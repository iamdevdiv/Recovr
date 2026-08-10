import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Backup } from '../models/Backup.js'
import { Collection } from '../models/Collection.js'
import { createBackup, restoreBackup } from '../utils/backupHelper.js'
import { getEmployeeIdFromReq } from '../utils/helpers.js'
import { User } from '../models/User.js'
import { buildAndWriteExcel, formatWorkbook } from '../utils/excelFormatter.js'
import { generateExcelForAdmin } from './fos.js'

const router = express.Router()

// Middleware to ensure Admin or Manager
router.use(async (req, res, next) => {
  const employeeId = getEmployeeIdFromReq(req)
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized' })
  const user = await User.findOne({ employeeId })
  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) {
    return res.status(403).json({ message: 'Forbidden' })
  }
  req.user = user
  next()
})

// GET /api/backups?collectionId=...
router.get('/', async (req, res) => {
  try {
    const { collectionId } = req.query
    const filter = {}
    if (collectionId) filter.collectionId = collectionId

    const backups = await Backup.find(filter)
      .populate('createdBy', 'name employeeId role')
      .sort({ createdAt: -1 })
      .lean()

    res.json(backups)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/backups/manual
router.post('/manual', async (req, res) => {
  try {
    const { collectionId, note } = req.body
    if (!collectionId || !note) return res.status(400).json({ message: 'collectionId and note are required' })

    const backup = await createBackup(collectionId, note, 'manual', req.user._id)
    if (!backup) return res.status(500).json({ message: 'Failed to create backup' })

    res.json({ message: 'Manual backup created successfully', backup })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/backups/:id/restore
router.post('/:id/restore', async (req, res) => {
  try {
    await restoreBackup(req.params.id, req.user._id)
    res.json({ message: 'Backup restored successfully and new state backed up.' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/backups/bulk
router.delete('/bulk', async (req, res) => {
  try {
    const { ids } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'No backup IDs provided.' })
    }

    const backups = await Backup.find({ _id: { $in: ids } })
    let deletedCount = 0

    for (const backup of backups) {
      if (backup.casesFilePath) {
        await fs.rm(backup.casesFilePath, { force: true })
      }
      await Backup.deleteOne({ _id: backup._id })
      deletedCount++
    }

    res.json({ message: `Successfully deleted ${deletedCount} backups.` })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/backups/:id
router.delete('/:id', async (req, res) => {
  try {
    const backup = await Backup.findById(req.params.id)
    if (!backup) return res.status(404).json({ message: 'Backup not found' })

    const filePath = backup.casesFilePath
    if (filePath) {
      await fs.rm(filePath, { force: true })
    }
    await Backup.deleteOne({ _id: backup._id })

    res.json({ message: 'Backup deleted successfully' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/backups/:id/download
router.get('/:id/download', async (req, res) => {
  try {
    const backup = await Backup.findById(req.params.id)
    if (!backup) return res.status(404).json({ message: 'Backup not found' })

    const casesData = await fs.readFile(backup.casesFilePath, 'utf8')
    const cases = JSON.parse(casesData)
    
    // Quick formatting to build an Excel workbook in memory
    const structure = backup.structure
    const sheets = []

    for (const sheet of structure.sheets) {
      const sheetCases = cases.filter(c => c.sheetName === sheet.name)
      const headers = sheet.standardColumns.map(sc => sc.label)
      const rows = sheetCases.map(c => {
        const rowData = {}
        for (const col of sheet.standardColumns) {
          const val = c.rawData?.[col.label]
          // If value is a valid ISO date string, convert it to Date for ExcelJS
          if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
            const d = new Date(val)
            rowData[col.label] = isNaN(d.getTime()) ? val : d
          } else {
            rowData[col.label] = val ?? ''
          }
        }
        return rowData
      })
      sheets.push({ name: sheet.name, headers, rows })
    }

    const wb = await formatWorkbook(sheets)
    const buffer = await wb.xlsx.writeBuffer()
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    const safeColName = (structure.name || 'Workbook').replace(/[<>:"/\\|?*]/g, '_').trim()
    res.setHeader('Content-Disposition', `attachment; filename="${safeColName} - Backup - ${backup._id}.xlsx"`)
    res.send(buffer)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router
