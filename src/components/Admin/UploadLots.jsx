import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../Shared.jsx'

function createSheetEntry(firstSheetName) {
  return {
    id: Date.now() + Math.random(),
    selectedSheet: firstSheetName || '',
    keyCol: '',
    targetSheetName: 'Sheet1',
    isNewTargetSheet: false,
    filters: [],
  }
}

export function UploadLots() {
  const navigate = useNavigate()
  const [dragOver, setDragOver] = useState(false)
  const [uploadState, setUploadState] = useState('idle')
  const [uploadError, setUploadError] = useState('')
  const [preview, setPreview] = useState(null)
  const [collections, setCollections] = useState([])
  const [colMode, setColMode] = useState('new')
  const currentMonthName = new Date().toLocaleString('default', { month: 'long' })
  const [newColName, setNewColName] = useState('')
  const [newColMonth, setNewColMonth] = useState(currentMonthName)
  const [newColYear, setNewColYear] = useState(new Date().getFullYear())
  const [existingColId, setExistingColId] = useState('')
  const [importState, setImportState] = useState('idle')
  const [importError, setImportError] = useState('')
  const [loadingCollections, setLoadingCollections] = useState(true)
  const [collectionsError, setCollectionsError] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const fileInputRef = useRef(null)

  // Multi-sheet entries: each has its own source sheet, target sheet, and filters
  const [sheetEntries, setSheetEntries] = useState([])
  const [matchCounts, setMatchCounts] = useState({}) // { [entryId]: number | null }
  const [isCounting, setIsCounting] = useState(false)

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

  // Debounced count fetch for each sheet entry
  useEffect(() => {
    if (!preview?.tempId || uploadState !== 'done' || sheetEntries.length === 0) {
      setMatchCounts({})
      return
    }
    const tid = setTimeout(async () => {
      setIsCounting(true)
      const results = {}
      await Promise.all(sheetEntries.map(async (entry) => {
        try {
          const payload = {
            tempId: preview.tempId,
            sheet: entry.selectedSheet,
            filters: entry.filters.filter(f => f.col).map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })),
            collectionId: colMode === 'existing' ? existingColId : null,
            targetSheetName: !entry.isNewTargetSheet ? entry.targetSheetName : null,
            keyCol: entry.keyCol
          }
          const res = await fetch('/api/lots/import-count', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          })
          const data = await res.json()
          if (res.ok) results[entry.id] = data
        } catch { /* ignore */ }
      }))
      setMatchCounts(results)
      setIsCounting(false)
    }, 350)
    return () => clearTimeout(tid)
  }, [sheetEntries, colMode, existingColId, preview?.tempId, uploadState])

  const isLoading = uploadState === 'uploading'
  const isDone = uploadState === 'done'
  const isError = uploadState === 'error'

  function getSheetData(sheetName) {
    if (!preview) return { columns: [], columnUniqueValues: {} }
    return preview.perSheetData?.[sheetName] ?? { columns: preview.columns ?? [], columnUniqueValues: preview.columnUniqueValues ?? {} }
  }

  async function handleFile(file) {
    if (!file) return
    setUploadState('uploading'); setUploadError(''); setPreview(null)
    setSheetEntries([]); setImportState('idle'); setImportError('')
    const form = new FormData(); form.append('file', file)
    try {
      const res = await fetch('/api/lots/preview', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Preview failed.')
      setPreview(data)
      const firstSheet = data.sheets?.[0] ?? ''
      setSheetEntries([createSheetEntry(firstSheet)])
      setUploadState('done')
    } catch (err) {
      setUploadError(err.message === 'Failed to fetch' ? 'Cannot reach the server.' : err.message)
      setUploadState('error')
    }
  }

  function resetUpload() {
    setUploadState('idle'); setPreview(null)
    setSheetEntries([]); setUploadError(''); setImportState('idle'); setImportError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function addSheetEntry() {
    const firstSheet = preview?.sheets?.[0] ?? ''
    setSheetEntries(prev => [...prev, createSheetEntry(firstSheet)])
  }

  function removeSheetEntry(id) {
    setSheetEntries(prev => prev.filter(e => e.id !== id))
  }

  function updateSheetEntry(id, changes) {
    setSheetEntries(prev => prev.map(e => e.id === id ? { ...e, ...changes } : e))
  }

  async function doImport() {
    if (!preview?.tempId || sheetEntries.length === 0) return
    setImportState('importing'); setImportError('')

    let collectionId
    let collectionName
    try {
      if (colMode === 'new') {
        if (!newColName.trim()) { setImportError('Enter a name for the new workbook.'); setImportState('error'); return }
        const fullWorkbookName = `${newColName.trim()} ${newColMonth} ${newColYear}`
        const res = await fetch('/api/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fullWorkbookName, month: newColMonth, year: newColYear }) })
        const data = await res.json()
        if (!res.ok) throw new Error(data.message)
        collectionId = data.collection._id
        collectionName = data.collection.name
        setCollections((prev) => [...prev, data.collection])
        setExistingColId(data.collection._id)
      } else {
        if (!existingColId) { setImportError('Select an existing workbook.'); setImportState('error'); return }
        collectionId = existingColId
        collectionName = collections.find((c) => c._id === existingColId)?.name ?? ''
      }
    } catch (err) { setImportError(err.message); setImportState('error'); return }

    // Sequentially import each sheet entry
    const importSummaries = []
    const allNewCaseIds = []
    const targetSheetNames = []
    const allSourceCols = new Set()
    let firstEntry = null
    
    for (let i = 0; i < sheetEntries.length; i++) {
      const entry = sheetEntries[i]
      if (!entry.targetSheetName.trim()) continue
      targetSheetNames.push(entry.targetSheetName.trim())
      
      const addingNewSheetToExisting = colMode === 'existing' && entry.isNewTargetSheet
      const sheetData = getSheetData(entry.selectedSheet)
      sheetData.columns.forEach(c => allSourceCols.add(c))
      try {
        const res = await fetch('/api/lots/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tempId: preview.tempId,
            collectionId,
            targetSheetName: entry.targetSheetName.trim(),
            sheet: entry.selectedSheet,
            filters: entry.filters.filter((f) => f.col).map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })),
            keyCol: entry.keyCol,
            isNewSheet: addingNewSheetToExisting,
            sourceColumns: addingNewSheetToExisting ? sheetData.columns : [],
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(`Sheet "${entry.targetSheetName}": ${data.message}`)
        
        console.log(`[Import] Newly imported loan numbers for sheet "${entry.targetSheetName}":`, data.importedLoanNumbers)
        
        importSummaries.push({ sheetName: entry.targetSheetName.trim(), imported: data.imported, sheetTotal: data.sheetTotal, importedLoanNumbers: data.importedLoanNumbers })
        allNewCaseIds.push(...(data.newCaseIds || []))
        if (i === 0) firstEntry = entry
      } catch (err) { setImportError(err.message); setImportState('error'); return }
    }

    setImportState('done')
    const primaryEntry = firstEntry || sheetEntries[0]
    const primarySheetData = getSheetData(primaryEntry.selectedSheet)
    const addingNewSheetToExisting = colMode === 'existing' && primaryEntry.isNewTargetSheet
    navigate('/admin/mapping', {
      state: {
        collectionId,
        collectionName,
        targetSheetNames,
        colMode,
        isNewSheet: addingNewSheetToExisting || colMode === 'new',
        tempId: preview.tempId,
        sourceColumns: Array.from(allSourceCols),
        importSummaries,
        genResult: null,
        newCaseIds: allNewCaseIds,
      }
    })
  }

  const importBtnLabel = importState === 'importing' ? 'Importing…' : 'Apply & import → map columns'

  return (
    <div className="admin-content">
      <div className="admin-heading"><div><span className="eyebrow">ALLOCATION INTAKE</span><h1>Upload new lot</h1><p>Preserve every source workbook while mapping it into your shared case format.</p></div></div>
      <section className="upload-layout" style={{ marginTop: 24 }}>
        <article className="panel upload-panel">
          <div
            className={`dropzone ${dragOver ? 'drag-over' : ''} ${isDone ? 'done' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]) }}
            onClick={() => !isLoading && fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.xlsm" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
            {isLoading && <div className="upload-loading"><span className="spin-icon"><Icon name="spinner" size={32} /></span><h2>Reading workbook…</h2></div>}
            {!isLoading && !isDone && !isError && <><div className="upload-icon"><Icon name="upload" size={24} /></div><h2>Drop the current lot here</h2><p>Excel files only · .xlsx, .xls · Max 25 MB</p><button className="outlined-button" type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>Browse files</button></>}
            {isDone && preview && <div className="upload-success"><span className="success-icon"><Icon name="check" size={22} /></span><h2>{preview.originalName}</h2><p>Fill in the details on the right, then click Import.</p><button className="outlined-button" type="button" onClick={(e) => { e.stopPropagation(); resetUpload() }}>Upload different file</button></div>}
            {isError && <div className="upload-error-state"><span className="error-icon"><Icon name="close" size={22} /></span><h2>Could not read file</h2><p>{uploadError}</p><button className="outlined-button" type="button" onClick={(e) => { e.stopPropagation(); resetUpload() }}>Try again</button></div>}
          </div>
        </article>

        <article className="panel filter-panel">
          <h2>Lot details &amp; filters</h2>

          {/* Workbook selection */}
          <div className="col-mode-toggle">
            <button className={colMode === 'new' ? 'active' : ''} onClick={() => setColMode('new')}>New workbook</button>
            <button className={colMode === 'existing' ? 'active' : ''} onClick={() => setColMode('existing')} disabled={loadingCollections || collections.length === 0}>Existing workbook</button>
          </div>
          {colMode === 'new' ? (
            <>
              <label>Workbook name</label>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <input style={{ flex: 2 }} placeholder="Enter loan provider" value={newColName} onChange={(e) => setNewColName(e.target.value)} disabled={!isDone} />
                <select style={{ flex: 1 }} value={newColMonth} onChange={(e) => setNewColMonth(e.target.value)} disabled={!isDone}>
                  {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <input style={{ flex: 1 }} type="number" value={newColYear} onChange={(e) => setNewColYear(e.target.value)} disabled={!isDone} min="2000" max="2100" />
              </div>
            </>
          ) : (
            <label>Select workbook
              <select
                value={existingColId}
                onChange={(e) => { setExistingColId(e.target.value) }}
                disabled={!isDone || loadingCollections}
                className={loadingCollections ? 'select-loading' : ''}
              >
                {loadingCollections
                  ? <option value="">Fetching workbooks…</option>
                  : collectionsError
                    ? <option value="">Server is unreachable</option>
                    : collections.length === 0
                      ? <option value="">No workbooks available</option>
                      : <>
                        <option value="">-- Select Existing Workbook --</option>
                        {collections.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                      </>
                }
              </select>
            </label>
          )}

          {/* Sheet entries */}
          {isDone && sheetEntries.map((entry, idx) => {
            const sheetData = getSheetData(entry.selectedSheet)
            const existingCollection = colMode === 'existing' ? collections.find(c => c._id === existingColId) : null

            return (
              <div key={entry.id} style={{ marginTop: 16, border: '1px solid #252525', borderRadius: 8, padding: '16px', background: '#111111', position: 'relative' }}>
                {/* Sheet header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#cccccc', flex: 1 }}>
                    Sheet {idx + 1}
                  </span>
                  {sheetEntries.length > 1 && (
                    <button type="button" className="icon-button filter-remove" onClick={() => removeSheetEntry(entry.id)} title="Remove sheet">
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </div>

                {/* Source sheet selection */}
                {(preview?.sheets?.length > 1) && (
                  <label style={{ marginBottom: 10 }}>Source Sheet
                    <select value={entry.selectedSheet} onChange={(e) => {
                      updateSheetEntry(entry.id, { selectedSheet: e.target.value, filters: [], keyCol: '' })
                    }}>
                      {preview.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                )}

                {/* Loan number column — per sheet, only columns from this entry's source sheet */}
                <label style={{ marginBottom: 10 }}>Loan number
                  <select value={entry.keyCol} onChange={(e) => updateSheetEntry(entry.id, { keyCol: e.target.value })} required>
                    <option value="">— select column —</option>
                    {sheetData.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>

                {/* Target sheet */}
                <label style={{ marginBottom: 10 }}>Target Sheet Name
                  {colMode === 'new' || !existingCollection ? (
                    <input value={entry.targetSheetName} onChange={(e) => updateSheetEntry(entry.id, { targetSheetName: e.target.value })} placeholder="e.g. Sheet1" />
                  ) : !entry.isNewTargetSheet ? (
                    <select value={entry.targetSheetName} onChange={(e) => {
                      if (e.target.value === '__NEW__') {
                        updateSheetEntry(entry.id, { isNewTargetSheet: true, targetSheetName: '' })
                      } else {
                        updateSheetEntry(entry.id, { targetSheetName: e.target.value })
                      }
                    }}>
                      <option value="">— select sheet —</option>
                      {(existingCollection.sheets || []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                      <option value="__NEW__">+ Add new sheet...</option>
                    </select>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input style={{ flex: 1 }} value={entry.targetSheetName} onChange={(e) => updateSheetEntry(entry.id, { targetSheetName: e.target.value })} placeholder="New sheet name" autoFocus />
                      <button type="button" className="icon-button" onClick={() => updateSheetEntry(entry.id, { isNewTargetSheet: false, targetSheetName: '' })}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  )}
                </label>

                {/* Row filters for this sheet */}
                <div className="filters-section">
                  <div className="filters-heading" style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#cccccc' }}>Row filters</span>
                  </div>
                  {entry.filters.length === 0 ? (
                    <p style={{ fontSize: 12, color: '#777777', marginBottom: 10 }}>No filters applied. All rows will be imported.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 10 }}>
                      {entry.filters.map((f, fi) => (
                        <div key={f.id} style={{ background: '#181818', padding: 12, borderRadius: 6, border: '1px solid #252525' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <span style={{ fontSize: 12, color: '#cccccc', fontWeight: 700 }}>Filter Column</span>
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                              <select value={f.col} onChange={(e) => updateSheetEntry(entry.id, { filters: entry.filters.map(x => x.id === f.id ? { ...x, col: e.target.value, selectedValues: new Set() } : x) })} style={{ flex: 1 }} required>
                                <option value="">— select filter column —</option>
                                {sheetData.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <button type="button" className="icon-button filter-remove" onClick={() => updateSheetEntry(entry.id, { filters: entry.filters.filter(x => x.id !== f.id) })}>
                                <Icon name="trash" size={16} />
                              </button>
                            </div>
                          </div>
                          {f.col && (
                            <div style={{ marginTop: 10 }}>
                              <span style={{ fontSize: 12, color: '#777777', display: 'block', marginBottom: 8 }}>Select values to match:</span>
                              <div style={{ maxHeight: 150, overflowY: 'auto', background: '#111111', padding: 8, borderRadius: 4, border: '1px solid #252525' }}>
                                {(sheetData.columnUniqueValues?.[f.col] ?? []).length === 0 ? <div style={{ fontSize: 12, color: '#777777' }}>No values found</div> : (
                                  (sheetData.columnUniqueValues?.[f.col] ?? []).map(val => (
                                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                                      <input type="checkbox" checked={f.selectedValues.has(val)} onChange={() => updateSheetEntry(entry.id, {
                                        filters: entry.filters.map(x => {
                                          if (x.id !== f.id) return x
                                          const newSet = new Set(x.selectedValues)
                                          if (newSet.has(val)) newSet.delete(val)
                                          else newSet.add(val)
                                          return { ...x, selectedValues: newSet }
                                        })
                                      })} />
                                      {val}
                                    </label>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="outlined-button" type="button" onClick={() => updateSheetEntry(entry.id, { filters: [...entry.filters, { id: Date.now(), col: '', selectedValues: new Set() }] })} style={{ fontSize: 12, padding: '5px 12px' }}>
                    <Icon name="plus" size={13} /> Add filter
                  </button>
                </div>

                {/* Case count for this sheet */}
                <div style={{ fontSize: 13, color: '#cccccc', marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isCounting ? (
                    <span style={{ color: '#555555' }}>Calculating cases...</span>
                  ) : matchCounts[entry.id] ? (
                    <span>
                      <strong style={{ color: '#6be2c7' }}>{matchCounts[entry.id].newCases}</strong>
                      <span style={{ color: '#777777' }}> new cases will be imported</span>
                      {colMode === 'existing' && !entry.isNewTargetSheet && matchCounts[entry.id].existingSheetCount !== undefined && (
                        <span style={{ color: '#777777' }}>
                          &nbsp;·&nbsp;<strong style={{ color: '#cccccc' }}>{matchCounts[entry.id].existingSheetCount + matchCounts[entry.id].newCases}</strong> total cases after import
                        </span>
                      )}
                    </span>
                  ) : entry.keyCol ? (
                    <span style={{ color: '#555555' }}>—</span>
                  ) : null}
                </div>
              </div>
            )
          })}

          {/* Add another sheet button */}
          {isDone && (
            <button className="outlined-button" type="button" onClick={addSheetEntry} style={{ marginTop: 12, width: '100%' }}>
              <Icon name="plus" size={13} /> Add another sheet
            </button>
          )}

          <button
            className="primary-button"
            disabled={
              !isDone ||
              sheetEntries.some(e => !e.targetSheetName.trim() || !e.keyCol) ||
              (colMode === 'new' && !newColName.trim()) ||
              (colMode === 'existing' && !existingColId) ||
              importState === 'importing' ||
              sheetEntries.length === 0 ||
              isCounting ||
              sheetEntries.some(e => matchCounts[e.id] && matchCounts[e.id].newCases === 0)
            }
            onClick={doImport}
            style={{ marginTop: 16 }}
          >
            {importBtnLabel}
          </button>
        </article>
      </section>

      {(fetchError || importError) && (
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
          <span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{fetchError || importError}</span>
        </div>
      )}
    </div>
  )
}
