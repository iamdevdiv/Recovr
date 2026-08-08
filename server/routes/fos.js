import express from 'express'
import { User } from '../models/User.js'
import { Collection } from '../models/Collection.js'
import { Case } from '../models/Case.js'
import { getEmployeeIdFromReq, filterCasesByFosPermission } from '../utils/helpers.js'
import { buildAndWriteExcel } from '../utils/excelFormatter.js'
import { collectionsDir } from '../utils/uploadConfig.js'
import path from 'node:path'

const router = express.Router()

router.get('/settings', async (req, res) => {
  try {
    const employeeId = getEmployeeIdFromReq(req)
    if (!employeeId) return res.status(401).json({ error: 'Unauthorized' })
    const user = await User.findOne({ employeeId })
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json({ whatsappTemplates: user.whatsappTemplates || {} })
  } catch (error) {
    console.error('Error fetching settings:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/settings', async (req, res) => {
  try {
    const employeeId = getEmployeeIdFromReq(req)
    if (!employeeId) return res.status(401).json({ error: 'Unauthorized' })

    const { workbookId, sheetName, template } = req.body
    if (!workbookId || !sheetName || typeof template !== 'string') {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    const user = await User.findOne({ employeeId })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const templates = user.whatsappTemplates || {}
    if (!templates[workbookId]) templates[workbookId] = {}
    templates[workbookId][sheetName] = template

    user.whatsappTemplates = templates
    user.markModified('whatsappTemplates')
    await user.save()

    res.json({ success: true, whatsappTemplates: user.whatsappTemplates })
  } catch (error) {
    console.error('Error saving settings:', error)
    res.status(500).json({ error: 'Server error' })
  }
})

export async function generateExcelForCollection(collectionId) {
  const collection = await Collection.findById(collectionId)
  if (!collection || !collection.sheets?.length) return null

  const cases = await Case.find({ collectionId }).lean()
  if (cases.length === 0) return null

  const sheetGroups = new Map()
  for (const c of cases) {
    const sName = c.sheetName || 'Cases'
    if (!sheetGroups.has(sName)) sheetGroups.set(sName, [])
    sheetGroups.get(sName).push(c)
  }

  const sheetsPayload = []

  for (const [sName, sheetCases] of sheetGroups.entries()) {
    const sheetDef = collection.sheets?.find((s) => s.name === sName)
    if (!sheetDef || !sheetDef.standardColumns?.length) continue

    const sheetMappingMap = new Map((sheetDef.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))
    const sheetOrdered = [...sheetDef.standardColumns].sort((a, b) => a.order - b.order)
    const headers = sheetOrdered.map((c) => c.label)

    const rows = sheetCases.map((c) => {
      const row = {}
      for (const { label } of sheetOrdered) {
        const srcCol = sheetMappingMap.get(label)
        row[label] = srcCol ? (c.rawData?.[srcCol] ?? '') : (c.rawData?.[label] ?? '')
      }
      return row
    })

    sheetsPayload.push({ name: sName, headers, rows })
  }

  if (sheetsPayload.length === 0) return null

  const excelPath = path.join(collectionsDir, `${collection._id}.xlsx`)
  await buildAndWriteExcel(sheetsPayload, excelPath)
  await Collection.findByIdAndUpdate(collectionId, { excelFilePath: excelPath })
  return { excelPath, rowCount: cases.length }
}

export async function generateExcelForAdmin(collectionId, user) {
  const collection = await Collection.findById(collectionId)
  if (!collection || !collection.sheets?.length) return null

  const cases = await Case.find({ collectionId }).lean()
  if (cases.length === 0) return null

  const sheetGroups = new Map()
  for (const c of cases) {
    const sName = c.sheetName || 'Cases'
    if (!sheetGroups.has(sName)) sheetGroups.set(sName, [])
    sheetGroups.get(sName).push(c)
  }

  const sheetsPayload = []
  for (const [sName, sheetCases] of sheetGroups.entries()) {
    const sheetDef = collection.sheets?.find((s) => s.name === sName)
    if (!sheetDef || !sheetDef.standardColumns?.length) continue

    const sheetMappingMap = new Map((sheetDef.lastMapping || []).map((m) => [m.standardLabel, m.sourceColumn]))
    const sheetOrdered = [...sheetDef.standardColumns].sort((a, b) => a.order - b.order)
    const headers = sheetOrdered.map((c) => c.label)

    const filteredCases = await filterCasesByFosPermission(user.employeeId, collectionId, sName, sheetCases)

    const rows = filteredCases.map((c) => {
      const row = {}
      for (const { label } of sheetOrdered) {
        const srcCol = sheetMappingMap.get(label)
        row[label] = srcCol ? (c.rawData?.[srcCol] ?? '') : (c.rawData?.[label] ?? '')
      }
      return row
    })

    sheetsPayload.push({ name: sName, headers, rows })
  }

  if (sheetsPayload.length === 0) return null

  const excelPath = path.join(collectionsDir, `temp_${collection._id}_${Date.now()}.xlsx`)
  await buildAndWriteExcel(sheetsPayload, excelPath)
  return { excelPath, rowCount: cases.length }
}




router.get('/sheets', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })

  const user = await User.findOne({ employeeId })
  if (!user) return res.status(404).json({ message: 'User not found.' })

  const permissions = user.permissions || {}
  const enabledWorkbookIds = Object.entries(permissions)
    .filter(([, wb]) => wb.enabled)
    .map(([id]) => id)

  if (enabledWorkbookIds.length === 0) return res.json({ workbooks: [] })

  const collections = await Collection.find({ _id: { $in: enabledWorkbookIds }, isWorkbook: true }).lean()

  const workbooks = collections.map(col => {
    const wbPerm = permissions[col._id.toString()] || {}
    const enabledSheets = col.sheets
      .filter(s => {
        const sheetPerm = (wbPerm.sheets || {})[s.name]
        return sheetPerm && sheetPerm.enabled
      })
      .map(s => {
        const sheetPerm = (wbPerm.sheets || {})[s.name] || {}
        let visibleTags = sheetPerm.visibleTags || []
        if (user.role === 'Admin' || user.role === 'Manager') {
          const DEFAULT_VISIBLE_TAGS = [
            'Address', 'Bucket', 'Customer Name', 'Dealer', 'EMI Amount', 'EMI End Date',
            'EMI Start Date', 'Father Name', 'Loan No', 'Lot', 'Mobile number', 'New Case',
            'PTP', 'Number of EMI Paid', 'POS', 'Previous Paid Date', 'Paid Date', 'Collected Amount',
            'Mode of Payment', 'Pin Code', 'Product', 'Reference mobile', 'Reference name', 
            'Reference name and mobile', 'Registration Number', 'Status', 'Tenure', 'Vehicle'
          ]
          const sheetTags = s.standardColumns ? s.standardColumns.filter(c => c.tag).map(c => c.tag) : []
          visibleTags = sheetTags.filter(t => DEFAULT_VISIBLE_TAGS.includes(t))
        }

        return {
          name: s.name,
          visibleTags
        }
      })
    return {
      _id: col._id,
      name: col.name,
      sheets: enabledSheets
    }
  }).filter(w => w.sheets.length > 0)

  res.json({ workbooks })
})

router.get('/cases', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })

  const { collectionId, sheetName } = req.query
  if (!collectionId || !sheetName) return res.status(400).json({ message: 'collectionId and sheetName are required.' })

  const user = await User.findOne({ employeeId })
  if (!user) return res.status(404).json({ message: 'User not found.' })

  const wbPerm = (user.permissions || {})[collectionId]
  if (!wbPerm || !wbPerm.enabled) return res.status(403).json({ message: 'Access denied to this workbook.' })
  const sheetPerm = (wbPerm.sheets || {})[sheetName]
  if (!sheetPerm || !sheetPerm.enabled) return res.status(403).json({ message: 'Access denied to this sheet.' })

  let visibleTags = sheetPerm.visibleTags || []

  const collection = await Collection.findById(collectionId).lean()
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheet = collection.sheets.find(s => s.name === sheetName)
  if (!sheet) return res.status(404).json({ message: 'Sheet not found.' })

  if (user.role === 'Admin' || user.role === 'Manager') {
    const DEFAULT_VISIBLE_TAGS = [
      'Address', 'Bucket', 'Customer Name', 'Dealer', 'EMI Amount', 'EMI End Date',
      'EMI Start Date', 'Father Name', 'Loan No', 'Lot', 'Mobile number', 'New Case',
      'PTP', 'Number of EMI Paid', 'POS', 'Previous Paid Date', 'Paid Date', 'Collected Amount',
      'Mode of Payment', 'Pin Code', 'Product', 'Reference mobile', 'Reference name', 
      'Reference name and mobile', 'Registration Number', 'Status', 'Tenure', 'Vehicle'
    ]
    const sheetTags = sheet.standardColumns ? sheet.standardColumns.filter(c => c.tag).map(c => c.tag) : []
    visibleTags = sheetTags.filter(t => DEFAULT_VISIBLE_TAGS.includes(t))
  }

  const tagToSourceCol = {}
  for (const col of sheet.standardColumns) {
    if (col.tag) {
      const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === col.label)
      const sourceCol = mapping ? mapping.sourceColumn : col.label
      const tags = col.tag.split(',').map(t => t.trim())
      for (const t of tags) {
        if (tagToSourceCol[t]) {
          tagToSourceCol[t] += '|||' + sourceCol
        } else {
          tagToSourceCol[t] = sourceCol
        }
      }
    }
  }

  const fosSourceColStr = tagToSourceCol['FOS']
  const fosSourceCols = fosSourceColStr ? fosSourceColStr.split('|||') : []
  const fosId = user.fosIdentifier || user.employeeId

  const allCases = await Case.find({ collectionId, sheetName }).lean()
  const myFosCases = fosSourceCols.length > 0
    ? allCases.filter(c => {
      return fosSourceCols.some(sc => {
        const fosVal = String(c.rawData?.[sc] ?? '').trim()
        if (fosVal === user.employeeId) return true;
        if (user.fosIdentifier && fosVal === user.fosIdentifier) return true;
        return false;
      })
    })
    : allCases

  const getVal = (caseData, tag) => {
    const sourceColsStr = tagToSourceCol[tag]
    if (!sourceColsStr) return null
    const sourceCols = sourceColsStr.split('|||')
    const vals = sourceCols.map(sc => caseData[sc]).filter(v => v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim() !== 'None')
    if (vals.length === 0) return null
    if (vals.length === 1) return vals[0]
    return vals.join(' , ')
  }

  const mappedCases = myFosCases.map(c => {
    const data = c.rawData || {}
    const tagData = {}
    for (const tag of visibleTags) {
      const val = getVal(data, tag)
      if (val !== null && val !== undefined && String(val).trim() !== '' && String(val).trim() !== 'None') {
        tagData[tag] = val
      }
    }
    return {
      _id: c._id,
      loanNumber: getVal(data, 'Loan No') || c.loanNumber,
      ptpDate: c.ptpDate || null,
      hasPtpTime: c.hasPtpTime || false,
      newCase: getVal(data, 'New Case'),
      fosNotes: c.fosNotes || '',
      tagData
    }
  })

  res.json({ cases: mappedCases, tagToSourceCol })
})

router.get('/sheet-stats', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })

  const { collectionId, sheetName } = req.query
  if (!collectionId || !sheetName) return res.status(400).json({ message: 'collectionId and sheetName are required.' })

  const user = await User.findOne({ employeeId })
  if (!user) return res.status(404).json({ message: 'User not found.' })

  const collection = await Collection.findById(collectionId).lean()
  if (!collection) return res.status(404).json({ message: 'Collection not found.' })

  const sheet = collection.sheets.find(s => s.name === sheetName)
  if (!sheet) return res.status(404).json({ message: 'Sheet not found.' })

  const tagToSourceCol = {}
  for (const col of sheet.standardColumns) {
    if (col.tag) {
      const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === col.label)
      const sourceCol = mapping ? mapping.sourceColumn : col.label
      const tags = col.tag.split(',').map(t => t.trim())
      for (const t of tags) {
        if (tagToSourceCol[t]) {
          tagToSourceCol[t] += '|||' + sourceCol
        } else {
          tagToSourceCol[t] = sourceCol
        }
      }
    }
  }

  const fosSourceColStr = tagToSourceCol['FOS']
  const fosSourceCols = fosSourceColStr ? fosSourceColStr.split('|||') : []
  const statusSourceColStr = tagToSourceCol['Status']
  const statusSourceCols = statusSourceColStr ? statusSourceColStr.split('|||') : []
  const fosId = user.fosIdentifier || user.employeeId

  const allCases = await Case.find({ collectionId, sheetName }).lean()
  const myFosCases = fosSourceCols.length > 0
    ? allCases.filter(c => {
      return fosSourceCols.some(sc => {
        const fosVal = String(c.rawData?.[sc] ?? '').trim()
        if (fosVal === user.employeeId) return true;
        if (user.fosIdentifier && fosVal === user.fosIdentifier) return true;
        return false;
      })
    })
    : allCases

  const statusCounts = {}
  for (const c of myFosCases) {
    let status = 'UNKNOWN'
    if (statusSourceCols.length > 0) {
      for (const sc of statusSourceCols) {
        const s = String(c.rawData?.[sc] ?? '').trim().toUpperCase()
        if (s && s !== 'NONE') {
          status = s
          break
        }
      }
    }
    statusCounts[status] = (statusCounts[status] || 0) + 1
  }

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
  const todayPtpCount = myFosCases.filter(c => {
    if (!c.ptpDate) return false
    const ptpStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(c.ptpDate))
    return ptpStr === todayStr
  }).length

  res.json({
    total: myFosCases.length,
    statusCounts,
    todayPtpCount
  })
})

router.put('/cases/:id/ptp', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })

  const { ptpDate, hasTime, queuedAt } = req.body
  const caseDoc = await Case.findById(req.params.id)
  if (!caseDoc) return res.status(404).json({ message: 'Case not found.' })

  // Conflict detection: if admin updated this case after the FOS queued this mutation, admin wins
  if (queuedAt && caseDoc.lastAdminUpdate && new Date(caseDoc.lastAdminUpdate) > new Date(queuedAt)) {
    return res.status(409).json({
      conflict: true,
      message: 'Admin update takes precedence.',
      case: caseDoc
    })
  }

  caseDoc.ptpDate = ptpDate ? new Date(ptpDate) : null
  caseDoc.hasPtpTime = ptpDate ? !!hasTime : false

  let dateStr = ''
  let timeStr = ''
  if (ptpDate) {
    const d = new Date(ptpDate)
    dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' })
    if (caseDoc.hasPtpTime) {
      timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    }
  }

  const collection = await Collection.findById(caseDoc.collectionId)
  if (collection) {
    const sheetDef = collection.sheets.find(s => s.name === caseDoc.sheetName)
    if (sheetDef) {
      const getSourceCol = (tag) => {
        const col = sheetDef.standardColumns.find(c => c.tag === tag)
        if (!col) return null
        const mapping = (sheetDef.lastMapping || []).find(m => m.standardLabel === col.label)
        return mapping ? mapping.sourceColumn : col.label
      }

      const dateCol = getSourceCol('PTP')
      const timeCol = getSourceCol('Time')

      let updated = false
      if (dateCol && caseDoc.rawData[dateCol] !== dateStr) {
        caseDoc.rawData[dateCol] = dateStr
        updated = true
      }
      if (timeCol && caseDoc.rawData[timeCol] !== timeStr) {
        caseDoc.rawData[timeCol] = timeStr
        updated = true
      }

      if (updated) {
        caseDoc.markModified('rawData')
      }
    }
  }

  await caseDoc.save()

  if (collection) {
    await generateExcelForCollection(caseDoc.collectionId)
  }

  res.json({ case: caseDoc })
})

router.put('/cases/:id/notes', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })

  const { fosNotes, queuedAt } = req.body
  const caseDoc = await Case.findById(req.params.id)
  if (!caseDoc) return res.status(404).json({ message: 'Case not found.' })

  // Conflict detection: admin update wins
  if (queuedAt && caseDoc.lastAdminUpdate && new Date(caseDoc.lastAdminUpdate) > new Date(queuedAt)) {
    return res.status(409).json({
      conflict: true,
      message: 'Admin update takes precedence.',
      case: caseDoc
    })
  }

  caseDoc.fosNotes = fosNotes || ''
  await caseDoc.save()

  res.json({ case: caseDoc })
})

// ── Batch sync endpoint: replays offline-queued FOS mutations ─────────────────
// Called by the client when it comes back online.
// Processes each mutation, returning per-item status so the client
// can update its cache. Admin writes always win (409 = conflict resolved by admin).
router.post('/cases/sync-queue', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' })

  const { mutations } = req.body
  if (!Array.isArray(mutations)) return res.status(400).json({ message: 'mutations array required.' })

  const results = []

  for (const mutation of mutations) {
    try {
      const { url, method, body: rawBody, queuedAt } = mutation
      const urlObj = new URL(url)
      const pathname = urlObj.pathname  // e.g. /api/fos/cases/:id/ptp
      let parsed
      try { parsed = JSON.parse(rawBody) } catch { parsed = {} }

      // PTP update
      const ptpMatch = pathname.match(/^\/api\/fos\/cases\/([^/]+)\/ptp$/)
      const notesMatch = pathname.match(/^\/api\/fos\/cases\/([^/]+)\/notes$/)
      const settingsMatch = pathname.match(/^\/api\/fos\/settings$/)

      if (ptpMatch && method === 'PUT') {
        const caseDoc = await Case.findById(ptpMatch[1])
        if (!caseDoc) { results.push({ id: mutation.id, status: 'error', message: 'Case not found' }); continue }

        if (queuedAt && caseDoc.lastAdminUpdate && new Date(caseDoc.lastAdminUpdate) > new Date(queuedAt)) {
          results.push({ id: mutation.id, status: 'conflict', case: caseDoc })
          continue
        }

        const { ptpDate, hasTime } = parsed
        caseDoc.ptpDate = ptpDate ? new Date(ptpDate) : null
        caseDoc.hasPtpTime = ptpDate ? !!hasTime : false

        // Update rawData columns
        const collection = await Collection.findById(caseDoc.collectionId)
        if (collection) {
          const sheetDef = collection.sheets.find(s => s.name === caseDoc.sheetName)
          if (sheetDef) {
            const getSourceCol = (tag) => {
              const col = sheetDef.standardColumns.find(c => c.tag === tag)
              if (!col) return null
              const mapping = (sheetDef.lastMapping || []).find(m => m.standardLabel === col.label)
              return mapping ? mapping.sourceColumn : col.label
            }
            let dateStr = ''
            let timeStr = ''
            if (ptpDate) {
              const d = new Date(ptpDate)
              dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' })
              if (caseDoc.hasPtpTime) timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
            }
            const dateCol = getSourceCol('PTP')
            const timeCol = getSourceCol('Time')
            let updated = false
            if (dateCol && caseDoc.rawData[dateCol] !== dateStr) { caseDoc.rawData[dateCol] = dateStr; updated = true }
            if (timeCol && caseDoc.rawData[timeCol] !== timeStr) { caseDoc.rawData[timeCol] = timeStr; updated = true }
            if (updated) caseDoc.markModified('rawData')
          }
        }
        await caseDoc.save()
        if (collection) await generateExcelForCollection(caseDoc.collectionId.toString())
        results.push({ id: mutation.id, status: 'ok', case: caseDoc })

      } else if (notesMatch && method === 'PUT') {
        const caseDoc = await Case.findById(notesMatch[1])
        if (!caseDoc) { results.push({ id: mutation.id, status: 'error', message: 'Case not found' }); continue }

        if (queuedAt && caseDoc.lastAdminUpdate && new Date(caseDoc.lastAdminUpdate) > new Date(queuedAt)) {
          results.push({ id: mutation.id, status: 'conflict', case: caseDoc })
          continue
        }

        caseDoc.fosNotes = parsed.fosNotes || ''
        await caseDoc.save()
        results.push({ id: mutation.id, status: 'ok', case: caseDoc })

      } else if (settingsMatch && method === 'POST') {
        // WhatsApp template — conflict check against user.updatedAt
        const { User } = await import('../models/User.js')
        const user = await User.findOne({ employeeId })
        if (!user) { results.push({ id: mutation.id, status: 'error', message: 'User not found' }); continue }

        // Admin conflict: if user record was updated by an admin after this was queued
        if (queuedAt && user.updatedAt && new Date(user.updatedAt) > new Date(queuedAt)) {
          results.push({ id: mutation.id, status: 'conflict', message: 'User settings updated by admin' })
          continue
        }

        const { workbookId, sheetName: sName, template } = parsed
        if (workbookId && sName && typeof template === 'string') {
          const templates = user.whatsappTemplates || {}
          if (!templates[workbookId]) templates[workbookId] = {}
          templates[workbookId][sName] = template
          user.whatsappTemplates = templates
          user.markModified('whatsappTemplates')
          await user.save()
        }
        results.push({ id: mutation.id, status: 'ok' })

      } else {
        results.push({ id: mutation.id, status: 'skipped', message: 'Unknown mutation type' })
      }
    } catch (err) {
      results.push({ id: mutation.id, status: 'error', message: err.message })
    }
  }

  res.json({ results })
})

export default router
