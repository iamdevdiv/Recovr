import mongoose from 'mongoose'

const referenceFileSchema = new mongoose.Schema(
  {
    bank:         { type: String, required: true, trim: true },
    month:        { type: String, required: true, trim: true }, // "YYYY-MM"
    originalName: { type: String, required: true },
    filePath:     { type: String, required: true }, // permanent path on disk
    sheets:       [String],
    columns:      [String],
    perSheetData: { type: Object, default: {} },
  },
  { timestamps: true },
)

export const ReferenceFile = mongoose.model('ReferenceFile', referenceFileSchema)
