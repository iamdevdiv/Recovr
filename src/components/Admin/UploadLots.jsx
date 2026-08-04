import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../Shared.jsx'

export function UploadLots() {
  const navigate = useNavigate()
  const [dragOver, setDragOver] = useState(false)
  const [uploadState, setUploadState] = useState('idle')
  const [uploadError, setUploadError] = useState('')
  const [preview, setPreview] = useState(null)
  const [selectedSheet, setSelectedSheet] = useState('')
  const [filters, setFilters] = useState([])
  const [keyCol, setKeyCol] = useState('')
  const [collections, setCollections] = useState([])
  const [colMode, setColMode] = useState('new')
  const currentMonthName = new Date().toLocaleString('default', { month: 'long' })
  const [newColName, setNewColName] = useState('')
  const [newColMonth, setNewColMonth] = useState(currentMonthName)
  const [newColYear, setNewColYear] = useState(new Date().getFullYear())
  const [existingColId, setExistingColId] = useState('')
  const [targetSheetName, setTargetSheetName] = useState('Sheet1')
  const [isNewTargetSheet, setIsNewTargetSheet] = useState(false)
  const [importState, setImportState] = useState('idle')
  const [importError, setImportError] = useState('')
  const [importSummary, setImportSummary] = useState(null)
  const [matchCount, setMatchCount] = useState(null)
  const [isCounting, setIsCounting] = useState(false)
  const [existingSheetCount, setExistingSheetCount] = useState(null)
  const [loadingCollections, setLoadingCollections] = useState(true)
  const [collectionsError, setCollectionsError] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (colMode === 'existing' && existingColId && targetSheetName && !isNewTargetSheet) {
      fetch(`/api/collections/${existingColId}/sheets/${encodeURIComponent(targetSheetName)}/count`)
        .then(r => r.json())
        .then(d => setExistingSheetCount(d.count))
        .catch(console.error)
    } else {
      setExistingSheetCount(null)
    }
  }, [colMode, existingColId, targetSheetName, isNewTargetSheet])

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

  const activeSheetData = useMemo(() => {
    if (!preview) return { columns: [], columnUniqueValues: {} }
    return preview.perSheetData?.[selectedSheet] ?? { columns: preview.columns ?? [], columnUniqueValues: preview.columnUniqueValues ?? {} }
  }, [preview, selectedSheet])

  const isLoading = uploadState === 'uploading'
  const isDone = uploadState === 'done'
  const isError = uploadState === 'error'

  useEffect(() => {
    if (!preview?.tempId || !isDone) return
    const fetchCount = async () => {
      setIsCounting(true)
      try {
        const payload = {
          tempId: preview.tempId,
          sheet: selectedSheet,
          filters: filters.filter(f => f.col).map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })),
          collectionId: colMode === 'existing' ? existingColId : null,
          targetSheetName: !isNewTargetSheet ? targetSheetName : null,
          keyCol
        }
        const res = await fetch(`/api/lots/import-count`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        })
        const data = await res.json()
        if (res.ok) {
          setMatchCount(data.newCases !== undefined ? data.newCases : data.count)
        }
      } catch (err) {
        console.error('Failed to fetch count', err)
      } finally {
        setIsCounting(false)
      }
    }

    const timeoutId = setTimeout(fetchCount, 300)
    return () => clearTimeout(timeoutId)
  }, [filters, selectedSheet, preview?.tempId, isDone, colMode, existingColId, targetSheetName, isNewTargetSheet, keyCol])

  async function handleFile(file) {
    if (!file) return
    setUploadState('uploading'); setUploadError(''); setPreview(null)
    setSelectedSheet(''); setFilters([]); setImportState('idle'); setImportError(''); setKeyCol('')
    const form = new FormData(); form.append('file', file)
    try {
      const res = await fetch('/api/lots/preview', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Preview failed.')
      setPreview(data)
      const firstSheet = data.sheets?.[0] ?? ''
      setSelectedSheet(firstSheet)
      const firstCols = data.perSheetData?.[firstSheet]?.columns ?? data.columns ?? []
      const uniqueVals = data.perSheetData?.[firstSheet]?.columnUniqueValues ?? data.columnUniqueValues ?? {}
      setFilters([])
      setUploadState('done')
    } catch (err) {
      setUploadError(err.message === 'Failed to fetch' ? 'Cannot reach the server.' : err.message)
      setUploadState('error')
    }
  }

  function resetUpload() {
    setUploadState('idle'); setPreview(null); setSelectedSheet('')
    setFilters([]); setUploadError(''); setImportState('idle'); setImportError(''); setKeyCol(''); setImportSummary(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function doImport() {
    if (!preview?.tempId || !keyCol) return
    setImportState('importing'); setImportError('')

    const addingNewSheetToExisting = colMode === 'existing' && isNewTargetSheet

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
        setColMode('existing')
      } else {
        if (!existingColId) { setImportError('Select an existing workbook.'); setImportState('error'); return }
        collectionId = existingColId
        collectionName = collections.find((c) => c._id === existingColId)?.name ?? ''
      }
    } catch (err) { setImportError(err.message); setImportState('error'); return }

    try {
      const res = await fetch('/api/lots/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempId: preview.tempId,
          collectionId,
          targetSheetName: targetSheetName.trim(),
          sheet: selectedSheet,
          filters: filters.filter((f) => f.col).map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })),
          keyCol,
          isNewSheet: addingNewSheetToExisting,
          sourceColumns: addingNewSheetToExisting ? activeSheetData.columns : [],
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)

      // For all imports → go to mapping
      setImportState('done')
      navigate('/admin/mapping', {
        state: {
          collectionId,
          collectionName,
          targetSheetName: targetSheetName.trim(),
          colMode,
          isNewSheet: addingNewSheetToExisting || colMode === 'new',
          tempId: preview.tempId,
          sourceColumns: activeSheetData.columns,
          importSummary: { imported: data.imported, sheetTotal: data.sheetTotal },
          genResult: null,
          newCaseIds: data.newCaseIds,
        }
      })
    } catch (err) { setImportError(err.message); setImportState('error') }
  }

  // Determine button label
  const importBtnLabel = (() => {
    if (importState === 'importing') return 'Importing…'
    return 'Apply & import → map columns'
  })()

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

        {/* Removed inline success state, all flows go to mapping */}
        {!importSummary && (
          <article className="panel filter-panel">
            <h2>Lot details &amp; filters</h2>
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
                <label>Target Sheet Name<input value={targetSheetName} onChange={(e) => setTargetSheetName(e.target.value)} disabled={!isDone} placeholder="e.g. Sheet1" /></label>
              </>
            ) : (
              <>
                <label>Select workbook
                  <select
                    value={existingColId}
                    onChange={(e) => { setExistingColId(e.target.value); setTargetSheetName(''); setIsNewTargetSheet(false) }}
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
                {existingColId && (
                  <label>Target Sheet
                    {!isNewTargetSheet ? (
                      <select value={targetSheetName} onChange={(e) => { if (e.target.value === '__NEW__') { setIsNewTargetSheet(true); setTargetSheetName('') } else setTargetSheetName(e.target.value) }} disabled={!isDone}>
                        <option value="">— select sheet —</option>
                        {(collections.find(c => c._id === existingColId)?.sheets || []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                        <option value="__NEW__">+ Add new sheet...</option>
                      </select>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input style={{ flex: 1 }} value={targetSheetName} onChange={(e) => setTargetSheetName(e.target.value)} placeholder="New sheet name" autoFocus />
                        <button type="button" className="icon-button" onClick={() => { setIsNewTargetSheet(false); setTargetSheetName('') }}><Icon name="close" size={14} /></button>
                      </div>
                    )}
                  </label>
                )}
              </>
            )}
            {isDone && (preview?.sheets?.length > 1) && <label>Sheet<select value={selectedSheet} onChange={(e) => {
              const sheet = e.target.value;
              setSelectedSheet(sheet);
              const cols = preview.perSheetData?.[sheet]?.columns ?? preview.columns ?? [];
              const uvals = preview.perSheetData?.[sheet]?.columnUniqueValues ?? preview.columnUniqueValues ?? {};
              setFilters([]);
              setKeyCol('')
            }}>{preview.sheets.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>}
            <label>Loan number
              <select value={keyCol} onChange={(e) => setKeyCol(e.target.value)} disabled={!isDone} required>
                <option value="">— select column —</option>
                {activeSheetData.columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <div className="filters-section">
              <div className="filters-heading" style={{ marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#cccccc' }}>Row filters</span>
              </div>
              {filters.length === 0 ? (
                <p style={{ fontSize: 12, color: '#777777', marginBottom: 16 }}>No filters applied. All rows will be imported.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
                  {filters.map((f, i) => (
                    <div key={f.id} style={{ background: '#181818', padding: 16, borderRadius: 6, border: '1px solid #252525' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <span style={{ fontSize: 12, color: '#cccccc', fontWeight: 700 }}>Filter Column</span>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <select value={f.col} onChange={(e) => setFilters(p => p.map(x => x.id === f.id ? { ...x, col: e.target.value, selectedValues: new Set() } : x))} disabled={!isDone} style={{ flex: 1 }} required>
                            <option value="">— select filter column —</option>
                            {isDone && activeSheetData.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <button type="button" className="icon-button filter-remove" onClick={() => setFilters(p => p.filter(x => x.id !== f.id))}><Icon name="trash" size={16} /></button>
                        </div>
                      </div>

                      {f.col && (
                        <div style={{ marginTop: 12 }}>
                          <span style={{ fontSize: 12, color: '#777777', display: 'block', marginBottom: 8 }}>Select values to match:</span>
                          <div style={{ maxHeight: 150, overflowY: 'auto', background: '#111111', padding: 8, borderRadius: 4, border: '1px solid #252525' }}>
                            {(activeSheetData.columnUniqueValues?.[f.col] ?? []).length === 0 ? <div style={{ fontSize: 12, color: '#777777' }}>No values found</div> : (
                              (activeSheetData.columnUniqueValues?.[f.col] ?? []).map(val => (
                                <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                                  <input type="checkbox" checked={f.selectedValues.has(val)} onChange={() => setFilters(p => p.map(x => {
                                    if (x.id !== f.id) return x
                                    const newSet = new Set(x.selectedValues)
                                    if (newSet.has(val)) newSet.delete(val)
                                    else newSet.add(val)
                                    return { ...x, selectedValues: newSet }
                                  }))} />
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
              <button className="outlined-button" type="button" onClick={() => setFilters(p => [...p, { id: Date.now(), col: '', selectedValues: new Set() }])} disabled={!isDone}><Icon name="plus" size={13} /> Add filter</button>
            </div>



            {isDone && preview && (
              <div style={{ fontSize: 13, color: '#cccccc', margin: '24px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                {isCounting ? (
                  <span style={{ color: '#777777' }}>Calculating cases...</span>
                ) : (
                  <span>
                    <strong>{matchCount !== null ? matchCount : '...'}</strong> new cases will be imported.
                    {existingSheetCount !== null && matchCount !== null && (
                      <span style={{ marginLeft: 6 }}>Total cases: <strong>{existingSheetCount + matchCount}</strong></span>
                    )}
                  </span>
                )}
              </div>
            )}

            <button
              className="primary-button"
              disabled={!isDone || !keyCol || !targetSheetName.trim() || (colMode === 'new' ? !newColName.trim() : !existingColId) || importState === 'importing' || matchCount === 0}
              onClick={doImport}
              style={{ marginTop: 12 }}
            >
              {importBtnLabel}
            </button>
          </article>
        )}
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
          zIndex: 9999,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <Icon name="close" size={16} style={{ color: '#e88080' }} />
          <span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{fetchError || importError}</span>
        </div>
      )}
    </div>
  )
}
