import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../Shared.jsx'
import { useDragSort } from '../../hooks/useDragSort.js'
import { useDownloadWorkbook } from '../../hooks/useDownloadWorkbook.js'

export function Mapping() {
  const { download: downloadWb, progress: downloadProgress, error: downloadError } = useDownloadWorkbook()
  const location = useLocation()
  const navigate = useNavigate()
  const ctx = location.state

  const [collection, setCollection]   = useState(null)
  
  const [sheetMappings, setSheetMappings] = useState({})
  const [activeTab, setActiveTab] = useState(ctx?.targetSheetNames?.[0] || '')
  
  const [genState, setGenState]       = useState('idle')
  const [genError, setGenError]       = useState('')
  const [genResult, setGenResult]     = useState(ctx?.genResult || null)

  const [showResetPopup, setShowResetPopup] = useState(false)
  const [showCopyPopup, setShowCopyPopup] = useState(false)
  const [showGeneratePopup, setShowGeneratePopup] = useState(false)
  const [copySourceSheet, setCopySourceSheet] = useState('')

  const dragTargetRef = useRef(false)

  const activeStdCols = sheetMappings[activeTab] || []
  const setActiveStdCols = (newColsOrFn) => {
    setSheetMappings(prev => {
      const current = prev[activeTab] || []
      const updated = typeof newColsOrFn === 'function' ? newColsOrFn(current) : newColsOrFn
      return { ...prev, [activeTab]: updated }
    })
  }

  const { draggedIdx, onDragStart, onDragOver, onDragEnd } = useDragSort(setActiveStdCols)

  useEffect(() => {
    if (!ctx?.collectionId) return
    fetch(`/api/collections/${ctx.collectionId}`).then((r) => r.json()).then((d) => {
      const col = d.collection
      setCollection(col)
      
      const initialMappings = {}
      for (const targetSheetName of (ctx.targetSheetNames || [])) {
        const sheet = col.sheets?.find(s => s.name === targetSheetName)
        const isTargetNew = ctx.colMode === 'new' || !sheet
        
        if (!isTargetNew && sheet?.standardColumns?.length) {
          const existing = sheet.standardColumns.map((sc) => {
            const m = sheet.lastMapping?.find((map) => map.standardLabel === sc.label)
            const isCustom = m?.customText != null
            return { 
              label: sc.label, 
              order: sc.order, 
              sourceColumn: isCustom ? '__CUSTOM__' : (ctx.sourceColumns?.find((c) => c === m?.sourceColumn) ?? ''), 
              customText: m?.customText || '' 
            }
          })
          initialMappings[targetSheetName] = existing
        } else {
          if (ctx.sourceColumns?.length) {
            const auto = ctx.sourceColumns.map((colName, i) => ({ label: colName, order: i, sourceColumn: colName, customText: '' }))
            initialMappings[targetSheetName] = auto
          } else {
            initialMappings[targetSheetName] = []
          }
        }
      }
      setSheetMappings(initialMappings)
    }).catch(() => {})
  }, [ctx?.collectionId])

  const resetToDefault = () => {
    if (!collection) return
    const sheet = collection.sheets?.find(s => s.name === activeTab)
    const isTargetNew = ctx.colMode === 'new' || !sheet
    
    let defaultCols = []
    if (!isTargetNew && sheet?.standardColumns?.length) {
      defaultCols = sheet.standardColumns.map((sc) => {
        const m = sheet.lastMapping?.find((map) => map.standardLabel === sc.label)
        const isCustom = m?.customText != null
        return { 
          label: sc.label, 
          order: sc.order, 
          sourceColumn: isCustom ? '__CUSTOM__' : (ctx.sourceColumns?.find((c) => c === m?.sourceColumn) ?? ''), 
          customText: m?.customText || '' 
        }
      })
    } else {
      if (ctx.sourceColumns?.length) {
        defaultCols = ctx.sourceColumns.map((colName, i) => ({ label: colName, order: i, sourceColumn: colName, customText: '' }))
      }
    }
    setActiveStdCols(defaultCols)
    setShowResetPopup(false)
  }

  const copyFromSheet = () => {
    if (!copySourceSheet) return
    let copiedCols = []
    if (sheetMappings[copySourceSheet]) {
      copiedCols = sheetMappings[copySourceSheet].map((c, i) => ({ ...c, order: i }))
    } else {
      const sheet = collection?.sheets?.find(s => s.name === copySourceSheet)
      if (sheet && sheet.standardColumns) {
        copiedCols = sheet.standardColumns.map((sc, i) => {
          const m = sheet.lastMapping?.find((map) => map.standardLabel === sc.label)
          const isCustom = m?.customText != null
          return { 
            label: sc.label, 
            order: i, 
            sourceColumn: isCustom ? '__CUSTOM__' : (ctx.sourceColumns?.find((c) => c === m?.sourceColumn) ?? ''), 
            customText: m?.customText || '' 
          }
        })
      }
    }
    
    if (copiedCols.length > 0) {
      setActiveStdCols(copiedCols)
    }
    setShowCopyPopup(false)
    setCopySourceSheet('')
  }

  function handleDone() {
    navigate('/admin/upload')
  }

  if (!ctx) return <div className="admin-content"><div className="empty-state" style={{ marginTop: 60 }}><Icon name="mapping" size={36} /><p>No import in progress.</p><small>Upload and import a lot first to map its columns.</small></div></div>

  async function generate() {
    const payloadMappings = {}
    for (const sheetName of (ctx.targetSheetNames || [])) {
      const cols = sheetMappings[sheetName] || []
      const activeCols = cols.filter((c) => !c._delete)
      const validCols = activeCols.filter((c) => c.label.trim())
      if (!validCols.length) { 
        setGenError(`Add at least one standard column for sheet "${sheetName}".`); 
        return 
      }
      payloadMappings[sheetName] = {
        standardColumns: validCols.map((c, i) => ({ label: c.label.trim(), order: i })),
        mapping: validCols.filter((c) => c.sourceColumn).map((c) => ({
          sourceColumn: c.sourceColumn === '__CUSTOM__' || c.sourceColumn === '__CUSTOM_DATE__' ? '' : c.sourceColumn,
          customText: c.sourceColumn === '__CUSTOM__' || c.sourceColumn === '__CUSTOM_DATE__' ? (c.customText || '') : undefined,
          isCustomDate: c.sourceColumn === '__CUSTOM_DATE__',
          standardLabel: c.label.trim()
        }))
      }
    }

    setGenState('generating'); setGenError('')
    try {
      const res  = await fetch(`/api/collections/${ctx.collectionId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tempId: ctx.tempId, 
          newCaseIds: ctx.newCaseIds, 
          isNewWorkbook: ctx.colMode === 'new',
          isNewSheet: ctx.isNewSheet || false, // this is passed but backend generates independently per sheet now
          sheetMappings: payloadMappings
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setGenResult(data); setGenState('done')
    } catch (err) { setGenError(err.message); setGenState('done') }
  }

  if (genResult) {
    const newAdded   = ctx?.importSummary?.imported ?? null
    const sheetTotal = ctx?.importSummary?.sheetTotal ?? null
    return (
      <div className="admin-content">
        <section className="panel mapping-done">
          <div className="mapping-done-content">
            <span className="success-icon"><Icon name="check" size={24} /></span>
            <h2>Excel generated!</h2>

            {ctx?.importSummaries?.map((summary, idx) => {
              const { sheetName, imported: newAdded, sheetTotal } = summary
              if (newAdded == null && sheetTotal == null) return null
              return (
                <div key={idx} style={{ margin: '10px 0', fontSize: 13, color: '#777777' }}>
                  <strong style={{ color: '#cccccc', marginRight: 8 }}>{sheetName}:</strong>
                  {newAdded != null && (
                    <><em style={{ fontStyle: 'normal', color: '#6be2c7', fontWeight: 700 }}>{newAdded}</em> new cases added</>
                  )}
                  {newAdded != null && sheetTotal != null && <>&nbsp;·&nbsp;</>}
                  {sheetTotal != null && (
                    <><em style={{ fontStyle: 'normal', color: '#cccccc' }}>{sheetTotal}</em> total in sheet</>
                  )}
                </div>
              )
            })}
            <div style={{ marginBottom: 24 }} />
            <div className="mapping-done-actions">
              <a className="primary-button" style={{ background: downloadProgress !== null ? `linear-gradient(to right, #419b74 ${downloadProgress}%, #5cce9d ${downloadProgress}%)` : '#5cce9d', color: '#08201d', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px', boxSizing: 'border-box', cursor: downloadProgress !== null ? 'wait' : 'pointer', pointerEvents: downloadProgress !== null ? 'none' : 'auto' }} onClick={(e) => {
                e.preventDefault();
                if (downloadProgress === null) downloadWb(ctx.collectionId);
              }}>
                <Icon name="download" size={14} /> {downloadProgress !== null ? `Downloading... ${downloadProgress}%` : 'Download Excel'}
              </a>
              <button className="outlined-button" onClick={handleDone}>Upload another lot</button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  const allAvailableSheets = new Set()
  if (collection?.sheets) {
    collection.sheets.forEach(s => allAvailableSheets.add(s.name))
  }
  if (ctx?.targetSheetNames) {
    ctx.targetSheetNames.forEach(n => allAvailableSheets.add(n))
  }
  allAvailableSheets.delete(activeTab)

  return (
    <div className="admin-content">
      <div className="admin-heading">
        <div><span className="eyebrow">COLUMN MAPPING · {ctx.collectionName}</span><h1>Map columns for import</h1></div>
        <button className="outlined-button" onClick={handleDone}>← Back</button>
      </div>
      
      {(ctx.targetSheetNames?.length > 1) && (
        <div className="col-mode-toggle" style={{ marginTop: 24 }}>
          {ctx.targetSheetNames.map(sheetName => (
            <button 
              key={sheetName} 
              className={activeTab === sheetName ? 'active' : ''} 
              onClick={() => setActiveTab(sheetName)}
            >
              {sheetName}
            </button>
          ))}
        </div>
      )}

      <section className="panel std-cols-panel" style={{ marginTop: ctx.targetSheetNames?.length > 1 ? 16 : 24 }}>
        <div className="panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Standard columns - {activeTab}</h2>
            <p>Drag to reorder. Map each column to a source column from the uploaded file.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="outlined-button" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setShowCopyPopup(true)}>
              <Icon name="copy" size={12} /> Copy from...
            </button>
            <button className="outlined-button" style={{ padding: '6px 12px', fontSize: 13, color: '#e88080', borderColor: '#4a2525' }} onClick={() => setShowResetPopup(true)}>
              <Icon name="undo" size={12} /> Reset to default
            </button>
          </div>
        </div>
        
        <div className="std-col-list">
          {activeStdCols.length > 0 && (
            <div
              className="subtle-add-row"
              style={{
                height: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '-4px 0'
              }}
            >
              <div 
                title="Insert column here"
                onClick={(e) => {
                  e.stopPropagation()
                  const newCols = [...activeStdCols]
                  newCols.unshift({ label: '', sourceColumn: '', order: Date.now() })
                  setActiveStdCols(newCols)
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
            return activeStdCols.map((col, idx) => {
              const isDeleted = col._delete;
              if (!isDeleted) count++;
              return (
                <React.Fragment key={col.order}>
                  <div
                    className={`std-col-row mapping-col-row ${draggedIdx === idx ? 'dragging' : ''}`}
                    style={isDeleted ? { opacity: 0.5 } : {}}
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
                    <input
                      className="std-col-label"
                      value={col.label}
                      onChange={(e) => setActiveStdCols((p) => p.map((c) => c.order === col.order ? { ...c, label: e.target.value } : c))}
                      placeholder="Column name"
                      style={isDeleted ? { textDecoration: 'line-through', opacity: 0.7 } : {}}
                      disabled={isDeleted}
                    />
                    <span className="mapping-arrow">←</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, opacity: isDeleted ? 0.5 : 1, pointerEvents: isDeleted ? 'none' : 'auto' }}>
                      <select
                        className={`std-col-source ${!col.sourceColumn && !isDeleted ? 'unmapped' : ''}`}
                        value={col.sourceColumn}
                        onChange={(e) => setActiveStdCols((p) => p.map((c) => c.order === col.order ? { ...c, sourceColumn: e.target.value } : c))}
                        style={col.sourceColumn === '__CUSTOM__' ? { width: 'auto', flex: '0 0 auto' } : { width: '100%' }}
                        disabled={isDeleted}
                      >
                        <option value="">— source column —</option>
                        <option value="__CUSTOM__">✎ Custom text</option>
                        <option value="__CUSTOM_DATE__">📅 Custom date</option>
                        {ctx.sourceColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {col.sourceColumn === '__CUSTOM__' && (
                        <input
                          className="std-col-custom"
                          value={col.customText || ''}
                          onChange={(e) => setActiveStdCols((p) => p.map((c) => c.order === col.order ? { ...c, customText: e.target.value } : c))}
                          placeholder="Enter text"
                          style={{ flex: '1 1 0' }}
                          disabled={isDeleted}
                        />
                      )}
                      {col.sourceColumn === '__CUSTOM_DATE__' && (
                        <input
                          type="date"
                          className="std-col-custom"
                          value={col.customText || ''}
                          onChange={(e) => setActiveStdCols((p) => p.map((c) => c.order === col.order ? { ...c, customText: e.target.value } : c))}
                          style={{ flex: '1 1 0' }}
                          disabled={isDeleted}
                        />
                      )}
                    </div>
                    <button className="icon-button filter-remove" title={isDeleted ? "Restore column" : "Delete column"} onClick={() => setActiveStdCols((p) => p.map((c) => c.order === col.order ? { ...c, _delete: !c._delete } : c))}>
                      <Icon name={isDeleted ? "undo" : "trash"} size={14} />
                    </button>
                  </div>
                  
                  {!isDeleted && (
                    <div
                      className="subtle-add-row"
                      style={{
                        height: 12, display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '-4px 0'
                      }}
                    >
                      <div 
                        title="Insert column here"
                        onClick={(e) => {
                          e.stopPropagation()
                          const newCols = [...activeStdCols]
                          newCols.splice(idx + 1, 0, { label: '', sourceColumn: '', order: Date.now() })
                          setActiveStdCols(newCols)
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
      </section>

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <button className="primary-button" disabled={genState === 'generating'} onClick={() => setShowGeneratePopup(true)}>
          {genState === 'generating' ? 'Generating…' : 'Generate Excel & finish'}
        </button>
      </div>

      {(genError || downloadError) && (
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
          <Icon name="close" size={16} style={{ color: '#e88080' }} />
          <span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{genError || downloadError}</span>
        </div>
      )}

      {showResetPopup && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowResetPopup(false) }}>
          <div className="modal" style={{ maxWidth: 360, textAlign: 'left', cursor: 'default' }}>
            <button className="close-button" type="button" onClick={() => setShowResetPopup(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#e88080' }}>RESET MAPPING</span>
            <h2 style={{ marginBottom: 12 }}>Reset {activeTab}?</h2>
            <p style={{ margin: 0, color: '#888888', fontSize: 13, lineHeight: 1.5 }}>
              Are you sure you want to reset the mapping for <strong>{activeTab}</strong> to its default structure? All unsaved changes will be lost.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button type="button" className="outlined-button" onClick={() => setShowResetPopup(false)} style={{ flex: 1 }}>Cancel</button>
              <button type="button" className="primary-button" style={{ background: '#a13b3b', borderColor: '#a13b3b', flex: 1 }} onClick={resetToDefault}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {showCopyPopup && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowCopyPopup(false) }}>
          <div className="modal" style={{ maxWidth: 360, textAlign: 'left', cursor: 'default' }}>
            <button className="close-button" type="button" onClick={() => setShowCopyPopup(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#50708c' }}>COPY MAPPING</span>
            <h2 style={{ marginBottom: 12 }}>Copy into {activeTab}?</h2>
            <p style={{ margin: 0, color: '#888888', fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              Select another sheet to copy its standard columns and mapping structure into <strong>{activeTab}</strong>. Existing columns will be overwritten.
            </p>
            
            <select 
              className="fos-ptp-input" 
              style={{ width: '100%', marginBottom: 24 }} 
              value={copySourceSheet} 
              onChange={e => setCopySourceSheet(e.target.value)}
            >
              <option value="">— Select a sheet —</option>
              {Array.from(allAvailableSheets).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" className="outlined-button" onClick={() => setShowCopyPopup(false)} style={{ flex: 1 }}>Cancel</button>
              <button type="button" className="primary-button" style={{ flex: 1 }} onClick={copyFromSheet} disabled={!copySourceSheet}>
                Copy Structure
              </button>
            </div>
          </div>
        </div>
      )}

      {showGeneratePopup && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowGeneratePopup(false) }}>
          <div className="modal" style={{ maxWidth: 360, textAlign: 'left', cursor: 'default' }}>
            <button className="close-button" type="button" onClick={() => setShowGeneratePopup(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#50708c' }}>GENERATE EXCEL</span>
            <h2 style={{ marginBottom: 12 }}>Proceed with Generation?</h2>
            <p style={{ margin: 0, color: '#888888', fontSize: 13, lineHeight: 1.5 }}>
              Are you sure you want to generate the Excel file? Ensure you have verified the mapping structure for <strong>all</strong> sheets before proceeding.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button type="button" className="outlined-button" onClick={() => setShowGeneratePopup(false)} style={{ flex: 1 }}>Cancel</button>
              <button type="button" className="primary-button" style={{ flex: 1 }} onClick={() => { setShowGeneratePopup(false); generate(); }}>
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

