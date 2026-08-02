import path from 'node:path'
import fs from 'node:fs'
import multer from 'multer'

export const uploadsDir = path.resolve('uploads')
export const tempDir = path.join(uploadsDir, 'temp')
export const refDir = path.join(uploadsDir, 'references')
export const collectionsDir = path.join(uploadsDir, 'collections')
export const backupsDir = path.join(uploadsDir, 'backups')

for (const dir of [uploadsDir, tempDir, refDir, collectionsDir, backupsDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

export function cleanOldTempFiles() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000
  try {
    for (const file of fs.readdirSync(tempDir)) {
      const fp = path.join(tempDir, file)
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp)
    }
  } catch { /* non-fatal */ }
}

export const upload = multer({
  dest: tempDir,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ok = /\.(xlsx|xls|xlsm)$/i.test(file.originalname)
    cb(ok ? null : new Error('Only Excel files are accepted.'), ok)
  },
})
