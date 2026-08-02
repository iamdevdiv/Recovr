import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Icon } from './Shared.jsx'
import { useOnlineStatus } from '../hooks/useOnlineStatus.js'
import { useOfflineSync } from '../hooks/useOfflineSync.js'
import * as offlineQueue from '../utils/offlineQueue.js'

// Tags that are always shown in the "go-to" summary (if present and not None)
// Adjusted since Address, Pin Code, and Father Name are now explicitly placed in UI
const GOTO_TAGS = [
  'Loan No', 'Customer Name', 'EMI Amount', 'Mobile number',
  'Reference name', 'Reference mobile', 'Status', 'PTP',
  'Address', 'Father Name', 'Pin Code', 'Previous Paid Date',
  'EMI Start Date', 'EMI End Date', 'Vehicle'
]

function getToken() {
  return localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
}

function authHeaders() {
  return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
}

function formatDate(dateStr) {
  if (!dateStr || String(dateStr).trim() === 'None') return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return String(dateStr)
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
}

function parseReferences(refNameRaw, refMobRaw) {
  let combined = ''
  if (refNameRaw === refMobRaw) {
    combined = String(refNameRaw || '')
  } else {
    combined = [String(refNameRaw || ''), String(refMobRaw || '')].join(' , ')
  }

  const phoneRegex = /\d{10,}/g
  const phones = combined.match(phoneRegex) || []

  let namesStr = combined.replace(phoneRegex, '|')
  let rawNames = namesStr.split(/[|,]/)
  let names = rawNames.map(n => n.trim()).filter(n => n.length > 1)

  names = names.map(n => {
    return n.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  })

  const refs = []
  const max = Math.max(phones.length, names.length)
  for (let i = 0; i < max; i++) {
    const p = phones[i] || null
    const n = names[i] || `Reference ${i + 1}`
    if (p || names[i]) {
      refs.push({ name: n, phone: p })
    }
  }
  return refs
}

// ── Sheet Stats Bar ────────────────────────────────────────────────────────────
function SheetStats({ stats, loading, compact = false }) {
  if (loading) return (
    <div className={`fos-stats-bar ${compact ? 'compact' : ''}`}>
      {[1, 2, 3, 4].map(i => <div key={i} className="fos-stat-card fos-stat-skeleton" />)}
    </div>
  )
  if (!stats) return null

  const { statusCounts = {}, todayPtpCount = 0, total = 0 } = stats
  const paid = statusCounts['PAID'] || 0
  const unpaid = statusCounts['UNPAID'] || 0
  const other = total - paid - unpaid

  return (
    <div className={`fos-stats-bar ${compact ? 'compact' : ''}`}>
      <div className="fos-stat-card fos-stat-total">
        <strong>{total}</strong>
        <span>Total</span>
      </div>
      <div className="fos-stat-card fos-stat-paid">
        <strong>{paid}</strong>
        <span>Paid</span>
      </div>
      <div className="fos-stat-card fos-stat-unpaid">
        <strong>{unpaid}</strong>
        <span>Unpaid</span>
      </div>
      {other > 0 && (
        <div className="fos-stat-card fos-stat-other">
          <strong>{other}</strong>
          <span>Other</span>
        </div>
      )}
      <div className="fos-stat-card fos-stat-ptp">
        <strong>{todayPtpCount}</strong>
        <span>Today's PTP</span>
      </div>
    </div>
  )
}

// ── PTP Editor ────────────────────────────────────────────────────────────────
function PtpEditor({ caseId, ptpDate, hasPtpTime, onUpdate, showDate, showTime }) {
  const [editing, setEditing] = useState(false)
  const [dateVal, setDateVal] = useState('')
  const [timeVal, setTimeVal] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (ptpDate) {
      const d = new Date(ptpDate)
      setDateVal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d)) // local YYYY-MM-DD
      setTimeVal(hasPtpTime ? d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '')
    } else {
      setDateVal('')
      setTimeVal('')
    }
  }, [ptpDate, hasPtpTime])

  async function savePtp() {
    const queuedAt = Date.now()

    if (!dateVal && !timeVal) {
      setSaving(true)
      try {
        const body = JSON.stringify({ ptpDate: null, queuedAt })
        const res = await fetch(`/api/fos/cases/${caseId}/ptp`, {
          method: 'PUT', headers: authHeaders(), body
        })
        if (res.ok) {
          onUpdate(null, false, false)
        } else if (res.status === 202) {
          // Queued offline — optimistic update already applied via onUpdate below
          onUpdate(null, false, true)
        }
      } catch {
        // Network error — queue it
        await offlineQueue.enqueue({
          url: `${window.location.origin}/api/fos/cases/${caseId}/ptp`,
          method: 'PUT', headers: authHeaders(),
          body: JSON.stringify({ ptpDate: null, queuedAt }),
          queuedAt
        })
        onUpdate(null, false, true)
      }
      setSaving(false)
      setEditing(false)
      return
    }

    const hasTime = !!timeVal
    const resolvedDate = dateVal || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
    const resolvedTime = timeVal || '00:00'
    const combined = `${resolvedDate}T${resolvedTime}:00`

    setSaving(true)
    try {
      const body = JSON.stringify({ ptpDate: combined, hasTime, queuedAt })
      const res = await fetch(`/api/fos/cases/${caseId}/ptp`, {
        method: 'PUT', headers: authHeaders(), body
      })
      if (res.ok) {
        const data = await res.json()
        onUpdate(data.case.ptpDate, data.case.hasPtpTime, false)
      } else if (res.status === 202) {
        // SW intercepted and queued — optimistic update
        onUpdate(combined, hasTime, true)
      }
    } catch {
      // Network error — queue manually and apply optimistic update
      await offlineQueue.enqueue({
        url: `${window.location.origin}/api/fos/cases/${caseId}/ptp`,
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ ptpDate: combined, hasTime, queuedAt }),
        queuedAt
      })
      onUpdate(combined, hasTime, true)
    }
    setSaving(false)
    setEditing(false)
  }

  async function clearPtp() {
    const queuedAt = Date.now()
    setSaving(true)
    try {
      const body = JSON.stringify({ ptpDate: null, queuedAt })
      const res = await fetch(`/api/fos/cases/${caseId}/ptp`, {
        method: 'PUT', headers: authHeaders(), body
      })
      if (res.ok) {
        onUpdate(null, false, false)
      } else if (res.status === 202) {
        onUpdate(null, false, true)
      }
    } catch {
      await offlineQueue.enqueue({
        url: `${window.location.origin}/api/fos/cases/${caseId}/ptp`,
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ ptpDate: null, queuedAt }),
        queuedAt
      })
      onUpdate(null, false, true)
    }
    setSaving(false)
    setEditing(false)
  }

  if (!editing) {
    let display = null
    if (ptpDate) {
      const d = new Date(ptpDate)
      display = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
      if (hasPtpTime) display += ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    }
    return (
      <button
        className="fos-ptp-display"
        onClick={e => { e.stopPropagation(); setEditing(true) }}
        title="Set PTP date & time"
      >
        <Icon name="clock" size={12} />
        {display ? <span className="fos-ptp-value">{display}</span> : <span className="fos-ptp-empty">Set PTP</span>}
        <Icon name="pencil" size={10} />
      </button>
    )
  }

  return (
    <div className="fos-ptp-editor" onClick={e => e.stopPropagation()}>
      {showDate && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: '9px', fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.5px', marginLeft: 2 }}>Date</span>
          <input type="date" value={dateVal} onChange={e => setDateVal(e.target.value)} className="fos-ptp-input" style={{ width: '110px' }} />
        </label>
      )}
      {showTime && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: '9px', fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.5px', marginLeft: 2 }}>Time</span>
          <input type="time" value={timeVal} onChange={e => {
            setTimeVal(e.target.value)
            if (!dateVal && showDate) setDateVal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()))
          }} className="fos-ptp-input" style={{ width: '90px' }} />
        </label>
      )}
      <div style={{ display: 'flex', gap: '4px', alignSelf: 'flex-end', paddingBottom: '1px' }}>
        <button className="fos-ptp-save" onClick={savePtp} disabled={saving} title="Save">
          {saving ? <Icon name="spinner" size={12} className="spin-icon" /> : <Icon name="check" size={12} />}
        </button>
        {ptpDate && (
          <button className="fos-ptp-cancel" onClick={clearPtp} disabled={saving} title="Delete PTP" style={{ background: '#2a1515', color: '#e88080' }}>
            <Icon name="trash" size={12} />
          </button>
        )}
        <button className="fos-ptp-cancel" onClick={() => setEditing(false)} disabled={saving} title="Cancel">
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  )
}

function NotesEditor({ caseId, initialNotes, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(initialNotes || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setNotes(initialNotes || '')
  }, [initialNotes])

  async function saveNotes() {
    const queuedAt = Date.now()
    setSaving(true)
    try {
      const body = JSON.stringify({ fosNotes: notes, queuedAt })
      const res = await fetch(`/api/fos/cases/${caseId}/notes`, {
        method: 'PUT', headers: authHeaders(), body
      })
      if (res.ok) {
        const data = await res.json()
        onUpdate(data.case.fosNotes, false)
      } else if (res.status === 202) {
        // Queued by SW
        onUpdate(notes, true)
      }
    } catch {
      await offlineQueue.enqueue({
        url: `${window.location.origin}/api/fos/cases/${caseId}/notes`,
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ fosNotes: notes, queuedAt }),
        queuedAt
      })
      onUpdate(notes, true)
    }
    setSaving(false)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className="fos-notes-display" onClick={e => { e.stopPropagation(); setEditing(true) }}>
        <Icon name="pencil" size={12} />
        {initialNotes ? <span className="fos-notes-text">{initialNotes}</span> : <span className="fos-notes-empty">Click to add notes...</span>}
      </div>
    )
  }

  return (
    <div className="fos-notes-editor" onClick={e => e.stopPropagation()}>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        className="fos-notes-input"
        placeholder="Enter case notes..."
        rows={3}
      />
      <div className="fos-notes-actions">
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

// ── Case Card ─────────────────────────────────────────────────────────────────
function CaseCard({ caseData, index, expandTags, onPtpUpdate, onNotesUpdate, whatsappTemplate, isQueued }) {
  const [expanded, setExpanded] = useState(false)
  const [copiedLoan, setCopiedLoan] = useState(false)
  const [copiedName, setCopiedName] = useState(false)
  const [showNumbers, setShowNumbers] = useState(false)

  const toTitleCase = (str) => {
    if (!str) return ''
    return String(str).trim().replace(/\s+/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  }

  const td = caseData.tagData || {}
  const statusRaw = expandTags.includes('Status') ? String(td['Status'] || '').trim().toUpperCase() : ''
  const status = statusRaw || '—'
  const newCaseVal = expandTags.includes('New Case') ? String(caseData.newCase || td['New Case'] || '').trim() : ''
  const isNew = newCaseVal.length > 0
  const isPaid = status === 'PAID'
  const isUnpaid = status === 'UNPAID'

  const custName = expandTags.includes('Customer Name') ? String(td['Customer Name'] || '—') : '—'
  const fatherName = expandTags.includes('Father Name') ? String(td['Father Name'] || '').trim() : ''
  const custMobile = expandTags.includes('Mobile number') ? td['Mobile number'] : null

  const refs = useMemo(() => {
    const rName = expandTags.includes('Reference name') ? td['Reference name'] : null;
    const rMob = expandTags.includes('Reference mobile') ? td['Reference mobile'] : null;
    return parseReferences(rName, rMob);
  }, [td['Reference name'], td['Reference mobile'], expandTags])

  function copyText(text, type) {
    navigator.clipboard.writeText(text || '')
    if (type === 'loan') {
      setCopiedLoan(true)
      setTimeout(() => setCopiedLoan(false), 1500)
    } else {
      setCopiedName(true)
      setTimeout(() => setCopiedName(false), 1500)
    }
  }

  const cardClass = `fos-case-card ${isPaid ? 'fos-case-paid' : isUnpaid ? 'fos-case-unpaid' : 'fos-case-other'} ${isNew ? 'fos-case-new' : ''} ${expanded ? 'fos-case-open' : ''} ${isQueued ? 'fos-case-queued' : ''}`

  return (
    <div className={cardClass}>
      <div className={`fos-status-stripe ${isPaid ? 'stripe-paid' : isUnpaid ? 'stripe-unpaid' : 'stripe-other'}`} />

      {/* Card Header — always visible */}
      <div className="fos-card-header" role="button" tabIndex={0} onClick={() => setExpanded(!expanded)} onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}>
        <div className="fos-card-top">

          <div className="fos-card-row-between">
            {/* Customer Name & Copy */}
            <div className="fos-card-name-group">
              <span className="fos-serial-no">#{index + 1}</span>
              <span className="fos-card-name">{custName}</span>
              {isNew && <div className="fos-new-badge" title={newCaseVal.toUpperCase()}>{newCaseVal.toUpperCase()}</div>}
              {isQueued && (
                <div className="fos-queued-badge" title="Pending sync — will update when online">
                  <Icon name="clock" size={9} /> Queued
                </div>
              )}
              <button className="fos-copy-btn-small" onClick={e => { e.stopPropagation(); copyText(custName, 'name') }} title="Copy Name">
                <Icon name={copiedName ? 'check' : 'copy'} size={11} />
              </button>
            </div>

            <span className={`fos-status-pill ${isPaid ? 'pill-paid' : isUnpaid ? 'pill-unpaid' : 'pill-other'}`}>
              {status || 'N/A'}
            </span>
          </div>

          {/* Father Name (inline below customer name) */}
          {fatherName && fatherName !== 'None' && (
            <div className="fos-card-subname">Father name: {fatherName}</div>
          )}

          <div className="fos-card-row-between" style={{ marginTop: '4px' }}>
            {/* Loan Number */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="fos-loan-no">{expandTags.includes('Loan No') ? (caseData.loanNumber || '—') : '—'}</span>
              <button className="fos-copy-btn-small" onClick={e => { e.stopPropagation(); copyText(caseData.loanNumber, 'loan') }} title="Copy loan number">
                <Icon name={copiedLoan ? 'check' : 'copy'} size={11} />
              </button>
            </div>

            {expandTags.includes('EMI Amount') && td['EMI Amount'] && (
              <span className="fos-emi-chip">₹{td['EMI Amount']}</span>
            )}
          </div>

          {/* Always Visible: Address & Pin Code */}
          {((expandTags.includes('Address') && td['Address']) || (expandTags.includes('Pin Code') && td['Pin Code'])) && (
            <div className="fos-card-address-block">
              {expandTags.includes('Address') && td['Address'] && td['Address'] !== 'None' ? td['Address'] : ''}
              {expandTags.includes('Pin Code') && td['Pin Code'] && td['Pin Code'] !== 'None' ? ` - ${td['Pin Code']}` : ''}
            </div>
          )}

          {/* Always Visible: Vehicle (if enabled) */}
          {expandTags.includes('Vehicle') && td['Vehicle'] && td['Vehicle'] !== 'None' && (
            <div className="fos-card-address-block" style={{ marginTop: '2px' }}>
              <strong style={{ opacity: 0.7, marginRight: '4px' }}>Vehicle:</strong>
              {td['Vehicle']}
            </div>
          )}

          {/* Always Visible: Notes Preview */}
          {caseData.fosNotes && (
            <div className="fos-card-notes-preview">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: 0.7, marginRight: '4px' }}>
                <Icon name="pencil" size={11} /> <strong>Note:</strong>
              </span>
              {caseData.fosNotes}
            </div>
          )}

          {/* PTP Editor is now right-aligned */}
          <div className="fos-card-row-right">
            {(expandTags.includes('PTP') || expandTags.includes('Time')) && (
              <PtpEditor
                caseId={caseData._id}
                ptpDate={caseData.ptpDate}
                hasPtpTime={caseData.hasPtpTime}
                onUpdate={(newDate, hasTime, queued) => onPtpUpdate(caseData._id, newDate, hasTime, queued)}
                showDate={expandTags.includes('PTP')}
                showTime={expandTags.includes('Time')}
              />
            )}
          </div>
        </div>

        {/* Quick actions row */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: '8px', borderTop: '1px solid rgba(255, 255, 255, .04)' }}>
          {/* Top row: Call buttons (scrollable) + Eye (fixed) */}
          <div className="fos-card-actions" style={{ borderTop: 'none', paddingBottom: '4px' }}>
            <div className="fos-call-group hide-scrollbar" style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: '8px', flex: 1, paddingRight: '8px' }}>
              {custMobile && (
                <a href={`tel:${custMobile}`} className="fos-call-btn" onClick={e => e.stopPropagation()} title="Call customer" style={{ flexShrink: 0 }}>
                  <Icon name="phone" size={14} />
                  <span>Call {showNumbers ? custMobile : toTitleCase(custName)}</span>
                </a>
              )}

              {refs.map((ref, idx) => ref.phone ? (
                <a key={idx} href={`tel:${ref.phone}`} className="fos-call-btn fos-call-ref" onClick={e => e.stopPropagation()} title={`Call ${ref.name}`} style={{ flexShrink: 0 }}>
                  <Icon name="phone" size={14} />
                  <span>Call {showNumbers ? ref.phone : toTitleCase(ref.name)}</span>
                </a>
              ) : null)}
            </div>

            <div
              role="button"
              onClick={e => { e.preventDefault(); e.stopPropagation(); setShowNumbers(!showNumbers) }}
              title="Toggle numbers"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'transparent', border: '1px solid #2e2e2e', borderRadius: 6, cursor: 'pointer', flexShrink: 0, color: '#aaa' }}
            >
              <Icon name={showNumbers ? 'eye-off' : 'eye'} size={14} />
            </div>
          </div>

          {/* Bottom row: Request receipt (left) + Chevron (right) with card background */}
          <div className="fos-card-actions" style={{ borderTop: 'none', paddingTop: '4px' }}>
            <div>
              {custMobile && (
                <a
                  href={`whatsapp://send?text=${encodeURIComponent(
                    (whatsappTemplate || '').replace(/\{\{(.*?)\}\}/g, (_, tag) => {
                      const val = String(caseData.tagData?.[tag] || '');
                      if (tag.toLowerCase().includes('name')) {
                        return toTitleCase(val);
                      }
                      return val;
                    })
                  )}`}
                  className="fos-call-btn"
                  style={{ background: '#1c3629', color: '#88e0b6', borderColor: '#234a36' }}
                  onClick={e => e.stopPropagation()}
                  title="Request receipt via WhatsApp"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.01 2.002c-5.522 0-9.998 4.477-9.998 10.002 0 1.954.559 3.784 1.523 5.342L2.01 22.002l4.805-1.503c1.517.881 3.266 1.378 5.148 1.378 5.522 0 10.002-4.477 10.002-10.002 0-5.525-4.48-10.002-10.002-10.002h-.01zM11.996 20.218c-1.597 0-3.1-.418-4.436-1.168l-.317-.184-3.111.977.994-3.078-.204-.326a8.337 8.337 0 0 1-1.272-4.431c0-4.62 3.759-8.381 8.381-8.381s8.383 3.761 8.383 8.381-3.761 8.38-8.383 8.38z" /><path d="M17.135 14.34c-.282-.141-1.666-.822-1.924-.916-.258-.094-.447-.141-.634.141-.188.282-.728.916-.893 1.104-.164.188-.328.212-.61.071-.282-.141-1.189-.438-2.264-1.396-.837-.745-1.402-1.666-1.566-1.948-.164-.282-.018-.435.123-.576.126-.126.282-.329.423-.493.141-.164.188-.282.282-.47.094-.188.047-.353-.024-.494-.071-.141-.634-1.53-.87-2.095-.229-.553-.464-.477-.634-.486-.164-.009-.353-.009-.54-.009-.188 0-.493.071-.752.353-.258.282-.986.963-.986 2.348 0 1.386 1.01 2.724 1.151 2.912.141.188 1.986 3.031 4.814 4.25 2.158.93 2.822.846 3.339.752.795-.144 1.666-.681 1.901-1.339.235-.658.235-1.222.164-1.339-.07-.118-.258-.188-.54-.329z" /></svg>
                  <span>Request receipt</span>
                </a>
              )}
            </div>

            <div className="fos-expand-hint" style={{ flexShrink: 0, marginLeft: 'auto' }}>
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
            </div>
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="fos-card-details">
          <div className="fos-details-grid">

            {/* Formatted Dates */}
            {expandTags.includes('Previous Paid Date') && td['Previous Paid Date'] && (
              <div className="fos-detail-item">
                <span className="fos-detail-label">Previous Paid Date</span>
                <strong className="fos-detail-val">{formatDate(td['Previous Paid Date'])}</strong>
              </div>
            )}
            {expandTags.includes('EMI Start Date') && td['EMI Start Date'] && (
              <div className="fos-detail-item">
                <span className="fos-detail-label">EMI Start Date</span>
                <strong className="fos-detail-val">{formatDate(td['EMI Start Date'])}</strong>
              </div>
            )}
            {expandTags.includes('EMI End Date') && td['EMI End Date'] && (
              <div className="fos-detail-item">
                <span className="fos-detail-label">EMI End Date</span>
                <strong className="fos-detail-val">{formatDate(td['EMI End Date'])}</strong>
              </div>
            )}

            {/* Other expand tags */}
            {expandTags.map((tag, idx) => {
              const val = td[tag]
              if (!val || String(val).trim() === '' || String(val).trim() === 'None') return null
              // Skip already shown tags
              if (GOTO_TAGS.includes(tag)) return null
              return (
                <div key={tag} className="fos-detail-item">
                  <span className="fos-detail-label">{tag}</span>
                  <strong className="fos-detail-val">{String(val)}</strong>
                </div>
              )
            })}
          </div>
          <div className="fos-notes-section">
            <NotesEditor
              caseId={caseData._id}
              initialNotes={caseData.fosNotes}
              onUpdate={(newNotes, queued) => onNotesUpdate(caseData._id, newNotes, queued)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

const FOS_GROUPABLE_TAGS = ['Status', 'New Case', 'Lot', 'Bucket']

function GroupNode({ node, depth, expandTags, onPtpUpdate, onNotesUpdate, whatsappTemplate }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!node.isGroup) {
    return (
      <CaseCard
        caseData={node}
        index={node.originalIndex ?? 0}
        expandTags={expandTags}
        onPtpUpdate={onPtpUpdate}
        onNotesUpdate={onNotesUpdate}
        whatsappTemplate={whatsappTemplate}
        isQueued={node._queued || false}
      />
    )
  }

  const lbl = String(node.label)
  const lblUpper = lbl.toUpperCase()
  const pillClass = lblUpper === 'PAID' ? 'pill-paid' : lblUpper === 'UNPAID' ? 'pill-unpaid' : ''

  return (
    <div className={`fos-group-node fos-group-depth-${Math.min(depth, 3)}`}>
      <button className="fos-group-hdr" onClick={() => setCollapsed(c => !c)}>
        <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={13} />
        {pillClass
          ? <span className={`fos-status-pill ${pillClass}`} style={{ fontSize: 10 }}>{lbl}</span>
          : <span className="fos-group-lbl">{lbl}</span>}
        <span className="fos-group-cnt">{node.count} {node.count === 1 ? 'case' : 'cases'}</span>
      </button>
      {!collapsed && (
        <div className="fos-group-body">
          {node.children.map((child, i) => (
            <GroupNode
              key={child.isGroup ? `${child.label}__${depth}__${i}` : String(child._id)}
              node={child}
              depth={depth + 1}
              expandTags={expandTags}
              onPtpUpdate={onPtpUpdate}
              onNotesUpdate={onNotesUpdate}
              whatsappTemplate={whatsappTemplate}
            />
          ))}
        </div>
      )}
    </div>
  )
}


// ── Sheet View ─────────────────────────────────────────────────────────────────
function SheetView({ workbook, sheet }) {
  const [cases, setCases] = useState([])
  const [stats, setStats] = useState(null)
  const [loadingCases, setLoadingCases] = useState(true)
  const [loadingStats, setLoadingStats] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [fromCache, setFromCache] = useState(false)

  const cacheKey = `fos-cache-cases-${workbook._id}-${sheet.name}`
  const statsCacheKey = `fos-cache-stats-${workbook._id}-${sheet.name}`
  const prefsKey = `fosPrefs_${workbook._id}_${sheet.name}`
  const initialPrefs = JSON.parse(localStorage.getItem(prefsKey) || '{"groupKeys":["Status"],"sortKeys":["alpha","ptp"]}')

  const [groupKeys, setGroupKeys] = useState(initialPrefs.groupKeys || [])
  const [sortKeys, setSortKeys] = useState(initialPrefs.sortKeys || [])
  const [whatsappTemplate, setWhatsappTemplate] = useState(`Loan Number: {{Loan No}}\nName: {{Customer Name}}\nAmount: {{EMI Amount}}\nSend receipt`)
  // Track which case IDs have pending offline writes
  const [queuedCaseIds, setQueuedCaseIds] = useState(new Set())
  const [otherSheetCounts, setOtherSheetCounts] = useState({})
  const navigate = useNavigate()

  useEffect(() => {
    localStorage.setItem(prefsKey, JSON.stringify({ groupKeys, sortKeys }))
  }, [groupKeys, sortKeys, prefsKey])

  const visibleTags = sheet.visibleTags || []

  useEffect(() => {
    fetchCases()
    fetchStats()
    fetch('/api/fos/settings', { headers: authHeaders() })
      .then(res => res.json())
      .then(data => {
        const userTmpl = data.whatsappTemplates?.[workbook._id]?.[sheet.name]
        if (userTmpl) setWhatsappTemplate(userTmpl)
      })
      .catch(() => { })
  }, [workbook._id, sheet.name])

  useEffect(() => {
    if (!search.trim()) {
      setOtherSheetCounts({})
      return
    }
    const q = search.toLowerCase()
    
    const timeoutId = setTimeout(() => {
      const counts = {}
      workbook.sheets.forEach(s => {
        if (s.name === sheet.name) return
        const cached = localStorage.getItem(`fos-cache-cases-${workbook._id}-${s.name}`)
        if (cached) {
          try {
            const sheetCases = JSON.parse(cached)
            const count = sheetCases.filter(c => 
              String(c.loanNumber || '').toLowerCase().includes(q) ||
              String(c.tagData?.['Customer Name'] || '').toLowerCase().includes(q)
            ).length
            if (count > 0) counts[s.name] = count
          } catch { }
        }
      })
      setOtherSheetCounts(counts)
    }, 300)
    
    return () => clearTimeout(timeoutId)
  }, [search, workbook, sheet])

  async function fetchCases() {
    setLoadingCases(true)
    setError('')
    try {
      const res = await fetch(
        `/api/fos/cases?collectionId=${workbook._id}&sheetName=${encodeURIComponent(sheet.name)}`,
        { headers: authHeaders() }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      const fresh = data.cases || []
      setCases(fresh)
      setFromCache(false)
      // Persist to localStorage cache
      try { localStorage.setItem(cacheKey, JSON.stringify(fresh)) } catch { }
    } catch (err) {
      // Try loading from cache
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        try {
          setCases(JSON.parse(cached))
          setFromCache(true)
          setError('')
        } catch {
          setError('Could not load cached data.')
        }
      } else {
        setError(err.message.includes('JSON') || err.message.includes('fetch')
          ? 'Server is unreachable and no cached data is available.'
          : err.message
        )
      }
    } finally {
      setLoadingCases(false)
    }
  }

  async function fetchStats() {
    setLoadingStats(true)
    try {
      const res = await fetch(
        `/api/fos/sheet-stats?collectionId=${workbook._id}&sheetName=${encodeURIComponent(sheet.name)}`,
        { headers: authHeaders() }
      )
      const data = await res.json()
      if (res.ok) {
        setStats(data)
        try { localStorage.setItem(statsCacheKey, JSON.stringify(data)) } catch { }
      }
    } catch {
      const cached = localStorage.getItem(statsCacheKey)
      if (cached) try { setStats(JSON.parse(cached)) } catch { }
    }
    setLoadingStats(false)
  }

  function handlePtpUpdate(caseId, newDate, hasTime, queued) {
    setCases(prev => prev.map(c => c._id === caseId ? { ...c, ptpDate: newDate, hasPtpTime: hasTime } : c))
    if (queued) {
      setQueuedCaseIds(prev => new Set([...prev, caseId]))
    } else {
      setQueuedCaseIds(prev => { const n = new Set(prev); n.delete(caseId); return n })
      fetchStats()
    }
  }

  function handleNotesUpdate(caseId, newNotes, queued) {
    setCases(prev => prev.map(c => c._id === caseId ? { ...c, fosNotes: newNotes } : c))
    if (queued) {
      setQueuedCaseIds(prev => new Set([...prev, caseId]))
    } else {
      setQueuedCaseIds(prev => { const n = new Set(prev); n.delete(caseId); return n })
    }
  }

  const availableGroupKeys = useMemo(() => {
    const found = new Set()
    cases.forEach(c => {
      FOS_GROUPABLE_TAGS.forEach(tag => {
        const val = tag === 'New Case' ? (c.newCase || c.tagData?.['New Case']) : c.tagData?.[tag]
        if (val && String(val).trim() !== '' && String(val).trim().toLowerCase() !== 'none') {
          found.add(tag)
        }
      })
    })
    return Array.from(found)
  }, [cases])

  function toggleGroupKey(key) {
    setGroupKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  function toggleSortKey(key) {
    if (key === 'default') {
      setSortKeys([])
      return
    }
    setSortKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  const processedCases = useMemo(() => {
    let result = cases.map((c, i) => ({ ...c, originalIndex: i, _queued: queuedCaseIds.has(c._id) }))
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(c =>
        String(c.loanNumber || '').toLowerCase().includes(q) ||
        String(c.tagData?.['Customer Name'] || '').toLowerCase().includes(q)
      )
    }

    if (sortKeys.length > 0) {
      result.sort((a, b) => {
        const hasPtp = sortKeys.includes('ptp')
        const hasAlpha = sortKeys.includes('alpha')

        if (hasPtp) {
          if (a.ptpDate && b.ptpDate) {
            const diff = new Date(a.ptpDate) - new Date(b.ptpDate)
            if (diff !== 0) return diff
          } else if (a.ptpDate) {
            return -1
          } else if (b.ptpDate) {
            return 1
          }
        }

        if (hasAlpha) {
          const nameA = String(a.tagData?.['Customer Name'] || '')
          const nameB = String(b.tagData?.['Customer Name'] || '')
          const cmp = nameA.localeCompare(nameB)
          if (cmp !== 0) return cmp
        }

        return 0
      })
    }

    function buildGroups(caseList, keys, idx) {
      if (idx >= keys.length) return caseList
      const key = keys[idx]
      const groupMap = new Map()

      caseList.forEach(c => {
        let rawVal = key === 'New Case' ? (c.newCase || c.tagData?.['New Case']) : c.tagData?.[key]
        let groupVal = (!rawVal || String(rawVal).trim() === '' || String(rawVal).trim().toLowerCase() === 'none')
          ? 'Unassigned'
          : String(rawVal).trim()

        if (key === 'New Case' && groupVal === 'Unassigned') groupVal = 'Old'

        if (!groupMap.has(groupVal)) groupMap.set(groupVal, [])
        groupMap.get(groupVal).push(c)
      })

      let entries = [...groupMap.entries()]
      if (key === 'Status') {
        entries.sort((a, b) => {
          const aU = a[0].toUpperCase() === 'UNPAID' ? 0 : (a[0].toUpperCase() === 'PAID' ? 1 : 2)
          const bU = b[0].toUpperCase() === 'UNPAID' ? 0 : (b[0].toUpperCase() === 'PAID' ? 1 : 2)
          if (aU !== bU) return aU - bU
          return a[0].localeCompare(b[0])
        })
      } else {
        entries.sort((a, b) => a[0].localeCompare(b[0]))
      }

      return entries.map(([label, groupCases]) => ({
        isGroup: true, label, count: groupCases.length,
        children: buildGroups(groupCases, keys, idx + 1)
      }))
    }

    if (groupKeys.length === 0) return result
    return buildGroups(result, groupKeys, 0)
  }, [cases, search, sortKeys, groupKeys, queuedCaseIds])

  return (
    <div className="fos-sheet-view">
      <SheetStats stats={stats} loading={loadingStats} />



      {/* Sheets & Search Sticky Wrapper */}
      <div style={{ position: 'sticky', top: '59px', zIndex: 10, background: '#0e0e0e', padding: '16px 0 12px' }}>
        <div className="fos-sorting-grouping-toolbar" style={{ margin: 0, gap: '12px', padding: '12px' }}>
          
          {/* Sheet Tabs */}
          <div className="fos-sheet-tabs hide-scrollbar" style={{ display: 'flex', gap: 12, overflowX: 'auto', alignItems: 'center' }}>
            <span style={{ color: '#777777', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>Sheets:</span>
            {workbook.sheets.map(s => {
              const isActive = s.name === sheet.name
              const count = otherSheetCounts[s.name]
              return (
                <button
                  key={s.name}
                  onClick={() => { if (!isActive) navigate(`/dashboard/${workbook._id}/${encodeURIComponent(s.name)}`) }}
                  style={{
                    background: isActive ? '#1e1e1e' : 'transparent',
                    color: isActive ? '#8be8d8' : '#777777',
                    border: `1px solid ${isActive ? '#2e2e2e' : '#222222'}`,
                    padding: '6px 14px',
                    borderRadius: 16,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  {s.name}
                  {!isActive && count > 0 && (
                    <span style={{ background: '#6be2c7', color: '#111111', padding: '0 6px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Search */}
          <div className="fos-search" style={{ margin: 0 }}>
            <Icon name="search" size={15} />
            <input
              type="text"
              placeholder="Search loan no or name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

        </div>
      </div>
      <div className="fos-sorting-grouping-toolbar">
        <div className="fos-sort-row">
          <span className="fos-toolbar-label">Sort by:</span>
          <button className={`fos-chip ${sortKeys.includes('alpha') ? 'active' : ''}`} onClick={() => toggleSortKey('alpha')}>
            {sortKeys.includes('alpha') && <span className="fos-chip-order">{sortKeys.indexOf('alpha') + 1}</span>}
            A-Z
          </button>
          <button className={`fos-chip ${sortKeys.includes('ptp') ? 'active' : ''}`} onClick={() => toggleSortKey('ptp')}>
            {sortKeys.includes('ptp') && <span className="fos-chip-order">{sortKeys.indexOf('ptp') + 1}</span>}
            Earliest PTP
          </button>
          {sortKeys.length > 0 && (
            <button className="fos-chip clear" onClick={() => toggleSortKey('default')}><Icon name="close" size={11} /> Clear</button>
          )}
        </div>
        {availableGroupKeys.length > 0 && (
          <div className="fos-group-row">
            <span className="fos-toolbar-label">Group by:</span>
            {availableGroupKeys.map(key => {
              const isActive = groupKeys.includes(key)
              return (
                <button key={key} className={`fos-chip ${isActive ? 'active' : ''}`} onClick={() => toggleGroupKey(key)}>
                  {isActive && <span className="fos-chip-order">{groupKeys.indexOf(key) + 1}</span>}
                  {key}
                </button>
              )
            })}
            {groupKeys.length > 0 && (
              <button className="fos-chip clear" onClick={() => setGroupKeys([])}><Icon name="close" size={11} /> Clear</button>
            )}
          </div>
        )}
      </div>

      {error && <div className="fos-error">{error}</div>}

      {loadingCases ? (
        <div className="fos-loading">
          <Icon name="spinner" size={24} className="spin-icon" />
          <span>Loading your cases...</span>
        </div>
      ) : processedCases.length === 0 ? (
        <div className="fos-empty">
          <Icon name="cases" size={32} />
          <p>{cases.length === 0 ? 'No cases assigned to you yet.' : 'No cases match your search.'}</p>
          <small>{cases.length === 0 ? 'The admin will assign cases after allocation.' : 'Try a different search term.'}</small>
        </div>
      ) : (
        <div className="fos-case-list">
          {processedCases.map((node, index) => (
            <GroupNode
              key={node.isGroup ? `root-${node.label}-${index}` : String(node._id)}
              node={node}
              depth={0}
              expandTags={visibleTags}
              onPtpUpdate={handlePtpUpdate}
              onNotesUpdate={handleNotesUpdate}
              whatsappTemplate={whatsappTemplate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sheet Tile (with stats) ────────────────────────────────────────────────────
function SheetTile({ workbookId, sheetName }) {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    const statsCacheKey = `fos-cache-stats-${workbookId}-${sheetName}`
    fetch(`/api/fos/sheet-stats?collectionId=${workbookId}&sheetName=${encodeURIComponent(sheetName)}`, { headers: authHeaders() })
      .then(res => {
        if (!res.ok) throw new Error('Bad response')
        return res.json()
      })
      .then(data => {
        setStats(data)
        try { localStorage.setItem(statsCacheKey, JSON.stringify(data)) } catch { }
      })
      .catch(() => {
        const cached = localStorage.getItem(statsCacheKey)
        if (cached) try { setStats(JSON.parse(cached)) } catch { }
      })
  }, [workbookId, sheetName])

  return (
    <div className="fos-sheet-tile-wrapper" style={{ position: 'relative' }}>
      <button
        style={{ all: 'unset', display: 'block', width: '100%', cursor: 'pointer', textAlign: 'left' }}
        onClick={() => navigate(`/dashboard/${workbookId}/${encodeURIComponent(sheetName)}`)}
      >
        <div className="fos-sheet-tile">
          <div className="fos-sheet-tile-header">
            <Icon name="file" size={20} />
            <span>{sheetName}</span>
            <Icon name="arrow" size={14} style={{ marginLeft: 'auto', opacity: 0.5 }} />
          </div>
        </div>
        <div className="fos-sheet-tile-stats">
          <SheetStats stats={stats} loading={!stats} compact={true} />
        </div>
      </button>
      <button
        className="fos-icon-btn"
        onClick={(e) => { e.stopPropagation(); navigate(`/dashboard/settings/${workbookId}/${encodeURIComponent(sheetName)}`) }}
        style={{ position: 'absolute', top: 12, right: 36, padding: 6 }}
        title="Settings"
      >
        <Icon name="settings" size={14} />
      </button>
    </div>
  )
}

// ── Sheet Selector (list of all permitted sheets across all workbooks) ─────────
function SheetSelector({ workbooks }) {
  if (workbooks.length === 0) {
    return (
      <div className="fos-empty" style={{ marginTop: 60 }}>
        <Icon name="layers" size={36} />
        <p>No sheets assigned.</p>
        <small>Ask your admin to configure your permissions.</small>
      </div>
    )
  }

  return (
    <div className="fos-sheet-selector">
      <h2 className="fos-section-title">Your Assigned Cases</h2>
      {workbooks.map(wb => (
        <div key={wb._id} className="fos-wb-group">
          <div className="fos-wb-label">
            <Icon name="layers" size={13} />
            {wb.name}
          </div>
          <div className="fos-sheet-grid">
            {wb.sheets.map(sheet => (
              <SheetTile key={sheet.name} workbookId={wb._id} sheetName={sheet.name} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Sheet Route Wrapper ───────────────────────────────────────────────────────
function SheetRoute({ workbooks }) {
  const { workbookId, sheetName } = useParams()
  const navigate = useNavigate()
  const decodedSheet = decodeURIComponent(sheetName || '')
  const wb = workbooks.find(w => w._id === workbookId)
  const sheet = wb?.sheets.find(s => s.name === decodedSheet)

  if (!wb || !sheet) {
    return (
      <div className="fos-empty" style={{ marginTop: 60 }}>
        <Icon name="cases" size={36} />
        <p>Sheet not found or access denied.</p>
        <button className="fos-back-btn" onClick={() => navigate('/dashboard')}>← Back to cases</button>
      </div>
    )
  }

  return (
    <>
      <button className="fos-back-btn" onClick={() => navigate('/dashboard')}>
        <Icon name="arrow-left" size={14} /> All cases
      </button>
      <div className="fos-sheet-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="fos-sheet-wb-label">{wb.name}</div>
          <h1 className="fos-sheet-name">{sheet.name}</h1>
        </div>
        <button
          className="fos-icon-btn"
          onClick={() => navigate(`/dashboard/settings/${workbookId}/${encodeURIComponent(sheetName)}`)}
          style={{ padding: '8px 12px', gap: 6 }}
        >
          <Icon name="settings" size={14} /> <span style={{ fontSize: 12, fontWeight: 600 }}>Settings</span>
        </button>
      </div>
      <SheetView workbook={wb} sheet={sheet} />
    </>
  )
}

// ── Settings View ────────────────────────────────────────────────────────────
function FosSettings({ workbooks }) {
  const { workbookId, sheetName } = useParams()
  const navigate = useNavigate()
  const decodedSheet = decodeURIComponent(sheetName || '')
  const wb = workbooks.find(w => w._id === workbookId)
  const sheet = wb?.sheets.find(s => s.name === decodedSheet)

  const defaultTemplate = `Loan Number: {{Loan No}}\nName: {{Customer Name}}\nAmount: {{EMI Amount}}\nSend receipt`
  const [template, setTemplate] = useState(defaultTemplate)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/fos/settings', { headers: authHeaders() })
      .then(res => res.json())
      .then(data => {
        const userTmpl = data.whatsappTemplates?.[workbookId]?.[decodedSheet]
        if (userTmpl) setTemplate(userTmpl)
      })
      .catch(() => { })
      .finally(() => setLoading(false))
  }, [workbookId, decodedSheet])

  const visibleTags = sheet?.visibleTags || []

  function insertTag(tag) {
    setTemplate(prev => prev + `{{${tag}}}`)
  }

  async function handleSave() {
    const queuedAt = Date.now()
    setSaving(true)
    setMessage('')
    try {
      const body = JSON.stringify({ workbookId, sheetName: decodedSheet, template, queuedAt })
      const res = await fetch('/api/fos/settings', {
        method: 'POST',
        headers: authHeaders(),
        body
      })
      if (res.ok || res.status === 202) {
        const queued = res.status === 202
        if (queued) {
          // SW queued it — also save locally for immediate use
          await offlineQueue.enqueue({
            url: `${window.location.origin}/api/fos/settings`,
            method: 'POST', headers: authHeaders(), body, queuedAt
          })
          setMessage('Template queued — will sync when online')
        } else {
          setMessage('Settings saved successfully!')
        }
        setTimeout(() => setMessage(''), 3000)
      } else {
        throw new Error('Failed to save settings')
      }
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('fetch') || !navigator.onLine) {
        // Queue offline
        try {
          await offlineQueue.enqueue({
            url: `${window.location.origin}/api/fos/settings`,
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ workbookId, sheetName: decodedSheet, template, queuedAt }),
            queuedAt
          })
          setMessage('Template queued — will sync when online')
        } catch {
          setMessage('Could not save template.')
        }
      } else {
        setMessage(err.message)
      }
      setTimeout(() => setMessage(''), 4000)
    } finally {
      setSaving(false)
    }
  }

  if (!wb || !sheet) {
    return (
      <div className="fos-empty" style={{ marginTop: 60 }}>
        <Icon name="cases" size={36} />
        <p>Sheet not found or access denied.</p>
        <button className="fos-back-btn" onClick={() => navigate('/dashboard')}>← Back to dashboard</button>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 16px 60px', maxWidth: 640, margin: '0 auto' }}>
      <button
        onClick={() => navigate(-1)}
        style={{ background: 'transparent', border: 'none', color: '#8be8d8', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 24, padding: 0 }}
      >
        <Icon name="arrow-left" size={16} /> Back to cases
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{ background: '#1a3229', color: '#6be4d2', padding: 8, borderRadius: 10, display: 'flex' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.01 2.002c-5.522 0-9.998 4.477-9.998 10.002 0 1.954.559 3.784 1.523 5.342L2.01 22.002l4.805-1.503c1.517.881 3.266 1.378 5.148 1.378 5.522 0 10.002-4.477 10.002-10.002 0-5.525-4.48-10.002-10.002-10.002h-.01zM11.996 20.218c-1.597 0-3.1-.418-4.436-1.168l-.317-.184-3.111.977.994-3.078-.204-.326a8.337 8.337 0 0 1-1.272-4.431c0-4.62 3.759-8.381 8.381-8.381s8.383 3.761 8.383 8.381-3.761 8.38-8.383 8.38z" /><path d="M17.135 14.34c-.282-.141-1.666-.822-1.924-.916-.258-.094-.447-.141-.634.141-.188.282-.728.916-.893 1.104-.164.188-.328.212-.61.071-.282-.141-1.189-.438-2.264-1.396-.837-.745-1.402-1.666-1.566-1.948-.164-.282-.018-.435.123-.576.126-.126.282-.329.423-.493.141-.164.188-.282.282-.47.094-.188.047-.353-.024-.494-.071-.141-.634-1.53-.87-2.095-.229-.553-.464-.477-.634-.486-.164-.009-.353-.009-.54-.009-.188 0-.493.071-.752.353-.258.282-.986.963-.986 2.348 0 1.386 1.01 2.724 1.151 2.912.141.188 1.986 3.031 4.814 4.25 2.158.93 2.822.846 3.339.752.795-.144 1.666-.681 1.901-1.339.235-.658.235-1.222.164-1.339-.07-.118-.258-.188-.54-.329z" /></svg>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: '#eeeeee' }}>WhatsApp Settings</h2>
      </div>
      <p style={{ color: '#777777', fontSize: 14, marginBottom: 28, lineHeight: 1.5 }}>
        Customize the receipt request message sent to customers.
        You can dynamically insert their specific case details using the dropdown below.
      </p>

      {loading ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#777777' }}><Icon name="spinner" size={20} className="spin-icon" /> Loading settings...</div>
      ) : (
        <div style={{ background: '#141414', border: '1px solid #2e2e2e', borderRadius: 16, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#cccccc' }}>Message Template</span>
            <div style={{ position: 'relative' }}>
              <select
                onChange={e => { if (e.target.value) insertTag(e.target.value); e.target.value = ''; }}
                style={{ appearance: 'none', padding: '6px 30px 6px 12px', background: '#181818', border: '1px solid #2e2e2e', color: '#8be8d8', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none' }}
              >
                <option value="">+ Insert variable</option>
                {visibleTags.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{ position: 'absolute', right: 10, top: 9, pointerEvents: 'none', color: '#8be8d8' }}>
                <Icon name="chevron-down" size={14} />
              </div>
            </div>
          </label>

          <textarea
            value={template}
            onChange={e => setTemplate(e.target.value)}
            style={{
              width: '100%', minHeight: 200, padding: 16, borderRadius: 10,
              background: '#0e0e0e', border: '1px solid #222222',
              color: '#aaaaaa', fontFamily: '"Fira Code", monospace', fontSize: 14,
              lineHeight: 1.6, resize: 'vertical', outline: 'none'
            }}
            placeholder="Type your WhatsApp message here..."
          />

          <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {message ? (
              <span style={{ fontSize: 14, fontWeight: 500, color: message.includes('success') ? '#6be2c7' : '#f36e6e', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name={message.includes('success') ? 'check' : 'alert-circle'} size={16} />
                {message}
              </span>
            ) : <span />}
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: '#3a7a6c', color: '#fff', border: 'none', borderRadius: 8,
                padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1, transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(58, 122, 108, 0.3)'
              }}
            >
              {saving ? 'Saving...' : 'Save Template'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Field Dashboard ───────────────────────────────────────────────────────────────
export function FieldDashboard({ onLogout }) {
  const name = localStorage.getItem('collectionAssistName') || sessionStorage.getItem('collectionAssistName') || 'User'
  const employeeId = localStorage.getItem('collectionAssistEmployeeId') || sessionStorage.getItem('collectionAssistEmployeeId') || ''

  const [workbooks, setWorkbooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [syncToast, setSyncToast] = useState(null)
  const menuRef = React.useRef(null)

  const isOnline = useOnlineStatus()

  const handleSyncComplete = useCallback(({ synced, conflicts }) => {
    if (synced > 0 || conflicts > 0) {
      setSyncToast({ synced, conflicts })
      setTimeout(() => setSyncToast(null), 5000)
    }
  }, [])

  useOfflineSync(isOnline, handleSyncComplete)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [])

  useEffect(() => {
    fetchSheets()
  }, [])

  async function fetchSheets() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/fos/sheets', { headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      const wbs = data.workbooks || []
      setWorkbooks(wbs)
      try { localStorage.setItem('fos-cache-workbooks', JSON.stringify(wbs)) } catch { }
    } catch (err) {
      const cached = localStorage.getItem('fos-cache-workbooks')
      if (cached) {
        try {
          setWorkbooks(JSON.parse(cached))
          setError('')
        } catch {
          setError('Server is unreachable.')
        }
      } else {
        setError(
          err.message.includes('JSON') || err.message.includes('fetch')
            ? 'Server is unreachable.'
            : err.message
        )
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fos-shell">


      {syncToast && (
        <div className="fos-sync-toast">
          <Icon name="check" size={14} />
          {syncToast.synced > 0 && <span>{syncToast.synced} change{syncToast.synced !== 1 ? 's' : ''} synced</span>}
          {syncToast.conflicts > 0 && <span style={{ opacity: 0.7 }}>{syncToast.conflicts} conflict{syncToast.conflicts !== 1 ? 's' : ''} resolved by admin</span>}
        </div>
      )}

      <header className="fos-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <a className="fos-brand" href="/dashboard" style={{ gap: '9px' }}>
            <img src="/icons/icon.png" width="26" height="26" alt="Recovr" style={{ borderRadius: 8 }} />
            <span><b>Recovr</b></span>
          </a>
          {!isOnline && (
            <span style={{ background: '#7e6200', color: '#fff', fontSize: '10px', padding: '2px 6px', borderRadius: '4px', fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase' }}>Offline</span>
          )}
        </div>
        <div className="fos-header-right">
          <div className="profile-menu-container" ref={menuRef} style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={() => setMenuOpen(!menuOpen)}>
              <div className="fos-avatar">{name[0]?.toUpperCase()}</div>
              <div className="fos-user-info">
                <strong>{name}</strong>
                <small>{employeeId}</small>
              </div>
            </div>
            {menuOpen && (
              <div className="profile-dropdown animate-dropdown" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: '#1e1e1e', border: '1px solid #333333', borderRadius: '8px', padding: '8px', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', minWidth: '160px' }}>
                <button onClick={onLogout} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '8px 12px', background: 'transparent', border: '1px solid #ef4444', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '14px', fontWeight: 500, transition: 'background 0.2s' }} onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }} onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                  <Icon name="logout" size={16} />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {!isOnline && (
        <div className="fos-offline-banner">
          <Icon name="alert-circle" size={14} />
          You're offline — viewing cached data. Changes will sync when you reconnect.
        </div>
      )}

      <main className="fos-content">
        {loading ? (
          <div className="fos-loading" style={{ marginTop: 80 }}>
            <Icon name="spinner" size={28} className="spin-icon" />
            <span>Loading your dashboard...</span>
          </div>
        ) : error ? (
          <div className="fos-error" style={{ marginTop: 40 }}>{error}</div>
        ) : (
          <Routes>
            <Route path="/" element={<SheetSelector workbooks={workbooks} />} />
            <Route path="/:workbookId/:sheetName" element={<SheetRoute workbooks={workbooks} />} />
            <Route path="/settings/:workbookId/:sheetName" element={<FosSettings workbooks={workbooks} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        )}
      </main>
    </div>
  )
}
