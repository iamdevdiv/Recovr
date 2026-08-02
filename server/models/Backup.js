import mongoose from 'mongoose'

const backupSchema = new mongoose.Schema(
  {
    collectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', required: true, index: true },
    note: { type: String, required: true },
    type: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional, null means system
    casesFilePath: { type: String, required: true },
    structure: { type: Object, required: true }, // Snapshots of all sheets and collection metadata
    changesDetail: { type: mongoose.Schema.Types.Mixed }, // Optional payload detailing changes made
    isLatest: { type: Boolean, default: false }
  },
  { timestamps: true }
)

export const Backup = mongoose.model('Backup', backupSchema)
