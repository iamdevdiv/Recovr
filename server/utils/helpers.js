import { verifyJwt } from './jwt.js'
import { User } from '../models/User.js'
import { Collection } from '../models/Collection.js'
import { Case } from '../models/Case.js'
import { TAGS } from './constants.js'

export function getEmployeeIdFromReq(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || '')
  if (!token) return null
  const payload = verifyJwt(token)
  return payload ? payload.employeeId : null
}
export async function filterCasesByFosPermission(employeeId, collectionId, sheetName, cases) {
  if (!employeeId) return cases;
  const user = await User.findOne({ employeeId }).lean();
  if (!user) return cases;

  // Admins have unrestricted access to all cases.
  if (user.role === 'Admin') return cases;

  // We enforce FOS permissions for Managers via their visibleTags.
  const wbPerm = (user.permissions || {})[collectionId] || {};
  const sheetPerm = (wbPerm.sheets || {})[sheetName] || {};
  const visibleTags = new Set(sheetPerm.visibleTags || []);

  const collection = await Collection.findById(collectionId).lean();
  if (!collection) return cases;
  const sheet = collection.sheets.find(s => s.name === sheetName);
  if (!sheet || !sheet.standardColumns) return cases;

  const getSourceCol = (tag) => {
    const col = sheet.standardColumns.find(c => c.tag === tag);
    if (!col) return null;
    const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === col.label);
    return mapping ? mapping.sourceColumn : col.label;
  };

  const fosSourceCol = getSourceCol('FOS');

  // Filter cases based on explicit tags.
  // If visibleTags is empty, no tags are permitted (meaning they see nothing).
  if (fosSourceCol) {
    return cases.filter(c => {
      const fosVal = String(c.rawData?.[fosSourceCol] ?? '').trim();
      if (fosVal === '') return visibleTags.has('__BLANKS__');
      return visibleTags.has(fosVal);
    });
  }

  return cases;
}

export async function getDistinctFosNames(collectionId, sheetName) {
  const collection = await Collection.findById(collectionId);
  if (!collection) return [];
  const sheet = collection.sheets.find(s => s.name === sheetName);
  if (!sheet) return [];
  const fosCol = sheet.standardColumns.find(c => c.tag === 'FOS');
  if (!fosCol) return [];
  const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === fosCol.label);
  const sourceCol = mapping ? mapping.sourceColumn : fosCol.label;
  const cases = await Case.find({ collectionId, sheetName }).lean();
  const fosSet = new Set();
  for (const c of cases) {
    const val = String(c.rawData?.[sourceCol] ?? '').trim();
    if (val) fosSet.add(val);
  }
  return Array.from(fosSet);
}

export async function autoEnablePermissions(collectionId, sheetName, newFosIdentifiers = [], uploaderEmployeeId = null) {
  const admins = await User.find({ role: 'Admin' });
  
  const upperFos = newFosIdentifiers.map(f => String(f).toUpperCase());
  const fieldEmployees = await User.find({
    role: 'FOS',
    $or: [
      { employeeId: { $in: upperFos } },
      { name: { $in: newFosIdentifiers } },
      { fosIdentifier: { $in: newFosIdentifiers } }
    ]
  });

  let uploader = null;
  if (uploaderEmployeeId) {
    uploader = await User.findOne({ employeeId: uploaderEmployeeId });
  }

  const usersToUpdate = [...admins, ...fieldEmployees];
  if (uploader && !usersToUpdate.some(u => u._id.toString() === uploader._id.toString())) {
    usersToUpdate.push(uploader);
  }
  
  const collection = await Collection.findById(collectionId).lean();
  const sheet = collection?.sheets.find(s => s.name === sheetName);
  const sheetTags = sheet?.standardColumns ? sheet.standardColumns.filter(c => c.tag).map(c => c.tag) : [];
  
  const DEFAULT_VISIBLE_TAGS = [
    'Address', 'Bucket', 'Customer Name', 'Dealer', 'EMI Amount', 'EMI End Date',
    'EMI Start Date', 'Father Name', 'Loan No', 'Lot', 'Mobile number', 'New Case',
    'PTP', 'Number of EMI Paid', 'POS', 'Previous Paid Date', 'Paid Date', 'Collected Amount',
    'Mode of Payment', 'Pin Code', 'Product', 'Reference mobile', 'Reference name', 
    'Reference name and mobile', 'Registration Number', 'Status', 'Tenure', 'Vehicle'
  ];
  const defaultSheetTags = sheetTags.filter(t => DEFAULT_VISIBLE_TAGS.includes(t));

  for (const user of usersToUpdate) {
    const permissions = user.permissions || {};
    const wbPerm = permissions[collectionId] || { enabled: false, sheets: {} };
    const sheetPerm = (wbPerm.sheets || {})[sheetName] || { enabled: false, visibleTags: [] };
    
    // If it's a FOS user being newly enabled, prepopulate their default tags
    if (user.role === 'FOS' && !sheetPerm.enabled && (!sheetPerm.visibleTags || sheetPerm.visibleTags.length === 0)) {
      sheetPerm.visibleTags = [...defaultSheetTags];
    }
    
    wbPerm.enabled = true;
    sheetPerm.enabled = true;
    
    if ((user.role === 'Admin' || user.role === 'Manager') && newFosIdentifiers.length > 0) {
      const currentTags = new Set(sheetPerm.visibleTags || []);
      for (const fos of newFosIdentifiers) {
        if (fos && String(fos).trim() !== '') currentTags.add(String(fos).trim());
      }
      sheetPerm.visibleTags = Array.from(currentTags);
    } else if (user.role === 'Field Employee' && sheetPerm.visibleTags.length === 0) {
      sheetPerm.visibleTags = TAGS;
    }

    wbPerm.sheets[sheetName] = sheetPerm;
    permissions[collectionId] = wbPerm;

    await User.updateOne(
      { _id: user._id },
      { $set: { permissions } }
    );
  }
}

export async function pushNewDefaultTagsToUsers(collectionId, sheetName, oldStandardColumns, newStandardColumns) {
  const DEFAULT_VISIBLE_TAGS = [
    'Address', 'Bucket', 'Customer Name', 'Dealer', 'EMI Amount', 'EMI End Date',
    'EMI Start Date', 'Father Name', 'Loan No', 'Lot', 'Mobile number', 'New Case',
    'PTP', 'Number of EMI Paid', 'POS', 'Previous Paid Date', 'Paid Date', 'Collected Amount',
    'Mode of Payment', 'Pin Code', 'Product', 'Reference mobile', 'Reference name', 
    'Reference name and mobile', 'Registration Number', 'Status', 'Tenure', 'Vehicle'
  ]

  const oldMapping = {}
  if (oldStandardColumns) {
    oldStandardColumns.forEach(c => { if (c.tag) oldMapping[c.label] = c.tag })
  }

  const newMapping = {}
  if (newStandardColumns) {
    newStandardColumns.forEach(c => { if (c.tag) newMapping[c.label] = c.tag })
  }

  const oldTagsSet = new Set(Object.values(oldMapping))
  const newlyIntroducedTags = new Set()
  
  for (const label in newMapping) {
    const tag = newMapping[label]
    if (!oldTagsSet.has(tag)) {
      newlyIntroducedTags.add(tag)
    }
  }

  const newDefaultTags = Array.from(newlyIntroducedTags).filter(t => DEFAULT_VISIBLE_TAGS.includes(t))

  if (newDefaultTags.length > 0) {
    const users = await User.find({ 'permissions': { $exists: true } })
    for (const u of users) {
      if (u.permissions && u.permissions[collectionId] && u.permissions[collectionId].sheets && u.permissions[collectionId].sheets[sheetName]) {
        const sheetPerm = u.permissions[collectionId].sheets[sheetName]
        if (!sheetPerm.visibleTags) sheetPerm.visibleTags = []
        let added = false
        for (const t of newDefaultTags) {
          if (!sheetPerm.visibleTags.includes(t)) {
            sheetPerm.visibleTags.push(t)
            added = true
          }
        }
        if (added) {
          u.markModified('permissions')
          await u.save()
        }
      }
    }
  }
}
