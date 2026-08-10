import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { Collection } from '../models/Collection.js'
import { Case } from '../models/Case.js'
import { User } from '../models/User.js'
import { upload, tempDir, collectionsDir } from '../utils/uploadConfig.js'
import { autoEnablePermissions, getDistinctFosNames, getEmployeeIdFromReq, filterCasesByFosPermission, pushNewDefaultTagsToUsers } from '../utils/helpers.js'
import { generateExcelForCollection, generateExcelForAdmin } from './fos.js'
import { autoTagColumnsWithAI } from '../utils/aiTagging.js'
import { TAGS } from '../utils/constants.js'
import { createBackup } from '../utils/backupHelper.js'

const router = express.Router()

function sheetData(ws) {
  if (!ws || !ws['!ref']) return { columns: [], columnUniqueValues: {}, rowCount: 0 }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  const colSet = new Set()
  const uvMap = new Map()
  for (const row of rows) {
    for (const [col, val] of Object.entries(row)) {
      const key = String(col).trim()
      if (!key) continue
      colSet.add(key)
      if (!uvMap.has(key)) uvMap.set(key, new Set())
      const str = String(val ?? '').trim()
      if (str && uvMap.get(key).size < 300) uvMap.get(key).add(str)
    }
  }
  const columns = [...colSet]
  const columnUniqueValues = {}
  for (const [col, set] of uvMap.entries()) {
    columnUniqueValues[col] = [...set].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }),
    )
  }
  return { columns, columnUniqueValues, rowCount: rows.length }
}

function parseWorkbook(filePath) {
  const buffer = fs.readFileSync(filePath)
  const workbook = XLSX.read(buffer, { cellDates: true, raw: false, type: 'buffer' })

  const perSheetData = {}
  let totalRows = 0
  for (const name of workbook.SheetNames) {
    const sd = sheetData(workbook.Sheets[name])
    perSheetData[name] = sd
    totalRows += sd.rowCount
  }

  const firstSheet = perSheetData[workbook.SheetNames[0]] ?? { columns: [], columnUniqueValues: {} }

  return {
    sheets: workbook.SheetNames,
    totalRows,
    columns: firstSheet.columns,
    columnUniqueValues: firstSheet.columnUniqueValues,
    perSheetData,
  }
}

router.get('/', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  let list = await Collection.find({ isWorkbook: true }).sort({ numericId: -1 }).lean()
  if (employeeId) {
    const user = await User.findOne({ employeeId })
    if (user && user.role === 'Manager') {
      const perms = user.permissions || {}
      list = list.filter(c => perms[c._id.toString()]?.enabled)
    }
  }
  return res.json({ collections: list })
})

router.post('/', async (req, res) => {
  const { name, month, year, isWorkbook = true, isReference = true } = req.body
  if (!name?.trim()) return res.status(400).json({ message: 'Collection name is required.' })
  const count = await Collection.countDocuments()
  const col = await Collection.create({ name: name.trim(), isWorkbook, isReference, month, year: year ? Number(year) : undefined })
  return res.status(201).json({ collection: col })
})

router.get('/:id', async (req, res) => {
  const col = await Collection.findById(req.params.id).lean()
  if (!col) return res.status(404).json({ message: 'Collection not found.' })
  return res.json({ collection: col })
})

router.get('/:id/sheets/:sheetName/count', async (req, res) => {
  const count = await Case.countDocuments({ collectionId: req.params.id, sheetName: req.params.sheetName })
  return res.json({ count })
})

router.get('/:id/sheets/:sheetName/loan-numbers', async (req, res) => {
  const cases = await Case.find({ collectionId: req.params.id, sheetName: req.params.sheetName }, { loanNumber: 1, _id: 0 }).lean()
  const loanNumbers = cases.map(c => c.loanNumber).filter(Boolean)
  return res.json({ loanNumbers })
})

router.post('/preview', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file received.' })
  let parsed
  try {
    parsed = parseWorkbook(req.file.path)
  } catch (err) {
    console.error('[preview]', err)
    try { fs.unlinkSync(req.file.path) } catch { /* ignore */ }
    return res.status(422).json({ message: 'Could not parse the file. Make sure it is a valid .xlsx or .xls workbook.' })
  }
  return res.json({ tempId: req.file.filename, originalName: req.file.originalname, ...parsed })
})

router.post('/import-count', async (req, res) => {
  const { tempId, sheet, filters = [], collectionId, targetSheetName, keyCol } = req.body
  if (!tempId) return res.status(400).json({ message: 'tempId is required.' })

  const tempPath = path.join(tempDir, tempId)
  if (!fs.existsSync(tempPath)) return res.status(404).json({ message: 'Upload session expired.' })

  let workbook
  try {
    workbook = XLSX.read(fs.readFileSync(tempPath), { cellDates: true, raw: false, type: 'buffer' })
  } catch (err) {
    return res.status(422).json({ message: 'Could not parse the uploaded file.' })
  }

  const sheetName = sheet && workbook.SheetNames.includes(sheet) ? sheet : workbook.SheetNames[0]
  const ws = workbook.Sheets[sheetName]
  if (!ws) return res.status(422).json({ message: `Sheet "${sheetName}" not found.` })

  let rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  const activeFilters = filters.filter((f) => f.col && Array.isArray(f.selectedValues) && f.selectedValues.length > 0)
  for (const { col, selectedValues } of activeFilters) {
    const valSet = new Set(selectedValues)
    rows = rows.filter((r) => valSet.has(String(r[col] ?? '').trim()))
  }

  let newCasesCount = rows.length
  let overlapCount = 0
  let existingSheetCount = 0

  if (collectionId && targetSheetName) {
    existingSheetCount = await Case.countDocuments({ collectionId, sheetName: targetSheetName })
    if (keyCol) {
      const incomingKeys = rows.map(r => String(r[keyCol] ?? '').trim()).filter(Boolean)
      if (incomingKeys.length > 0) {
        const existingCases = await Case.find({ collectionId, sheetName: targetSheetName, loanNumber: { $in: incomingKeys } }).select('loanNumber').lean()
        overlapCount = existingCases.length
        newCasesCount = incomingKeys.length - overlapCount
      }
    }
  }

  return res.json({ count: rows.length, newCases: newCasesCount, overlapCount, existingSheetCount })
})

router.post('/import', async (req, res) => {
  const {
    tempId,
    collectionId,
    sheet,
    filters = [],
    keyCol,
    targetSheetName,
    sourceColumns = [],
    isNewSheet = false,
  } = req.body

  if (!tempId || !collectionId || !keyCol) {
    return res.status(400).json({ message: 'tempId, collectionId, and keyCol are required.' })
  }

  const collection = await Collection.findById(collectionId)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  const isNewSheetCreation = targetSheetName && !collection.sheets.some((s) => s.name === targetSheetName)
  if (collection.sheets.length > 0) {
    await createBackup(collectionId, `Before import to ${targetSheetName}`, 'auto', user?._id)
  }

  const tempPath = path.join(tempDir, tempId)
  if (!fs.existsSync(tempPath)) {
    return res.status(404).json({ message: 'Upload session expired. Please re-upload the file.' })
  }

  let workbook
  try {
    workbook = XLSX.read(fs.readFileSync(tempPath), { cellDates: true, raw: false, type: 'buffer' })
  } catch (err) {
    console.error('[import] parse error:', err)
    return res.status(422).json({ message: 'Could not parse the uploaded file.' })
  }

  const sheetName = sheet && workbook.SheetNames.includes(sheet) ? sheet : workbook.SheetNames[0]
  const ws = workbook.Sheets[sheetName]
  if (!ws) return res.status(422).json({ message: `Sheet "${sheetName}" not found.` })

  let rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  const activeFilters = filters.filter((f) => f.col && Array.isArray(f.selectedValues) && f.selectedValues.length > 0)
  for (const { col, selectedValues } of activeFilters) {
    const valSet = new Set(selectedValues)
    rows = rows.filter((r) => valSet.has(String(r[col] ?? '').trim()))
  }
  if (rows.length === 0) {
    return res.status(422).json({ message: 'No rows match the applied filters.' })
  }

  const ops = rows.map((row) => {
    const loanNumber = String(row[keyCol] ?? '').trim()
    if (!loanNumber) return null
    const rawData = { ...row }
    return {
      updateOne: {
        filter: { collectionId: collection._id, loanNumber, sheetName: targetSheetName },
        update: { $setOnInsert: { rawData, loanNumber, collectionId: collection._id, status: 'UNPAID', sheetName: targetSheetName } },
        upsert: true,
      },
    }
  }).filter(Boolean)

  let result
  try {
    result = await Case.bulkWrite(ops, { ordered: false })
  } catch (err) {
    console.error('[import] bulkWrite error:', err)
    return res.status(500).json({ message: 'Database write failed. ' + err.message })
  }

  if (targetSheetName && !collection.sheets.some((s) => s.name === targetSheetName)) {
    collection.sheets.push({ name: targetSheetName, standardColumns: [], lastMapping: [] })
    await collection.save()
  }

  let genResult = null
  if (isNewSheet) {
    try {
      const newSheetCases = await Case.find({ collectionId, sheetName: targetSheetName }).lean()
      if (newSheetCases.length) {
        const cols = sourceColumns.map(String)
        const excelPath = path.join(collectionsDir, `${collection._id}.xlsx`)

        const rows = newSheetCases.map((c) => {
          const row = {}
          for (const col of cols) row[col] = c.rawData?.[col] ?? ''
          return row
        })

        let existingSheets = []
        if (fs.existsSync(excelPath)) {
          try {
            const existingWb = XLSX.read(fs.readFileSync(excelPath), { type: 'buffer' })
            for (const sheetNm of existingWb.SheetNames) {
              if (sheetNm === targetSheetName) continue
              const existingRows = XLSX.utils.sheet_to_json(existingWb.Sheets[sheetNm], { defval: '' })
              const existingHeaders = existingRows.length > 0 ? Object.keys(existingRows[0]) : []
              existingSheets.push({ name: sheetNm, headers: existingHeaders, rows: existingRows })
            }
          } catch { /* ignore read errors – start fresh */ }
        }

        const { buildAndWriteExcel } = await import('../utils/excelFormatter.js')
        const allSheets = [...existingSheets, { name: targetSheetName, headers: cols, rows }]
        await buildAndWriteExcel(allSheets, excelPath)
        await Collection.findByIdAndUpdate(collectionId, { excelFilePath: excelPath })
        genResult = { rowCount: newSheetCases.length }
      }
    } catch (genErr) {
      console.error('[import] new-sheet excel write error:', genErr)
    }
  }

  const totalCases = await Case.countDocuments({ collectionId: collection._id.toString() })
  const sheetTotal = await Case.countDocuments({ collectionId: collection._id.toString(), sheetName: targetSheetName })
  await Collection.findByIdAndUpdate(collectionId, { caseCount: totalCases })

  const fosNames = await getDistinctFosNames(collectionId, targetSheetName)
  const employeeIdForPerms = getEmployeeIdFromReq(req)
  await autoEnablePermissions(collectionId, targetSheetName, fosNames, employeeIdForPerms)

  await createBackup(collectionId, `After import to ${targetSheetName}`, 'auto', user?._id)

  const importedLoanNumbers = result.upsertedIds 
    ? Object.keys(result.upsertedIds).map(idx => ops[idx].updateOne.filter.loanNumber)
    : []

  return res.json({
    message: 'Import complete.',
    collection: { _id: collection._id, name: collection.name, numericId: collection.numericId },
    total: rows.length,
    imported: result.upsertedCount,
    updated: result.modifiedCount,
    newCaseIds: Object.values(result.upsertedIds || {}),
    importedLoanNumbers,
    sheetTotal,
    overallTotal: totalCases,
    genResult,
  })
})

router.post('/:id/generate', async (req, res) => {
  const { tempId, standardColumns, mapping, newCaseIds = [], sheetNames, isNewWorkbook, isNewSheet } = req.body
  const targetSheets = sheetNames || []
  if (!standardColumns?.length || !mapping?.length || targetSheets.length === 0 || !targetSheets[0]) {
    return res.status(400).json({ message: 'standardColumns, mapping, and at least one sheetName are required.' })
  }

  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  // Backup before change
  if (!isNewWorkbook && collection.sheets.length > 0) {
    await createBackup(req.params.id, `Before column mapping generation for ${targetSheets.join(', ')}`, 'auto', user?._id)
  }

  const finalMapping = []
  const customUpdates = {}
  for (const m of mapping) {
    if (m.customText != null) {
      const val = m.isCustomDate && m.customText ? new Date(m.customText) : m.customText
      customUpdates[`rawData.${m.standardLabel}`] = val
      finalMapping.push({ standardLabel: m.standardLabel, sourceColumn: m.standardLabel, customText: val })
    } else {
      finalMapping.push({ standardLabel: m.standardLabel, sourceColumn: m.sourceColumn })
    }
  }

  if (Object.keys(customUpdates).length > 0 && newCaseIds.length > 0) {
    await Case.updateMany(
      { _id: { $in: newCaseIds } },
      { $set: customUpdates }
    )
  }

  const oldStandardColumnsMap = {}
  
  for (const sName of targetSheets) {
    let sheetIdx = collection.sheets.findIndex(s => s.name === sName)
    
    const finalStandardColumns = standardColumns.map(sc => {
      let tag = sc.tag;
      if (!tag && sheetIdx !== -1) {
        const existing = collection.sheets[sheetIdx].standardColumns.find(c => c.label === sc.label);
        if (existing && existing.tag) tag = existing.tag;
      }
      return { ...sc, tag };
    });

    if (isNewWorkbook || isNewSheet) {
      const untaggedCols = finalStandardColumns.filter(sc => !sc.tag).map(sc => sc.label);
      if (untaggedCols.length > 0) {
        const sampleCase = await Case.findOne({ collectionId: req.params.id, sheetName: sName }).lean();
        const sampleData = sampleCase ? sampleCase.rawData : {};
        const usedTags = new Set(finalStandardColumns.filter(sc => sc.tag).map(sc => sc.tag));
        const aiAvailableTags = TAGS.filter(t => t === 'Reference name' || t === 'Reference mobile' || !usedTags.has(t));
        const aiMappings = await autoTagColumnsWithAI(untaggedCols, aiAvailableTags, sampleData);

        for (const sc of finalStandardColumns) {
          if (!sc.tag && aiMappings[sc.label]) {
            const proposedTag = aiMappings[sc.label];
            if (proposedTag !== 'Reference name' && proposedTag !== 'Reference mobile' && usedTags.has(proposedTag)) {
              continue;
            }
            sc.tag = proposedTag;
            usedTags.add(proposedTag);
          }
        }
      }
    }

    const oldStandardColumns = sheetIdx !== -1 ? collection.sheets[sheetIdx].standardColumns.map(sc => sc.toObject()) : []
    oldStandardColumnsMap[sName] = oldStandardColumns

    if (sheetIdx !== -1) {
      collection.sheets[sheetIdx].set('standardColumns', finalStandardColumns)
      collection.sheets[sheetIdx].set('lastMapping', finalMapping)
    } else {
      collection.sheets.push({ name: sName, standardColumns: finalStandardColumns, lastMapping: finalMapping })
    }
  }

  collection.markModified('sheets')
  await collection.save()

  for (const sName of targetSheets) {
    await pushNewDefaultTagsToUsers(req.params.id, sName, oldStandardColumnsMap[sName], collection.sheets.find(s => s.name === sName).standardColumns)
  }

  const result = await generateExcelForCollection(req.params.id)
  if (!result) return res.status(422).json({ message: 'Failed to generate Excel.' })

  if (tempId) {
    try { fs.unlinkSync(path.join(tempDir, tempId)) } catch { /* ignore */ }
  }

  const employeeIdForPerms = getEmployeeIdFromReq(req)
  for (const sName of targetSheets) {
    const fosNames = await getDistinctFosNames(req.params.id, sName)
    await autoEnablePermissions(req.params.id, sName, fosNames, employeeIdForPerms)
  }

  // Backup after change
  await createBackup(req.params.id, `After column mapping generation for ${targetSheets.join(', ')}`, 'auto', user?._id)

  return res.json({ message: 'Excel generated successfully.', rowCount: result.rowCount, fileName: `${collection._id}.xlsx` })
})

router.put('/:id/structure', async (req, res) => {
  const { standardColumns, renames = [], sheetName } = req.body
  if (!standardColumns?.length || !sheetName) return res.status(400).json({ message: 'standardColumns and sheetName are required.' })

  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  // Backup before change
  await createBackup(req.params.id, `Before structure update on ${sheetName}`, 'auto', user?._id)

  const sheetIdx = collection.sheets.findIndex((s) => s.name === sheetName)
  if (sheetIdx === -1) return res.status(404).json({ message: `Sheet "${sheetName}" not found in this collection.` })

  const sheet = collection.sheets[sheetIdx]
  let updatedMapping = [...(sheet.lastMapping || [])]

  for (const { old, new: newLabel } of renames) {
    const existing = updatedMapping.find(m => m.standardLabel === old)
    if (existing) {
      existing.standardLabel = newLabel
    } else {
      updatedMapping.push({ standardLabel: newLabel, sourceColumn: old })
    }
  }

  const validLabels = new Set(standardColumns.map((c) => c.label))
  const newLastMapping = updatedMapping.filter((m) => validLabels.has(m.standardLabel))

  const finalStandardColumns = standardColumns.map(sc => {
    let tag = sc.tag;
    if (!tag) {
      const existing = sheet.standardColumns.find(c => c.label === sc.label);
      if (existing && existing.tag) {
        tag = existing.tag;
      } else {
        const renameMatch = renames.find(r => r.new === sc.label);
        if (renameMatch) {
          const oldExisting = sheet.standardColumns.find(c => c.label === renameMatch.old);
          if (oldExisting && oldExisting.tag) tag = oldExisting.tag;
        }
      }
    }
    return { ...sc, tag };
  });

  const untaggedCols = finalStandardColumns.filter(sc => !sc.tag).map(sc => sc.label);
  if (untaggedCols.length > 0) {
    const sampleCase = await Case.findOne({ collectionId: req.params.id, sheetName: sheetName }).lean();
    const sampleData = sampleCase ? sampleCase.rawData : {};
    const usedTags = new Set(finalStandardColumns.filter(sc => sc.tag).map(sc => sc.tag));
    const aiAvailableTags = TAGS.filter(t => t === 'Reference name' || t === 'Reference mobile' || !usedTags.has(t));
    const aiMappings = await autoTagColumnsWithAI(untaggedCols, aiAvailableTags, sampleData);

    for (const sc of finalStandardColumns) {
      if (!sc.tag && aiMappings[sc.label]) {
        const proposedTag = aiMappings[sc.label];
        if (proposedTag !== 'Reference name' && proposedTag !== 'Reference mobile' && usedTags.has(proposedTag)) {
          continue;
        }
        sc.tag = proposedTag;
        usedTags.add(proposedTag);
      }
    }
  }

  const oldStandardColumns = collection.sheets[sheetIdx].standardColumns.map(sc => sc.toObject())

  collection.sheets[sheetIdx].set('standardColumns', finalStandardColumns)
  collection.sheets[sheetIdx].set('lastMapping', newLastMapping)
  collection.markModified('sheets')
  await collection.save()

  await pushNewDefaultTagsToUsers(req.params.id, sheetName, oldStandardColumns, finalStandardColumns)

  const result = await generateExcelForCollection(req.params.id)
  if (!result) return res.status(422).json({ message: 'Failed to regenerate Excel.' })

  const fosNames = await getDistinctFosNames(req.params.id, sheetName)
  const employeeIdForPerms = getEmployeeIdFromReq(req)
  await autoEnablePermissions(req.params.id, sheetName, fosNames, employeeIdForPerms)

  // Backup after change
  await createBackup(req.params.id, `After structure update on ${sheetName}`, 'auto', user?._id)

  return res.json({ message: 'Collection structure updated.', collection: await Collection.findById(req.params.id).lean() })
})

router.put('/:id/tags', async (req, res) => {
  const { sheetName, tagsMapping } = req.body
  if (!sheetName || !tagsMapping) return res.status(400).json({ message: 'sheetName and tagsMapping are required.' })

  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  const sheetIdx = collection.sheets.findIndex((s) => s.name === sheetName)
  if (sheetIdx === -1) return res.status(404).json({ message: `Sheet "${sheetName}" not found in this collection.` })

  const sheet = collection.sheets[sheetIdx]

  const oldStandardColumns = sheet.standardColumns.map(sc => sc.toObject())

  const newStandardColumns = sheet.standardColumns.map(sc => ({
    ...sc.toObject(),
    tag: tagsMapping[sc.label] || null
  }))

  collection.sheets[sheetIdx].set('standardColumns', newStandardColumns)
  collection.markModified('sheets')
  await collection.save()

  await pushNewDefaultTagsToUsers(req.params.id, sheetName, oldStandardColumns, newStandardColumns)

  return res.json({ message: 'Tags updated.', collection: await Collection.findById(req.params.id).lean() })
})

router.get('/:id/distinct', async (req, res) => {
  const { sheetName, column } = req.query
  if (!sheetName || !column) return res.status(400).json({ message: 'sheetName and column are required.' })

  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheetDef = collection.sheets.find(s => s.name === sheetName)
  if (!sheetDef) return res.status(404).json({ message: 'Sheet not found.' })

  const mapping = sheetDef.lastMapping.find(m => m.standardLabel === column)
  const sourceCol = mapping ? mapping.sourceColumn : column

  const employeeId = getEmployeeIdFromReq(req)
  let cases = await Case.find({ collectionId: req.params.id, sheetName }).lean()
  cases = await filterCasesByFosPermission(employeeId, req.params.id, sheetName, cases)
  const values = new Set()
  let hasBlank = false
  for (const c of cases) {
    const val = String(c.rawData?.[sourceCol] ?? '').trim()
    if (val) values.add(val)
    else hasBlank = true
  }
  const sorted = Array.from(values).sort()
  if (hasBlank) sorted.unshift('__BLANKS__')
  return res.json({ values: sorted })
})

router.post('/:id/bulk-update', async (req, res) => {
  const { sheetName, targetColumn, newValue, valueType, filters = [] } = req.body
  if (!sheetName || !targetColumn) return res.status(400).json({ message: 'sheetName and targetColumn are required.' })

  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheetIdx = collection.sheets.findIndex(s => s.name === sheetName)
  if (sheetIdx === -1) return res.status(404).json({ message: 'Sheet not found.' })
  const sheetDef = collection.sheets[sheetIdx]

  const targetMapping = sheetDef.lastMapping.find(m => m.standardLabel === targetColumn)
  const destCol = targetMapping ? targetMapping.sourceColumn : targetColumn

  const activeFilters = filters.map(f => {
    const m = sheetDef.lastMapping.find(map => map.standardLabel === f.column)
    return { sourceCol: m ? m.sourceColumn : f.column, selectedValues: new Set(f.selectedValues) }
  })

  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })
  const user = await User.findOne({ employeeId })
  if (!user) return res.status(404).json({ message: 'User not found.' })

  // Backup before change
  await createBackup(req.params.id, `Before bulk updating column ${targetColumn} on ${sheetName}`, 'auto', user?._id)

  let cases = await Case.find({ collectionId: req.params.id, sheetName }).lean()

  cases = await filterCasesByFosPermission(employeeId, req.params.id, sheetName, cases)
  const bulkOps = []
  let updatedCount = 0
  const bulkUpdateChanges = []

  for (const c of cases) {
    let match = true
    for (const f of activeFilters) {
      if (f.selectedValues.size === 0) continue
      const val = String(c.rawData?.[f.sourceCol] ?? '').trim()
      const effectiveVal = val === '' ? '__BLANKS__' : val
      if (!f.selectedValues.has(effectiveVal) && !f.selectedValues.has(val)) { match = false; break; }
    }
    if (!match) continue

    const finalValue = valueType === 'date' && newValue ? new Date(newValue) : (newValue ?? '')
    const oldVal = c.rawData?.[destCol] ?? ''

    const normalizeVal = (val) => {
      if (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]') return val.toISOString()
      if (val !== null && typeof val === 'object' && typeof val.toISOString === 'function') return val.toISOString()
      if (val === null || val === undefined) return ''
      return String(val)
    }

    if (normalizeVal(oldVal) === normalizeVal(finalValue)) continue

    const newRawData = { ...c.rawData }

    bulkUpdateChanges.push({
      _id: c._id,
      loanNumber: c.loanNumber || c.rawData?.['Loan No'] || 'Unknown Loan',
      tagData: c.tagData,
      changes: [{ col: targetColumn, old: c.rawData?.[destCol] ?? '', new: finalValue }]
    })

    newRawData[destCol] = finalValue
    bulkOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: { rawData: newRawData } } } })
    updatedCount++
  }

  if (bulkOps.length > 0) {
    if (sheetDef.standardColumns.some(sc => sc.label === targetColumn)) {
      if (!sheetDef.lastMapping.some(m => m.standardLabel === targetColumn)) {
        await Collection.updateOne({ _id: collection._id }, { $push: { [`sheets.${sheetIdx}.lastMapping`]: { standardLabel: targetColumn, sourceColumn: targetColumn } } })
      }
    }
    await Case.bulkWrite(bulkOps, { ordered: false })
    await generateExcelForCollection(req.params.id)

    // Backup after change
    await createBackup(req.params.id, `After bulk updating column ${targetColumn} on ${sheetName}`, 'auto', user?._id)
  }

  return res.json({ message: `Bulk update applied to ${updatedCount} cases.`, updatedCount })
})

function buildTagData(c, sheet) {
  const tagToSourceCol = {};
  for (const col of sheet.standardColumns) {
    if (col.tag && col.tag !== 'None' && String(col.tag).trim() !== '') {
      const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === col.label);
      const tags = col.tag.split(',').map(t => t.trim());
      for (const t of tags) {
        if (!tagToSourceCol[t]) tagToSourceCol[t] = [];
        tagToSourceCol[t].push(mapping ? mapping.sourceColumn : col.label);
      }
    }
  }
  const tagData = {};
  for (const [tag, cols] of Object.entries(tagToSourceCol)) {
    const vals = [];
    for (const col of cols) {
      const val = c.rawData?.[col];
      if (val !== null && val !== undefined && String(val).trim() !== '' && String(val).trim() !== 'None') {
        vals.push(val);
      }
    }
    if (vals.length > 0) {
      tagData[tag] = vals.length > 1 ? vals : vals[0];
    }
  }
  return tagData;
}

router.post('/:id/bulk-update-preview', async (req, res) => {
  const { sheetName, targetColumn, newValue, valueType, filters = [] } = req.body
  if (!sheetName || !targetColumn) return res.status(400).json({ message: 'sheetName and targetColumn are required.' })

  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheetIdx = collection.sheets.findIndex(s => s.name === sheetName)
  if (sheetIdx === -1) return res.status(404).json({ message: 'Sheet not found.' })
  const sheetDef = collection.sheets[sheetIdx]

  const targetMapping = sheetDef.lastMapping.find(m => m.standardLabel === targetColumn)
  const destCol = targetMapping ? targetMapping.sourceColumn : targetColumn

  const activeFilters = filters.map(f => {
    const m = sheetDef.lastMapping.find(map => map.standardLabel === f.column)
    return { sourceCol: m ? m.sourceColumn : f.column, selectedValues: new Set(f.selectedValues) }
  })

  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })
  const user = await User.findOne({ employeeId })
  if (!user) return res.status(404).json({ message: 'User not found.' })

  let cases = await Case.find({ collectionId: req.params.id, sheetName }).lean()

  cases = await filterCasesByFosPermission(employeeId, req.params.id, sheetName, cases)

  const preview = []

  for (const c of cases) {
    let match = true
    for (const f of activeFilters) {
      if (f.selectedValues.size === 0) continue
      const val = String(c.rawData?.[f.sourceCol] ?? '').trim()
      const effectiveVal = val === '' ? '__BLANKS__' : val
      if (!f.selectedValues.has(effectiveVal) && !f.selectedValues.has(val)) { match = false; break; }
    }
    if (!match) continue

    const finalValue = valueType === 'date' && newValue ? new Date(newValue) : (newValue ?? '')
    const oldVal = c.rawData?.[destCol] ?? ''

    const normalizeVal = (val) => {
      if (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]') return val.toISOString()
      if (val !== null && typeof val === 'object' && typeof val.toISOString === 'function') return val.toISOString()
      if (val === null || val === undefined) return ''
      return String(val)
    }

    if (normalizeVal(oldVal) === normalizeVal(finalValue)) continue

    preview.push({
      _id: c._id,
      loanNumber: c.loanNumber || c.rawData?.['Loan No'] || 'Unknown Loan',
      tagData: buildTagData(c, sheetDef),
      changes: [{ col: targetColumn, old: c.rawData?.[destCol] ?? '', new: finalValue }]
    })

    if (preview.length >= 50) break; // Limit preview size
  }

  return res.json({ preview })
})

router.post('/:id/bulk-update-count', async (req, res) => {
  const { sheetName, targetColumn, newValue, valueType, filters = [] } = req.body
  if (!sheetName) return res.status(400).json({ message: 'sheetName is required.' })

  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheetDef = collection.sheets.find(s => s.name === sheetName)
  if (!sheetDef) return res.status(404).json({ message: 'Sheet not found.' })

  let destCol = null
  if (targetColumn) {
    const targetMapping = sheetDef.lastMapping.find(m => m.standardLabel === targetColumn)
    destCol = targetMapping ? targetMapping.sourceColumn : targetColumn
  }

  const activeFilters = filters.map(f => {
    const m = sheetDef.lastMapping.find(map => map.standardLabel === f.column)
    return { sourceCol: m ? m.sourceColumn : f.column, selectedValues: new Set(f.selectedValues) }
  })

  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })
  const user = await User.findOne({ employeeId })
  if (!user) return res.status(404).json({ message: 'User not found.' })

  let cases = await Case.find({ collectionId: req.params.id, sheetName }).lean()

  cases = await filterCasesByFosPermission(employeeId, req.params.id, sheetName, cases)
  let matchCount = 0

  for (const c of cases) {
    let match = true
    for (const f of activeFilters) {
      if (f.selectedValues.size === 0) continue
      const val = String(c.rawData?.[f.sourceCol] ?? '').trim()
      const effectiveVal = val === '' ? '__BLANKS__' : val
      if (!f.selectedValues.has(effectiveVal) && !f.selectedValues.has(val)) { match = false; break; }
    }
    if (match) {
      if (targetColumn) {
        const finalValue = valueType === 'date' && newValue ? new Date(newValue) : (newValue ?? '')
        const oldVal = c.rawData?.[destCol] ?? ''

        const normalizeVal = (val) => {
          if (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]') return val.toISOString()
          if (val !== null && typeof val === 'object' && typeof val.toISOString === 'function') return val.toISOString()
          if (val === null || val === undefined) return ''
          return String(val)
        }

        if (normalizeVal(oldVal) !== normalizeVal(finalValue)) {
          matchCount++
        }
      } else {
        matchCount++
      }
    }
  }

  return res.json({ count: matchCount })
})

router.delete('/:id', async (req, res) => {
  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const deleteRef = req.query.deleteRef !== 'false'
  if (!deleteRef && collection.isReference) {
    await Collection.findByIdAndUpdate(collection._id, { isWorkbook: false })
    return res.json({ message: 'Workbook removed but reference data kept.' })
  }

  if (collection.excelFilePath && fs.existsSync(collection.excelFilePath)) {
    try { fs.unlinkSync(collection.excelFilePath) } catch (err) { console.error('Failed to delete excel:', err) }
  }

  await Case.deleteMany({ collectionId: collection._id })
  await Collection.findByIdAndDelete(collection._id)
  await User.updateMany(
    { 'lastViewedCases.colId': collection._id.toString() },
    { $set: { lastViewedCases: null } }
  )

  return res.json({ message: 'Collection deleted successfully.' })
})

router.delete('/:id/sheets/:sheetName', async (req, res) => {
  const { id, sheetName } = req.params
  const collection = await Collection.findById(id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  await createBackup(id, `Before deleting sheet ${sheetName}`, 'auto', user?._id)

  collection.sheets = collection.sheets.filter((s) => s.name !== sheetName)
  await collection.save()

  await Case.deleteMany({ collectionId: id, sheetName })

  const totalCases = await Case.countDocuments({ collectionId: id })
  await Collection.findByIdAndUpdate(id, { caseCount: totalCases })

  await User.updateMany(
    { 'lastViewedCases.colId': id, 'lastViewedCases.sheetName': sheetName },
    { $set: { lastViewedCases: null } }
  )

  await generateExcelForCollection(id)

  await createBackup(id, `After deleting sheet ${sheetName}`, 'auto', user?._id)

  return res.json({ message: 'Sheet deleted successfully.', collection: await Collection.findById(id).lean() })
})

router.get('/:id/download', async (req, res) => {
  const col = await Collection.findById(req.params.id).lean()
  if (!col) return res.status(404).json({ message: 'Collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })

  const user = await User.findOne({ employeeId })
  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) return res.status(403).json({ message: 'Forbidden. Only admins and managers can download workbooks.' })

  let result = await generateExcelForAdmin(req.params.id, user)
  let isTemp = true

  if (!result) return res.status(404).json({ message: 'No data found to generate Excel.' })

  res.download(result.excelPath, `${col.name.replace(/[<>:"/\\|?*]/g, '_')}.xlsx`, (err) => {
    if (isTemp && fs.existsSync(result.excelPath)) {
      try {
        fs.unlinkSync(result.excelPath)
      } catch (e) {
        console.error('Failed to clean up temp excel:', e)
      }
    }
  })
})

router.put('/:id/rename', async (req, res) => {
  const { newName } = req.body
  if (!newName?.trim()) return res.status(400).json({ message: 'New name is required.' })

  const collection = await Collection.findById(req.params.id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const oldName = collection.name
  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  collection.name = newName.trim()
  await collection.save()

  await createBackup(req.params.id, 'Workbook renamed', 'auto', user?._id, {
    structuralChanges: [`Renamed workbook from '${oldName}' to '${newName.trim()}'`],
    addedCases: 0,
    deletedCases: 0,
    changes: []
  })

  return res.json({ message: 'Workbook renamed successfully.', collection })
})

router.put('/:id/sheet/:sheetName/rename', async (req, res) => {
  const { newName } = req.body
  const { id, sheetName: oldName } = req.params
  if (!newName?.trim()) return res.status(400).json({ message: 'New name is required.' })
  const finalNewName = newName.trim()

  const collection = await Collection.findById(id)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheetIdx = collection.sheets.findIndex(s => s.name === oldName)
  if (sheetIdx === -1) return res.status(404).json({ message: `Sheet "${oldName}" not found.` })

  if (collection.sheets.some(s => s.name === finalNewName)) {
    return res.status(400).json({ message: 'A sheet with this name already exists in this workbook.' })
  }

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  collection.sheets[sheetIdx].name = finalNewName
  collection.markModified('sheets')
  await collection.save()

  await Case.updateMany(
    { collectionId: id, sheetName: oldName },
    { $set: { sheetName: finalNewName } }
  )

  await generateExcelForCollection(id)

  await createBackup(id, 'Sheet renamed', 'auto', user?._id, {
    structuralChanges: [`Renamed sheet from '${oldName}' to '${finalNewName}'`],
    addedCases: 0,
    deletedCases: 0,
    changes: []
  })

  return res.json({ message: 'Sheet renamed successfully.', collection })
})

export default router
