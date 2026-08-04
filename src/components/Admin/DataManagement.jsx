import React, { useState, useEffect } from 'react'
import { Icon, Skeleton, CaseAdditionalDetails } from '../Shared.jsx'

const formatPreviewValue = (val) => {
  if (val === null || val === undefined || val === '') return '—'
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
    const d = new Date(val)
    if (!isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, '0')
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const yyyy = d.getFullYear()
      return `${dd}-${mm}-${yyyy}`
    }
  }
  return val
}

function getToken() {
  return localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
}
function authHeaders() {
  return { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' }
}

export function DataManagement({ collectionId, sheetName, availableColumns }) {
  const [targetColumn, setTargetColumn] = useState('')
  const [newValue, setNewValue] = useState('')
  const [valueType, setValueType] = useState('text')
  const [filters, setFilters] = useState([])
  const [applyState, setApplyState] = useState('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [matchCount, setMatchCount] = useState(null)
  const [isCounting, setIsCounting] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewData, setPreviewData] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [expandedPreviewCases, setExpandedPreviewCases] = useState(new Set())

  useEffect(() => {
    const fetchCount = async () => {
      setIsCounting(true)
      try {
        const payload = {
          sheetName,
          targetColumn,
          newValue,
          valueType,
          filters: filters.filter(f => f.column).map(f => ({ column: f.column, selectedValues: Array.from(f.selectedValues) }))
        }
        const res = await fetch(`/api/collections/${collectionId}/bulk-update-count`, {
          method: 'POST', headers: authHeaders(), body: JSON.stringify(payload)
        })
        const data = await res.json()
        if (res.ok) setMatchCount(data.count)
      } catch (err) {
        console.error('Failed to fetch count', err)
      } finally {
        setIsCounting(false)
      }
    }

    const timeoutId = setTimeout(fetchCount, 300)
    return () => clearTimeout(timeoutId)
  }, [sheetName, targetColumn, newValue, valueType, filters, collectionId])

  const addFilter = () => {
    setFilters([...filters, { id: Date.now(), column: '', availableValues: [], selectedValues: new Set(), loading: false }])
  }

  const removeFilter = (id) => {
    setFilters(filters.filter(f => f.id !== id))
  }

  const handleFilterColumnChange = async (id, newCol) => {
    setFilters(filters.map(f => f.id === id ? { ...f, column: newCol, availableValues: [], selectedValues: new Set(), loading: true } : f))
    if (!newCol) return

    try {
      const res = await fetch(`/api/collections/${collectionId}/distinct?sheetName=${encodeURIComponent(sheetName)}&column=${encodeURIComponent(newCol)}`, { headers: { 'Authorization': `Bearer ${getToken()}` } })
      const data = await res.json()
      if (res.ok) {
        setFilters(prev => prev.map(f => f.id === id ? { ...f, availableValues: data.values, loading: false } : f))
      }
    } catch (err) {
      console.error(err)
      setFilters(prev => prev.map(f => f.id === id ? { ...f, loading: false } : f))
    }
  }

  const toggleFilterValue = (id, val) => {
    setFilters(filters.map(f => {
      if (f.id !== id) return f
      const newSet = new Set(f.selectedValues)
      if (newSet.has(val)) newSet.delete(val)
      else newSet.add(val)
      return { ...f, selectedValues: newSet }
    }))
  }

  const applyBulkUpdate = async () => {
    if (!targetColumn) { setError('Target column is required.'); return }
    setMessage('')
    setError('')
    setApplyState('saving')
    try {
      const payload = {
        sheetName,
        targetColumn,
        newValue,
        valueType,
        filters: filters.filter(f => f.column).map(f => ({ column: f.column, selectedValues: Array.from(f.selectedValues) }))
      }
      const res = await fetch(`/api/collections/${collectionId}/bulk-update`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setMessage(data.message)
      setApplyState('idle')
      setTargetColumn('')
      setNewValue('')
      setFilters([])
    } catch (err) {
      setError(err.message)
      setApplyState('idle')
    }
  }

  const togglePreviewExpand = (id) => {
    setExpandedPreviewCases(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openPreview = async () => {
    if (!targetColumn) { setError('Target column is required.'); return }
    setPreviewModalOpen(true)
    setPreviewLoading(true)
    setPreviewData([])
    setExpandedPreviewCases(new Set())
    try {
      const payload = {
        sheetName,
        targetColumn,
        newValue,
        valueType,
        filters: filters.filter(f => f.column).map(f => ({ column: f.column, selectedValues: Array.from(f.selectedValues) }))
      }
      const res = await fetch(`/api/collections/${collectionId}/bulk-update-preview`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (res.ok) setPreviewData(data.preview || [])
    } catch (e) {
      console.error(e)
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <p style={{ color: '#777777', fontSize: 13, marginBottom: 20 }}>Populate a specific column with a value, optionally filtering which rows get updated.</p>

      <div className="bulk-entry-fields" style={{ display: 'flex', gap: 16 }}>
        <label style={{ display: 'block', flex: 1 }}>Target Column
          <select value={targetColumn} onChange={e => setTargetColumn(e.target.value)} style={{ marginTop: 8 }}>
            <option value="">— select column —</option>
            {availableColumns.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'block', width: '120px' }}>Value Type
          <select value={valueType} onChange={e => { setValueType(e.target.value); setNewValue(''); }} style={{ marginTop: 8 }}>
            <option value="text">Text</option>
            <option value="date">Date</option>
          </select>
        </label>
        <label style={{ display: 'block', flex: 1 }}>New Value
          {valueType === 'date' ? (
            <input type="date" value={newValue} onChange={e => setNewValue(e.target.value)} style={{ marginTop: 8 }} />
          ) : (
            <input type="text" value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Value to populate" style={{ marginTop: 8 }} />
          )}
        </label>
      </div>

      <div style={{ marginTop: 24 }}>
        <h4 style={{ marginBottom: 12 }}>Filters (Optional)</h4>
        {filters.length === 0 ? (
          <p style={{ fontSize: 12, color: '#777777' }}>No filters applied. All rows will be updated.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filters.map(f => (
              <div key={f.id} style={{ background: '#181818', padding: 16, borderRadius: 6, border: '1px solid #252525' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#cccccc', fontWeight: 700 }}>Filter Column</span>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <select value={f.column} onChange={e => handleFilterColumnChange(f.id, e.target.value)} style={{ flex: 1 }}>
                      <option value="">— select filter column —</option>
                      {availableColumns.map(c => <option key={c.label} value={c.label}>{c.label}</option>)}
                    </select>
                    <button className="icon-button filter-remove" onClick={() => removeFilter(f.id)}><Icon name="trash" size={16} /></button>
                  </div>
                </div>

                {f.column && (
                  <div style={{ marginTop: 12 }}>
                    <span style={{ fontSize: 12, color: '#777777', display: 'block', marginBottom: 8 }}>Select values to match:</span>
                    {f.loading ? (
                      <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Skeleton width="70%" height="12px" />
                        <Skeleton width="50%" height="12px" />
                        <Skeleton width="60%" height="12px" />
                      </div>
                    ) : (
                      <div style={{ maxHeight: 150, overflowY: 'auto', background: '#111111', padding: 8, borderRadius: 4, border: '1px solid #252525' }}>
                        {f.availableValues.length === 0 ? <div style={{ fontSize: 12, color: '#777777' }}>No values found</div> : (
                          f.availableValues.map(val => (
                            <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                              <input type="checkbox" checked={f.selectedValues.has(val)} onChange={() => toggleFilterValue(f.id, val)} />
                              {val === '__BLANKS__' ? <em style={{ color: '#777777' }}>(Blanks)</em> : val}
                            </label>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <button className="outlined-button" onClick={addFilter} style={{ marginTop: 12 }}><Icon name="plus" size={14} /> Add Filter</button>
      </div>

      {error && <div style={{ background: '#3b1d1d', color: '#e88080', padding: '10px 14px', borderRadius: 6, marginTop: 24, fontSize: 13, border: '1px solid #8a4b4b' }}>{error}</div>}
      {message && <div style={{ background: '#1d3b2c', color: '#80e8a8', padding: '10px 14px', borderRadius: 6, marginTop: 24, fontSize: 13, border: '1px solid #4b8a61' }}>{message}</div>}

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 13, color: '#cccccc', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          {isCounting ? <span style={{ color: '#777777' }}>Calculating cases...</span> : <span><strong>{matchCount !== null ? matchCount : '...'}</strong> cases will be updated.</span>}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className="outlined-button"
            style={{ padding: '12px', fontSize: 14 }}
            disabled={applyState === 'saving' || !targetColumn || matchCount === 0}
            onClick={openPreview}
          >
            <Icon name="eye" size={16} /> View Preview
          </button>
          <button className="primary-button" style={{ flex: 1, padding: '12px', fontSize: 14 }} disabled={applyState === 'saving' || !targetColumn || matchCount === 0} onClick={applyBulkUpdate}>
            {applyState === 'saving' ? 'Applying...' : 'Apply Bulk Update & Regenerate Excel'}
          </button>
        </div>
      </div>

      {previewModalOpen && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setPreviewModalOpen(false)}>
          <div className="modal" style={{ width: '80%', height: '80%', maxWidth: '1200px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#eeeeee' }}>Preview Details</h3>
              <button className="icon-button" onClick={() => setPreviewModalOpen(false)}><Icon name="close" size={20} /></button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {previewLoading ? (
                <div style={{ color: '#cccccc', padding: 20 }}>Loading preview...</div>
              ) : previewData.length === 0 ? (
                <div style={{ color: '#cccccc', padding: 20 }}>No cases will be updated with current settings.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {previewData.map(caseItem => {
                    const isExpanded = expandedPreviewCases.has(caseItem._id)
                    const custNameRaw = caseItem.tagData?.['Customer Name']
                    const custName = Array.isArray(custNameRaw) ? custNameRaw.join(', ') : (custNameRaw || 'Unknown Name')
                    return (
                      <div key={caseItem._id} style={{ background: '#141414', borderRadius: 8, border: '1px solid #252525', overflow: 'hidden' }}>
                        <div
                          style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: '#1e1e1e' }}
                          onClick={() => togglePreviewExpand(caseItem._id)}
                        >
                          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                            <span style={{ color: '#eeeeee', fontWeight: 600 }}>{custName !== 'Unknown Name' ? custName : (caseItem.loanNumber || 'Unknown Loan')} <span style={{ color: '#777777', fontWeight: 400, marginLeft: 6 }}>({custName !== 'Unknown Name' ? (caseItem.loanNumber || 'Unknown Loan') : ''})</span></span>
                            <div style={{ display: 'flex', gap: 16 }}>
                              {caseItem.changes?.map((change, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                  <span style={{ color: '#777777' }}>{change.col}:</span>
                                  <span style={{ color: '#e88080', textDecoration: 'line-through' }}>{formatPreviewValue(change.old)}</span>
                                  <Icon name="arrow" size={12} style={{ color: '#5cce9d' }} />
                                  <span style={{ color: '#5cce9d', fontWeight: 600 }}>{formatPreviewValue(change.new)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} style={{ color: '#777777' }} />
                        </div>
                        {isExpanded && (
                          <div style={{ padding: 16, borderTop: '1px solid #252525' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px 24px' }}>
                              <CaseAdditionalDetails caseData={caseItem} />
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #252525', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="outlined-button" onClick={() => setPreviewModalOpen(false)}>Close Preview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
