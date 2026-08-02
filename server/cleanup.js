import 'dotenv/config'
import mongoose from 'mongoose'
import { connectDatabase } from './database.js'
import { Case } from './models/Case.js'

async function run() {
  await connectDatabase()
  console.log('Connected to DB.')

  // 1. Delete orphaned cases (cases with no collectionId)
  const deleted = await Case.deleteMany({ collectionId: { $exists: false } })
  console.log(`Deleted ${deleted.deletedCount} orphaned cases.`)

  // 2. Drop the old loanNumber_1 index if it exists
  try {
    await Case.collection.dropIndex('loanNumber_1')
    console.log('Dropped old index: loanNumber_1')
  } catch (err) {
    if (err.codeName === 'IndexNotFound') {
      console.log('Index loanNumber_1 not found, nothing to drop.')
    } else {
      console.error('Error dropping index:', err.message)
    }
  }
  
  // Also drop lotIdentifier if it exists since we moved to collectionId
  try {
    await Case.collection.dropIndex('lotIdentifier_1_loanNumber_1')
    console.log('Dropped old index: lotIdentifier_1_loanNumber_1')
  } catch (err) {
    // Ignore
  }

  // 3. Ensure new indexes are built
  await Case.syncIndexes()
  console.log('Indexes synced.')

  mongoose.disconnect()
  console.log('Done.')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
