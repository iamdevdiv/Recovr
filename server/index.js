import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import * as XLSX from 'xlsx'
import fs from 'node:fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { connectDatabase } from './database.js'
import { cleanOldTempFiles } from './utils/uploadConfig.js'

import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import adminRouter from './routes/admin.js'
import fosRouter from './routes/fos.js'
import collectionsRouter from './routes/collections.js'
import allocationsRouter from './routes/allocations.js'
import referencesRouter from './routes/references.js'
import backupsRouter from './routes/backups.js'

XLSX.set_fs(fs)

const app = express()
const port = Number(process.env.PORT || 5174)

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }))
app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

app.use('/api/auth', authRouter)
app.use('/api/users', usersRouter)
app.use('/api/admin', adminRouter)
app.use('/api/fos', fosRouter)
app.use('/api/collections', collectionsRouter)
app.use('/api/lots/references', referencesRouter) // get references, delete references
app.use('/api/lots', collectionsRouter) // preview, import, import-count
app.use('/api/allocation', allocationsRouter)
app.use('/api/backups', backupsRouter)

// Error handler

// Serve static frontend in production
app.use(express.static(path.join(__dirname, '../dist')))

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'))
})

// Error handler MUST be at the end
app.use((error, _req, res, _next) => {
  console.error(error)
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File exceeds the 25 MB limit.' })
  res.status(500).json({ message: error.message || 'Internal server error.' })
})

async function start() {
  await connectDatabase()


  cleanOldTempFiles()
  app.listen(port, () => console.log(`Recovr API → http://localhost:${port}`))
}
start().catch((err) => { console.error(err.message); process.exit(1) })
