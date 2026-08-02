import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDatabase } from './database.js'
import { Case } from './models/Case.js'
import { Collection } from './models/Collection.js'
import fs from 'node:fs'
import path from 'node:path'

async function run() {
  await connectDatabase()
  console.log('Connected to DB. Clearing collections...')

  await Case.collection.drop().catch(() => {})
  await Collection.collection.drop().catch(() => {})

  console.log('Database cleared.')
  
  const colDir = path.resolve('uploads/collections')
  if (fs.existsSync(colDir)) {
    for (const f of fs.readdirSync(colDir)) {
      if (f.endsWith('.xlsx')) fs.unlinkSync(path.join(colDir, f))
    }
  }

  mongoose.disconnect()
  console.log('Done.')
}

run().catch(console.error)
