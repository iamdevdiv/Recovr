import mongoose from 'mongoose'

const sheetSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sidebarWidth: { type: Number, default: 450 },
  drrPercentage: { type: Number, default: 97 },
  drrDaysOverride: { type: Number },
  rawColumns: [String],
  standardColumns: [
    {
      label: { type: String, required: true },
      order: { type: Number, required: true },
      tag: { type: String },
    },
  ],
  lastMapping: [
    {
      standardLabel: { type: String, required: true },
      sourceColumn: { type: String },
      customText: { type: String },
    },
  ],
}, { _id: false })

const collectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    numericId: { type: Number, unique: true },
    isWorkbook: { type: Boolean, default: true },
    isReference: { type: Boolean, default: true },
    month: { type: String },
    year: { type: Number },
    excelFilePath: { type: String }, // Path to generated Excel file
    sheets: [sheetSchema],    // Sheets inside this collection
  },
  { timestamps: true },
)

collectionSchema.pre('save', async function () {
  if (!this.numericId) {
    const last = await mongoose.model('Collection').findOne().sort({ numericId: -1 })
    this.numericId = (last?.numericId ?? 99) + 1
  }
})

export const Collection = mongoose.model('Collection', collectionSchema)
