import React, { useState, useEffect, useMemo } from 'react'
import { Icon, Skeleton, SkeletonTableRows, CaseAdditionalDetails } from '../Shared.jsx'

export function Allocation() {
  const [workbooks, setWorkbooks] = useState([])
  const [users, setUsers] = useState([])
  const [selectedWorkbookId, setSelectedWorkbookId] = useState('')
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const [cases, setCases] = useState([])
  const [loadingCases, setLoadingCases] = useState(false)
  const [loadingWorkbooks, setLoadingWorkbooks] = useState(true)
  const [collectionsError, setCollectionsError] = useState(false)

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('default')
  const [sortAsc, setSortAsc] = useState(true)
  const [expandedCases, setExpandedCases] = useState(new Set())
  const [allocationLoading, setAllocationLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [filteredFos, setFilteredFos] = useState(null)

  useEffect(() => {
    fetchWorkbooks()
    fetchUsers()
  }, [])

  useEffect(() => {
    if (selectedWorkbookId && selectedSheetName) {
      fetchCases(selectedWorkbookId, selectedSheetName)
    } else {
      setCases([])
    }
  }, [selectedWorkbookId, selectedSheetName])

  async function fetchWorkbooks() {
    setLoadingWorkbooks(true)
    try {
      const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
      const res = await fetch('/api/allocation/workbooks', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setWorkbooks(data.collections || [])
    } catch (err) {
      setError('Failed to fetch workbooks.')
      setCollectionsError(true)
    } finally {
      setLoadingWorkbooks(false)
    }
  }

  async function fetchUsers() {
    try {
      const res = await fetch('/api/users')
      const data = await res.json()
      // Use both field employees and any others with an FOS Identifier just in case
      setUsers((data.users || []).filter(u => u.role === 'Field Employee' || u.fosIdentifier))
    } catch (err) {
      console.error(err)
    }
  }

  async function fetchCases(collectionId, sheetName) {
    setLoadingCases(true)
    setError('')
    try {
      const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || '';
      const res = await fetch(`/api/allocation/cases?collectionId=${collectionId}&sheetName=${encodeURIComponent(sheetName)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setCases((data.cases || []).map(c => ({ ...c, _originalFosForSort: c.fos })))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoadingCases(false)
    }
  }

  async function allocateCase(caseId, fosIdentifier) {
    if (fosIdentifier === undefined || fosIdentifier === null) return // Skip if nullish

    setAllocationLoading(true)
    setSuccess('')
    setError('')
    try {
      const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || '';
      const res = await fetch('/api/allocation/cases', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          caseIds: [caseId],
          fosIdentifier,
          collectionId: selectedWorkbookId,
          sheetName: selectedSheetName
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)

      setSuccess('Case allocated successfully.')
      // Update local state
      setCases(prev => prev.map(c => c._id === caseId ? { ...c, fos: fosIdentifier } : c))
    } catch (err) {
      setError(err.message)
    } finally {
      setAllocationLoading(false)
      setTimeout(() => setSuccess(''), 3000)
    }
  }

  const selectedWorkbook = workbooks.find(w => w._id === selectedWorkbookId)

  // Filtering and Sorting
  const filteredAndSortedCases = useMemo(() => {
    let result = cases

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(c =>
        (c.loanNumber != null && String(c.loanNumber).toLowerCase().includes(q)) ||
        (c.customerName != null && String(c.customerName).toLowerCase().includes(q))
      )
    }

    if (filteredFos) {
      if (filteredFos === 'UNALLOCATED') {
        result = result.filter(c => !users.some(u => (u.fosIdentifier || u.employeeId) === c.fos))
      } else {
        result = result.filter(c => c.fos === filteredFos)
      }
    }

    return result
  }, [cases, search, filteredFos, users])

  function toggleExpand(id) {
    const newSet = new Set(expandedCases)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setExpandedCases(newSet)
  }

  return (
    <div className="admin-content">
      <div className="admin-heading">
        <div>
          <span className="eyebrow">CASE MANAGEMENT</span>
          <h1>Case Allocation</h1>
          <p>Assign field employees to cases based on address and pincode.</p>
        </div>
      </div>

      <section className="panel" style={{ marginTop: 24, padding: '24px', display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <label className="form-label">Select Workbook
            <select
              value={selectedWorkbookId}
              onChange={e => { setSelectedWorkbookId(e.target.value); setSelectedSheetName('') }}
              className={loadingWorkbooks ? 'select-loading' : ''}
              disabled={loadingWorkbooks}
            >
              {loadingWorkbooks
                ? <option value="">Fetching workbooks…</option>
                : collectionsError
                  ? <option value="">Server is unreachable</option>
                  : workbooks.length === 0
                    ? <option value="">No workbooks available</option>
                    : <>
                      <option value="">-- Choose Workbook --</option>
                      {workbooks.map(w => <option key={w._id} value={w._id}>{w.name}</option>)}
                    </>
              }
            </select>
          </label>
        </div>
        <div style={{ flex: 1 }}>
          <label className="form-label">Select Sheet
            <select
              value={selectedSheetName}
              onChange={e => setSelectedSheetName(e.target.value)}
              disabled={!selectedWorkbook}
            >
              <option value="">-- Choose Sheet --</option>
              {selectedWorkbook?.sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {(error || success || allocationLoading) && (
        <div style={{
          position: 'fixed',
          bottom: 32,
          right: 32,
          background: '#111111',
          border: '1px solid #252525',
          borderRadius: 8,
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 1000,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {allocationLoading && !success && !error && <><Icon name="spinner" size={16} className="spin-icon" /><span style={{ color: '#777777', fontSize: 13, fontWeight: 600 }}>Allocating case...</span></>}
          {success && <><Icon name="check" size={16} style={{ color: '#5cce9d' }} /><span style={{ color: '#5cce9d', fontSize: 13, fontWeight: 600 }}>{success}</span></>}
          {error && <><Icon name="close" size={16} style={{ color: '#e88080' }} /><span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{error}</span></>}
        </div>
      )}

      {selectedWorkbookId && selectedSheetName && (
        <>
          <section className="panel" style={{ marginTop: 24, padding: '16px 24px' }}>
            <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Allocation Summary</h3>
            {loadingCases ? (
              <div className="skeleton-stat-row">
                {[140, 120, 130, 110].map((w, i) => (
                  <div key={i} className="skeleton-stat-card">
                    <Skeleton width={`${w - 60}px`} height="11px" />
                    <Skeleton width={`${w - 20}px`} height="28px" style={{ borderRadius: 6 }} />
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                <div 
                  onClick={() => setFilteredFos(null)} 
                  style={{ background: filteredFos === null ? '#2a3f54' : '#252525', border: '1px solid #3b5998', borderRadius: 8, padding: '12px 16px', minWidth: 150, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <div style={{ fontSize: 12, color: filteredFos === null ? '#fff' : '#3498db', fontWeight: 600, marginBottom: 4 }}>Total Cases</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {cases.length}
                    {cases.filter(c => c.newCase).length > 0 && (
                      <span style={{ fontSize: 11, background: 'rgba(52, 152, 219, 0.2)', color: filteredFos === null ? '#fff' : '#3498db', border: `1px solid ${filteredFos === null ? 'rgba(255,255,255,0.4)' : '#3b5998'}`, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{cases.filter(c => c.newCase).length} New</span>
                    )}
                  </div>
                </div>
                <div 
                  onClick={() => setFilteredFos(filteredFos === 'UNALLOCATED' ? null : 'UNALLOCATED')}
                  style={{ background: filteredFos === 'UNALLOCATED' ? '#e74c3c' : '#e74c3c22', border: '1px solid #e74c3c', borderRadius: 8, padding: '12px 16px', minWidth: 150, cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  <div style={{ fontSize: 12, color: filteredFos === 'UNALLOCATED' ? '#fff' : '#e74c3c', fontWeight: 600, marginBottom: 4 }}>Unallocated</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {cases.filter(c => !users.some(u => (u.fosIdentifier || u.employeeId) === c.fos)).length}
                    {cases.filter(c => !users.some(u => (u.fosIdentifier || u.employeeId) === c.fos) && c.newCase).length > 0 && (
                      <span style={{ fontSize: 11, background: 'rgba(231, 76, 60, 0.2)', color: filteredFos === 'UNALLOCATED' ? '#fff' : '#e74c3c', border: `1px solid ${filteredFos === 'UNALLOCATED' ? 'rgba(255,255,255,0.4)' : '#e74c3c'}`, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{cases.filter(c => !users.some(u => (u.fosIdentifier || u.employeeId) === c.fos) && c.newCase).length} New</span>
                    )}
                  </div>
                </div>
                {users.map(u => {
                  const fosId = u.fosIdentifier || u.employeeId;
                  const fosCases = cases.filter(c => c.fos === fosId);
                  const count = fosCases.length;
                  if (count === 0) return null;
                  
                  const isSelected = filteredFos === fosId;
                  const newCount = fosCases.filter(c => c.newCase).length;
                  
                  return (
                    <div 
                      key={u._id} 
                      onClick={() => setFilteredFos(isSelected ? null : fosId)}
                      style={{ background: isSelected ? '#3a4f64' : '#252525', border: isSelected ? '1px solid #5a6f84' : '1px solid #2a3f54', borderRadius: 8, padding: '12px 16px', minWidth: 150, cursor: 'pointer', transition: 'all 0.2s' }}
                    >
                      <div style={{ fontSize: 12, color: isSelected ? '#fff' : '#777777', fontWeight: 600, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={u.name}>{u.name}</div>
                      <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {count}
                        {newCount > 0 && (
                          <span style={{ fontSize: 11, background: 'rgba(52, 152, 219, 0.1)', color: isSelected ? '#fff' : '#3498db', border: `1px solid ${isSelected ? 'rgba(255,255,255,0.4)' : '#2a3f54'}`, padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{newCount} New</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="panel" style={{ marginTop: 24 }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid #252525', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: 16, fontWeight: 500 }}>Cases ({filteredAndSortedCases.length})</h3>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Search Loan No or Name..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ padding: '8px 12px', background: '#161616', border: '1px solid #252525', borderRadius: 6, color: '#fff', outline: 'none' }}
                />
              </div>
            </div>

            {loadingCases ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 800, textAlign: 'left', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <tbody>
                    <SkeletonTableRows rows={6} cols={5} />
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 800, textAlign: 'left', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #252525', background: '#161616' }}>
                      <th style={{ padding: '12px 16px', color: '#7a94a5', width: '5%' }}>#</th>
                      <th style={{ padding: '12px 24px', color: '#7a94a5', width: '25%' }}>
                        Customer Name
                      </th>
                      <th style={{ padding: '12px 8px', color: '#7a94a5', width: '35%' }}>Address & Pin</th>
                      <th style={{ padding: '12px 8px', color: '#7a94a5', width: '25%' }}>
                        Allocation
                      </th>
                      <th style={{ padding: '12px 24px', textAlign: 'right', color: '#7a94a5', width: '10%' }}>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedCases.map((c, idx) => {
                      const isExpanded = expandedCases.has(c._id)
                      return (
                        <React.Fragment key={c._id}>
                          <tr
                            onClick={() => toggleExpand(c._id)}
                            style={{
                              borderBottom: isExpanded ? 'none' : '1px solid #252525',
                              background: 'transparent',
                              cursor: 'pointer'
                            }}>
                            <td style={{ padding: '16px 16px', verticalAlign: 'top', color: '#7a94a5', fontSize: 13 }}>
                              {idx + 1}
                            </td>
                            <td style={{ padding: '16px 24px', verticalAlign: 'top' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{c.customerName || '—'}</div>
                                {c.newCase && (
                                  <span style={{ padding: '2px 6px', background: 'rgba(52, 152, 219, 0.2)', border: '1px solid rgba(52, 152, 219, 0.5)', color: '#3498db', fontSize: 10, borderRadius: 4, fontWeight: 'bold' }}>
                                    {String(c.newCase).toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: '#7a94a5', marginTop: 4 }}>Loan No: {c.loanNumber || '—'}</div>
                            </td>
                            <td style={{ padding: '16px 8px', verticalAlign: 'top', maxWidth: 300 }}>
                              <div style={{ fontSize: 14, color: '#dce5eb', lineHeight: 1.4 }}>{c.address || '—'}</div>
                              {c.pinCode && <div style={{ fontSize: 13, color: '#3498db', marginTop: 4, fontWeight: 500 }}>Pin Code: {c.pinCode}</div>}
                            </td>
                            <td style={{ padding: '16px 8px', verticalAlign: 'top' }}>
                              {!c.fosCol ? (
                                <span style={{ color: '#e74c3c', fontSize: 12 }}>No FOS column mapped</span>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                  {(() => {
                                    const isAllocated = users.some(u => (u.fosIdentifier || u.employeeId) === c.fos)
                                    return (
                                      <select
                                        value={isAllocated ? c.fos : ''}
                                        onClick={e => e.stopPropagation()}
                                        onChange={e => allocateCase(c._id, e.target.value)}
                                        disabled={allocationLoading}
                                        style={{
                                          maxWidth: 200,
                                          ...(isAllocated ? {} : { background: '#e74c3c22', borderColor: '#e74c3c' })
                                        }}
                                      >
                                        <option value="" style={{ background: '#252525', color: '#fff' }}>-- Unallocated --</option>
                                        {users.map(u => (
                                          <option key={u._id} value={u.fosIdentifier || u.employeeId} style={{ background: '#252525', color: '#fff' }}>
                                            {u.name} ({u.fosIdentifier || 'No ID'})
                                          </option>
                                        ))}
                                      </select>
                                    )
                                  })()}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '16px 24px', verticalAlign: 'top' }}>
                              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="icon-button" onClick={(e) => { e.stopPropagation(); toggleExpand(c._id); }}>
                                  <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr style={{ background: 'rgba(0, 0, 0, 0.2)' }}>
                              <td colSpan="5" style={{ padding: 0 }}>
                                <div style={{ borderTop: '1px solid #222222', borderBottom: '1px solid #252525', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, color: '#8fa4b5', fontFamily: '"DM Mono", monospace' }}>
                                      <Icon name="file" size={13} /> Additional Details
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '14px 20px' }}>
                                      <CaseAdditionalDetails caseData={c} />
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                    {filteredAndSortedCases.length === 0 && (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center', padding: '40px 20px', color: '#5a7a8a' }}>
                          No cases match your filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
