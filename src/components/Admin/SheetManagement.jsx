import React, { useEffect, useState, useRef } from 'react'
import { Icon } from '../Shared.jsx'
import { useDragSort } from '../../hooks/useDragSort.js'
import { DataManagement } from './DataManagement.jsx'
import { TaggingManagement } from './TaggingManagement.jsx'
import { useDownloadWorkbook } from '../../hooks/useDownloadWorkbook.js'
export function SheetManagement() {
  const { download: downloadWb, progress: downloadProgress, error: downloadError } = useDownloadWorkbook()
  const [collections, setCollections] = useState([])
  const [selectedColId, setSelectedColId] = useState('')
  const [selectedSheetName, setSelectedSheetName] = useState('')
  const [mode, setMode] = useState('structure')
  const [stdCols, setStdCols] = useState([])
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [loadingCollections, setLoadingCollections] = useState(true)
  const [collectionsError, setCollectionsError] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const { draggedIdx, onDragStart, onDragOver, onDragEnd } = useDragSort(setStdCols)
  const dragTargetRef = useRef(false)

  // Deletion states
  const [deleteModal, setDeleteModal] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [deleteRefChecked, setDeleteRefChecked] = useState(false)

  const [deleteSheetModal, setDeleteSheetModal] = useState(false)
  const [confirmSheetName, setConfirmSheetName] = useState('')
  const [deleteSheetError, setDeleteSheetError] = useState('')

  const [backupMessage, setBackupMessage] = useState('')
  const [backupError, setBackupError] = useState('')

  const [manualBackupModal, setManualBackupModal] = useState(false)
  const [manualBackupNote, setManualBackupNote] = useState('Manual backup')
  const [manualBackupLoading, setManualBackupLoading] = useState(false)

  const [renameWbModal, setRenameWbModal] = useState(false)
  const [renameWbName, setRenameWbName] = useState('')
  const [renameWbError, setRenameWbError] = useState('')

  const [renameSheetModal, setRenameSheetModal] = useState(false)
  const [renameSheetName, setRenameSheetName] = useState('')
  const [renameSheetError, setRenameSheetError] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    fetch('/api/collections', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((r) => r.json()).then((d) => {
      setCollections(d.collections ?? [])
      setLoadingCollections(false)
    }).catch(() => {
      setLoadingCollections(false)
      setCollectionsError(true)
      setFetchError('Failed to fetch workbooks.')
    })
  }, [])

  // Derive the selected collection object
  const selectedCollection = collections.find((c) => c._id === selectedColId) ?? null

  // The sheets available in the selected collection
  const availableSheets = selectedCollection?.sheets ?? []

  // When collection changes, reset sheet selection
  function handleColChange(id) {
    setSelectedColId(id)
    setSelectedSheetName('')
    setStdCols([])
    setSaveState('idle')
    setSaveError('')
  }

  // When sheet changes, load its columns
  function handleSheetChange(sheetName) {
    setSelectedSheetName(sheetName)
    setSaveState('idle')
    setSaveError('')
    if (!sheetName) { setStdCols([]); return }
    const sheet = availableSheets.find((s) => s.name === sheetName)
    if (sheet?.standardColumns?.length) {
      setStdCols(sheet.standardColumns.map((c, i) => ({ label: c.label, originalLabel: c.label, id: i, tag: c.tag })))
    } else {
      setStdCols([])
    }
  }

  async function save() {
    const activeCols = stdCols.filter((c) => !c._delete)
    const valid = activeCols.filter((c) => c.label.trim())
    if (!valid.length) { setSaveError('Sheet must have at least one column.'); return }
    setSaveState('saving'); setSaveError('')
    try {
      const renames = activeCols.filter((c) => c.originalLabel && c.originalLabel !== c.label.trim()).map(c => ({ old: c.originalLabel, new: c.label.trim() }))
      const res = await fetch(`/api/collections/${selectedColId}/structure`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          standardColumns: valid.map((c, i) => ({ label: c.label.trim(), order: i })),
          renames,
          sheetName: selectedSheetName,
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setSaveState('saved')
      setCollections((prev) => prev.map((c) => c._id === selectedColId ? data.collection : c))
      // Refresh local sheet column list
      const updatedSheet = data.collection?.sheets?.find((s) => s.name === selectedSheetName)
      if (updatedSheet?.standardColumns) {
        setStdCols(updatedSheet.standardColumns.map((c, i) => ({ label: c.label, originalLabel: c.label, id: i, tag: c.tag })))
      }
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (err) { setSaveError(err.message); setSaveState('idle') }
  }

  // --- Deletion handlers ---
  const selectedColName = selectedCollection?.name || ''

  async function confirmDelete() {
    if (confirmName !== selectedColName) {
      setDeleteError('Workbook name does not match.')
      return
    }
    setDeleteError('')
    try {
      const res = await fetch(`/api/collections/${selectedColId}?deleteRef=${deleteRefChecked}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setCollections(prev => prev.filter(c => c._id !== selectedColId))
      
      const empId = localStorage.getItem('collectionAssistEmployeeId') || sessionStorage.getItem('collectionAssistEmployeeId') || 'unknown'
      const storageKey = `lastViewedCases_${empId}`
      try {
        const prefs = JSON.parse(localStorage.getItem(storageKey))
        if (prefs && prefs.colId === selectedColId) {
          localStorage.removeItem(storageKey)
          window.dispatchEvent(new Event('prefsChanged'))
        }
      } catch (e) {}

      setSelectedColId('')
      setSelectedSheetName('')
      setStdCols([])
      setDeleteModal(false)
      setConfirmName('')
      setDeleteRefChecked(false)
    } catch (err) {
      setDeleteError(err.message)
    }
  }

  async function handleRenameWorkbook() {
    if (!renameWbName.trim()) { setRenameWbError('Name is required'); return }
    try {
      const res = await fetch(`/api/collections/${selectedColId}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''}` },
        body: JSON.stringify({ newName: renameWbName })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setCollections(prev => prev.map(c => c._id === selectedColId ? { ...c, name: renameWbName.trim() } : c))
      setRenameWbModal(false)
    } catch (err) {
      setRenameWbError(err.message)
    }
  }

  async function handleRenameSheet() {
    if (!renameSheetName.trim()) { setRenameSheetError('Name is required'); return }
    try {
      const res = await fetch(`/api/collections/${selectedColId}/sheet/${selectedSheetName}/rename`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''}` },
        body: JSON.stringify({ newName: renameSheetName })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setCollections(prev => prev.map(c => {
        if (c._id !== selectedColId) return c
        const updatedSheets = c.sheets.map(s => s.name === selectedSheetName ? { ...s, name: renameSheetName.trim() } : s)
        return { ...c, sheets: updatedSheets }
      }))
      setSelectedSheetName(renameSheetName.trim())
      setRenameSheetModal(false)
    } catch (err) {
      setRenameSheetError(err.message)
    }
  }

  async function confirmDeleteSheet() {
    if (confirmSheetName !== selectedSheetName) {
      setDeleteSheetError('Sheet name does not match.')
      return
    }
    setDeleteSheetError('')
    try {
      const res = await fetch(`/api/collections/${selectedColId}/sheets/${encodeURIComponent(selectedSheetName)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setCollections(prev => prev.map(c => c._id === selectedColId ? data.collection : c))
      
      const empId = localStorage.getItem('collectionAssistEmployeeId') || sessionStorage.getItem('collectionAssistEmployeeId') || 'unknown'
      const storageKey = `lastViewedCases_${empId}`
      try {
        const prefs = JSON.parse(localStorage.getItem(storageKey))
        if (prefs && prefs.colId === selectedColId && prefs.sheetName === selectedSheetName) {
          localStorage.removeItem(storageKey)
          window.dispatchEvent(new Event('prefsChanged'))
        }
      } catch (e) {}

      setSelectedSheetName('')
      setStdCols([])
      setDeleteSheetModal(false)
      setConfirmSheetName('')
    } catch (err) {
      setDeleteSheetError(err.message)
    }
  }

  async function handleManualBackup() {
    if (!manualBackupNote.trim()) return

    setManualBackupLoading(true)
    setBackupError('')
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const res = await fetch(`/api/backups/manual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ collectionId: selectedColId, note: manualBackupNote })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Backup failed')
      setBackupMessage('Manual backup created successfully.')
      setManualBackupModal(false)
      setTimeout(() => setBackupMessage(''), 3000)
    } catch (err) {
      setBackupError(err.message)
    } finally {
      setManualBackupLoading(false)
    }
  }

  return (
    <div className="admin-content">
      <div className="admin-heading">
        <div>
          <span className="eyebrow">STRUCTURE MANAGEMENT</span>
          <h1>Workbooks</h1>
          <p>Select a workbook, then pick a sheet to reorder, rename, add, or remove its columns. Changes regenerate the output Excel.</p>
        </div>
      </div>
      <section className="panel" style={{ marginTop: 24, padding: 22 }}>
        {/* Step 1: Select workbook */}
        <label className="form-label">Select Workbook
            <select value={selectedColId} onChange={(e) => handleColChange(e.target.value)} disabled={loadingCollections} className={loadingCollections ? 'select-loading' : ''}>
              {loadingCollections
                ? <option value="">Fetching workbooks…</option>
                : collectionsError
                  ? <option value="">Server is unreachable</option>
                  : collections.length === 0
                    ? <option value="">No workbooks available</option>
                    : <>
                      <option value="">— select —</option>
                      {collections.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </>
              }
            </select>
        </label>

        {/* Workbook Actions */}
        {selectedColId && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, paddingBottom: 16 }}>
              <a className="primary-button" style={{ background: downloadProgress !== null ? `linear-gradient(to right, #419b74 ${downloadProgress}%, #5cce9d ${downloadProgress}%)` : '#5cce9d', color: '#08201d', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', boxSizing: 'border-box', cursor: downloadProgress !== null ? 'wait' : 'pointer', pointerEvents: downloadProgress !== null ? 'none' : 'auto' }} onClick={(e) => {
                e.preventDefault();
                if (downloadProgress === null) downloadWb(selectedColId);
              }}>
                <Icon name="download" size={14} /> {downloadProgress !== null ? `Downloading... ${downloadProgress}%` : 'Download Workbook'}
              </a>
              <button className="outlined-button" style={{ color: '#419b74', borderColor: '#419b74' }} onClick={() => {
                setManualBackupNote('Manual backup')
                setBackupError('')
                setManualBackupModal(true)
              }}>
                <Icon name="copy" size={14} /> Manual Backup
              </button>
              <button className="outlined-button" style={{ color: '#e8c480', borderColor: '#8a6e4b' }} onClick={() => {
                setRenameWbName(selectedCollection?.name || '')
                setRenameWbError('')
                setRenameWbModal(true)
              }}>
                <Icon name="pencil" size={14} /> Rename Workbook
              </button>
              <button className="outlined-button" style={{ borderColor: '#8a4b4b', color: '#e88080' }} onClick={() => setDeleteModal(true)}>
                <Icon name="trash" size={14} /> Delete Workbook
              </button>
            </div>
            {backupMessage && <p style={{ color: '#419b74', fontSize: '13px', margin: '0 0 16px 0' }}>{backupMessage}</p>}
            {backupError && <p style={{ color: '#e88080', fontSize: '13px', margin: '0 0 16px 0' }}>{backupError}</p>}
            <div style={{ borderBottom: '1px solid #252525', marginBottom: 24 }}></div>
          </div>
        )}

        {/* Step 2: Select sheet within the workbook */}
        {selectedColId && (
          <div style={{ marginTop: 24 }}>
            <label className="form-label">Select sheet to configure
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <select value={selectedSheetName} onChange={(e) => handleSheetChange(e.target.value)} style={{ flex: 1 }}>
                  <option value="">— select sheet —</option>
                  {availableSheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
                {selectedSheetName && (
                  <>
                    <button className="outlined-button" style={{ borderColor: '#8a6e4b', color: '#e8c480' }} onClick={() => {
                      setRenameSheetName(selectedSheetName)
                      setRenameSheetError('')
                      setRenameSheetModal(true)
                    }}>
                      <Icon name="pencil" size={14} /> Rename Sheet
                    </button>
                    <button className="outlined-button" style={{ borderColor: '#8a4b4b', color: '#e88080' }} onClick={() => setDeleteSheetModal(true)}>
                      <Icon name="trash" size={14} /> Delete Sheet
                    </button>
                  </>
                )}
              </div>
            </label>
          </div>
        )}

        {selectedColId && selectedSheetName && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24, borderBottom: '1px solid #252525', paddingBottom: 16 }}>
            <button className={mode === 'structure' ? 'primary-button' : 'outlined-button'} onClick={() => setMode('structure')}>Structure Management</button>
            <button className={mode === 'tagging' ? 'primary-button' : 'outlined-button'} onClick={() => setMode('tagging')}>Tagging</button>
            <button className={mode === 'data' ? 'primary-button' : 'outlined-button'} onClick={() => setMode('data')}>Bulk Entry</button>
          </div>
        )}

        {/* Step 3: Edit sheet columns */}
        {selectedColId && selectedSheetName && mode === 'structure' && (
          <div style={{ marginTop: 20 }}>
            {stdCols.length === 0 && (
              <p style={{ color: '#777777', fontSize: 12, margin: '0 0 14px' }}>
                No columns defined for this sheet yet. Add columns below to set the structure.
              </p>
            )}
            <div className="std-col-list">
              {/* Subtle Add Button at the very top */}
              {stdCols.length > 0 && (
                <div
                  className="subtle-add-row"
                  style={{
                    height: 12,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    margin: '-4px 0'
                  }}
                >
                  <div
                    title="Insert column here"
                    onClick={(e) => {
                      e.stopPropagation()
                      const newCols = [...stdCols]
                      newCols.unshift({ label: '', id: Date.now() })
                      setStdCols(newCols)
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = 0.2}
                    style={{ opacity: 0.2, transition: 'opacity 0.2s', cursor: 'pointer', background: '#5cce9d', color: '#08201d', borderRadius: '50%', width: 14, height: 14, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <Icon name="plus" size={10} />
                  </div>
                </div>
              )}
              {(() => {
                let count = 0;
                return stdCols.map((col, idx) => {
                  const isDeleted = col._delete;
                  if (!isDeleted) count++;
                  return (
                    <React.Fragment key={col.id}>
                      <div
                        className={`std-col-row ${draggedIdx === idx ? 'dragging' : ''}`}
                        style={isDeleted ? { gridTemplateColumns: 'auto auto 1fr auto', opacity: 0.5 } : { gridTemplateColumns: 'auto auto 1fr auto' }}
                        draggable={!isDeleted}
                        onMouseDown={(e) => {
                          dragTargetRef.current = !!e.target.closest('.drag-handle');
                        }}
                        onDragStart={!isDeleted ? (e) => {
                          if (!dragTargetRef.current) {
                            e.preventDefault();
                            return;
                          }
                          onDragStart(e, idx);
                        } : undefined}
                        onDragOver={(e) => onDragOver(e, isDeleted ? null : idx)}
                        onDragEnd={!isDeleted ? onDragEnd : undefined}
                      >
                        <div className="drag-handle" style={{ color: '#50708c', display: 'flex', alignItems: 'center', cursor: isDeleted ? 'default' : 'grab', visibility: isDeleted ? 'hidden' : 'visible' }}>
                          <Icon name="drag" size={16} />
                        </div>
                        <span className="std-col-num">{isDeleted ? '' : count}</span>
                        <input className="std-col-label" value={col.label} onChange={(e) => setStdCols((p) => p.map((c) => c.id === col.id ? { ...c, label: e.target.value } : c))} placeholder="Column name" style={isDeleted ? { textDecoration: 'line-through', opacity: 0.7 } : {}} disabled={isDeleted} />
                        <button className="icon-button filter-remove" title={isDeleted ? "Restore column" : "Delete column"} onClick={() => setStdCols((p) => p.map((c) => c.id === col.id ? { ...c, _delete: !c._delete } : c))}><Icon name={isDeleted ? "undo" : "trash"} size={14} /></button>
                      </div>

                      {/* Subtle Add Button */}
                      {!isDeleted && (
                        <div
                          className="subtle-add-row"
                          style={{
                            height: 12,
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            margin: '-4px 0'
                          }}
                        >
                          <div
                            title="Insert column here"
                            onClick={(e) => {
                              e.stopPropagation()
                              const newCols = [...stdCols]
                              newCols.splice(idx + 1, 0, { label: '', id: Date.now() })
                              setStdCols(newCols)
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                            onMouseLeave={(e) => e.currentTarget.style.opacity = 0.2}
                            style={{ opacity: 0.2, transition: 'opacity 0.2s', cursor: 'pointer', background: '#5cce9d', color: '#08201d', borderRadius: '50%', width: 14, height: 14, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <Icon name="plus" size={10} />
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  )
                })
              })()}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>

              <button className="primary-button" disabled={saveState === 'saving'} onClick={save} style={{ flex: 1, ...(saveState === 'saved' ? { background: '#5cce9d', color: '#08201d' } : {}) }}>{saveState === 'saving' ? 'Tagging via AI & Saving…' : saveState === 'saved' ? 'Saved & Regenerated!' : 'Save & Regenerate Excel'}</button>
              <a className="primary-button" style={{ background: downloadProgress !== null ? `linear-gradient(to right, #419b74 ${downloadProgress}%, #5cce9d ${downloadProgress}%)` : '#5cce9d', color: '#08201d', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', boxSizing: 'border-box', cursor: downloadProgress !== null ? 'wait' : 'pointer', pointerEvents: downloadProgress !== null ? 'none' : 'auto' }} onClick={(e) => {
                e.preventDefault();
                if (downloadProgress === null) downloadWb(selectedColId);
              }}>
                <Icon name="download" size={14} /> {downloadProgress !== null ? `Downloading... ${downloadProgress}%` : 'Download'}
              </a>
            </div>
          </div>
        )}

        {/* Tagging Management mode */}
        {selectedColId && selectedSheetName && mode === 'tagging' && (
          <TaggingManagement collectionId={selectedColId} sheetName={selectedSheetName} availableColumns={availableSheets.find((s) => s.name === selectedSheetName)?.standardColumns ?? []} setCollections={setCollections} />
        )}

        {/* Data Management mode */}
        {selectedColId && selectedSheetName && mode === 'data' && (
          <DataManagement collectionId={selectedColId} sheetName={selectedSheetName} availableColumns={availableSheets.find((s) => s.name === selectedSheetName)?.standardColumns ?? []} />
        )}
      </section>

      {/* Rename Workbook Modal */}
      {renameWbModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setRenameWbModal(false)}>
          <div className="modal">
            <button className="close-button" onClick={() => setRenameWbModal(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#e8c480' }}>WORKBOOK CONFIGURATION</span>
            <h2>Rename workbook</h2>
            <p>Change the name of <strong>{selectedColName}</strong>.</p>
            <div style={{ marginTop: 22 }}>
              <label className="form-label">New Name
                <input
                  type="text"
                  value={renameWbName}
                  onChange={e => setRenameWbName(e.target.value)}
                  style={{ marginTop: 8 }}
                />
              </label>

              {renameWbError && <p style={{ color: '#e88080', fontSize: 13, marginTop: 10 }}>{renameWbError}</p>}

              <button
                className="primary-button"
                style={{ width: '100%', marginTop: 16 }}
                onClick={handleRenameWorkbook}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Sheet Modal */}
      {renameSheetModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setRenameSheetModal(false)}>
          <div className="modal">
            <button className="close-button" onClick={() => setRenameSheetModal(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#e8c480' }}>SHEET CONFIGURATION</span>
            <h2>Rename sheet</h2>
            <p>Change the name of sheet <strong>{selectedSheetName}</strong>.</p>
            <div style={{ marginTop: 22 }}>
              <label className="form-label">New Name
                <input
                  type="text"
                  value={renameSheetName}
                  onChange={e => setRenameSheetName(e.target.value)}
                  style={{ marginTop: 8 }}
                />
              </label>

              {renameSheetError && <p style={{ color: '#e88080', fontSize: 13, marginTop: 10 }}>{renameSheetError}</p>}

              <button
                className="primary-button"
                style={{ width: '100%', marginTop: 16 }}
                onClick={handleRenameSheet}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteModal(false)}>
          <div className="modal">
            <button className="close-button" onClick={() => setDeleteModal(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#e88080' }}>DANGER ZONE</span>
            <h2>Delete workbook</h2>
            <p>This will permanently delete the workbook <strong>{selectedColName}</strong> and all of its associated cases and data. This cannot be undone.</p>
            <div style={{ marginTop: 22 }}>
              {selectedCollection?.isReference && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
                  <input style={{ marginTop: 4 }} type="checkbox" checked={deleteRefChecked} onChange={(e) => setDeleteRefChecked(e.target.checked)} />
                  <span style={{ lineHeight: 1.4 }}>Delete the corresponding reference file</span>
                </label>
              )}
              <label style={{ display: 'block' }}>Type <strong>{selectedColName}</strong> to confirm
                <input
                  type="text"
                  value={confirmName}
                  onChange={e => setConfirmName(e.target.value)}
                  placeholder={selectedColName}
                  style={{ marginTop: 8 }}
                />
              </label>

              <button
                className="primary-button"
                style={{ background: '#a13b3b', color: '#fff', width: '100%', marginTop: 16 }}
                onClick={confirmDelete}
                disabled={confirmName !== selectedColName}
              >
                Permanently delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Sheet Confirmation Modal */}
      {deleteSheetModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteSheetModal(false)}>
          <div className="modal">
            <button className="close-button" onClick={() => setDeleteSheetModal(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#e8c480' }}>DANGER ZONE</span>
            <h2>Delete sheet</h2>
            <p>This will permanently delete the sheet <strong>{selectedSheetName}</strong> and all of its associated cases and data. This cannot be undone.</p>
            <div style={{ marginTop: 22 }}>
              <label style={{ display: 'block' }}>Type <strong>{selectedSheetName}</strong> to confirm
                <input
                  type="text"
                  value={confirmSheetName}
                  onChange={e => setConfirmSheetName(e.target.value)}
                  placeholder={selectedSheetName}
                  style={{ marginTop: 8 }}
                />
              </label>

              <button
                className="primary-button"
                style={{ background: '#a1813b', color: '#fff', width: '100%', marginTop: 16 }}
                onClick={confirmDeleteSheet}
                disabled={confirmSheetName !== selectedSheetName}
              >
                Permanently delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Manual Backup Modal */}
      {manualBackupModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setManualBackupModal(false)}>
          <div className="modal">
            <button className="close-button" onClick={() => setManualBackupModal(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#419b74' }}>SYSTEM</span>
            <h2>Manual Backup</h2>
            <p>Create a backup of <strong>{selectedColName}</strong>.</p>
            <div style={{ marginTop: 22 }}>
              <label className="form-label">Backup Note
                <input
                  type="text"
                  value={manualBackupNote}
                  onChange={e => setManualBackupNote(e.target.value)}
                  placeholder="e.g. Manual backup before big change"
                  style={{ marginTop: 8 }}
                  maxLength={150}
                />
              </label>

              <button
                className="primary-button"
                style={{ background: '#419b74', color: '#fff', width: '100%', marginTop: 16 }}
                onClick={handleManualBackup}
                disabled={!manualBackupNote.trim() || manualBackupLoading}
              >
                {manualBackupLoading ? 'Creating backup...' : 'Create Backup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {(backupMessage || fetchError || saveError || deleteError || deleteSheetError || backupError || downloadError) && (
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
          {backupMessage && <><Icon name="check" size={16} style={{ color: '#5cce9d' }} /><span style={{ color: '#5cce9d', fontSize: 13, fontWeight: 600 }}>{backupMessage}</span></>}
          {(fetchError || saveError || deleteError || deleteSheetError || backupError || downloadError) && <><Icon name="close" size={16} style={{ color: '#e88080' }} /><span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{fetchError || saveError || deleteError || deleteSheetError || backupError || downloadError}</span></>}
        </div>
      )}

    </div>
  )
}
