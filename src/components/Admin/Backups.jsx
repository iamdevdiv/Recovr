import React, { useEffect, useState } from 'react'
import { Icon, CaseAdditionalDetails } from '../Shared.jsx'

const formatChangeVal = (val, col, activeCol) => {
  if (val === null || val === undefined || val === '') return '—'
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(val)) {
    const d = new Date(val)
    if (!isNaN(d)) {
      let isTime = col && typeof col === 'string' && col.toLowerCase().includes('time')
      if (activeCol && activeCol.sheets) {
        for (const sheet of activeCol.sheets) {
          const stdCol = sheet.standardColumns?.find(sc => sc.label === col)
          if (stdCol && stdCol.tag && stdCol.tag.toLowerCase().includes('time')) {
            isTime = true
            break
          }
        }
      }
      if (isTime) {
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      }
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    }
  }
  return String(val)
}

export function Backups() {
  const [collections, setCollections] = useState([])
  const [colId, setColId] = useState('')
  const activeCol = collections.find(c => c._id === colId)
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(false)
  const [actionState, setActionState] = useState({ id: null, loading: false, message: '', error: '' })

  const [restoreConfirm, setRestoreConfirm] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [previewDetails, setPreviewDetails] = useState(null)
  const [expandedPreviewCases, setExpandedPreviewCases] = useState(new Set())
  const [selectedBackups, setSelectedBackups] = useState(new Set())

  const fetchCollections = async () => {
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const r = await fetch('/api/collections', { headers: { 'Authorization': `Bearer ${token}` } })
      const d = await r.json()
      setCollections(d.collections ?? [])
    } catch (err) {}
  }

  useEffect(() => {
    fetchCollections()
  }, [])

  useEffect(() => {
    if (!colId) {
      setBackups([])
      return
    }
    loadBackups()
  }, [colId])

  const loadBackups = async () => {
    setLoading(true)
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const res = await fetch(`/api/backups?collectionId=${colId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setBackups(data || [])
      setSelectedBackups(new Set())
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleRestore = (backupId) => {
    setRestoreConfirm(backupId)
  }

  const confirmRestore = async () => {
    if (!restoreConfirm) return
    const backupId = restoreConfirm
    setRestoreConfirm(null)
    setActionState({ id: backupId, loading: true, message: '', error: '' })
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const res = await fetch(`/api/backups/${backupId}/restore`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to restore')
      setActionState({ id: backupId, loading: false, message: 'Restore successful!', error: '' })
      loadBackups()
      fetchCollections()
      setTimeout(() => setActionState(prev => prev.id === backupId ? { ...prev, message: '' } : prev), 3000)
    } catch (err) {
      setActionState({ id: backupId, loading: false, message: '', error: err.message })
      setTimeout(() => setActionState(prev => prev.id === backupId ? { ...prev, error: '' } : prev), 3000)
    }
  }

  const handleDelete = (backupId) => {
    setDeleteConfirm(backupId)
  }

  const confirmDelete = async () => {
    if (!deleteConfirm) return
    const backupId = deleteConfirm
    setDeleteConfirm(null)
    setActionState({ id: backupId, loading: true, message: '', error: '' })
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const res = await fetch(`/api/backups/${backupId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to delete')
      setActionState({ id: backupId, loading: false, message: 'Deleted successfully!', error: '' })
      loadBackups()
      setTimeout(() => setActionState(prev => prev.id === backupId ? { ...prev, message: '' } : prev), 3000)
    } catch (err) {
      setActionState({ id: backupId, loading: false, message: '', error: err.message })
      setTimeout(() => setActionState(prev => prev.id === backupId ? { ...prev, error: '' } : prev), 3000)
    }
  }

  const confirmBulkDelete = async () => {
    setBulkDeleteConfirm(false)
    setActionState({ id: 'bulk', loading: true, message: '', error: '' })
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const res = await fetch(`/api/backups/bulk`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedBackups) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to delete backups')
      setActionState({ id: 'bulk', loading: false, message: 'Deleted successfully!', error: '' })
      loadBackups()
      setTimeout(() => setActionState(prev => prev.id === 'bulk' ? { ...prev, message: '' } : prev), 3000)
    } catch (err) {
      setActionState({ id: 'bulk', loading: false, message: '', error: err.message })
      setTimeout(() => setActionState(prev => prev.id === 'bulk' ? { ...prev, error: '' } : prev), 3000)
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

  const handleDownload = (backupId) => {
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    window.location.href = `/api/backups/${backupId}/download?token=${token}`
  }

  return (
    <div className="admin-content">
      <div className="admin-heading">
        <div>
          <span className="eyebrow">SYSTEM</span>
          <h1>Backups</h1>
          <p>View and restore automatic or manual workbook backups.</p>
        </div>
      </div>

      <section className="panel" style={{ marginTop: 24, padding: '16px 24px', maxWidth: 600 }}>
        <label style={{ display: 'block', color: '#777777', fontWeight: '500', marginBottom: 8 }}>Select Workbook</label>
        <select
          value={colId}
          onChange={(e) => setColId(e.target.value)}
          style={{ width: '100%' }}
        >
          <option value="">— Choose a workbook —</option>
          {collections.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>
      </section>

      {colId && (
        <section className="panel" style={{ marginTop: 24, padding: '16px 24px' }}>
          {loading ? (
            <p style={{ color: '#777777' }}>Loading backups...</p>
          ) : backups.length === 0 ? (
            <p style={{ color: '#777777' }}>No backups found for this workbook.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{
                position: 'fixed',
                bottom: selectedBackups.size > 0 ? 32 : -100,
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#1e1e1e',
                border: '1px solid #252525',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                borderRadius: 32,
                padding: '12px 24px',
                display: 'flex',
                gap: 24,
                alignItems: 'center',
                transition: 'bottom 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                zIndex: 1000,
                pointerEvents: selectedBackups.size > 0 ? 'auto' : 'none'
              }}>
                <span style={{ color: '#eeeeee', fontWeight: 500 }}>{selectedBackups.size} backups selected</span>
                <button className="primary-button" style={{ background: '#a54d4d', color: '#ffd6d6', boxShadow: 'none', padding: '6px 16px', borderRadius: 20 }} onClick={() => setBulkDeleteConfirm(true)} disabled={actionState.loading}>Delete Selected</button>
              </div>

              <table style={{ width: '100%', minWidth: 700, textAlign: 'left', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #252525' }}>
                    <th style={{ padding: '12px 8px', width: 40 }}>
                      <input
                        type="checkbox"
                        checked={backups.length > 0 && selectedBackups.size === backups.length}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedBackups(new Set(backups.map(b => b._id)))
                          else setSelectedBackups(new Set())
                        }}
                        disabled={backups.length === 0}
                      />
                    </th>
                    <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500' }}>Date & Time</th>
                    <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500' }}>Type</th>
                    <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500' }}>Note</th>
                    <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500' }}>Created By</th>
                    <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b, index) => {
                    const isCurrentLatest = b.isLatest || (!backups.some(bk => bk.isLatest) && index === 0)
                    return (
                    <tr key={b._id} style={{ borderBottom: '1px solid #252525', background: selectedBackups.has(b._id) ? '#ffffff05' : 'transparent' }}>
                      <td style={{ padding: '15px 8px' }}>
                        <input
                          type="checkbox"
                          checked={selectedBackups.has(b._id)}
                          onChange={(e) => {
                            const next = new Set(selectedBackups)
                            if (e.target.checked) next.add(b._id)
                            else next.delete(b._id)
                            setSelectedBackups(next)
                          }}
                        />
                      </td>
                      <td style={{ padding: '15px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {new Date(b.createdAt).toLocaleString()}
                          {isCurrentLatest && (
                            <span style={{
                              display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                              backgroundColor: '#419b7433', color: '#5cce9d', border: '1px solid #419b74'
                            }}>
                              LATEST
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '15px 8px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12,
                          backgroundColor: b.type === 'manual' ? '#6be2c722' : '#7a94a522',
                          color: b.type === 'manual' ? '#6be2c7' : '#777777'
                        }}>
                          {b.type === 'manual' ? 'Manual' : 'Auto'}
                        </span>
                      </td>
                      <td style={{ padding: '15px 8px', maxWidth: 300, wordBreak: 'break-word', color: '#eeeeee' }}>
                        {b.changesDetail ? (
                          <span
                            style={{ color: '#5cce9d', textDecoration: 'underline', cursor: 'pointer' }}
                            onClick={() => setPreviewDetails(b.changesDetail)}
                          >
                            {b.note}
                          </span>
                        ) : (
                          <span>{b.note}</span>
                        )}
                      </td>
                      <td style={{ padding: '15px 8px' }}>{b.createdBy?.name || 'System'}</td>
                      <td style={{ padding: '15px 8px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
                          {!isCurrentLatest && (
                            <button
                              className="outlined-button"
                              style={{ padding: '6px 12px', fontSize: '13px', borderColor: '#419b74', color: '#419b74', display: 'flex', alignItems: 'center', gap: 6 }}
                              onClick={() => handleRestore(b._id)}
                              disabled={actionState.loading}
                            >
                              <Icon name="undo" size={14} /> Restore
                            </button>
                          )}
                          <button
                            className="primary-button"
                            style={{ padding: '6px 12px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: 6 }}
                            onClick={() => handleDownload(b._id)}
                            disabled={actionState.loading}
                          >
                            <Icon name="download" size={14} /> Export
                          </button>
                          <button
                            className="icon-button"
                            style={{ color: '#a54d4d', cursor: 'pointer' }}
                            onClick={() => handleDelete(b._id)}
                            disabled={actionState.loading}
                            title="Delete Backup"
                          >
                            <Icon name="trash" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Restore Modal */}
      {restoreConfirm && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setRestoreConfirm(null)}>
          <div className="modal">
            <button className="close-button" onClick={() => setRestoreConfirm(null)}><Icon name="close" size={16} /></button>
            <span className="eyebrow" style={{ color: '#419b74' }}>RESTORE BACKUP</span>
            <h2>Are you sure?</h2>
            <p>This will completely overwrite the current state of the workbook. Ensure you have backed up any recent changes.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button type="button" className="outlined-button" style={{ flex: 1 }} onClick={() => setRestoreConfirm(null)}>Cancel</button>
              <button type="button" className="primary-button" style={{ flex: 1, background: '#419b74', color: '#fff', boxShadow: 'none' }} onClick={confirmRestore}>Restore Backup</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {deleteConfirm && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteConfirm(null)}>
          <div className="modal">
            <button className="close-button" onClick={() => setDeleteConfirm(null)}><Icon name="close" size={16} /></button>
            <span className="eyebrow" style={{ color: '#e88080' }}>DELETE BACKUP</span>
            <h2>Are you sure?</h2>
            <p>This backup will be permanently deleted and cannot be recovered. Do you wish to proceed?</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button type="button" className="outlined-button" style={{ flex: 1 }} onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button type="button" className="primary-button" style={{ flex: 1, background: '#a54d4d', color: '#ffd6d6', boxShadow: 'none' }} onClick={confirmDelete}>Delete Backup</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {bulkDeleteConfirm && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setBulkDeleteConfirm(false)}>
          <div className="modal">
            <button className="close-button" onClick={() => setBulkDeleteConfirm(false)}><Icon name="close" size={16} /></button>
            <span className="eyebrow" style={{ color: '#e88080' }}>BULK DELETE BACKUPS</span>
            <h2>Are you sure?</h2>
            <p>You are about to permanently delete <strong>{selectedBackups.size}</strong> backups. This action cannot be undone. Do you wish to proceed?</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button type="button" className="outlined-button" style={{ flex: 1 }} onClick={() => setBulkDeleteConfirm(false)}>Cancel</button>
              <button type="button" className="primary-button" style={{ flex: 1, background: '#a54d4d', color: '#ffd6d6', boxShadow: 'none' }} onClick={confirmBulkDelete}>Delete {selectedBackups.size} Backups</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Details Modal */}
      {previewDetails && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setPreviewDetails(null)}>
          <div className="modal" style={{ width: '80%', height: '80%', maxWidth: '1200px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: '#eeeeee' }}>Changes Detail</h3>
              <button className="icon-button" onClick={() => setPreviewDetails(null)}><Icon name="close" size={20} /></button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '0 4px' }}>

              {/* Structural Changes */}
              {previewDetails.structuralChanges?.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ color: '#777777', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Structural Changes</h4>
                  <ul style={{ margin: 0, paddingLeft: 20, color: '#eeeeee', fontSize: 14 }}>
                    {previewDetails.structuralChanges.map((sc, i) => (
                      <li key={i} style={{ marginBottom: 6 }}>{sc}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Added/Deleted Cases summary */}
              {(previewDetails.addedCases > 0 || previewDetails.deletedCases > 0) && (
                <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 16 }}>
                    {previewDetails.addedCases > 0 && <span style={{ color: '#5cce9d', fontWeight: 600 }}>+ {previewDetails.addedCases} cases added</span>}
                    {previewDetails.deletedCases > 0 && <span style={{ color: '#e88080', fontWeight: 600 }}>- {previewDetails.deletedCases} cases deleted</span>}
                  </div>
                </div>
              )}

              {!previewDetails.changes || previewDetails.changes.length === 0 ? (
                <div style={{ color: '#b7c5d4', padding: 20, background: '#141414', borderRadius: 8, border: '1px dashed #252525' }}>No case values were modified in this backup.</div>
              ) : (
                <div style={{ marginBottom: 24 }}>
                  <h4 style={{ color: '#777777', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Modified Cases ({previewDetails.changes.length})</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {previewDetails.changes.map(caseItem => {
                      const isExpanded = expandedPreviewCases.has(caseItem._id)
                      const custNameRaw = caseItem.tagData?.['Customer Name']
                      const custName = Array.isArray(custNameRaw) ? custNameRaw.join(', ') : (custNameRaw || 'Unknown Name')
                      const title = custName !== 'Unknown Name' ? custName : (caseItem.loanNumber || 'Unknown Loan')
                      const subtitle = custName !== 'Unknown Name' ? (caseItem.loanNumber || 'Unknown Loan') : ''
                      return (
                        <div key={caseItem._id} style={{ background: '#141414', borderRadius: 8, border: '1px solid #252525', overflow: 'hidden' }}>
                          <div
                            style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', background: '#1e1e1e' }}
                            onClick={() => togglePreviewExpand(caseItem._id)}
                          >
                            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                              <span style={{ color: '#eeeeee', fontWeight: 600 }}>{title} {subtitle && <span style={{ color: '#777777', fontWeight: 400, marginLeft: 6 }}>({subtitle})</span>}</span>
                              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                                {caseItem.changes?.map((change, i) => (
                                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                    <span style={{ color: '#777777' }}>{change.col}:</span>
                                    <span style={{ color: '#e88080', textDecoration: 'line-through' }}>{formatChangeVal(change.old, change.col, activeCol)}</span>
                                    <Icon name="arrow" size={12} style={{ color: '#5cce9d' }} />
                                    <span style={{ color: '#5cce9d', fontWeight: 600 }}>{formatChangeVal(change.new, change.col, activeCol)}</span>
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
                </div>
              )}
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #252525', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button className="outlined-button" onClick={() => setPreviewDetails(null)}>Close Details</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {(actionState.message || actionState.error) && (
        <div style={{
          position: 'fixed',
          bottom: 32,
          right: 32,
          background: '#181818',
          border: '1px solid #252525',
          borderRadius: 8,
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 99999,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          {actionState.message && <><Icon name="check" size={16} style={{ color: '#5cce9d' }} /><span style={{ color: '#5cce9d', fontSize: 13, fontWeight: 600 }}>{actionState.message}</span></>}
          {actionState.error && <><Icon name="close" size={16} style={{ color: '#e88080' }} /><span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{actionState.error}</span></>}
        </div>
      )}

    </div>
  )
}
