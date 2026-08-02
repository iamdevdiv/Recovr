import fs from 'node:fs/promises'
import path from 'node:path'
import { Backup } from '../models/Backup.js'
import { Collection } from '../models/Collection.js'
import { Case } from '../models/Case.js'
import { backupsDir } from './uploadConfig.js'
import { generateExcelForCollection } from '../routes/fos.js'

function buildTagData(c, sheet) {
  if (!sheet) return {};
  const tagToSourceCol = {};
  for (const col of sheet.standardColumns || []) {
    if (col.tag && col.tag !== 'None' && String(col.tag).trim() !== '') {
      const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === col.label);
      if (!tagToSourceCol[col.tag]) tagToSourceCol[col.tag] = [];
      tagToSourceCol[col.tag].push(mapping ? mapping.sourceColumn : col.label);
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

export async function createBackup(collectionId, note, type = 'auto', userId = null) {
  try {
    const collection = await Collection.findById(collectionId).lean()
    if (!collection) throw new Error('Collection not found')

    const cases = await Case.find({ collectionId }).lean()

    const previousBackup = await Backup.findOne({ collectionId }).sort({ createdAt: -1 }).lean()
    
    let changesDetail = null
    
    if (previousBackup && !note.startsWith('Before ')) {
      changesDetail = { mode: 'auto-diff', changes: [], structuralChanges: [], addedCases: 0, deletedCases: 0, addedCaseList: [], deletedCaseList: [] }
      
      const oldSheets = previousBackup.structure.sheets || []
      const newSheets = collection.sheets || []
      
      for (const ns of newSheets) {
        const os = oldSheets.find(s => s.name === ns.name)
        if (!os) {
          changesDetail.structuralChanges.push(`Added sheet: ${ns.name}`)
          continue
        }
        const oldCols = os.standardColumns.map(c => c.label)
        const newCols = ns.standardColumns.map(c => c.label)
        
        const addedCols = newCols.filter(c => !oldCols.includes(c))
        const removedCols = oldCols.filter(c => !newCols.includes(c))
        
        if (addedCols.length) changesDetail.structuralChanges.push(`Added columns in ${ns.name}: ${addedCols.join(', ')}`)
        if (removedCols.length) changesDetail.structuralChanges.push(`Removed columns in ${ns.name}: ${removedCols.join(', ')}`)
      }
      for (const os of oldSheets) {
        if (!newSheets.find(s => s.name === os.name)) {
          changesDetail.structuralChanges.push(`Deleted sheet: ${os.name}`)
        }
      }

      try {
        const oldCasesData = await fs.readFile(previousBackup.casesFilePath, 'utf8')
        const oldCases = JSON.parse(oldCasesData)
        
        const oldMap = new Map(oldCases.map(c => [String(c._id), c]))
        const newMap = new Map(cases.map(c => [String(c._id), c]))
        
        for (const nc of cases) {
          const sheetObj = newSheets.find(s => s.name === nc.sheetName)
          const ncTagData = buildTagData(nc, sheetObj)
          const oc = oldMap.get(String(nc._id))
          
          if (!oc) {
            changesDetail.addedCases++
            changesDetail.changes.push({
              _id: nc._id,
              loanNumber: nc.loanNumber || nc.rawData?.['Loan No'] || 'Unknown Loan',
              tagData: ncTagData,
              changes: []
            })
            continue
          }
          
          const caseDiff = []
          
          const normalizeVal = (val) => {
            if (val instanceof Date || Object.prototype.toString.call(val) === '[object Date]') return val.toISOString()
            if (val !== null && typeof val === 'object' && typeof val.toISOString === 'function') return val.toISOString()
            if (val === null || val === undefined) return ''
            return String(val)
          }

          const allKeys = new Set([...Object.keys(nc.rawData || {}), ...Object.keys(oc.rawData || {})])
          for (const key of allKeys) {
            const oldVal = oc.rawData?.[key] ?? ''
            const newVal = nc.rawData?.[key] ?? ''
            if (normalizeVal(oldVal) !== normalizeVal(newVal)) {
              caseDiff.push({ col: key, old: normalizeVal(oldVal), new: normalizeVal(newVal) })
            }
          }
          
          const oldSheetObj = oldSheets.find(s => s.name === oc.sheetName)
          const ocTagData = buildTagData(oc, oldSheetObj)


          
          if (nc.sheetName !== oc.sheetName) {
            caseDiff.push({ col: 'Sheet (Moved)', old: oc.sheetName, new: nc.sheetName })
          }

          if (caseDiff.length > 0) {
            changesDetail.changes.push({
              _id: nc._id,
              loanNumber: nc.loanNumber || nc.rawData?.['Loan No'] || 'Unknown',
              tagData: ncTagData,
              changes: caseDiff
            })
          }
        }
        
        for (const oc of oldCases) {
          if (!newMap.has(String(oc._id))) {
            const oldSheetObj = oldSheets.find(s => s.name === oc.sheetName)
            const ocTagData = buildTagData(oc, oldSheetObj)

            changesDetail.deletedCases++
            changesDetail.changes.push({
              _id: oc._id,
              loanNumber: oc.loanNumber || oc.rawData?.['Loan No'] || 'Unknown Loan',
              tagData: ocTagData,
              changes: []
            })
          }
        }
      } catch (err) {
        console.error('Error computing diff:', err)
      }
      
      // Allow changesDetail to remain an empty object so the UI can explicitly show "No changes" instead of becoming unclickable.
    }

    const backup = new Backup({
      collectionId,
      note,
      type,
      createdBy: userId,
      structure: collection,
      ...(changesDetail && { changesDetail })
    })
    
    const filename = `${backup._id}.json`
    const filePath = path.join(backupsDir, filename)
    await fs.writeFile(filePath, JSON.stringify(cases))

    backup.casesFilePath = filePath
    backup.isLatest = true
    
    await Backup.updateMany({ collectionId }, { $set: { isLatest: false } })
    await backup.save()

    return backup
  } catch (err) {
    console.error('Failed to create backup:', err)
    // Don't throw, let the main operation proceed if backup fails
  }
}

export async function restoreBackup(backupId, userId = null) {
  const backup = await Backup.findById(backupId)
  if (!backup) throw new Error('Backup not found')

  const { collectionId, structure, casesFilePath } = backup

  // Read the cases from the JSON file
  const casesData = await fs.readFile(casesFilePath, 'utf8')
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d*)?(?:[-+]\d{2}:?\d{2}|Z)?$/
  const cases = JSON.parse(casesData, (key, value) => {
    if (typeof value === 'string' && isoDateRegex.test(value)) {
      const d = new Date(value)
      if (!isNaN(d.getTime())) return d
    }
    return value
  })

  // Remove existing cases and insert backup cases
  await Case.deleteMany({ collectionId })
  
  // Format cases for insertion (remove _id to let mongo generate new ones or keep old ones?)
  // Actually, keeping old _id is fine, but it might be safer to remove them or just insertMany directly since we deleted all of them.
  // We keep them so any references remain intact (if any).
  await Case.insertMany(cases)

  // Update collection structure
  await Collection.updateOne(
    { _id: collectionId },
    { $set: { sheets: structure.sheets, name: structure.name, rawColumns: structure.rawColumns, month: structure.month, year: structure.year } }
  )

  // Regenerate Excel
  await generateExcelForCollection(collectionId.toString())

  // Mark restored backup as Latest and unmark others, instead of changing createdAt
  await Backup.updateMany({ collectionId }, { $set: { isLatest: false } })
  await Backup.updateOne({ _id: backupId }, { $set: { isLatest: true } })
}
