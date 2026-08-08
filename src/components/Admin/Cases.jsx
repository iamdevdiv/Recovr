import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Icon, formatDetailValue } from '../Shared.jsx'

function getToken() {
  return localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
}
function authHeaders() {
  return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
}

const GROUPABLE_TAGS = ['Bucket', 'FOS', 'Lot', 'Status', 'Mode of Payment', 'New Case']
const CHIP_TAGS = ['Bucket', 'Lot', 'FOS', 'Father Name', 'EMI Amount', 'POS', 'New Case']
const INLINE_KNOWN = ['Customer Name', 'Loan No', 'Status', 'Address', 'Pin Code', 'Paid Date',
  'Collected Amount', 'Mode of Payment', 'New Case', 'Vehicle', ...CHIP_TAGS]

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// ── Inline Status/MOP select — matches col-mode-toggle style ─────────────────
// A select + optional free-text input, replicating the pattern used app-wide
function PresetInput({ value, onChange, presets, placeholder }) {
  const [isCustomMode, setIsCustomMode] = useState(false)
  const isCustomValue = value && !presets.includes(value)
  const showInput = isCustomMode || isCustomValue

  return (
    <div className="ac-preset-wrap" onClick={e => e.stopPropagation()}>
      {!showInput ? (
        <select
          value={value || ''}
          onChange={e => {
            if (e.target.value === '__custom__') {
              setIsCustomMode(true)
              onChange('')
            } else {
              onChange(e.target.value)
            }
          }}
        >
          <option value="">— Not set —</option>
          {presets.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="__custom__">Custom text…</option>
        </select>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', width: '100%' }}>
          <input
            type="text"
            placeholder={placeholder}
            value={value || ''}
            onChange={e => onChange(e.target.value)}
            className="ac-preset-custom-input"
            style={{ flex: 1, minWidth: 0, padding: '4px 6px' }}
            autoFocus={isCustomMode}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              setIsCustomMode(false)
              onChange('')
            }}
            style={{ flexShrink: 0, padding: 4 }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Stats breakdown tables (like AdminOverview) ───────────────────────────────
function StatsBreakdown({ stats, hiddenFos, toggleFos }) {
  if (!stats) return null
  const { fosStats = [] } = stats

  return (
    <div className="ac-stats-breakdown">
      {/* FOS breakdown table */}
      {fosStats.length > 0 && (
        <div className="ac-stats-table-wrap">
          <table className="ac-stats-table">
            <thead>
              <tr>
                <th style={{ width: '30px', textAlign: 'center' }}>On</th>
                <th>FOS / Status</th>
                <th>Cases</th>
                <th>POS</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {fosStats.map(f => {
                const isHidden = hiddenFos.has(f.fos)
                const isLastChecked = !isHidden && (fosStats.length - hiddenFos.size <= 1)
                return (
                  <React.Fragment key={f.fos}>
                    <tr className="ac-stats-fos-row">
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!isHidden}
                          onChange={() => toggleFos(f.fos)}
                          disabled={isLastChecked}
                          style={{ cursor: isLastChecked ? 'not-allowed' : 'pointer', accentColor: '#6be2c7', opacity: isLastChecked ? 0.5 : 1 }}
                        />
                      </td>
                      <td style={{ opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>{f.fos}</td>
                      <td style={{ opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>{f.totalCount}</td>
                      <td style={{ opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>₹{fmt(f.totalPos)}</td>
                      <td style={{ opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>100%</td>
                    </tr>
                    {!isHidden && f.statuses.map(s => (
                      <tr key={s.status} className="ac-stats-fos-sub">
                        <td></td>
                        <td className="ac-stats-sub-indent">
                          <span className={`fos-status-pill ${s.status === 'PAID' ? 'pill-paid' : s.status === 'UNPAID' ? 'pill-unpaid' : 'pill-other'}`} style={{ fontSize: 10 }}>{s.status}</span>
                        </td>
                        <td>{s.count}</td>
                        <td>₹{fmt(s.pos)}</td>
                        <td>{s.percentage}%</td>
                      </tr>
                    ))}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Master Edit Field ─────────────────────────────────────────────────────────
function MasterEditField({ caseId, tag, sourceCol, value, fullString, replaceTarget, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(value || '')
  const [saving, setSaving] = useState(false)

  const lowerTag = tag.toLowerCase()
  const isDate = lowerTag.includes('date')
  const isTime = lowerTag.includes('time')

  function initEdit() {
    let initial = value || ''
    if (initial) {
      try {
        const d = new Date(initial)
        if (!isNaN(d)) {
          const pad = n => n.toString().padStart(2, '0')
          const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
          const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
          if (isDate && !isTime) initial = ymd
          else if (isTime && !isDate) initial = hm
          else if (isDate && isTime) initial = `${ymd}T${hm}`
        }
      } catch { }
    }
    if (lowerTag.includes('mobile') || lowerTag.includes('phone') || lowerTag.includes('contact')) {
      initial = String(initial).replace(/^[\s,]+|[\s,]+$/g, '')
    }
    setVal(initial)
    setEditing(true)
  }

  async function save(e) {
    e.stopPropagation()
    setSaving(true)
    let payloadVal = val
    if (val && (isDate || isTime)) {
      try {
        const oldD = new Date(value)
        const d = isNaN(oldD) ? new Date() : oldD
        if (isDate && !isTime) {
          const [y, m, dNum] = val.split('-')
          d.setFullYear(y, m - 1, dNum)
        } else if (isTime && !isDate) {
          const [hh, mm] = val.split(':')
          d.setHours(hh, mm)
        } else if (isDate && isTime) {
          const [datePart, timePart] = val.split('T')
          const [y, m, dNum] = datePart.split('-')
          const [hh, mm] = timePart.split(':')
          d.setFullYear(y, m - 1, dNum)
          d.setHours(hh, mm)
        }
        payloadVal = d.toISOString()
      } catch { }
    }
    try {
      let finalPayload = payloadVal
      if (fullString && replaceTarget) {
        finalPayload = fullString.replace(replaceTarget, payloadVal)
      }

      const bodyPayload = sourceCol
        ? { masterEditsCol: { [sourceCol]: finalPayload } }
        : { masterEdits: { [tag]: finalPayload } }

      const res = await fetch(`/api/admin/cases/${caseId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(bodyPayload),
      })
      if (res.ok) { onUpdate(tag, payloadVal, sourceCol); setEditing(false) }
    } catch { }
    setSaving(false)
  }

  if (!editing) {
    return (
      <span className="ac-master-view" onClick={e => e.stopPropagation()}>
        {tag === 'EMI Amount' ? <span className="fos-emi-chip" style={{ margin: 0 }}>₹{value}</span> : <span>{formatDetailValue(tag, value)}</span>}
        <button
          className="ac-master-edit-btn"
          onClick={e => { e.stopPropagation(); initEdit() }}
          title={`Edit ${tag}`}
        >
          <Icon name="pencil" size={10} />
        </button>
      </span>
    )
  }

  const inputType = (isDate && isTime) ? 'datetime-local' : isDate ? 'date' : isTime ? 'time' : 'text'

  return (
    <span className="ac-master-edit-row" onClick={e => e.stopPropagation()}>
      <input
        type={inputType}
        className="ac-master-input"
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') save(e)
          if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) }
        }}
        autoFocus
      />
      <button className="ac-master-save" onClick={save} disabled={saving}>
        {saving ? <Icon name="spinner" size={10} className="spin-icon" /> : <Icon name="check" size={10} />}
      </button>
      <button className="ac-master-cancel" onClick={e => { e.stopPropagation(); setEditing(false) }}>
        <Icon name="close" size={10} />
      </button>
    </span>
  )
}

// ── Notes Editor ──────────────────────────────────────────────────────────────
function AdminNotesEditor({ caseId, initialNotes, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(initialNotes || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => setNotes(initialNotes || ''), [initialNotes])

  async function saveNotes() {
    setSaving(true)
    try {
      const res = await fetch(`/api/fos/cases/${caseId}/notes`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ fosNotes: notes }),
      })
      const data = await res.json()
      if (res.ok) onUpdate(data.case.fosNotes)
    } catch { }
    setSaving(false)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="ac-notes-display" onClick={e => { e.stopPropagation(); setEditing(true) }}>
        <Icon name="pencil" size={12} />
        {initialNotes
          ? <span className="ac-notes-text">{initialNotes}</span>
          : <span className="ac-notes-empty">Click to add notes...</span>}
      </div>
    )
  }

  return (
    <div className="ac-notes-editor" onClick={e => e.stopPropagation()}>
      <textarea
        className="ac-notes-textarea"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Enter case notes..."
        rows={3}
        autoFocus
      />
      <div className="ac-notes-actions">
        <button className="fos-notes-save-btn" onClick={saveNotes} disabled={saving}>
          {saving ? <Icon name="spinner" size={12} className="spin-icon" /> : 'Save Notes'}
        </button>
        <button className="fos-notes-cancel-btn" onClick={() => { setNotes(initialNotes || ''); setEditing(false) }} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Inline Quick-Edit Strip (always visible, NOT inside the clickable area) ───
function InlineQuickEdit({ caseData, onUpdate, testMode, masterMode }) {
  function parseToYMD(val) {
    const s = String(val || '').trim()
    if (!s || s.toLowerCase() === 'none') return ''
    try {
      const d = new Date(s)
      if (isNaN(d)) return '' // Invalid date fallback to empty
      const pad = n => n.toString().padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    } catch { return '' }
  }

  const td = caseData.tagData || {}
  const emiAmount = td['EMI Amount'] || ''

  const [status, setStatus] = useState(String(td['Status'] || '').trim().toUpperCase() === 'NONE' ? '' : String(td['Status'] || '').trim().toUpperCase())
  const [paidDate, setPaidDate] = useState(() => parseToYMD(td['Paid Date']))
  const [collected, setCollected] = useState(() => { const ca = td['Collected Amount'] !== undefined ? String(td['Collected Amount']).trim() : ''; return ca.toLowerCase() === 'none' ? '' : ca })
  const [mop, setMop] = useState(() => { const m = String(td['Mode of Payment'] || '').trim(); return m.toLowerCase() === 'none' ? '' : m })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // Sync state when case changes
  useEffect(() => {
    const td2 = caseData.tagData || {}
    setStatus(String(td2['Status'] || '').trim().toUpperCase() === 'NONE' ? '' : String(td2['Status'] || '').trim().toUpperCase())
    setPaidDate(parseToYMD(td2['Paid Date']))
    const ca = td2['Collected Amount'] !== undefined ? String(td2['Collected Amount']).trim() : ''; setCollected(ca.toLowerCase() === 'none' ? '' : ca)
    const m = String(td2['Mode of Payment'] || '').trim(); setMop(m.toLowerCase() === 'none' ? '' : m)
    setSaved(false)
  }, [caseData._id])

  async function handleSave(newVals) {
    const currentStatus = newVals.status !== undefined ? newVals.status : status
    const currentPaidDate = newVals.paidDate !== undefined ? newVals.paidDate : paidDate
    const currentCollected = newVals.collected !== undefined ? newVals.collected : collected
    const currentMop = newVals.mop !== undefined ? newVals.mop : mop

    const tagUpdates = { 'Status': currentStatus, 'Paid Date': currentPaidDate, 'Collected Amount': currentCollected, 'Mode of Payment': currentMop }

    if (testMode) {
      onUpdate({ tagData: tagUpdates }, true)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/cases/${caseData._id}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({
          status: currentStatus || undefined,
          paymentDate: currentPaidDate || undefined,
          collectedAmount: currentCollected !== '' ? Number(currentCollected) : undefined,
          paymentMode: currentMop || undefined,
        }),
      })
      if (res.ok) {
        onUpdate({ tagData: tagUpdates }, false)
        setSaved(true); setTimeout(() => setSaved(false), 2500)
      }
    } catch { }
    setSaving(false)
  }

  const isTestChanged = !!caseData._testChanged

  return (
    <div className="ac-inline-edit" onClick={e => e.stopPropagation()}>
      {/* Status */}
      <div className="ac-ie-field">
        <span className="ac-ie-label">Status</span>
        <PresetInput value={status} onChange={v => { setStatus(v); handleSave({ status: v }) }} presets={['PAID', 'UNPAID']} placeholder="Custom status…" />
      </div>

      {/* Paid Date */}
      <div className="ac-ie-field">
        <span className="ac-ie-label">Paid Date</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="date"
            value={paidDate}
            onChange={e => { setPaidDate(e.target.value); handleSave({ paidDate: e.target.value }) }}
            onClick={e => e.stopPropagation()}
            className="ac-ie-date"
            style={{ flex: 1 }}
          />
          <button
            className="ac-mode-btn"
            style={{ padding: '0 6px', height: '24px', background: '#111111', border: '1px solid #252525', borderRadius: '4px' }}
            title={paidDate ? 'Clear date' : 'Set to today'}
            onClick={e => {
              e.stopPropagation();
              if (paidDate) {
                setShowClearConfirm(true);
              } else {
                const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
                setPaidDate(today);
                handleSave({ paidDate: today });
              }
            }}
          >
            <Icon name={paidDate ? 'close' : 'calendar'} size={12} />
          </button>
        </div>
      </div>

      {/* Collected Amount */}
      <div className="ac-ie-field">
        <span className="ac-ie-label">Collected Amount</span>
        <div className="ac-ie-amount-row">
          <input
            type="number"
            placeholder="Amount"
            value={collected}
            onChange={e => setCollected(e.target.value)}
            onBlur={e => handleSave({ collected: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') { e.target.blur() } }}
            onClick={e => e.stopPropagation()}
            className="ac-ie-number"
          />
          {emiAmount && (
            <button className="ac-autofill-btn" onClick={e => { e.stopPropagation(); setCollected(String(emiAmount)); handleSave({ collected: String(emiAmount) }) }} title={`Fill EMI: ₹${emiAmount}`}>
              =EMI
            </button>
          )}
        </div>
      </div>

      {/* Mode of Payment */}
      <div className="ac-ie-field">
        <span className="ac-ie-label">Mode</span>
        <PresetInput value={mop} onChange={v => { setMop(v); handleSave({ mop: v }) }} presets={['Cash', 'Online', 'Bank Paid']} placeholder="Custom mode…" />
      </div>

      {/* Status Indicator */}
      <div className="ac-ie-save-wrap" style={{ minWidth: 60, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', color: '#777777', fontSize: 11 }}>
        {isTestChanged && <span className="ac-test-dot" title="Test change" style={{ marginRight: 6 }}>⚠</span>}
        {saving ? <Icon name="spinner" size={13} className="spin-icon" />
          : saved ? <span style={{ color: '#6ce0c9', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={11} /> Saved</span>
            : null}
      </div>

      {/* Clear Date Confirmation Modal */}
      {showClearConfirm && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowClearConfirm(false)}>
          <div className="modal" style={{ maxWidth: 360, textAlign: 'left', cursor: 'default' }} onClick={e => e.stopPropagation()}>
            <button className="close-button" type="button" onClick={() => setShowClearConfirm(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#e88080' }}>CLEAR DATE</span>
            <h2 style={{ marginBottom: 12 }}>Remove Paid Date?</h2>
            <p style={{ margin: 0, color: '#888888', fontSize: 13, lineHeight: 1.5 }}>
              Are you sure you want to clear the paid date for this case? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button type="button" className="outlined-button" onClick={() => setShowClearConfirm(false)} style={{ flex: 1 }}>Cancel</button>
              <button type="button" className="primary-button" style={{ background: '#a13b3b', borderColor: '#a13b3b', flex: 1 }} onClick={() => {
                setShowClearConfirm(false);
                setPaidDate('');
                handleSave({ paidDate: '' });
              }}>Clear Date</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Case Row ──────────────────────────────────────────────────────────────────
function CaseRow({ caseData, index, availableTags, masterMode, testMode, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [copiedLoan, setCopiedLoan] = useState(false)
  const [copiedName, setCopiedName] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  async function confirmDelete(e) {
    e.stopPropagation()
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/admin/cases/${caseData._id}`, { method: 'DELETE', headers: authHeaders() })
      if (res.ok) {
        onUpdate(caseData._id, { _deleted: true }, false)
      } else {
        const err = await res.json()
        setDeleteError(err.message || 'Unknown error deleting case')
      }
    } catch(err) {
      setDeleteError('Network error deleting case')
    }
    setDeleting(false)
  }

  const td = caseData.tagData || {}
  const statusRaw = String(td['Status'] || '').trim()
  const statusUpper = statusRaw.toUpperCase()
  const isPaid = statusUpper === 'PAID'
  const isUnpaid = statusUpper === 'UNPAID'
  const newCaseVal = String(td['New Case'] || '').trim()
  const isNew = newCaseVal.length > 0 && newCaseVal.toLowerCase() !== 'none'
  const custName = String(td['Customer Name'] || '—')
  const loanNo = String(caseData.loanNumber || td['Loan No'] || '—')
  const address = (td['Address'] && String(td['Address']).toLowerCase() !== 'none') ? String(td['Address']) : ''
  const pinCode = (td['Pin Code'] && String(td['Pin Code']).toLowerCase() !== 'none') ? String(td['Pin Code']) : ''
  const fatherName = (td['Father Name'] && String(td['Father Name']).toLowerCase() !== 'none') ? String(td['Father Name']) : ''
  const emiAmount = td['EMI Amount'] || ''

  // Chips: CHIP_TAGS that are available and have values (exclude Father Name since we show it inline)
  const chipFields = CHIP_TAGS.filter(t =>
    t !== 'Father Name' && t !== 'New Case' && t !== 'EMI Amount' && availableTags.includes(t) && td[t] && String(td[t]).trim() !== '' && String(td[t]).trim().toLowerCase() !== 'none'
  )

  // Tags for expanded "Additional Details"
  const expandTags = availableTags.filter(t => !INLINE_KNOWN.includes(t) && td[t])

  const statusPillClass = isPaid ? 'pill-paid' : isUnpaid ? 'pill-unpaid' : 'pill-other'

  const expandTagElements = []
  const processedTags = new Set()

  for (const tag of expandTags) {
    if (processedTags.has(tag)) continue

    const lowerTag = tag.toLowerCase()

    // Defer processing of Reference Mobile if Reference Name is also present
    if ((lowerTag === 'reference number' || lowerTag === 'reference mobile') && expandTags.some(t => t.toLowerCase() === 'reference name')) {
      continue
    }

    const rawVal = td[tag]
    const rawCols = caseData.tagCols?.[tag]

    // Special logic for Reference interleaving
    if (lowerTag === 'reference name') {
      processedTags.add(tag)
      const mobTag = expandTags.find(t => t.toLowerCase() === 'reference number' || t.toLowerCase() === 'reference mobile')
      const mobVal = mobTag ? td[mobTag] : null
      const mobCols = mobTag ? caseData.tagCols?.[mobTag] : null

      if (mobTag) processedTags.add(mobTag)

      // Regex parsing for single-column merged Reference Name & Number
      if (mobTag && rawVal && mobVal && typeof rawVal === 'string' && rawVal === mobVal) {
        const combined = rawVal
        const refSourceCol = caseData.tagCols?.[tag]

        const phoneRegex = /\d{10,}/g
        const phones = combined.match(phoneRegex) || []
        let namesStr = combined.replace(phoneRegex, '|')
        let rawNames = namesStr.split(/[|,]/)
        let names = rawNames.map(n => n.trim()).filter(n => n.length > 1)
        names = names.map(n => n.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '))

        const max = Math.max(phones.length, names.length)
        for (let i = 0; i < max; i++) {
          const n = names[i] || `Reference ${i + 1}`
          const p = phones[i] || null
          if (n && n !== `Reference ${i + 1}`) {
            expandTagElements.push(
              <div key={`RefName_${i}`} className="fos-detail-item">
                <span className="fos-detail-label">Reference Name {i + 1}</span>
                {masterMode
                  ? <strong className="fos-detail-val"><MasterEditField caseId={caseData._id} tag="Reference Name" sourceCol={refSourceCol} value={n} fullString={combined} replaceTarget={names[i]} onUpdate={handleFieldMasterUpdate} /></strong>
                  : <strong className="fos-detail-val">{n}</strong>}
              </div>
            )
          }
          if (p) {
            expandTagElements.push(
              <div key={`RefPhone_${i}`} className="fos-detail-item">
                <span className="fos-detail-label">{mobTag} {i + 1}</span>
                {masterMode
                  ? <strong className="fos-detail-val"><MasterEditField caseId={caseData._id} tag={mobTag} sourceCol={refSourceCol} value={p} fullString={combined} replaceTarget={p} onUpdate={handleFieldMasterUpdate} /></strong>
                  : <strong className="fos-detail-val">{p}</strong>}
              </div>
            )
          }
        }
        continue
      }

      // Normal Array logic (multiple distinct columns) or Single distinct columns (interleaved)
      const nameArr = Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : [])
      const nameColsArr = Array.isArray(rawCols) ? rawCols : (rawCols ? [rawCols] : [])
      const mobArr = Array.isArray(mobVal) ? mobVal : (mobVal ? [mobVal] : [])
      const mobColsArr = Array.isArray(mobCols) ? mobCols : (mobCols ? [mobCols] : [])

      const maxLen = Math.max(nameArr.length, mobArr.length)
      for (let i = 0; i < maxLen; i++) {
        if (i < nameArr.length) {
          const colName = nameColsArr[i]
          expandTagElements.push(
            <div key={`RefName_${i}`} className="fos-detail-item">
              <span className="fos-detail-label">{tag} {i + 1}</span>
              {masterMode
                ? <strong className="fos-detail-val"><MasterEditField caseId={caseData._id} tag={tag} sourceCol={colName} value={String(nameArr[i] || '')} onUpdate={handleFieldMasterUpdate} /></strong>
                : <strong className="fos-detail-val">{formatDetailValue(tag, nameArr[i])}</strong>}
            </div>
          )
        }
        if (i < mobArr.length) {
          const colName = mobColsArr[i]
          expandTagElements.push(
            <div key={`RefPhone_${i}`} className="fos-detail-item">
              <span className="fos-detail-label">{mobTag || 'Reference Number'} {i + 1}</span>
              {masterMode
                ? <strong className="fos-detail-val"><MasterEditField caseId={caseData._id} tag={mobTag || 'Reference Number'} sourceCol={colName} value={String(mobArr[i] || '')} onUpdate={handleFieldMasterUpdate} /></strong>
                : <strong className="fos-detail-val">{formatDetailValue(mobTag || 'Reference Number', mobArr[i])}</strong>}
            </div>
          )
        }
      }
      continue
    }

    // Default arrays
    if (Array.isArray(rawVal)) {
      rawVal.forEach((v, i) => {
        const colName = Array.isArray(rawCols) ? rawCols[i] : rawCols
        expandTagElements.push(
          <div key={`${tag}_${i}`} className="fos-detail-item">
            <span className="fos-detail-label">{tag} {i + 1}</span>
            {masterMode
              ? <strong className="fos-detail-val"><MasterEditField caseId={caseData._id} tag={tag} sourceCol={colName} value={String(v || '')} onUpdate={handleFieldMasterUpdate} /></strong>
              : <strong className="fos-detail-val">{formatDetailValue(tag, v)}</strong>}
          </div>
        )
      })
      continue
    }

    // Default single
    expandTagElements.push(
      <div key={tag} className="fos-detail-item">
        <span className="fos-detail-label">{tag}</span>
        {masterMode
          ? <strong className="fos-detail-val"><MasterEditField caseId={caseData._id} tag={tag} sourceCol={rawCols} value={String(rawVal || '')} onUpdate={handleFieldMasterUpdate} /></strong>
          : <strong className="fos-detail-val">{formatDetailValue(tag, rawVal)}</strong>}
      </div>
    )
  }

  function handleFieldMasterUpdate(tag, val, sourceCol) {
    if (sourceCol) {
      // It's hard to update local tags precisely when we just have sourceCol, especially if it's a regex replacement.
      // So we will trigger a re-fetch of cases in the parent if possible?
      // Wait, onUpdate updates local state. 
      // If we don't update local state perfectly, the UI might be stale until refresh. 
      // FOS Cases are refreshed on page load anyway.
    }
    onUpdate(caseData._id, { tagData: { [tag]: val } }, false)
  }
  function handleQuickUpdate(updates, isTest) { onUpdate(caseData._id, updates, isTest) }
  function handleNotesUpdate(newNotes) { onUpdate(caseData._id, { fosNotes: newNotes }, false) }

  return (
    <div className={`ac-case-row ${expanded ? 'ac-row-open' : ''}`}>
      <div className={`ac-row-stripe ${isPaid ? 'stripe-paid' : isUnpaid ? 'stripe-unpaid' : 'stripe-other'}`} />

      {/* ── Clickable info area ── */}
      <div className="ac-row-header-btn" role="button" tabIndex={0} onClick={() => setExpanded(e => !e)}>

        {/* Line 1: # + Name + Loan + Status pill + expand */}
        <div className="ac-row-line1">
          <span className="ac-row-num">#{index + 1}</span>

          <div className="ac-row-name-block">
            <div className="ac-row-name-row">
              {masterMode
                ? <span className="ac-row-name"><MasterEditField caseId={caseData._id} tag="Customer Name" value={custName} onUpdate={handleFieldMasterUpdate} /></span>
                : <span className="ac-row-name">{custName}</span>}
              {isNew && <span className="fos-new-badge">{newCaseVal.toUpperCase()}</span>}
              <button className="fos-copy-btn-small" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(custName); setCopiedName(true); setTimeout(() => setCopiedName(false), 1500) }} title="Copy name">
                <Icon name={copiedName ? 'check' : 'copy'} size={10} />
              </button>
            </div>
            {fatherName && <div className="ac-row-father">Father name: {fatherName}</div>}
          </div>

          <div className="ac-row-loan-block">
            <span className="ac-row-field-label">Loan No</span>
            <div className="ac-row-loan-row">
              {masterMode
                ? <span className="ac-row-loan"><MasterEditField caseId={caseData._id} tag="Loan No" value={loanNo} onUpdate={handleFieldMasterUpdate} /></span>
                : <span className="ac-row-loan">{loanNo}</span>}
              <button className="fos-copy-btn-small" onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(loanNo); setCopiedLoan(true); setTimeout(() => setCopiedLoan(false), 1500) }} title="Copy loan number">
                <Icon name={copiedLoan ? 'check' : 'copy'} size={10} />
              </button>
            </div>
          </div>

          {emiAmount && (
            <div className="ac-row-emi-block" style={{ minWidth: '80px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div>
                <span className="ac-row-field-label">EMI AMOUNT</span>
                {masterMode ? (
                  <MasterEditField caseId={caseData._id} tag="EMI Amount" value={emiAmount} onUpdate={handleFieldMasterUpdate} />
                ) : (
                  <span className="fos-emi-chip" style={{ margin: 0 }}>₹{emiAmount}</span>
                )}
              </div>
            </div>
          )}

          <div className="ac-row-status-block">
            <span className="ac-row-field-label">Status</span>
            <span className={`fos-status-pill ${statusPillClass}`}>{statusRaw || 'N/A'}</span>
          </div>

          <div className="ac-row-expand-btn" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {masterMode && (localStorage.getItem('collectionAssistRole') || sessionStorage.getItem('collectionAssistRole')) === 'Admin' && (
              <>
                <button 
                  className="fos-copy-btn-small" 
                  style={{ color: '#e88080' }} 
                  title="Delete this case" 
                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true) }}
                >
                  <Icon name="trash" size={14} />
                </button>
                {showDeleteConfirm && (
                  <div className="modal-backdrop" onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) setShowDeleteConfirm(false) }}>
                    <div className="modal" style={{ maxWidth: 360, textAlign: 'left', cursor: 'default' }} onClick={e => e.stopPropagation()}>
                      <button className="close-button" type="button" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}><Icon name="close" size={20} /></button>
                      <span className="eyebrow" style={{ color: '#e88080' }}>DELETE CASE</span>
                      <h2 style={{ marginBottom: 12 }}>Permanently Delete Case?</h2>
                      <p style={{ margin: 0, color: '#888888', fontSize: 13, lineHeight: 1.5 }}>
                        Are you sure you want to completely delete case <strong>{loanNo}</strong>? This will remove it from the database and the output Excel file. This action cannot be undone.
                      </p>
                      {deleteError && <div className="fos-error ac-error" style={{ marginTop: 12, padding: 8, fontSize: 12 }}>{deleteError}</div>}
                      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                        <button type="button" className="outlined-button" onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1 }} disabled={deleting}>Cancel</button>
                        <button type="button" className="primary-button" style={{ background: '#a13b3b', borderColor: '#a13b3b', flex: 1 }} onClick={confirmDelete} disabled={deleting}>
                          {deleting ? 'Deleting...' : 'Delete Case'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
          </div>
        </div>

        {/* Line 2: Address */}
        {(address || pinCode) && (
          <div className="ac-row-address">
            {masterMode
              ? <span><MasterEditField caseId={caseData._id} tag="Address" value={address} onUpdate={handleFieldMasterUpdate} /></span>
              : <span>{address}</span>}
            {pinCode && (
              <>{address && <span className="ac-addr-sep">·</span>}
                {masterMode
                  ? <span className="ac-row-pincode"><MasterEditField caseId={caseData._id} tag="Pin Code" value={pinCode} onUpdate={handleFieldMasterUpdate} /></span>
                  : <span className="ac-row-pincode">{pinCode}</span>}</>
            )}
          </div>
        )}

        {/* Line 2.5: Vehicle */}
        {availableTags.includes('Vehicle') && td['Vehicle'] && td['Vehicle'] !== 'None' && (
          <div className="ac-row-address" style={{ marginTop: 2, color: '#88e0b6' }}>
            <strong style={{ opacity: 0.7, marginRight: 4 }}>Vehicle:</strong>
            {masterMode
              ? <span><MasterEditField caseId={caseData._id} tag="Vehicle" value={td['Vehicle']} onUpdate={handleFieldMasterUpdate} /></span>
              : <span>{td['Vehicle']}</span>}
          </div>
        )}

        {/* Line 3: Chips */}
        {chipFields.length > 0 && (
          <div className="ac-row-chips">
            {chipFields.map(tag => {
              const val = String(td[tag])
              const isCurrency = ['EMI Amount', 'POS'].includes(tag)
              return (
                <div key={tag} className="ac-chip">
                  <span className="ac-chip-label">{tag}</span>
                  {masterMode
                    ? <span className="ac-chip-val"><MasterEditField caseId={caseData._id} tag={tag} value={val} onUpdate={handleFieldMasterUpdate} /></span>
                    : <span className="ac-chip-val">{isCurrency ? `₹${val}` : val}</span>}
                </div>
              )
            })}
            {caseData.ptpDate && (
              <div className="ac-chip" style={{ background: '#3b2512', borderColor: '#5c3a1c' }}>
                <span className="ac-chip-label">PTP</span>
                <span className="ac-chip-val" style={{ color: '#e69f5c' }}>
                  {new Date(caseData.ptpDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {caseData.hasPtpTime ? ', ' + new Date(caseData.ptpDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Notes preview */}
        {caseData.fosNotes && (
          <div className="ac-row-notes-preview" style={{ fontSize: '14px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: 0.7, marginRight: '4px' }}>
              <Icon name="pencil" size={11} /> <strong>Note:</strong>
            </span>
            {caseData.fosNotes}
          </div>
        )}
      </div>

      {/* ── Always-visible Quick Edit strip (outside clickable area) ── */}
      <InlineQuickEdit
        caseData={caseData}
        onUpdate={handleQuickUpdate}
        testMode={testMode}
        masterMode={masterMode}
      />

      {/* ── Expanded section (additional details + notes) ── */}
      {expanded && (
        <div className="ac-row-expanded">
          {expandTagElements.length > 0 && (
            <div className="ac-expand-block">
              <div className="ac-expand-block-label"><Icon name="file" size={13} /> Additional Details</div>
              <div className="ac-expand-details-grid">
                {expandTagElements}
              </div>
            </div>
          )}

          <div className="ac-expand-block">
            <AdminNotesEditor caseId={caseData._id} initialNotes={caseData.fosNotes} onUpdate={handleNotesUpdate} />
          </div>
        </div>
      )}
    </div>
  )
}


// ── Group Node ─────────────────────────────────────────────────────────────────
function GroupNode({ node, depth, availableTags, masterMode, testMode, onUpdate, caseIndexMap }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!node.isGroup) {
    return (
      <CaseRow
        caseData={node}
        index={caseIndexMap[String(node._id)] ?? 0}
        availableTags={availableTags}
        masterMode={masterMode}
        testMode={testMode}
        onUpdate={onUpdate}
      />
    )
  }

  const lbl = String(node.label)
  const lblUpper = lbl.toUpperCase()
  const pillClass = lblUpper === 'PAID' ? 'pill-paid' : lblUpper === 'UNPAID' ? 'pill-unpaid' : ''

  const countStr = node.count === node.currentCount
    ? `${node.count} ${node.count === 1 ? 'case' : 'cases'}`
    : `${node.count} ${node.count === 1 ? 'case' : 'cases'} (${node.currentCount} current)`

  return (
    <div className={`ac-group-node ac-group-depth-${Math.min(depth, 3)}`}>
      <button className="ac-group-hdr" onClick={() => setCollapsed(c => !c)}>
        <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={13} />
        {pillClass
          ? <span className={`fos-status-pill ${pillClass}`} style={{ fontSize: 10 }}>{lbl}</span>
          : <span className="ac-group-lbl">{lbl}</span>}
        <span className="ac-group-cnt">{countStr}</span>
      </button>
      {!collapsed && (
        <div className="ac-group-body">
          {node.children.map((child, i) => (
            <GroupNode
              key={child.isGroup ? `${child.label}__${depth}__${i}` : String(child._id)}
              node={child} depth={depth + 1}
              availableTags={availableTags}
              masterMode={masterMode} testMode={testMode}
              onUpdate={onUpdate} caseIndexMap={caseIndexMap}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Cases Component ──────────────────────────────────────────────────────
export function Cases() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const collectionId = searchParams.get('collectionId')
  const sheetName = searchParams.get('sheetName')

  const [cases, setCases] = useState([])
  const [originalCases, setOriginalCases] = useState([])
  const [stats, setStats] = useState(null)
  const [availableTags, setAvailableTags] = useState([])
  const [workbookName, setWorkbookName] = useState('')
  const [workbookSheets, setWorkbookSheets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [groupKeys, setGroupKeys] = useState([])
  const [testMode, setTestMode] = useState(false)
  const [masterMode, setMasterMode] = useState(false)
  const [overallOpen, setOverallOpen] = useState(true)
  const [fosOpen, setFosOpen] = useState(true)
  const [drrOpen, setDrrOpen] = useState(true)
  const initialTagsRef = useRef(new Map())
  const [sidebarWidth, setSidebarWidth] = useState(450)
  const [headerScrolled, setHeaderScrolled] = useState(false)
  const [mobileStatsOpen, setMobileStatsOpen] = useState(false)

  const [collectionMonth, setCollectionMonth] = useState('')
  const [collectionYear, setCollectionYear] = useState(null)

  const [otherSheetCounts, setOtherSheetCounts] = useState({})

  const [hiddenFos, setHiddenFos] = useState(new Set())
  const [drrPercentage, setDrrPercentage] = useState(97)
  const [drrDaysOverride, setDrrDaysOverride] = useState('')

  const headerRef = useRef(null)

  useEffect(() => {
    if (!headerRef.current) return
    const observer = new IntersectionObserver(([entry]) => {
      setHeaderScrolled(!entry.isIntersecting)
    }, { rootMargin: '-72px 0px 0px 0px' })
    observer.observe(headerRef.current)
    return () => observer.disconnect()
  }, [])

  function handleSidebarDrag(e) {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    let finalWidth = startWidth
    let ticking = false

    function onMouseMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX
      finalWidth = Math.max(250, Math.min(startWidth - deltaX, 800))

      if (!ticking) {
        window.requestAnimationFrame(() => {
          setSidebarWidth(finalWidth)
          ticking = false
        })
        ticking = true
      }
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)

      // Save to database
      fetch(`/api/admin/collection/${collectionId}/sheet/${encodeURIComponent(sheetName)}/prefs`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ width: finalWidth })
      }).catch(err => console.error(err))
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  function handleToggleOverall() {
    setOverallOpen(o => !o)
  }

  function handleToggleFos() {
    setFosOpen(o => !o)
  }

  function handleToggleDrr() {
    setDrrOpen(o => !o)
  }

  useEffect(() => {
    const empId = localStorage.getItem('collectionAssistEmployeeId') || sessionStorage.getItem('collectionAssistEmployeeId') || 'unknown'
    const storageKey = `lastViewedCases_${empId}`

    const checkPrefs = async () => {
      if (collectionId && sheetName) {
        fetchCases()
      } else {
        try {
          const localPrefs = JSON.parse(localStorage.getItem(storageKey))
          if (localPrefs?.colId && localPrefs?.sheetName) {
            setSearchParams({ collectionId: localPrefs.colId, sheetName: localPrefs.sheetName })
            return
          }
        } catch (e) { }

        try {
          const res = await fetch('/api/users/me/prefs', { headers: authHeaders() })
          if (res.ok) {
            const data = await res.json()
            if (data.lastViewedCases?.colId && data.lastViewedCases?.sheetName) {
              localStorage.setItem(storageKey, JSON.stringify(data.lastViewedCases))
              setSearchParams({ collectionId: data.lastViewedCases.colId, sheetName: data.lastViewedCases.sheetName })
            } else {
              setLoading(false)
            }
          } else {
            setLoading(false)
          }
        } catch (e) {
          console.error('Failed to load last viewed cases:', e)
          setLoading(false)
        }
      }
    }
    checkPrefs()
  }, [collectionId, sheetName])

  async function fetchCases(silent = false) {
    if (!silent) { setLoading(true); setError('') }
    try {
      const res = await fetch(
        `/api/admin/cases?collectionId=${collectionId}&sheetName=${encodeURIComponent(sheetName)}`,
        { headers: authHeaders() }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setCases(data.cases || [])
      if (!silent) {
        const tagMap = new Map()
          ; (data.cases || []).forEach(c => tagMap.set(String(c._id), c.tagData || {}))
        initialTagsRef.current = tagMap

        const empId = localStorage.getItem('collectionAssistEmployeeId') || sessionStorage.getItem('collectionAssistEmployeeId') || 'unknown'
        const storageKey = `lastViewedCases_${empId}`
        localStorage.setItem(storageKey, JSON.stringify({ colId: collectionId, sheetName }))
        fetch('/api/users/me/prefs', {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({ lastViewedCases: { colId: collectionId, sheetName } })
        }).catch(err => console.error('Failed to save last viewed cases:', err))
      }
      setOriginalCases(data.cases || [])
      setStats(data.stats || null)
      setAvailableTags(data.availableTags || [])
      setWorkbookName(data.workbookName || '')
      setWorkbookSheets(data.workbookSheets || [])
      setCollectionMonth(data.collectionMonth || '')
      setCollectionYear(data.collectionYear || null)
      if (!silent) {
        if (data.sidebarWidth) setSidebarWidth(data.sidebarWidth)
        setDrrPercentage(data.drrPercentage !== undefined ? data.drrPercentage : 97)
        setDrrDaysOverride(data.drrDaysOverride !== null && data.drrDaysOverride !== undefined ? data.drrDaysOverride : '')
      }
    } catch (err) {
      if (!silent) {
        setError(err.message)
        if (err.message === 'Collection not found.' || err.message === 'Sheet not found.') {
          const empId = localStorage.getItem('collectionAssistEmployeeId') || sessionStorage.getItem('collectionAssistEmployeeId') || 'unknown'
          localStorage.removeItem(`lastViewedCases_${empId}`)

          fetch('/api/users/me/prefs', {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ lastViewedCases: null })
          }).catch(() => { })

          setSearchParams({})
        }
      }
    }
    finally { if (!silent) setLoading(false) }
  }

  useEffect(() => {
    if (!search.trim()) {
      setOtherSheetCounts({})
      return
    }
    const q = search.trim()
    const controller = new AbortController()
    
    const timeoutId = setTimeout(() => {
      fetch(`/api/admin/search-counts?collectionId=${collectionId}&q=${encodeURIComponent(q)}`, {
        headers: authHeaders(),
        signal: controller.signal
      })
        .then(r => r.json())
        .then(d => {
          if (d.counts) setOtherSheetCounts(d.counts)
        })
        .catch(() => {})
    }, 300)
    
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [search, collectionId])

  // Derived state for overall stats based on hiddenFos
  const activeStats = useMemo(() => {
    if (!stats) return { totalCount: 0, totalPos: 0, overallStatuses: [] }

    let totalPos = 0
    let totalCount = 0
    const statusMap = { statusPos: {}, statusCount: {} }

    stats.fosStats.forEach(f => {
      if (hiddenFos.has(f.fos)) return

      totalPos += f.totalPos
      totalCount += f.totalCount

      f.statuses.forEach(s => {
        statusMap.statusPos[s.status] = (statusMap.statusPos[s.status] || 0) + s.pos
        statusMap.statusCount[s.status] = (statusMap.statusCount[s.status] || 0) + s.count
      })
    })

    const overallStatuses = Object.keys(statusMap.statusPos).map(status => ({
      status,
      count: statusMap.statusCount[status],
      pos: statusMap.statusPos[status],
      percentage: totalPos > 0 ? ((statusMap.statusPos[status] / totalPos) * 100).toFixed(2) : '0.00'
    }))
    overallStatuses.sort((a, b) => a.status.localeCompare(b.status))

    return { totalCount, totalPos, overallStatuses }
  }, [stats, hiddenFos])

  // DRR Calculations
  const drrInfo = useMemo(() => {
    const paidStatus = activeStats.overallStatuses.find(s => s.status.toLowerCase() === 'paid')
    const currentPaidPos = paidStatus ? paidStatus.pos : 0
    const targetPos = (activeStats.totalPos * (drrPercentage / 100))
    const diff = targetPos - currentPaidPos

    let calcDays = 0
    if (collectionMonth && collectionYear) {
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
      const mIdx = monthNames.findIndex(m => m.toLowerCase() === collectionMonth.toLowerCase())
      if (mIdx !== -1) {
        const now = new Date()
        if (now.getFullYear() > collectionYear || (now.getFullYear() === collectionYear && now.getMonth() > mIdx)) {
          calcDays = 0
        } else if (now.getFullYear() === collectionYear && now.getMonth() === mIdx) {
          const totalDaysInMonth = new Date(collectionYear, mIdx + 1, 0).getDate()
          calcDays = Math.max(0, totalDaysInMonth - now.getDate() + 1)
        } else {
          calcDays = new Date(collectionYear, mIdx + 1, 0).getDate()
        }
      }
    }

    const finalDays = (drrDaysOverride !== null && drrDaysOverride !== '') ? Number(drrDaysOverride) : calcDays
    const drrValue = finalDays > 0 ? (diff / finalDays) : diff

    return { currentPaidPos, targetPos, diff, calcDays, finalDays, drrValue }
  }, [activeStats, drrPercentage, drrDaysOverride, collectionMonth, collectionYear])

  async function updateDrrPrefs(updates) {
    if (updates.drrPercentage !== undefined) setDrrPercentage(updates.drrPercentage)
    if (updates.drrDaysOverride !== undefined) setDrrDaysOverride(updates.drrDaysOverride)

    try {
      await fetch(`/api/admin/collection/${collectionId}/sheet/${encodeURIComponent(sheetName)}/prefs`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(updates)
      })
    } catch (err) {
      console.error('Failed to update DRR prefs:', err)
    }
  }

  function handleDrrPercentageBlur(e) {
    let val = parseFloat(e.target.value)
    if (isNaN(val) || val < 0) val = 97
    if (val > 100) val = 100
    e.target.value = val
    updateDrrPrefs({ drrPercentage: val })
  }

  function handleDrrDaysBlur(e) {
    let val = e.target.value.trim()
    if (val === '') {
      updateDrrPrefs({ drrDaysOverride: '' })
    } else {
      let num = parseInt(val, 10)
      if (isNaN(num) || num < 0) num = 0
      e.target.value = num
      updateDrrPrefs({ drrDaysOverride: num })
    }
  }

  function toggleFos(fosName) {
    setHiddenFos(prev => {
      const next = new Set(prev)
      if (next.has(fosName)) {
        next.delete(fosName)
      } else {
        if (stats && stats.fosStats.length - next.size <= 1) return prev;
        next.add(fosName)
      }
      return next
    })
  }

  function handleCaseUpdate(caseId, updates, isTest) {
    if (updates._deleted) {
      setCases(prev => prev.filter(c => String(c._id) !== String(caseId)))
      return
    }

    setCases(prev => prev.map(c => {
      if (String(c._id) !== String(caseId)) return c
      return {
        ...c,
        ...(updates.fosNotes !== undefined ? { fosNotes: updates.fosNotes } : {}),
        tagData: updates.tagData ? { ...c.tagData, ...updates.tagData } : c.tagData,
        _testChanged: isTest ? true : c._testChanged,
      }
    }))

    // Dynamically refresh stats if Status is updated and not in Test mode
    if (!isTest && updates.tagData && updates.tagData['Status'] !== undefined) {
      fetchCases(true)
    }
  }

  function handleToggleTestMode() {
    if (testMode) { setCases(originalCases) } else { if (masterMode) setMasterMode(false) }
    setTestMode(t => !t)
  }
  function handleToggleMasterMode() {
    if (testMode) return
    setMasterMode(m => !m)
  }
  function toggleGroupKey(key) {
    setGroupKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  const availableGroupKeys = GROUPABLE_TAGS.filter(k => availableTags.includes(k))

  const filteredCases = useMemo(() => {
    if (!search.trim()) return cases
    const q = search.toLowerCase()
    return cases.filter(c =>
      String(c.loanNumber || '').toLowerCase().includes(q) ||
      String(c.tagData?.['Customer Name'] || '').toLowerCase().includes(q)
    )
  }, [cases, search])

  function buildGroups(caseList, keys, idx) {
    if (idx >= keys.length) return caseList
    const key = keys[idx]
    const groupMap = new Map()
    for (const c of caseList) {
      const origTagData = initialTagsRef.current.get(String(c._id)) || c.tagData
      const rawVal = origTagData?.[key]
      let groupVal = (!rawVal || String(rawVal).trim() === '' || String(rawVal).trim().toLowerCase() === 'none')
        ? 'Unassigned' : String(rawVal).trim()
      if (key === 'New Case' && groupVal === 'Unassigned') groupVal = 'Old'

      if (!groupMap.has(groupVal)) groupMap.set(groupVal, [])
      groupMap.get(groupVal).push(c)
    }
    return [...groupMap.entries()].map(([label, groupCases]) => {
      let currentCount = 0
      for (const c of groupCases) {
        const curRawVal = c.tagData?.[key]
        let curVal = (!curRawVal || String(curRawVal).trim() === '' || String(curRawVal).trim().toLowerCase() === 'none')
          ? 'Unassigned' : String(curRawVal).trim()
        if (key === 'New Case' && curVal === 'Unassigned') curVal = 'Old'
        if (curVal === label) currentCount++
      }

      return {
        isGroup: true, label, count: groupCases.length, currentCount,
        children: buildGroups(groupCases, keys, idx + 1),
      }
    })
  }

  const treeData = useMemo(() => {
    if (groupKeys.length === 0) return filteredCases
    return buildGroups(filteredCases, groupKeys, 0)
  }, [filteredCases, groupKeys])

  const caseIndexMap = useMemo(() => {
    function flatten(nodes) {
      const result = []
      for (const n of (Array.isArray(nodes) ? nodes : [])) {
        if (n.isGroup) result.push(...flatten(n.children))
        else result.push(n)
      }
      return result
    }
    const map = {}
    flatten(treeData).forEach((c, i) => { map[String(c._id)] = i })
    return map
  }, [treeData])

  // ── Landing state ──────────────────────────────────────────────────────────
  if (!collectionId || !sheetName) {
    return (
      <div className="admin-content">
        <div className="ac-landing">
          <div className="ac-landing-icon"><Icon name="cases" size={44} /></div>
          <h2>No Sheet Selected</h2>
          <p>Click <strong>"View cases"</strong> on any sheet in the Overview to see its cases here.</p>
          <button className="primary-button" onClick={() => navigate('/admin/overview')}>
            <Icon name="grid" size={15} /> Go to Overview
          </button>
        </div>
      </div>
    )
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div className="cases-layout-container" style={{ display: 'flex', alignItems: 'stretch' }}>
      <div className="ac-page" style={{ flex: 1, minWidth: 0, paddingRight: 0 }}>
        {/* Page Header */}
        <div className="ac-page-header" ref={headerRef}>
          <div>
            <span className="eyebrow">CASES VIEW</span>
            <h1 className="ac-page-title">{workbookName}</h1>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <div className="ac-mode-toggles">
              <button
                className={`ac-mode-btn ${testMode ? 'ac-mode-test-on' : ''} ${masterMode ? 'ac-mode-btn-disabled' : ''}`}
                onClick={handleToggleTestMode}
                disabled={masterMode}
                title={masterMode ? 'Cannot use Test Mode while Master Mode is active' : testMode ? 'Disable Test Mode (reverts changes)' : 'Enable Test Mode (no DB writes)'}
              >
                <Icon name="wand" size={13} />
                Test Mode
                {testMode && <span className="ac-mode-on-badge"><Icon name="check" size={10} /> ON</span>}
              </button>
              <button
                className={`ac-mode-btn ${masterMode ? 'ac-mode-master-on' : ''} ${testMode ? 'ac-mode-btn-disabled' : ''}`}
                onClick={handleToggleMasterMode}
                disabled={testMode}
                title={testMode ? 'Cannot use Master Mode while Test Mode is active' : masterMode ? 'Disable Master Mode' : 'Enable Master Mode (edit all fields)'}
              >
                <Icon name="shield" size={13} />
                Master Mode
                {masterMode && <span className="ac-mode-on-badge"><Icon name="check" size={10} /> ON</span>}
              </button>
            </div>
          </div>
        </div>

        {/* ── Desktop Combined Sticky Section ── */}
        <div className="ac-desktop-combined-sticky">
        {/* ── Non-Sticky Top Section ── */}
        <div style={{ display: 'flex', flexDirection: 'column', background: '#111111' }}>
          {/* Sheet Tabs Row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 22px 12px', overflowX: 'auto' }} className="hide-scrollbar">
            <span style={{ color: '#777777', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Sheets:</span>
            {workbookSheets.map(sName => {
              const isActive = sName === sheetName
              const count = otherSheetCounts[sName]
              return (
                <button
                  key={sName}
                  onClick={() => {
                    if (!isActive) {
                      setSearchParams({ collectionId, sheetName: sName })
                    }
                  }}
                  style={{
                    background: isActive ? '#1e1e1e' : 'transparent',
                    color: isActive ? '#8be8d8' : '#777777',
                    border: `1px solid ${isActive ? '#2e2e2e' : 'transparent'}`,
                    padding: '4px 12px',
                    borderRadius: 12,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  {sName}
                  {!isActive && count > 0 && (
                    <span style={{ background: '#6be2c7', color: '#111111', padding: '0 6px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Sticky Top Section ── */}
        <div className="ac-sticky-top-section" style={{ position: 'sticky', top: 0, zIndex: 30, background: '#111111', borderBottom: '1px solid #1e1e1e', display: 'flex', flexDirection: 'column', paddingBottom: 10, paddingTop: 10 }}>          {/* Controls Bar */}
          <div className="ac-controls" style={{ padding: '0 22px' }}>
            <div className="ac-search">
              <Icon name="search" size={15} />
              <input
                type="text"
                placeholder="Search by loan number or customer name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="ac-search-clear" onClick={() => setSearch('')}><Icon name="close" size={13} /></button>
              )}
            </div>
            {availableGroupKeys.length > 0 && (
              <div className="ac-grouping-row">
                <span className="ac-grouping-label">Group by:</span>
                {availableGroupKeys.map(key => {
                  const isActive = groupKeys.includes(key)
                  return (
                    <button key={key} className={`ac-group-chip ${isActive ? 'ac-chip-on' : ''}`} onClick={() => toggleGroupKey(key)}>
                      {isActive && <span className="ac-chip-order">{groupKeys.indexOf(key) + 1}</span>}
                      {key}
                    </button>
                  )
                })}
                {groupKeys.length > 0 && (
                  <button className="ac-group-chip ac-chip-clear" onClick={() => setGroupKeys([])}><Icon name="close" size={11} /> Clear</button>
                )}
              </div>
            )}
          </div>

        </div>
        </div>

        {error && <div className="fos-error ac-error">{error}</div>}

        {/* ── Case List ── */}
        <div className="ac-list-wrapper">
          {loading ? (
            <div className="ac-case-list" style={{ paddingTop: 8 }}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                <div key={i} className="ac-case-row" style={{ position: 'relative', overflow: 'hidden' }}>
                  {/* Left stripe */}
                  <div className="ac-row-stripe" style={{ background: i % 3 === 0 ? '#4caf85' : i % 3 === 1 ? '#e6a835' : '#555555', opacity: 0.5 }} />

                  {/* Header area */}
                  <div style={{ padding: '14px 18px 12px 22px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Line 1: index + name + loan + status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <span className="skeleton-block" style={{ width: 24, height: 12, borderRadius: 3, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span className="skeleton-block" style={{ width: `${140 + (i % 4) * 30}px`, height: 16, borderRadius: 4 }} />
                        <span className="skeleton-block" style={{ width: 100, height: 11, borderRadius: 3 }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 140, alignItems: 'flex-start' }}>
                        <span className="skeleton-block" style={{ width: 60, height: 10, borderRadius: 3 }} />
                        <span className="skeleton-block" style={{ width: 110, height: 14, borderRadius: 4 }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 80 }}>
                        <span className="skeleton-block" style={{ width: 44, height: 10, borderRadius: 3 }} />
                        <span className="skeleton-block" style={{ width: 60, height: 22, borderRadius: 12 }} />
                      </div>
                    </div>

                    {/* Address line */}
                    <span className="skeleton-block" style={{ width: `${40 + (i % 5) * 8}%`, height: 12, borderRadius: 3, marginLeft: 38 }} />

                    {/* Chips row: LOT | EMI AMOUNT | POS */}
                    <div style={{ display: 'flex', gap: 12, marginLeft: 38 }}>
                      {[['LOT', 36], ['EMI AMOUNT', 52], ['POS', 64]].map(([lbl, valW]) => (
                        <div key={lbl} style={{ background: '#111111', border: '1px solid #1a1a1a', borderRadius: 6, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <span className="skeleton-block" style={{ width: lbl.length * 6, height: 9, borderRadius: 2 }} />
                          <span className="skeleton-block" style={{ width: valW, height: 14, borderRadius: 3 }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="ac-empty">
              <Icon name="cases" size={36} />
              <p>{cases.length === 0 ? 'No cases found for this sheet.' : 'No cases match your search.'}</p>
              {cases.length > 0 && <small>Try a different search term.</small>}
            </div>
          ) : (
            <div style={{ animation: 'contentFadeIn 0.3s ease' }}>
              <div className="ac-list-count-bar">
                <span>{filteredCases.length !== cases.length ? `${filteredCases.length} of ${cases.length} cases` : `${cases.length} ${cases.length === 1 ? 'case' : 'cases'}`}</span>
                {groupKeys.length > 0 && <span className="ac-grouped-badge">Grouped by: {groupKeys.join(' → ')}</span>}
              </div>
              <div className="ac-case-list">
                {groupKeys.length === 0
                  ? filteredCases.map((c, i) => (
                    <CaseRow key={String(c._id)} caseData={c} index={i} availableTags={availableTags} masterMode={masterMode} testMode={testMode} onUpdate={handleCaseUpdate} />
                  ))
                  : (Array.isArray(treeData) ? treeData : []).map((node, i) => (
                    <GroupNode key={node.isGroup ? `root-${node.label}-${i}` : String(node._id)} node={node} depth={0} availableTags={availableTags} masterMode={masterMode} testMode={testMode} onUpdate={handleCaseUpdate} caseIndexMap={caseIndexMap} />
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Stats FAB */}
      <button
        className="ac-mobile-stats-fab"
        onClick={() => setMobileStatsOpen(o => !o)}
        title={mobileStatsOpen ? 'Close stats' : 'Show stats'}
      >
        <Icon name={mobileStatsOpen ? 'close' : 'grid'} size={20} />
      </button>

      {/* Right Sidebar for Stats */}
      {mobileStatsOpen && <div className="ac-mobile-stats-backdrop" onClick={() => setMobileStatsOpen(false)} />}
      <aside className={`ac-right-sidebar ${mobileStatsOpen ? 'ac-stats-mobile-open' : ''}`} style={{ width: sidebarWidth }}>
        <div
          onMouseDown={handleSidebarDrag}
          style={{
            position: 'absolute',
            left: -3,
            top: 0,
            bottom: 0,
            width: 6,
            cursor: 'col-resize',
            zIndex: 10
          }}
          title="Drag to resize"
        />
        <div className="ac-right-sidebar-header" style={{ padding: '24px 20px 16px', borderBottom: '1px solid #1e1e1e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 14, color: '#eeeeee' }}>Stats & Breakdown</h3>
          <button
            className="ac-stats-close-btn"
            onClick={() => setMobileStatsOpen(false)}
            title="Close stats"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="ac-right-sidebar-content" style={{ padding: '16px 20px' }}>

          {!stats ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, opacity: 0.7 }}>
              <div style={{ background: '#111111', padding: 14, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <span className="skeleton-block" style={{ width: 140, height: 16, borderRadius: 4 }} />
                <span className="skeleton-block" style={{ width: '100%', height: 32, borderRadius: 4 }} />
                <span className="skeleton-block" style={{ width: '100%', height: 32, borderRadius: 4 }} />
                <span className="skeleton-block" style={{ width: '100%', height: 32, borderRadius: 4 }} />
              </div>
              <div style={{ background: '#111111', padding: 14, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <span className="skeleton-block" style={{ width: 110, height: 16, borderRadius: 4 }} />
                <span className="skeleton-block" style={{ width: '100%', height: 48, borderRadius: 4 }} />
                <span className="skeleton-block" style={{ width: '100%', height: 48, borderRadius: 4 }} />
              </div>
            </div>
          ) : (
            <div style={{ animation: 'contentFadeIn 0.3s ease' }}>
              {/* Overall Status Accordion */}
              <div className="ac-stats-accordion">
                <button className={`ac-stats-expand-btn ${overallOpen ? 'open' : ''}`} style={{ width: '100%', margin: 0, justifyContent: 'space-between', padding: '10px 14px' }} onClick={handleToggleOverall}>
                  <span style={{ fontWeight: 600 }}>Overall Status</span>
                  <Icon name={overallOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                </button>
                {overallOpen && (
                  <div className="ac-stats-accordion-body" style={{ marginTop: 12 }}>
                    <div className="ac-stats-table-wrap" style={{ margin: 0, padding: '12px 14px', background: '#111111' }}>
                      <table className="ac-stats-table">
                        <thead>
                          <tr><th>Status</th><th>Cases</th><th>POS</th><th>%</th></tr>
                        </thead>
                        <tbody>
                          {(activeStats.overallStatuses || []).map(s => (
                            <tr key={s.status}>
                              <td><span className={`fos-status-pill ${s.status === 'PAID' ? 'pill-paid' : s.status === 'UNPAID' ? 'pill-unpaid' : 'pill-other'}`} style={{ fontSize: 10 }}>{s.status}</span></td>
                              <td>{s.count}</td>
                              <td>₹{fmt(s.pos)}</td>
                              <td>{s.percentage}%</td>
                            </tr>
                          ))}
                          <tr className="ac-stats-total-row">
                            <td>TOTAL</td>
                            <td>{activeStats.totalCount}</td>
                            <td>₹{fmt(activeStats.totalPos)}</td>
                            <td>100%</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* FOS Breakdown Accordion */}
              {stats.fosStats?.length > 0 && (
                <div className="ac-stats-accordion" style={{ marginTop: 24 }}>
                  <button className={`ac-stats-expand-btn ${fosOpen ? 'open' : ''}`} style={{ width: '100%', margin: 0, justifyContent: 'space-between', padding: '10px 14px' }} onClick={handleToggleFos}>
                    <span style={{ fontWeight: 600 }}>FOS Breakdown</span>
                    <Icon name={fosOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                  </button>
                  {fosOpen && (
                    <div className="ac-stats-accordion-body" style={{ marginTop: 12 }}>
                      <StatsBreakdown stats={stats} hiddenFos={hiddenFos} toggleFos={toggleFos} />
                    </div>
                  )}
                </div>
              )}

              {/* DRR Accordion */}
              <div className="ac-stats-accordion" style={{ marginTop: 24 }}>
                <button className={`ac-stats-expand-btn ${drrOpen ? 'open' : ''}`} style={{ width: '100%', margin: 0, justifyContent: 'space-between', padding: '10px 14px' }} onClick={handleToggleDrr}>
                  <span style={{ fontWeight: 600 }}>DRR</span>
                  <Icon name={drrOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                </button>
                {drrOpen && (
                  <div className="ac-stats-accordion-body" style={{ marginTop: 12 }}>
                    <div style={{ margin: 0, padding: '20px 18px', background: '#111111', borderRadius: 8 }}>

                      {/* Redesigned DRR */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <span style={{ color: '#777777', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                              Target POS
                              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(10, 21, 32, 0.5)', border: '1px solid #252525', borderRadius: 4, padding: '0 4px', height: 20 }}>
                                <input
                                  type="number"
                                  defaultValue={drrPercentage}
                                  onBlur={handleDrrPercentageBlur}
                                  style={{
                                    width: 28, height: '100%', background: 'transparent', border: 'none', color: '#6be2c7',
                                    textAlign: 'center', fontSize: 12, padding: 0, margin: 0, outline: 'none', boxShadow: 'none', minHeight: 0,
                                    MozAppearance: 'textfield'
                                  }}
                                />
                                <span style={{ color: '#6be2c7', fontSize: 12, marginRight: 2 }}>%</span>
                              </div>
                            </span>
                            <span style={{ fontWeight: 700, color: '#eeeeee', fontSize: 16 }}>₹{fmt(drrInfo.targetPos)}</span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                            <span style={{ color: '#777777', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                              Days Left
                              <input
                                type="number"
                                defaultValue={drrInfo.finalDays}
                                onBlur={handleDrrDaysBlur}
                                placeholder={String(drrInfo.calcDays)}
                                title={`Calculated automatically as ${drrInfo.calcDays} days. Enter a number to override.`}
                                style={{
                                  width: 32, height: 20, background: 'rgba(10, 21, 32, 0.5)', border: '1px solid #252525',
                                  color: '#eeeeee', padding: 0, margin: 0, borderRadius: 4, outline: 'none', boxShadow: 'none', minHeight: 0, fontSize: 12,
                                  textAlign: 'center', MozAppearance: 'textfield'
                                }}
                              />
                            </span>
                            <span style={{ fontWeight: 600, color: '#f36e6e', fontSize: 14 }}>Diff: ₹{fmt(drrInfo.diff)}</span>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div style={{ width: '100%', height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden', marginTop: -6 }}>
                          <div style={{
                            width: `${Math.min(100, (drrInfo.currentPaidPos / drrInfo.targetPos) * 100 || 0)}%`,
                            height: '100%',
                            background: '#6be2c7',
                            transition: 'width 0.3s ease'
                          }} />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: -6 }}>
                          <span style={{ color: '#eeeeee', fontSize: 12 }}>Paid: ₹{fmt(drrInfo.currentPaidPos)}</span>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                            <span style={{ color: '#777777', fontSize: 12 }}>Require:</span>
                            <span style={{ fontSize: 16, fontWeight: 700, color: '#6be2c7' }}>₹{fmt(drrInfo.drrValue)}</span>
                            <span style={{ fontSize: 10, color: '#777777' }}>/day</span>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      </aside>

    </div>
  )
}
