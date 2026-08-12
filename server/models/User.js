import mongoose from 'mongoose'

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      validate: {
        validator: function (v) {
          if (this.role === 'Field Employee') return /^FOS\d{3}$/.test(v);
          if (this.role === 'Manager' || this.role === 'Admin') return /^ADM\d{3}$/.test(v);
          return /^(FOS|ADM)\d{3}$/.test(v);
        },
        message: props => `${props.value} is not a valid employee ID for the assigned role.`
      }
    },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['Field Employee', 'Manager', 'Admin'],
      default: 'Field Employee',
      required: true,
    },
    fosIdentifiers: { type: [String], default: [] }, // multiple FOS IDs (OR logic)
    permissions: {
      // Structure: { [workbookId]: { enabled: Boolean, sheets: { [sheetName]: { enabled: Boolean, visibleTags: [String] } } } }
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    whatsappTemplates: {
      // Structure: { [workbookId]: { [sheetName]: String } }
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    accessibleModules: {
      type: [String],
      default: function() {
        if (this.role === 'Admin') {
          return ['overview', 'cases', 'upload', 'mapping', 'workbooks', 'allocation', 'referencing', 'users']
        } else if (this.role === 'Manager') {
          return ['overview', 'cases', 'upload', 'mapping', 'workbooks', 'allocation', 'referencing']
        }
        return []
      }
    },
    lastViewedCases: {
      type: { colId: String, sheetName: String },
      default: null
    },
    overviewPreferences: {
      type: mongoose.Schema.Types.Mixed,
      default: { expandedMonths: [], expandedWorkbooks: [], expandedSheets: [] }
    }
  },
  { timestamps: true },
)

export const User = mongoose.model('User', userSchema)
