import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { Collection } from '../models/Collection.js'
import { Case } from '../models/Case.js'
import { User } from '../models/User.js'
import { tempDir } from '../utils/uploadConfig.js'
import { autoEnablePermissions, getDistinctFosNames, getEmployeeIdFromReq, filterCasesByFosPermission } from '../utils/helpers.js'
import { generateExcelForCollection } from './fos.js'
import { createBackup } from '../utils/backupHelper.js'

const router = express.Router()

router.post('/', async (req, res) => {
  const { tempId, label, sheets } = req.body
  if (!tempId || !label) return res.status(400).json({ message: 'Missing fields.' })

  const tempFilePath = path.join(tempDir, tempId)
  if (!fs.existsSync(tempFilePath)) return res.status(404).json({ message: 'Temp file expired or missing.' })

  let workbook
  try {
    workbook = XLSX.read(fs.readFileSync(tempFilePath), { cellDates: true, raw: false, type: 'buffer' })
  } catch (err) {
    return res.status(422).json({ message: 'Could not parse the uploaded file.' })
  }

  const count = await Collection.countDocuments()
  const refCol = await Collection.create({
    name: label,
    isWorkbook: false,
    isReference: true,
    sheets: sheets.map(s => {
      const ws = workbook.Sheets[s]
      const rows = ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : []
      const rawColumns = rows.length > 0 ? Object.keys(rows[0]) : []
      return { name: s, standardColumns: [], lastMapping: [], rawColumns }
    })
  })

  const ops = []
  for (const sheetName of sheets) {
    const ws = workbook.Sheets[sheetName]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
    for (let i = 0; i < rows.length; i++) {
      const rawData = { ...rows[i] }
      ops.push({
        insertOne: {
          document: {
            collectionId: refCol._id,
            sheetName,
            loanNumber: `REF_${refCol.numericId}_${sheetName}_${i}`,
            rawData,
            status: 'UNPAID'
          }
        }
      })
    }
  }

  if (ops.length > 0) {
    await Case.bulkWrite(ops, { ordered: false })
  }
  try { fs.unlinkSync(tempFilePath) } catch { /* ignore */ }
  return res.json({ message: 'Reference saved.', reference: refCol })
})

router.get('/', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  let references = await Collection.find({ isReference: true }).sort({ createdAt: -1 }).lean()
  if (employeeId) {
    const user = await User.findOne({ employeeId })
    if (user && user.role === 'Manager') {
      const perms = user.permissions || {}
      references = references.filter(c => !c.isWorkbook || perms[c._id.toString()]?.enabled)
    }
  }
  return res.json({ references })
})

router.delete('/:id', async (req, res) => {
  const ref = await Collection.findById(req.params.id)
  if (!ref) return res.status(404).json({ message: 'Reference not found.' })

  if (ref.isWorkbook) {
    await Collection.findByIdAndUpdate(ref._id, { isReference: false })
    return res.json({ message: 'Reference removed from dropdown.' })
  }

  if (ref.excelFilePath && fs.existsSync(ref.excelFilePath)) {
    try { fs.unlinkSync(ref.excelFilePath) } catch (err) { /* ignore */ }
  }
  await Case.deleteMany({ collectionId: ref._id })
  await Collection.findByIdAndDelete(ref._id)
  return res.json({ message: 'Reference deleted.' })
})

router.post('/apply-count/:collectionId', async (req, res) => {
  const { refId, refSheet, targetSheet, lookupMapping, dataMapping, overwriteExisting = false, filters = [] } = req.body
  if (!refId || !lookupMapping?.targetColumn || !lookupMapping?.refColumn || !dataMapping?.length || !targetSheet) {
    return res.status(400).json({ message: 'Invalid reference mapping payload.' })
  }

  const collection = await Collection.findById(req.params.collectionId)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const refDoc = await Collection.findById(refId).lean()
  if (!refDoc || !refDoc.isReference) return res.status(404).json({ message: 'Reference file not found.' })

  const sheet = refSheet || (refDoc.sheets && refDoc.sheets[0] ? refDoc.sheets[0].name : 'Sheet1')
  const refCases = await Case.find({ collectionId: refDoc._id, sheetName: sheet }).lean()

  const refLookup = new Map()
  for (const refCase of refCases) {
    const key = String(refCase.rawData?.[lookupMapping.refColumn] ?? '').trim()
    if (key && !refLookup.has(key)) refLookup.set(key, refCase.rawData || {})
  }

  const sheetIdx = collection.sheets.findIndex(s => s.name === targetSheet)
  if (sheetIdx === -1) return res.status(404).json({ message: 'Target sheet not found.' })
  const targetSheetObj = collection.sheets[sheetIdx]
  const sheetMappingMap = new Map((targetSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))

  let cases = await Case.find({ collectionId: req.params.collectionId, sheetName: targetSheet }).lean()
  cases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), req.params.collectionId, targetSheet, cases)
  let updatedCount = 0

  for (const c of cases) {
    const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn
    const targetKey = String(c.rawData?.[lookupSrcCol] ?? '').trim()
    if (!targetKey || !refLookup.has(targetKey)) continue

    let passesFilters = true
    for (const f of filters) {
      const filterCol = sheetMappingMap.get(f.col) || f.col
      const val = String(c.rawData?.[filterCol] || '').trim()
      const effectiveVal = val === '' ? '__BLANKS__' : val
      if (f.selectedValues && f.selectedValues.length > 0) {
        if (!f.selectedValues.includes(effectiveVal) && !f.selectedValues.includes(val)) {
          passesFilters = false
          break
        }
      } else if (f.val && val !== f.val.trim()) {
        passesFilters = false
        break
      }
    }
    if (!passesFilters) continue

    const refRow = refLookup.get(targetKey)
    let hasData = false

    for (const dm of dataMapping) {
      const destCol = sheetMappingMap.get(dm.targetColumn) || dm.targetColumn
      const refVal = dm.refColumn === '__CUSTOM__' ? dm.customText : (dm.refColumn === '__CUSTOM_DATE__' && dm.customText ? new Date(dm.customText) : refRow[dm.refColumn])

      if (refVal === undefined || refVal === null || String(refVal).trim() === '') {
        continue
      }

      let shouldUpdate = true
      if (!overwriteExisting) {
        const existingVal = c.rawData?.[destCol]
        if (existingVal !== undefined && existingVal !== null && String(existingVal).trim() !== '') {
          shouldUpdate = false
        }
      }

      if (shouldUpdate) {
        hasData = true
      }
    }

    if (hasData) {
      updatedCount++
    }
  }

  return res.json({ count: updatedCount })
})

router.get('/unique-values/:collectionId', async (req, res) => {
  const { sheet, col } = req.query
  if (!sheet || !col) return res.status(400).json({ message: 'Missing sheet or col' })

  const collection = await Collection.findById(req.params.collectionId).lean()
  if (!collection) return res.status(404).json({ message: 'Collection not found' })

  const sheetObj = collection.sheets.find(s => s.name === sheet)
  if (!sheetObj) return res.status(404).json({ message: 'Sheet not found' })

  const sheetMappingMap = new Map((sheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))
  const actualCol = sheetMappingMap.get(col) || col

  const uniqueValues = await Case.distinct(`rawData.${actualCol}`, { collectionId: req.params.collectionId, sheetName: sheet })
  const nonBlanks = uniqueValues.filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(String).sort()

  // Check if any cases have a blank value for this column (null, undefined, or empty string)
  const totalCount = await Case.countDocuments({ collectionId: req.params.collectionId, sheetName: sheet })
  const nonBlankCount = await Case.countDocuments({
    collectionId: req.params.collectionId,
    sheetName: sheet,
    [`rawData.${actualCol}`]: { $exists: true, $nin: [null, '', undefined] }
  })
  const hasBlank = nonBlankCount < totalCount || uniqueValues.some(v => v === null || v === undefined || String(v).trim() === '')

  const filtered = hasBlank ? ['__BLANKS__', ...nonBlanks] : nonBlanks

  res.json({ uniqueValues: filtered })
})

router.post('/apply/:collectionId', async (req, res) => {
  const { refId, refSheet, targetSheet, lookupMapping, dataMapping, overwriteExisting = false, filters = [] } = req.body
  if (!refId || !lookupMapping?.targetColumn || !lookupMapping?.refColumn || !dataMapping?.length || !targetSheet) {
    return res.status(400).json({ message: 'Invalid reference mapping payload.' })
  }

  const collection = await Collection.findById(req.params.collectionId)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  await createBackup(req.params.collectionId, `Before applying reference data to ${targetSheet}`, 'auto', user?._id)

  const refDoc = await Collection.findById(refId).lean()
  if (!refDoc || !refDoc.isReference) return res.status(404).json({ message: 'Reference file not found.' })

  const sheet = refSheet || (refDoc.sheets && refDoc.sheets[0] ? refDoc.sheets[0].name : 'Sheet1')
  const refCases = await Case.find({ collectionId: refDoc._id, sheetName: sheet }).lean()

  const refLookup = new Map()
  for (const refCase of refCases) {
    const key = String(refCase.rawData?.[lookupMapping.refColumn] ?? '').trim()
    if (key && !refLookup.has(key)) refLookup.set(key, refCase.rawData || {})
  }

  const sheetIdx = collection.sheets.findIndex(s => s.name === targetSheet)
  if (sheetIdx === -1) return res.status(404).json({ message: 'Target sheet not found.' })
  const targetSheetObj = collection.sheets[sheetIdx]
  const sheetMappingMap = new Map((targetSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))

  let cases = await Case.find({ collectionId: req.params.collectionId, sheetName: targetSheet }).lean()
  cases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), req.params.collectionId, targetSheet, cases)
  let updatedCount = 0

  const bulkOps = []
  const caseChanges = []
  for (const c of cases) {
    const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn
    const targetKey = String(c.rawData?.[lookupSrcCol] ?? '').trim()
    if (!targetKey || !refLookup.has(targetKey)) continue

    let passesFilters = true
    for (const f of filters) {
      const filterCol = sheetMappingMap.get(f.col) || f.col
      const val = String(c.rawData?.[filterCol] || '').trim()
      const effectiveVal = val === '' ? '__BLANKS__' : val
      if (f.selectedValues && f.selectedValues.length > 0) {
        if (!f.selectedValues.includes(effectiveVal) && !f.selectedValues.includes(val)) {
          passesFilters = false
          break
        }
      } else if (f.val && val !== f.val.trim()) {
        passesFilters = false
        break
      }
    }
    if (!passesFilters) continue

    const refRow = refLookup.get(targetKey)
    const newRawData = { ...c.rawData }

    const newMappingEntries = []
    let hasData = false
    const changes = []

    for (const dm of dataMapping) {
      const destCol = sheetMappingMap.get(dm.targetColumn) || dm.targetColumn
      const refVal = dm.refColumn === '__CUSTOM__' ? dm.customText : (dm.refColumn === '__CUSTOM_DATE__' && dm.customText ? new Date(dm.customText) : refRow[dm.refColumn])

      if (refVal === undefined || refVal === null || String(refVal).trim() === '') {
        continue
      }

      let shouldUpdate = true
      if (!overwriteExisting) {
        const existingVal = c.rawData?.[destCol]
        if (existingVal !== undefined && existingVal !== null && String(existingVal).trim() !== '') {
          shouldUpdate = false
        }
      }

      if (shouldUpdate) {
        changes.push({ col: dm.targetColumn, old: c.rawData?.[destCol], new: refVal })
        newRawData[destCol] = refVal ?? ''
        hasData = true
      }

      if (targetSheetObj.standardColumns.some(sc => sc.label === dm.targetColumn)) {
        if (!targetSheetObj.lastMapping.some(m => m.standardLabel === dm.targetColumn)) {
          newMappingEntries.push({ standardLabel: dm.targetColumn, sourceColumn: dm.targetColumn })
        }
      }
    }

    if (newMappingEntries.length > 0) {
      await Collection.updateOne({ _id: collection._id }, { $push: { [`sheets.${sheetIdx}.lastMapping`]: { $each: newMappingEntries } } })
      targetSheetObj.lastMapping.push(...newMappingEntries)
      for (const entry of newMappingEntries) {
        sheetMappingMap.set(entry.standardLabel, entry.sourceColumn)
      }
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: c._id },
        update: { $set: { rawData: newRawData } },
      }
    })
    if (hasData) {
      caseChanges.push({ _id: c._id, tagData: c.tagData, loanNumber: c.rawData?.[sheetMappingMap.get('Loan No') || 'Loan No'], changes })
      updatedCount++
    }
  }

  if (bulkOps.length > 0) {
    await Case.bulkWrite(bulkOps, { ordered: false })
    await generateExcelForCollection(req.params.collectionId)
  }

  const fosNames = await getDistinctFosNames(req.params.collectionId, targetSheet)
  const employeeIdForPerm = getEmployeeIdFromReq(req)
  await autoEnablePermissions(req.params.collectionId, targetSheet, fosNames, employeeIdForPerm)

  await createBackup(req.params.collectionId, `After applying reference data to ${targetSheet}`, 'auto', user?._id)

  return res.json({ message: `Reference data applied to ${updatedCount} cases.`, updatedCount })
})

router.post('/move-cases', async (req, res) => {
  const { sourceColId, sourceSheet, destColId, destSheet, isNewDestSheet, refId, refSheet, lookupMapping, filters, deleteSource, overwriteDest, inputType, manualValues } = req.body

  if (!sourceColId || !sourceSheet || !destColId || !destSheet || !lookupMapping?.targetColumn) {
    return res.status(400).json({ message: 'Missing fields.' })
  }
  if (inputType !== 'manual' && (!lookupMapping?.refColumn || !refId)) {
    return res.status(400).json({ message: 'Missing fields.' })
  }

  const sourceCollection = await Collection.findById(sourceColId).lean()
  if (!sourceCollection) return res.status(404).json({ message: 'Source collection not found.' })

  const destCollection = await Collection.findById(destColId)
  if (!destCollection) return res.status(404).json({ message: 'Destination collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  await createBackup(sourceColId, `Before moving cases from ${sourceSheet} to ${destSheet}`, 'auto', user?._id)
  if (String(sourceColId) !== String(destColId)) {
    await createBackup(destColId, `Before receiving cases from ${sourceSheet}`, 'auto', user?._id)
  }

  let refValues = new Set()
  if (inputType === 'manual') {
    if (manualValues && Array.isArray(manualValues)) {
      manualValues.forEach(v => {
        if (v.trim()) refValues.add(v.trim())
      })
    }
  } else {
    const refDoc = await Collection.findById(refId).lean()
    if (!refDoc) return res.status(404).json({ message: 'Reference file not found.' })

    const refCases = await Case.find({ collectionId: refDoc._id, sheetName: refSheet }).lean()
    refValues = new Set(refCases.map(c => String(c.rawData?.[lookupMapping.refColumn] || '').trim()).filter(Boolean))
  }

  if (refValues.size === 0) {
    return res.status(400).json({ message: 'No valid lookup values found in reference file.' })
  }

  const sourceSheetObj = sourceCollection.sheets.find(s => s.name === sourceSheet)
  if (!sourceSheetObj) return res.status(404).json({ message: 'Source sheet not found.' })
  const sheetMappingMap = new Map((sourceSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))
  const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn

  let sourceCases = await Case.find({ collectionId: sourceColId, sheetName: sourceSheet }).lean()
  sourceCases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), sourceColId, sourceSheet, sourceCases)
  let casesToMove = []

  for (const c of sourceCases) {
    const targetKey = String(c.rawData?.[lookupSrcCol] || '').trim()
    if (!targetKey || !refValues.has(targetKey)) continue

    let passesFilters = true
    for (const f of filters) {
      const filterCol = sheetMappingMap.get(f.col) || f.col
      const val = String(c.rawData?.[filterCol] || '').trim()
      const effectiveVal = val === '' ? '__BLANKS__' : val
      if (f.selectedValues && f.selectedValues.length > 0) {
        if (!f.selectedValues.includes(effectiveVal) && !f.selectedValues.includes(val)) {
          passesFilters = false
          break
        }
      } else if (f.val && val !== f.val.trim()) {
        passesFilters = false
        break
      }
    }

    if (passesFilters) {
      casesToMove.push(c)
    }
  }

  if (casesToMove.length === 0) {
    return res.status(400).json({ message: 'No cases matched the reference data and filters.' })
  }

  if (isNewDestSheet) {
    if (!destCollection.sheets.find(s => s.name === destSheet)) {
      destCollection.sheets.push({
        name: destSheet,
        standardColumns: sourceSheetObj.standardColumns || [],
        rawColumns: sourceSheetObj.rawColumns || [],
        lastMapping: sourceSheetObj.lastMapping || []
      })
      await destCollection.save()
    }
  }

  let movedCount = 0
  let skippedCount = 0

  const destCases = await Case.find({ collectionId: destColId, sheetName: destSheet }).lean()
  const destLoanNumbers = new Set(destCases.map(c => c.loanNumber))

  const ops = []
  const moveChanges = []

  for (const c of casesToMove) {
    const exists = destLoanNumbers.has(c.loanNumber)
    if (exists && !overwriteDest) {
      skippedCount++
      continue
    }

    if (exists && overwriteDest) {
      ops.push({
        deleteOne: {
          filter: { collectionId: destColId, sheetName: destSheet, loanNumber: c.loanNumber }
        }
      })
    }

    if (deleteSource) {
      ops.push({
        updateOne: {
          filter: { _id: c._id },
          update: { $set: { collectionId: destColId, sheetName: destSheet } }
        }
      })
    } else {
      const newCase = { ...c }
      delete newCase._id
      delete newCase.createdAt
      delete newCase.updatedAt
      newCase.collectionId = destColId
      newCase.sheetName = destSheet
      ops.push({
        insertOne: {
          document: newCase
        }
      })
    }
    moveChanges.push({ _id: c._id, loanNumber: c.loanNumber, tagData: c.tagData, destination: destSheet })
    movedCount++
  }

  if (ops.length > 0) {
    const deleteOps = ops.filter(o => o.deleteOne)
    const writeOps = ops.filter(o => !o.deleteOne)

    if (deleteOps.length > 0) {
      await Case.bulkWrite(deleteOps, { ordered: false })
    }
    if (writeOps.length > 0) {
      await Case.bulkWrite(writeOps, { ordered: false })
    }

    await generateExcelForCollection(destColId)
    if (deleteSource && String(sourceColId) !== String(destColId)) {
      await generateExcelForCollection(sourceColId)
    }
  }

  await createBackup(sourceColId, `After moving cases from ${sourceSheet} to ${destSheet}`, 'auto', user?._id)
  if (String(sourceColId) !== String(destColId)) {
    await createBackup(destColId, `After receiving cases from ${sourceSheet}`, 'auto', user?._id)
  }

  return res.json({ message: `Successfully ${deleteSource ? 'moved' : 'copied'} ${movedCount} cases. ${skippedCount > 0 ? `(${skippedCount} skipped due to duplicates)` : ''}` })
})

router.post('/move-cases-count', async (req, res) => {
  const { sourceColId, sourceSheet, destColId, destSheet, overwriteDest, refId, refSheet, lookupMapping, filters, inputType, manualValues } = req.body

  if (!sourceColId || !sourceSheet || !lookupMapping?.targetColumn) {
    return res.status(400).json({ message: 'Missing fields.' })
  }
  if (inputType !== 'manual' && (!lookupMapping?.refColumn || !refId)) {
    return res.status(400).json({ message: 'Missing fields.' })
  }

  const sourceCollection = await Collection.findById(sourceColId).lean()
  if (!sourceCollection) return res.status(404).json({ message: 'Source collection not found.' })

  let refValues = new Set()
  if (inputType === 'manual') {
    if (manualValues && Array.isArray(manualValues)) {
      manualValues.forEach(v => {
        if (v.trim()) refValues.add(v.trim())
      })
    }
  } else {
    const refDoc = await Collection.findById(refId).lean()
    if (!refDoc) return res.status(404).json({ message: 'Reference file not found.' })

    const refCases = await Case.find({ collectionId: refDoc._id, sheetName: refSheet }).lean()
    refValues = new Set(refCases.map(c => String(c.rawData?.[lookupMapping.refColumn] || '').trim()).filter(Boolean))
  }

  if (refValues.size === 0) return res.json({ totalMatched: 0, skippedCount: 0, actuallyMoved: 0, destExistingCount: undefined })

  const sourceSheetObj = sourceCollection.sheets.find(s => s.name === sourceSheet)
  if (!sourceSheetObj) return res.json({ totalMatched: 0, skippedCount: 0, actuallyMoved: 0, destExistingCount: undefined })

  const sheetMappingMap = new Map((sourceSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))
  const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn

  let sourceCases = await Case.find({ collectionId: sourceColId, sheetName: sourceSheet }).lean()
  sourceCases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), sourceColId, sourceSheet, sourceCases)

  let destLoanNumbers = new Set()
  let destExistingCount = undefined
  if (destColId && destSheet) {
    const destCases = await Case.find({ collectionId: destColId, sheetName: destSheet }).lean()
    destExistingCount = destCases.length
    destLoanNumbers = new Set(destCases.map(c => c.loanNumber))
  }

  let totalMatched = 0
  let skippedCount = 0

  for (const c of sourceCases) {
    const targetKey = String(c.rawData?.[lookupSrcCol] || '').trim()
    if (!targetKey || !refValues.has(targetKey)) continue

    let passesFilters = true
    for (const f of filters) {
      const filterCol = sheetMappingMap.get(f.col) || f.col
      const val = String(c.rawData?.[filterCol] || '').trim()
      const effectiveVal = val === '' ? '__BLANKS__' : val
      if (f.selectedValues && f.selectedValues.length > 0) {
        if (!f.selectedValues.includes(effectiveVal) && !f.selectedValues.includes(val)) {
          passesFilters = false
          break
        }
      } else if (f.val && val !== f.val.trim()) {
        passesFilters = false
        break
      }
    }

    if (passesFilters) {
      totalMatched++
      if (destLoanNumbers.has(c.loanNumber) && !overwriteDest) {
        skippedCount++
      }
    }
  }

  const actuallyMoved = totalMatched - skippedCount
  return res.json({ totalMatched, skippedCount, actuallyMoved, destExistingCount })
})

router.post('/find-new-cases-count/:collectionId', async (req, res) => {
  const { targetSheet, refFiles, lookupMapping } = req.body
  if (!targetSheet || !refFiles?.length || !lookupMapping?.targetColumn || !refFiles.every(r => r.refColumn)) {
    return res.status(400).json({ message: 'Invalid payload.' })
  }

  const collection = await Collection.findById(req.params.collectionId)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheetIdx = collection.sheets.findIndex(s => s.name === targetSheet)
  if (sheetIdx === -1) return res.status(404).json({ message: 'Target sheet not found.' })
  const targetSheetObj = collection.sheets[sheetIdx]
  const sheetMappingMap = new Map((targetSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))

  const refLookup = new Set()
  for (const ref of refFiles) {
    const refCases = await Case.find({ collectionId: ref.id, sheetName: ref.sheet }).select('rawData').lean()
    for (const rc of refCases) {
      const key = String(rc.rawData?.[ref.refColumn] ?? '').trim()
      if (key) refLookup.add(key)
    }
  }

  let targetCases = await Case.find({ collectionId: req.params.collectionId, sheetName: targetSheet }).select('rawData').lean()
  targetCases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), req.params.collectionId, targetSheet, targetCases)
  let newCasesCount = 0

  for (const c of targetCases) {
    const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn
    const targetKey = String(c.rawData?.[lookupSrcCol] ?? '').trim()
    if (!targetKey || !refLookup.has(targetKey)) {
      newCasesCount++
    }
  }

  return res.json({ count: newCasesCount })
})

router.post('/find-new-cases/:collectionId', async (req, res) => {
  const { targetSheet, refFiles, lookupMapping, newMarker } = req.body
  if (!targetSheet || !refFiles?.length || !lookupMapping?.targetColumn || !refFiles.every(r => r.refColumn) || !newMarker?.targetColumn) {
    return res.status(400).json({ message: 'Invalid payload.' })
  }

  const collection = await Collection.findById(req.params.collectionId)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const employeeId = getEmployeeIdFromReq(req)
  const user = employeeId ? await User.findOne({ employeeId }) : null

  await createBackup(req.params.collectionId, `Before marking new cases on ${targetSheet}`, 'auto', user?._id)

  const sheetIdx = collection.sheets.findIndex(s => s.name === targetSheet)
  if (sheetIdx === -1) return res.status(404).json({ message: 'Target sheet not found.' })
  const targetSheetObj = collection.sheets[sheetIdx]
  const sheetMappingMap = new Map((targetSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))

  const refLookup = new Set()
  for (const ref of refFiles) {
    const refCases = await Case.find({ collectionId: ref.id, sheetName: ref.sheet }).select('rawData').lean()
    for (const rc of refCases) {
      const key = String(rc.rawData?.[ref.refColumn] ?? '').trim()
      if (key) refLookup.add(key)
    }
  }

  let targetCases = await Case.find({ collectionId: req.params.collectionId, sheetName: targetSheet }).lean()
  targetCases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), req.params.collectionId, targetSheet, targetCases)
  let newCasesCount = 0
  const bulkOps = []
  const newCasesChanges = []

  for (const c of targetCases) {
    const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn
    const targetKey = String(c.rawData?.[lookupSrcCol] ?? '').trim()

    if (!targetKey || !refLookup.has(targetKey)) {
      const newRawData = { ...c.rawData }
      const destCol = sheetMappingMap.get(newMarker.targetColumn) || newMarker.targetColumn

      let shouldUpdate = true
      if (!newMarker.overwriteExisting) {
        const existingVal = c.rawData?.[destCol]
        if (existingVal !== undefined && existingVal !== null && String(existingVal).trim() !== '') {
          shouldUpdate = false
        }
      }

      if (shouldUpdate) {
        newRawData[destCol] = newMarker.markText ?? 'NEW'
        bulkOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: { rawData: newRawData } } } })
        newCasesChanges.push({ _id: c._id, loanNumber: c.loanNumber, tagData: c.tagData, changes: [{ col: newMarker.targetColumn, old: c.rawData?.[destCol] ?? '', new: newMarker.markText ?? 'NEW' }] })
        newCasesCount++
      }
    }
  }

  if (bulkOps.length > 0) {
    if (targetSheetObj.standardColumns.some(sc => sc.label === newMarker.targetColumn)) {
      if (!targetSheetObj.lastMapping.some(m => m.standardLabel === newMarker.targetColumn)) {
        const newMappingEntries = [{ standardLabel: newMarker.targetColumn, sourceColumn: newMarker.targetColumn }]
        await Collection.updateOne({ _id: collection._id }, { $push: { [`sheets.${sheetIdx}.lastMapping`]: { $each: newMappingEntries } } })
      }
    }

    await Case.bulkWrite(bulkOps, { ordered: false })
    await generateExcelForCollection(req.params.collectionId)
  }

  await createBackup(req.params.collectionId, `After marking new cases on ${targetSheet}`, 'auto', user?._id)

  return res.json({ message: `Found and marked ${newCasesCount} new cases.`, updatedCount: newCasesCount })
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

router.post('/apply-preview/:collectionId', async (req, res) => {
  const { refId, refSheet, targetSheet, lookupMapping, dataMapping, overwriteExisting = false, filters = [] } = req.body
  if (!refId || !lookupMapping?.targetColumn || !lookupMapping?.refColumn || !dataMapping?.length || !targetSheet) {
    return res.status(400).json({ message: 'Invalid reference mapping payload.' })
  }

  const collection = await Collection.findById(req.params.collectionId).lean()
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const refDoc = await Collection.findById(refId).lean()
  if (!refDoc) return res.status(404).json({ message: 'Reference file not found.' })

  const sheet = refSheet || (refDoc.sheets && refDoc.sheets[0] ? refDoc.sheets[0].name : 'Sheet1')
  const refCases = await Case.find({ collectionId: refDoc._id, sheetName: sheet }).lean()

  const refLookup = new Map()
  for (const refCase of refCases) {
    const key = String(refCase.rawData?.[lookupMapping.refColumn] ?? '').trim()
    if (key && !refLookup.has(key)) refLookup.set(key, refCase.rawData || {})
  }

  const sheetIdx = collection.sheets.findIndex(s => s.name === targetSheet)
  if (sheetIdx === -1) return res.status(404).json({ message: 'Target sheet not found.' })
  const targetSheetObj = collection.sheets[sheetIdx]
  const sheetMappingMap = new Map((targetSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))

  let cases = await Case.find({ collectionId: req.params.collectionId, sheetName: targetSheet }).lean()
  cases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), req.params.collectionId, targetSheet, cases)
  const preview = []

  for (const c of cases) {
    const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn
    const targetKey = String(c.rawData?.[lookupSrcCol] ?? '').trim()
    if (!targetKey || !refLookup.has(targetKey)) continue

    let passesFilters = true
    for (const f of filters) {
      const filterCol = sheetMappingMap.get(f.col) || f.col
      const val = String(c.rawData?.[filterCol] || '').trim()
      if (f.selectedValues && f.selectedValues.length > 0) {
        if (!f.selectedValues.includes(val)) {
          passesFilters = false
          break
        }
      } else if (f.val && val !== f.val.trim()) {
        passesFilters = false
        break
      }
    }
    if (!passesFilters) continue

    const refRow = refLookup.get(targetKey)
    let hasData = false
    const changes = []

    for (const dm of dataMapping) {
      const destCol = sheetMappingMap.get(dm.targetColumn) || dm.targetColumn
      const refVal = dm.refColumn === '__CUSTOM__' ? dm.customText : (dm.refColumn === '__CUSTOM_DATE__' && dm.customText ? new Date(dm.customText) : refRow[dm.refColumn])

      if (refVal === undefined || refVal === null || String(refVal).trim() === '') {
        continue
      }

      let shouldUpdate = true
      if (!overwriteExisting) {
        const existingVal = c.rawData?.[destCol]
        if (existingVal !== undefined && existingVal !== null && String(existingVal).trim() !== '') {
          shouldUpdate = false
        }
      }

      if (shouldUpdate) {
        changes.push({ col: dm.targetColumn, old: c.rawData?.[destCol] ?? '', new: refVal ?? '' })
        hasData = true
      }
    }

    if (hasData) {
      preview.push({
        _id: c._id,
        loanNumber: c.loanNumber,
        tagData: buildTagData(c, targetSheetObj),
        changes
      })
    }
  }

  return res.json({ preview })
})

router.post('/find-new-cases-preview/:collectionId', async (req, res) => {
  const { targetSheet, refFiles, lookupMapping, newMarker } = req.body
  if (!targetSheet || !refFiles?.length || !lookupMapping?.targetColumn || !refFiles.every(r => r.refColumn) || !newMarker?.targetColumn) {
    return res.status(400).json({ message: 'Invalid payload.' })
  }

  const collection = await Collection.findById(req.params.collectionId).lean()
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheetIdx = collection.sheets.findIndex(s => s.name === targetSheet)
  if (sheetIdx === -1) return res.status(404).json({ message: 'Target sheet not found.' })
  const targetSheetObj = collection.sheets[sheetIdx]
  const sheetMappingMap = new Map((targetSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))

  const refLookup = new Set()
  for (const ref of refFiles) {
    const refCases = await Case.find({ collectionId: ref.id, sheetName: ref.sheet }).select('rawData').lean()
    for (const rc of refCases) {
      const key = String(rc.rawData?.[ref.refColumn] ?? '').trim()
      if (key) refLookup.add(key)
    }
  }

  let targetCases = await Case.find({ collectionId: req.params.collectionId, sheetName: targetSheet }).lean()
  targetCases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), req.params.collectionId, targetSheet, targetCases)
  const preview = []

  for (const c of targetCases) {
    const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn
    const targetKey = String(c.rawData?.[lookupSrcCol] ?? '').trim()

    if (!targetKey || !refLookup.has(targetKey)) {
      const destCol = sheetMappingMap.get(newMarker.targetColumn) || newMarker.targetColumn
      let shouldUpdate = true
      if (!newMarker.overwriteExisting) {
        const existingVal = c.rawData?.[destCol]
        if (existingVal !== undefined && existingVal !== null && String(existingVal).trim() !== '') {
          shouldUpdate = false
        }
      }

      if (shouldUpdate) {
        preview.push({
          _id: c._id,
          loanNumber: c.loanNumber,
          tagData: buildTagData(c, targetSheetObj),
          changes: [{ col: newMarker.targetColumn, old: c.rawData?.[destCol] ?? '', new: newMarker.markText ?? 'NEW' }]
        })
      }
    }
  }

  return res.json({ preview })
})

router.post('/move-cases-preview', async (req, res) => {
  const { sourceColId, sourceSheet, destColId, destSheet, overwriteDest, refId, refSheet, lookupMapping, filters, inputType, manualValues } = req.body
  if (!sourceColId || !sourceSheet || !lookupMapping?.targetColumn) {
    return res.status(400).json({ message: 'Missing fields.' })
  }
  if (inputType !== 'manual' && (!lookupMapping?.refColumn || !refId)) {
    return res.status(400).json({ message: 'Missing fields.' })
  }

  const sourceCollection = await Collection.findById(sourceColId).lean()
  if (!sourceCollection) return res.status(404).json({ message: 'Source collection not found.' })

  let refValues = new Set()
  if (inputType === 'manual') {
    if (manualValues && Array.isArray(manualValues)) {
      manualValues.forEach(v => {
        if (v.trim()) refValues.add(v.trim())
      })
    }
  } else {
    const refDoc = await Collection.findById(refId).lean()
    if (!refDoc) return res.status(404).json({ message: 'Reference file not found.' })

    const refCases = await Case.find({ collectionId: refDoc._id, sheetName: refSheet }).lean()
    refValues = new Set(refCases.map(c => String(c.rawData?.[lookupMapping.refColumn] || '').trim()).filter(Boolean))
  }

  if (refValues.size === 0) return res.json({ preview: [] })

  const sourceSheetObj = sourceCollection.sheets.find(s => s.name === sourceSheet)
  if (!sourceSheetObj) return res.json({ preview: [] })

  const sheetMappingMap = new Map((sourceSheetObj.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))
  const lookupSrcCol = sheetMappingMap.get(lookupMapping.targetColumn) || lookupMapping.targetColumn
  let sourceCases = await Case.find({ collectionId: sourceColId, sheetName: sourceSheet }).lean()
  sourceCases = await filterCasesByFosPermission(getEmployeeIdFromReq(req), sourceColId, sourceSheet, sourceCases)

  let destLoanNumbers = new Set()
  if (destColId && destSheet) {
    const destCases = await Case.find({ collectionId: destColId, sheetName: destSheet }).lean()
    destLoanNumbers = new Set(destCases.map(c => c.loanNumber))
  }

  const preview = []

  for (const c of sourceCases) {
    const targetKey = String(c.rawData?.[lookupSrcCol] || '').trim()
    if (!targetKey || !refValues.has(targetKey)) continue

    let passesFilters = true
    for (const f of filters) {
      const filterCol = sheetMappingMap.get(f.col) || f.col
      const val = String(c.rawData?.[filterCol] || '').trim()
      const effectiveVal = val === '' ? '__BLANKS__' : val
      if (f.selectedValues && f.selectedValues.length > 0) {
        if (!f.selectedValues.includes(effectiveVal) && !f.selectedValues.includes(val)) {
          passesFilters = false
          break
        }
      } else if (f.val && val !== f.val.trim()) {
        passesFilters = false
        break
      }
    }

    if (passesFilters) {
      if (destLoanNumbers.has(c.loanNumber) && !overwriteDest) continue

      preview.push({
        _id: c._id,
        loanNumber: c.loanNumber,
        tagData: buildTagData(c, sourceSheetObj),
        destination: destSheet || 'New Sheet'
      })
    }
  }

  return res.json({ preview })
})

export default router
