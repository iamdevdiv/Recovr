import mongoose from 'mongoose'

const caseSchema = new mongoose.Schema(
  {
    collectionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Collection', required: true, index: true },
    sheetName:       { type: String, required: true },
    lotLabel:        { type: String, default: '' },
    loanNumber:      { type: String, required: true },
    rawData:         { type: Object, default: {} },
    status:          { type: String, enum: ['PAID', 'UNPAID'], default: 'UNPAID' },
    ptpDate:         Date,
    hasPtpTime:      { type: Boolean, default: false },
    ptpRemark:       String,
    fosNotes:        { type: String, default: '' },
    assignedTo:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paymentDate:     Date,
    collectedAmount: Number,
    paymentMode:     { type: String, default: '' },
    // Timestamp set whenever an admin/manager writes to this case (ptpDate or fosNotes).
    // Used to detect conflicts when offline FOS mutations are replayed on reconnect.
    lastAdminUpdate: { type: Date, default: null },
  },
  { timestamps: true },
)

caseSchema.index({ collectionId: 1, sheetName: 1, loanNumber: 1 }, { unique: true })

export const Case = mongoose.model('Case', caseSchema)
