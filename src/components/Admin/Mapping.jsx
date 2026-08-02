import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../Shared.jsx'
import { useDragSort } from './useDragSort.js'
import { useDownloadWorkbook } from '../../hooks/useDownloadWorkbook.js'

export function Mapping() {
  const { download: downloadWb, progress: downloadProgress } = useDownloadWorkbook()
  const location = useLocation()
  const navigate = useNavigate()
  const ctx = location.state

  const [collection, setCollection]   = useState(null)
  const [stdCols, setStdCols]         = useState([])
  const [genState, setGenState]       = useState('idle')
  const [genError, setGenError]       = useState('')
  const [genResult, setGenResult]     = useState(ctx?.genResult || null)
  const nextOrder = useRef(0)
  const dragTargetRef = useRef(false)

  const { draggedIdx, onDragStart, onDragOver, onDragEnd } = useDragSort(setStdCols)

  useEffect(() => {
    if (!ctx?.collectionId) return
    fetch(`/api/collections/${ctx.collectionId}`).then((r) => r.json()).then((d) => {
      setCollection(d.collection)
      const targetSheetName = ctx.targetSheetName || 'Sheet1'
      const sheet = d.collection.sheets?.find(s => s.name === targetSheetName)
      
      if (sheet && sheet.standardColumns?.length && !ctx.isNewSheet) {
        const existing = sheet.standardColumns.map((sc) => {
          const m = sheet.lastMapping?.find((map) => map.standardLabel === sc.label)
          const isCustom = m?.customText != null
          return { label: sc.label, order: sc.order, sourceColumn: isCustom ? '__CUSTOM__' : (ctx.sourceColumns?.find((c) => c === m?.sourceColumn) ?? ''), customText: m?.customText || '' }
        })
        setStdCols(existing)
        nextOrder.current = Math.max(0, ...existing.map((c) => c.order)) + 1
      } else {
        if (ctx.sourceColumns?.length) {
          const auto = ctx.sourceColumns.map((col, i) => ({ label: col, order: i, sourceColumn: col, customText: '' }))
          setStdCols(auto)
          nextOrder.current = auto.length
        }
      }
    }).catch(() => {})
  }, [ctx?.collectionId])

  function handleDone() {
    navigate('/admin/upload')
  }

  if (!ctx) return <div className="admin-content"><div className="empty-state" style={{ marginTop: 60 }}><Icon name="mapping" size={36} /><p>No import in progress.</p><small>Upload and import a lot first to map its columns.</small></div></div>

  async function generate() {
    const activeCols = stdCols.filter((c) => !c._delete)
    const validCols = activeCols.filter((c) => c.label.trim())
    if (!validCols.length) { setGenError('Add at least one standard column.'); return }
    setGenState('generating'); setGenError('')
    try {
      const res  = await fetch(`/api/collections/${ctx.collectionId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tempId: ctx.tempId, 
          newCaseIds: ctx.newCaseIds, 
          sheetName: ctx.targetSheetName || 'Sheet1',
          isNewWorkbook: ctx.colMode === 'new',
          standardColumns: validCols.map((c, i) => ({ label: c.label.trim(), order: i })), 
          mapping: validCols.filter((c) => c.sourceColumn).map((c) => ({ 
            sourceColumn: c.sourceColumn === '__CUSTOM__' || c.sourceColumn === '__CUSTOM_DATE__' ? '' : c.sourceColumn, 
            customText: c.sourceColumn === '__CUSTOM__' || c.sourceColumn === '__CUSTOM_DATE__' ? (c.customText || '') : undefined, 
            isCustomDate: c.sourceColumn === '__CUSTOM_DATE__',
            standardLabel: c.label.trim() 
          })) 
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

            {(newAdded != null || sheetTotal != null) && (
              <p style={{ margin: '10px 0 24px', fontSize: 13, color: '#777777' }}>
                {newAdded != null && (
                  <><em style={{ fontStyle: 'normal', color: '#252525', fontWeight: 700 }}>{newAdded}</em> new cases added</>
                )}
                {newAdded != null && sheetTotal != null && <>&nbsp;·&nbsp;</>}
                {sheetTotal != null && (
                  <><em style={{ fontStyle: 'normal', color: '#cccccc' }}>{sheetTotal}</em> total in sheet</>
                )}
              </p>
            )}
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

  return (
    <div className="admin-content">
      <div className="admin-heading">
        <div><span className="eyebrow">COLUMN MAPPING · {ctx.collectionName}</span><h1>Map columns for import</h1></div>
        <button className="outlined-button" onClick={handleDone}>← Back</button>
      </div>
      <section className="panel std-cols-panel" style={{ marginTop: 20 }}>
        <div className="panel-heading">
          <div><h2>Standard columns</h2><p>Drag to reorder. Map each column to a source column from the uploaded file.</p></div>
        </div>
        <div className="std-col-list">
          {/* Subtle Add Button at the very top */}
          {stdCols.length > 0 && (
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
                  const newCols = [...stdCols]
                  newCols.unshift({ label: '', sourceColumn: '', order: Date.now() })
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
                    onDragOver={!isDeleted ? (e) => onDragOver(e, idx) : undefined}
                    onDragEnd={!isDeleted ? onDragEnd : undefined}
                  >
                    {/* Drag handle */}
                    <div className="drag-handle" style={{ color: '#50708c', display: 'flex', alignItems: 'center', cursor: isDeleted ? 'default' : 'grab', visibility: isDeleted ? 'hidden' : 'visible' }}>
                      <Icon name="drag" size={16} />
                    </div>
                    <span className="std-col-num">{isDeleted ? '' : count}</span>
                    <input
                      className="std-col-label"
                      value={col.label}
                      onChange={(e) => setStdCols((p) => p.map((c) => c.order === col.order ? { ...c, label: e.target.value } : c))}
                      placeholder="Column name"
                      style={isDeleted ? { textDecoration: 'line-through', opacity: 0.7 } : {}}
                      disabled={isDeleted}
                    />
                    <span className="mapping-arrow">←</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, opacity: isDeleted ? 0.5 : 1, pointerEvents: isDeleted ? 'none' : 'auto' }}>
                      <select
                        className={`std-col-source ${!col.sourceColumn && !isDeleted ? 'unmapped' : ''}`}
                        value={col.sourceColumn}
                        onChange={(e) => setStdCols((p) => p.map((c) => c.order === col.order ? { ...c, sourceColumn: e.target.value } : c))}
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
                          onChange={(e) => setStdCols((p) => p.map((c) => c.order === col.order ? { ...c, customText: e.target.value } : c))}
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
                          onChange={(e) => setStdCols((p) => p.map((c) => c.order === col.order ? { ...c, customText: e.target.value } : c))}
                          style={{ flex: '1 1 0' }}
                          disabled={isDeleted}
                        />
                      )}
                    </div>
                    <button className="icon-button filter-remove" title={isDeleted ? "Restore column" : "Delete column"} onClick={() => setStdCols((p) => p.map((c) => c.order === col.order ? { ...c, _delete: !c._delete } : c))}>
                      <Icon name={isDeleted ? "undo" : "trash"} size={14} />
                    </button>
                  </div>
                  
                  {/* Subtle Add Button */}
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
                          const newCols = [...stdCols]
                          newCols.splice(idx + 1, 0, { label: '', sourceColumn: '', order: Date.now() })
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
        {genError && <p className="form-error" style={{ margin: '12px 0 0' }}>{genError}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="outlined-button" onClick={() => setStdCols((p) => [...p, { label: '', order: nextOrder.current++, sourceColumn: '' }])}>
            <Icon name="plus" size={14} /> Add column
          </button>
          <button className="primary-button" disabled={genState === 'generating' || !stdCols.some((c) => c.label)} onClick={generate} style={{ flex: 1 }}>
            {genState === 'generating' ? 'Generating…' : 'Generate Excel & finish'}
          </button>
        </div>
      </section>
    </div>
  )
}
