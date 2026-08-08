import express from 'express'
import { Collection } from '../models/Collection.js'
import { Case } from '../models/Case.js'
import { User } from '../models/User.js'
import { autoEnablePermissions, getEmployeeIdFromReq, filterCasesByFosPermission } from '../utils/helpers.js'
import { generateExcelForCollection } from './fos.js'

const router = express.Router()

router.get('/workbooks', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  let collections = await Collection.find({ isWorkbook: true }).sort({ numericId: -1 }).lean()
  if (employeeId) {
    const user = await User.findOne({ employeeId })
    if (user && user.role === 'Manager') {
      const perms = user.permissions || {}
      collections = collections.filter(c => perms[c._id.toString()]?.enabled)
    }
  }
  res.json({ collections })
})

router.get('/cases', async (req, res) => {
  const { collectionId, sheetName } = req.query
  if (!collectionId || !sheetName) return res.status(400).json({ message: 'collectionId and sheetName are required.' })

  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })
  const user = await User.findOne({ employeeId })
  if (!user) return res.status(404).json({ message: 'User not found.' })

  const collection = await Collection.findById(collectionId).lean()
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheet = collection.sheets.find(s => s.name === sheetName)
  if (!sheet) return res.status(404).json({ message: 'Sheet not found.' })

  let cases = await Case.find({ collectionId, sheetName }).lean()

  cases = await filterCasesByFosPermission(employeeId, collectionId, sheetName, cases)

  const tagToSourceCol = {};
  for (const col of sheet.standardColumns) {
    if (col.tag && col.tag !== 'None' && String(col.tag).trim() !== '') {
      const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === col.label);
      if (!tagToSourceCol[col.tag]) tagToSourceCol[col.tag] = [];
      tagToSourceCol[col.tag].push(mapping ? mapping.sourceColumn : col.label);
    }
  }

  const mappedCases = cases.map(c => {
    const data = c.rawData || {}
    const getVal = (tag) => {
      const sourceCols = tagToSourceCol[tag]
      return sourceCols && sourceCols.length > 0 ? (data[sourceCols[0]] ?? '') : ''
    }

    const tagData = {}
    for (const [tag, cols] of Object.entries(tagToSourceCol)) {
      const vals = [];
      for (const col of cols) {
        const val = data[col];
        if (val !== null && val !== undefined && String(val).trim() !== '' && String(val).trim() !== 'None') {
          vals.push(val);
        }
      }
      if (vals.length > 0) {
        tagData[tag] = vals.length > 1 ? vals : vals[0];
      }
    }

    return {
      _id: c._id,
      loanNumber: getVal('Loan No') || c.loanNumber,
      customerName: getVal('Customer Name'),
      address: getVal('Address'),
      pinCode: getVal('Pin Code'),
      bucket: getVal('Bucket'),
      emi: getVal('EMI Amount'),
      pos: getVal('POS'),
      fos: getVal('FOS'),
      newCase: getVal('New Case'),
      fosCol: tagToSourceCol['FOS'] && tagToSourceCol['FOS'][0] ? tagToSourceCol['FOS'][0] : null, 
      rawData: data,
      tagData
    }
  })

  res.json({ cases: mappedCases })
})

router.put('/cases', async (req, res) => {
  const { caseIds, fosIdentifier, collectionId, sheetName } = req.body
  if (!caseIds || !Array.isArray(caseIds) || !collectionId || !sheetName) {
    return res.status(400).json({ message: 'caseIds array, collectionId, and sheetName are required.' })
  }

  const collection = await Collection.findById(collectionId)
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheet = collection.sheets.find(s => s.name === sheetName)
  if (!sheet) return res.status(404).json({ message: 'Sheet not found.' })

  const fosCol = sheet.standardColumns.find(c => c.tag === 'FOS')
  if (!fosCol) return res.status(400).json({ message: 'This sheet does not have an FOS tagged column.' })

  const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === fosCol.label)
  const sourceCol = mapping ? mapping.sourceColumn : fosCol.label

  const updatePath = `rawData.${sourceCol}`
  await Case.updateMany(
    { _id: { $in: caseIds } },
    { $set: { [updatePath]: fosIdentifier } }
  )

  const result = await generateExcelForCollection(collectionId)
  if (!result) return res.status(500).json({ message: 'Allocated, but failed to regenerate Excel file.' })

  const employeeId = getEmployeeIdFromReq(req)
  await autoEnablePermissions(collectionId, sheetName, [fosIdentifier], employeeId)

  res.json({ message: 'Allocation successful.', updatedCount: caseIds.length })
})

export default router
