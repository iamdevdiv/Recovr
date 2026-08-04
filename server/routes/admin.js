import express from 'express'
import { User } from '../models/User.js'
import { Collection } from '../models/Collection.js'
import { Case } from '../models/Case.js'
import { getEmployeeIdFromReq, filterCasesByFosPermission } from '../utils/helpers.js'
import { generateExcelForCollection } from './fos.js'

const router = express.Router()

router.get('/overview-stats', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req);
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' });

  const user = await User.findOne({ employeeId });
  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) return res.status(403).json({ message: 'Forbidden.' });

  const allUsers = await User.find({}).lean();

  const permissions = user.permissions || {};
  const enabledWorkbookIds = Object.entries(permissions)
    .filter(([, wb]) => wb.enabled)
    .map(([id]) => id);

  if (enabledWorkbookIds.length === 0) return res.json({ workbooks: [] });

  const collections = await Collection.find({ _id: { $in: enabledWorkbookIds }, isWorkbook: true }).lean();
  const result = [];

  for (const col of collections) {
    const wbPerm = permissions[col._id.toString()] || {};
    const enabledSheets = col.sheets.filter(s => {
      const sheetPerm = (wbPerm.sheets || {})[s.name];
      return sheetPerm && sheetPerm.enabled;
    });

    if (enabledSheets.length === 0) continue;

    const sheetStats = [];

    for (const sheet of enabledSheets) {
      const sheetPerm = wbPerm.sheets[sheet.name] || {};
      const visibleFosNames = new Set(sheetPerm.visibleTags || []);

      const getSourceCol = (tag) => {
        const standardCol = sheet.standardColumns.find(c => c.tag === tag);
        if (!standardCol) return null;
        const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === standardCol.label);
        return mapping ? mapping.sourceColumn : standardCol.label;
      };

      const posCol = getSourceCol('POS');
      const statusCol = getSourceCol('Status');
      const fosCol = getSourceCol('FOS');

      let cases = await Case.find({ collectionId: col._id, sheetName: sheet.name }).lean();
      cases = await filterCasesByFosPermission(user.employeeId, col._id, sheet.name, cases);

      let totalPos = 0;
      let totalCount = 0;
      const fosMap = {};
      const overallStatusMap = { statusPos: {}, statusCount: {} };

      for (const c of cases) {
        const fosVal = String(c.rawData?.[fosCol] ?? '').trim();

        // Map FOS identifier to FOS name if available
        let fosName = fosVal || 'UNASSIGNED';
        if (fosVal) {
          const userMatch = allUsers.find(u => u.fosIdentifier === fosVal);
          if (userMatch && userMatch.name) {
            fosName = `${userMatch.name} (${fosVal})`;
          }
        }

        const posValStr = String(c.rawData?.[posCol] ?? '').replace(/,/g, '');
        const posVal = parseFloat(posValStr) || 0;
        const statusVal = String(c.rawData?.[statusCol] ?? '').trim().toUpperCase() || 'UNASSIGNED/OTHER';

        totalPos += posVal;
        totalCount++;

        // FOS level stats
        if (!fosMap[fosName]) {
          fosMap[fosName] = { totalPos: 0, totalCount: 0, statusPos: {}, statusCount: {} };
        }
        fosMap[fosName].totalPos += posVal;
        fosMap[fosName].totalCount++;
        fosMap[fosName].statusPos[statusVal] = (fosMap[fosName].statusPos[statusVal] || 0) + posVal;
        fosMap[fosName].statusCount[statusVal] = (fosMap[fosName].statusCount[statusVal] || 0) + 1;

        // Overall sheet stats
        overallStatusMap.statusPos[statusVal] = (overallStatusMap.statusPos[statusVal] || 0) + posVal;
        overallStatusMap.statusCount[statusVal] = (overallStatusMap.statusCount[statusVal] || 0) + 1;
      }

      const fosStats = Object.keys(fosMap).map(fos => {
        const data = fosMap[fos];
        const statuses = Object.keys(data.statusPos).map(status => {
          const pos = data.statusPos[status];
          const percentage = data.totalPos > 0 ? ((pos / data.totalPos) * 100).toFixed(2) : '0.00';
          return { status, count: data.statusCount[status], pos, percentage };
        });
        statuses.sort((a, b) => a.status.localeCompare(b.status));
        return {
          fos,
          totalPos: data.totalPos,
          totalCount: data.totalCount,
          statuses
        };
      });

      fosStats.sort((a, b) => b.totalPos - a.totalPos);

      // Format overall sheet statuses
      const overallStatuses = Object.keys(overallStatusMap.statusPos).map(status => {
        const pos = overallStatusMap.statusPos[status];
        const percentage = totalPos > 0 ? ((pos / totalPos) * 100).toFixed(2) : '0.00';
        return { status, count: overallStatusMap.statusCount[status], pos, percentage };
      });
      overallStatuses.sort((a, b) => a.status.localeCompare(b.status));

      sheetStats.push({
        name: sheet.name,
        totalPos,
        totalCount,
        fosStats,
        drrPercentage: sheet.drrPercentage !== undefined ? sheet.drrPercentage : 97,
        drrDaysOverride: sheet.drrDaysOverride !== undefined ? sheet.drrDaysOverride : null,
        overallStats: {
          totalPos,
          totalCount,
          statuses: overallStatuses
        }
      });
    }

    if (sheetStats.length > 0) {
      let combinedCases = 0;
      for (const st of sheetStats) {
        combinedCases += st.totalCount;
      }

      result.push({
        _id: col._id,
        name: col.name,
        month: col.month || 'Unknown',
        year: col.year || 0,
        sheets: sheetStats,
        combinedCases
      });
    }
  }

  res.json({ 
    workbooks: result,
    overviewPreferences: user.overviewPreferences || { expandedMonths: [], expandedWorkbooks: [], expandedSheets: [] }
  });
})

router.post('/overview-preferences', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req);
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' });
  const user = await User.findOne({ employeeId });
  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) return res.status(403).json({ message: 'Forbidden.' });

  user.overviewPreferences = req.body;
  await user.save();
  res.json({ success: true });
})

router.put('/collection/:id/sheet/:name/prefs', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req);
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' });
  const user = await User.findOne({ employeeId });
  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) return res.status(403).json({ message: 'Forbidden.' });

  const { id, name } = req.params;
  const { width, drrPercentage, drrDaysOverride } = req.body;

  const coll = await Collection.findById(id);
  if (!coll) return res.status(404).json({ message: 'Collection not found.' });

  const sheet = coll.sheets.find(s => s.name === name);
  if (!sheet) return res.status(404).json({ message: 'Sheet not found.' });

  if (width !== undefined) sheet.sidebarWidth = width;
  if (drrPercentage !== undefined) sheet.drrPercentage = drrPercentage;
  if (drrDaysOverride !== undefined) sheet.drrDaysOverride = drrDaysOverride;

  await coll.save();

  res.json({ message: 'Saved successfully.' });
});

// ---- Added search counts endpoint ----
router.get('/search-counts', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req);
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' });

  const user = await User.findOne({ employeeId });
  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) return res.status(403).json({ message: 'Forbidden.' });

  const { collectionId, q } = req.query;
  if (!collectionId || !q) return res.status(400).json({ message: 'Missing parameters.' });

  const collection = await Collection.findById(collectionId).lean();
  if (!collection) return res.status(404).json({ message: 'Collection not found.' });

  const query = q.toLowerCase();
  const allCases = await Case.find({ collectionId }).lean();
  
  const wbPerm = (user.permissions || {})[collectionId] || {};
  
  const counts = {};

  for (const sheet of collection.sheets) {
    const sheetPerm = (wbPerm.sheets || {})[sheet.name] || {};
    if (user.role !== 'Admin' && user.role !== 'Manager' && !sheetPerm.enabled) continue;
    
    const visibleFosNames = new Set(sheetPerm.visibleTags || []);
    
    const getSourceCol = (tag) => {
      const standardCol = sheet.standardColumns.find(c => c.tag === tag);
      if (!standardCol) return null;
      const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === standardCol.label);
      return mapping ? mapping.sourceColumn : standardCol.label;
    };
    
    const fosCol = getSourceCol('FOS');
    const custNameCol = getSourceCol('Customer Name');
    
    let sheetCases = allCases.filter(c => c.sheetName === sheet.name);
    sheetCases = await filterCasesByFosPermission(user.employeeId, collectionId, sheet.name, sheetCases);
    
    let count = 0;
    for (const c of sheetCases) {
      const loanNo = String(c.loanNumber || '').toLowerCase();
      const custName = String(c.rawData?.[custNameCol] || '').toLowerCase();
      
      if (loanNo.includes(query) || custName.includes(query)) {
        count++;
      }
    }
    if (count > 0) {
      counts[sheet.name] = count;
    }
  }

  res.json({ counts });
});

router.get('/cases', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req);
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' });

  const user = await User.findOne({ employeeId });
  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) return res.status(403).json({ message: 'Forbidden.' });

  const { collectionId, sheetName } = req.query;
  if (!collectionId || !sheetName) return res.status(400).json({ message: 'collectionId and sheetName are required.' });

  const collection = await Collection.findById(collectionId).lean();
  if (!collection) return res.status(404).json({ message: 'Collection not found.' });

  const sheet = collection.sheets.find(s => s.name === sheetName);
  if (!sheet) return res.status(404).json({ message: 'Sheet not found.' });

  const allUsers = await User.find({}).lean();
  const wbPerm = (user.permissions || {})[collectionId] || {};
  const sheetPerm = (wbPerm.sheets || {})[sheetName] || {};
  const visibleFosNames = new Set(sheetPerm.visibleTags || []);

  // Helpers (same as overview-stats)
  const getSourceCol = (tag) => {
    const standardCol = sheet.standardColumns.find(c => c.tag === tag);
    if (!standardCol) return null;
    const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === standardCol.label);
    return mapping ? mapping.sourceColumn : standardCol.label;
  };

  // Build tag → source column map (only for tags actually assigned, not None)
  const tagToSourceCol = {};
  for (const col of sheet.standardColumns) {
    if (col.tag && col.tag !== 'None' && String(col.tag).trim() !== '') {
      const mapping = (sheet.lastMapping || []).find(m => m.standardLabel === col.label);
      if (!tagToSourceCol[col.tag]) tagToSourceCol[col.tag] = [];
      tagToSourceCol[col.tag].push(mapping ? mapping.sourceColumn : col.label);
    }
  }

  const availableTags = Object.keys(tagToSourceCol);
  const fosCol = getSourceCol('FOS');
  const statusCol = getSourceCol('Status');
  const posCol = getSourceCol('POS');

  let allCases = await Case.find({ collectionId, sheetName }).lean();
  const cases = await filterCasesByFosPermission(user.employeeId, collectionId, sheetName, allCases);

  // Build rich stats (same structure as overview-stats)
  let totalPos = 0;
  let totalCount = 0;
  const fosMap = {};
  const overallStatusMap = { statusPos: {}, statusCount: {} };

  for (const c of cases) {
    const fosVal = fosCol ? String(c.rawData?.[fosCol] ?? '').trim() : '';
    let fosName = fosVal || 'UNASSIGNED';
    if (fosVal) {
      const userMatch = allUsers.find(u => u.fosIdentifier === fosVal);
      if (userMatch?.name) fosName = `${userMatch.name} (${fosVal})`;
    }

    const posValStr = String(c.rawData?.[posCol] ?? '').replace(/,/g, '');
    const posVal = parseFloat(posValStr) || 0;
    const statusVal = statusCol
      ? (String(c.rawData?.[statusCol] ?? '').trim().toUpperCase() || 'UNASSIGNED/OTHER')
      : 'UNASSIGNED/OTHER';

    totalPos += posVal;
    totalCount++;

    if (!fosMap[fosName]) fosMap[fosName] = { totalPos: 0, totalCount: 0, statusPos: {}, statusCount: {} };
    fosMap[fosName].totalPos += posVal;
    fosMap[fosName].totalCount++;
    fosMap[fosName].statusPos[statusVal] = (fosMap[fosName].statusPos[statusVal] || 0) + posVal;
    fosMap[fosName].statusCount[statusVal] = (fosMap[fosName].statusCount[statusVal] || 0) + 1;

    overallStatusMap.statusPos[statusVal] = (overallStatusMap.statusPos[statusVal] || 0) + posVal;
    overallStatusMap.statusCount[statusVal] = (overallStatusMap.statusCount[statusVal] || 0) + 1;
  }

  const fosStats = Object.keys(fosMap).map(fos => {
    const data = fosMap[fos];
    const statuses = Object.keys(data.statusPos).map(status => ({
      status,
      count: data.statusCount[status],
      pos: data.statusPos[status],
      percentage: data.totalPos > 0 ? ((data.statusPos[status] / data.totalPos) * 100).toFixed(2) : '0.00',
    }));
    statuses.sort((a, b) => a.status.localeCompare(b.status));
    return { fos, totalPos: data.totalPos, totalCount: data.totalCount, statuses };
  });
  fosStats.sort((a, b) => b.totalPos - a.totalPos);

  const overallStatuses = Object.keys(overallStatusMap.statusPos).map(status => ({
    status,
    count: overallStatusMap.statusCount[status],
    pos: overallStatusMap.statusPos[status],
    percentage: totalPos > 0 ? ((overallStatusMap.statusPos[status] / totalPos) * 100).toFixed(2) : '0.00',
  }));
  overallStatuses.sort((a, b) => a.status.localeCompare(b.status));

  // Map cases to tagData (exclude None values)
  const mappedCases = cases.map(c => {
    const data = c.rawData || {};
    const tagData = {};
    const tagCols = {};
    for (const [tag, cols] of Object.entries(tagToSourceCol)) {
      const vals = [];
      const colNames = [];
      for (const col of cols) {
        const val = data[col];
        if (val !== null && val !== undefined && String(val).trim() !== '' && String(val).trim() !== 'None') {
          vals.push(val);
          colNames.push(col);
        }
      }
      if (vals.length > 0) {
        // Only return array if there's more than one distinct column mapped for this tag that actually has a value,
        // otherwise just return the first string, to minimize breaking UI components expecting strings.
        tagData[tag] = vals.length > 1 ? vals : vals[0];
        tagCols[tag] = colNames.length > 1 ? colNames : colNames[0];
      }
    }
    return {
      _id: c._id,
      loanNumber: c.loanNumber,
      fosNotes: c.fosNotes || '',
      ptpDate: c.ptpDate || null,
      hasPtpTime: c.hasPtpTime || false,
      collectedAmount: c.collectedAmount,
      paymentMode: c.paymentMode || '',
      tagData,
      tagCols,
    };
  });

  res.json({
    cases: mappedCases,
    availableTags,
    stats: {
      total: totalCount,
      totalPos,
      overallStatuses,
      fosStats,
    },
    sheetName,
    workbookName: collection.name,
    workbookSheets: collection.sheets.map(s => s.name),
    collectionMonth: collection.month,
    collectionYear: collection.year,
    sidebarWidth: sheet.sidebarWidth || 450,
    drrPercentage: sheet.drrPercentage ?? 97,
    drrDaysOverride: sheet.drrDaysOverride ?? null,
  });
});

router.put('/cases/:id', async (req, res) => {
  const employeeId = getEmployeeIdFromReq(req);
  if (!employeeId) return res.status(401).json({ message: 'Unauthorized.' });

  const user = await User.findOne({ employeeId });
  if (!user || (user.role !== 'Admin' && user.role !== 'Manager')) return res.status(403).json({ message: 'Forbidden.' });

  const { id } = req.params;
  const updates = req.body;

  const caseDoc = await Case.findById(id);
  if (!caseDoc) return res.status(404).json({ message: 'Case not found.' });

  const collection = await Collection.findById(caseDoc.collectionId);
  if (!collection) return res.status(404).json({ message: 'Collection not found.' });

  const sheetDef = collection.sheets.find(s => s.name === caseDoc.sheetName);
  if (!sheetDef) return res.status(404).json({ message: 'Sheet not found.' });

  // Handle master mode updates (raw data edits)
  let rawDataModified = false;
  if (updates.masterEdits && typeof updates.masterEdits === 'object') {
    for (const [tag, val] of Object.entries(updates.masterEdits)) {
      if (tag === 'Loan No') continue; // Prevent editing Loan No

      const col = sheetDef.standardColumns.find(c => c.tag === tag);
      if (col) {
        const mapping = (sheetDef.lastMapping || []).find(m => m.standardLabel === col.label);
        const sourceCol = mapping ? mapping.sourceColumn : col.label;
        if (caseDoc.rawData[sourceCol] !== val) {
          caseDoc.rawData[sourceCol] = val;
          rawDataModified = true;
        }
      }
    }
  }

  // Handle direct column edits via masterEditsCol (for mapped references)
  if (updates.masterEditsCol && typeof updates.masterEditsCol === 'object') {
    for (const [colName, val] of Object.entries(updates.masterEditsCol)) {
      // Don't allow editing Loan No via this either (need to know its source column, but we trust client to not send it)
      if (caseDoc.rawData[colName] !== val) {
        caseDoc.rawData[colName] = val;
        rawDataModified = true;
      }
    }
  }

  // Handle standard field edits
  const getSourceCol = (tag) => {
    const col = sheetDef.standardColumns.find(c => c.tag === tag);
    if (!col) return null;
    const mapping = (sheetDef.lastMapping || []).find(m => m.standardLabel === col.label);
    return mapping ? mapping.sourceColumn : col.label;
  };

  if (updates.status !== undefined) {
    const statusCol = getSourceCol('Status');
    if (statusCol) {
      caseDoc.rawData[statusCol] = updates.status;
      rawDataModified = true;
    }
    if (['PAID', 'UNPAID'].includes(updates.status)) {
      caseDoc.status = updates.status;
    }
  }

  if (updates.paymentDate !== undefined) {
    const pDateCol = getSourceCol('Paid Date');
    if (pDateCol) {
      caseDoc.rawData[pDateCol] = updates.paymentDate;
      rawDataModified = true;
    }
  }

  if (updates.collectedAmount !== undefined) {
    const caCol = getSourceCol('Collected Amount');
    if (caCol) {
      caseDoc.rawData[caCol] = updates.collectedAmount;
      rawDataModified = true;
    }
    caseDoc.collectedAmount = Number(updates.collectedAmount) || 0;
  }

  if (updates.paymentMode !== undefined) {
    const pmCol = getSourceCol('Mode of Payment');
    if (pmCol) {
      caseDoc.rawData[pmCol] = updates.paymentMode;
      rawDataModified = true;
    }
    caseDoc.paymentMode = updates.paymentMode;
  }

  if (updates.fosNotes !== undefined) {
    caseDoc.fosNotes = updates.fosNotes;
    // Mark admin update time for offline conflict detection (admin always wins)
    caseDoc.lastAdminUpdate = new Date();
  }

  // If the admin edited any PTP-related raw columns via masterEdits/masterEditsCol,
  // also stamp lastAdminUpdate so queued FOS PTP mutations are correctly rejected.
  const ptpRelated = ['PTP', 'Time']
  const touchedPtp = updates.masterEdits
    ? Object.keys(updates.masterEdits).some(tag => ptpRelated.includes(tag))
    : false
  if (touchedPtp) {
    caseDoc.lastAdminUpdate = new Date();
  }

  if (rawDataModified) {
    caseDoc.markModified('rawData');
  }

  await caseDoc.save();

  // Instantly reflect in final output Excel file
  await generateExcelForCollection(caseDoc.collectionId);

  res.json({ message: 'Case updated successfully', case: caseDoc });
});

export default router
