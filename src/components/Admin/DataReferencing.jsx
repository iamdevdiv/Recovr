import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon, CaseAdditionalDetails } from '../Shared.jsx'
import { useDownloadWorkbook } from '../../hooks/useDownloadWorkbook.js'

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

export function DataReferencing() {
  const { download: downloadWb, progress: downloadProgress } = useDownloadWorkbook()
  const [collections, setCollections] = useState([])
  const [references, setReferences] = useState([])
  const [loadingCollections, setLoadingCollections] = useState(true)
  const [collectionsError, setCollectionsError] = useState(false)
  const [loadingReferences, setLoadingReferences] = useState(true)
  const [referencesError, setReferencesError] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [colId, setColId] = useState('')
  const [targetSheet, setTargetSheet] = useState('')
  const [refId, setRefId] = useState('')

  const [refFile, setRefFile] = useState(null)
  const [label, setLabel] = useState('')

  const [inputType, setInputType] = useState('reference')
  const [manualInputText, setManualInputText] = useState('')

  const [refSheet, setRefSheet] = useState('')
  const [lookup, setLookup] = useState({ targetColumn: '', refColumn: '' })
  const [dataMap, setDataMap] = useState([{ targetColumn: '', refColumn: '', customText: '' }])
  const [overwriteExisting, setOverwriteExisting] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const [mode, setMode] = useState(searchParams.get('mode') || 'apply')

  useEffect(() => {
    setSearchParams(p => { p.set('mode', mode); return p }, { replace: true })
  }, [mode, setSearchParams])

  useEffect(() => {
    if (mode !== 'move' && refId && refId === colId) {
      setRefId('')
      setRefSheet('')
      setLookup({ targetColumn: '', refColumn: '' })
    }
  }, [mode, colId, refId])
  const [selectedRefFiles, setSelectedRefFiles] = useState({})
  const [newCasesTargetCol, setNewCasesTargetCol] = useState('')
  const [newCasesMarkerText, setNewCasesMarkerText] = useState('NEW')
  const [newCasesCount, setNewCasesCount] = useState(null)
  const [updatedCasesCount, setUpdatedCasesCount] = useState(null)
  const [isCounting, setIsCounting] = useState(false)

  const [applyState, setApplyState] = useState('idle')
  const [applyMessage, setApplyMessage] = useState('')
  const [applyError, setApplyError] = useState('')

  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')

  const [deleteConfirm, setDeleteConfirm] = useState(false)

  // Move Cases state
  const [destColId, setDestColId] = useState('')
  const [destSheet, setDestSheet] = useState('')
  const [isNewDestSheet, setIsNewDestSheet] = useState(false)
  const [moveFilters, setMoveFilters] = useState([])
  const [deleteSource, setDeleteSource] = useState(true)
  const [overwriteDest, setOverwriteDest] = useState(false)
  const [moveStats, setMoveStats] = useState(null)
  const [colUniqueValues, setColUniqueValues] = useState({})

  // Preview state
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewData, setPreviewData] = useState([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [expandedPreviewCases, setExpandedPreviewCases] = useState(new Set())

  const selCol = collections.find((c) => c._id === colId)
  const selRef = references.find((r) => r._id === refId)
  const activeRefSheet = selRef?.sheets?.find(s => s.name === (refSheet || selRef?.sheets?.[0]?.name))

  const activeRefColumns = mode !== 'findNew'
    ? (activeRefSheet ? (activeRefSheet.rawColumns?.length ? activeRefSheet.rawColumns : activeRefSheet.standardColumns?.map(c => c.label) ?? []) : [])
    : (() => {
      const cols = new Set()
      Object.entries(selectedRefFiles).forEach(([id, sheetName]) => {
        const ref = references.find(r => r._id === id)
        const sheet = ref?.sheets?.find(s => s.name === sheetName)
        if (sheet) {
          const list = sheet.rawColumns?.length ? sheet.rawColumns : sheet.standardColumns?.map(c => c.label) ?? []
          list.forEach(c => cols.add(c))
        }
      })
      return Array.from(cols)
    })()

  const activeTargetSheet = targetSheet
  const activeTargetColumns = (activeTargetSheet && selCol?.sheets) ? (selCol.sheets.find(s => s.name === activeTargetSheet)?.standardColumns ?? []) : []

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
    loadRefs()
  }, [])

  async function loadRefs() {
    setLoadingReferences(true)
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    fetch('/api/lots/references', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((r) => r.json()).then((d) => {
      setReferences(d.references ?? [])
      setLoadingReferences(false)
    }).catch(() => {
      setLoadingReferences(false)
      setReferencesError(true)
      setFetchError('Failed to fetch references.')
    })
  }

  useEffect(() => {
    if (mode !== 'findNew') return
    const refIds = Object.keys(selectedRefFiles)
    if (!colId || !activeTargetSheet || !lookup.targetColumn || refIds.length === 0 || !refIds.every(id => lookup.refColumns?.[id])) {
      setNewCasesCount(null)
      return
    }

    const refFilesList = refIds.map((id) => ({
      id,
      sheet: selectedRefFiles[id],
      refColumn: lookup.refColumns[id]
    }))

    const fetchCount = async () => {
      setIsCounting(true)
      try {
        const res = await fetch(`/api/lots/references/find-new-cases-count/${colId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetSheet: activeTargetSheet, refFiles: refFilesList, lookupMapping: lookup })
        })
        const data = await res.json()
        if (res.ok) setNewCasesCount(data.count)
      } catch (e) {
        console.error(e)
      } finally {
        setIsCounting(false)
      }
    }

    const tid = setTimeout(fetchCount, 500)
    return () => clearTimeout(tid)
  }, [mode, colId, activeTargetSheet, lookup, selectedRefFiles])

  useEffect(() => {
    if (mode !== 'apply') return
    const validMap = dataMap.filter((m) => m.targetColumn && m.refColumn)
    if (!colId || !refId || !lookup.targetColumn || !lookup.refColumn || !validMap.length || (selRef?.sheets?.length > 1 && !refSheet)) {
      setUpdatedCasesCount(null)
      return
    }

    const fetchCount = async () => {
      setIsCounting(true)
      try {
        const res = await fetch(`/api/lots/references/apply-count/${colId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refId, refSheet: refSheet || (selRef?.sheets?.[0] ?? ''), targetSheet: activeTargetSheet, lookupMapping: lookup, dataMapping: validMap, overwriteExisting })
        })
        const data = await res.json()
        if (res.ok) setUpdatedCasesCount(data.count)
      } catch (e) {
        console.error(e)
      } finally {
        setIsCounting(false)
      }
    }

    const tid = setTimeout(fetchCount, 500)
    return () => clearTimeout(tid)
  }, [mode, colId, refId, activeTargetSheet, lookup, dataMap, overwriteExisting, refSheet, selRef])

  useEffect(() => {
    if (mode !== 'move') return
    const validFilters = moveFilters.filter(f => f.col && f.selectedValues && f.selectedValues.size > 0)
    if (!colId || !lookup.targetColumn || moveFilters.length !== validFilters.length) {
      setMoveStats(null)
      return
    }

    const manualValues = inputType === 'manual' ? manualInputText.split(',').map(s => s.trim()).filter(Boolean) : []
    if (inputType === 'manual') {
      if (manualValues.length === 0) {
        setMoveStats(null)
        return
      }
    } else {
      if (!refId || !lookup.refColumn) {
        setMoveStats(null)
        return
      }
    }

    const fetchCount = async () => {
      setIsCounting(true)
      const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
      try {
        const res = await fetch(`/api/lots/references/move-cases-count`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            sourceColId: colId,
            sourceSheet: activeTargetSheet,
            destColId,
            destSheet,
            overwriteDest,
            refId,
            refSheet: refSheet || (selRef?.sheets?.[0]?.name ?? ''),
            lookupMapping: lookup,
            filters: validFilters.map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })),
            inputType,
            manualValues
          })
        })
        const data = await res.json()
        if (res.ok) setMoveStats(data)
      } catch (e) {
        console.error(e)
      } finally {
        setIsCounting(false)
      }
    }

    const tid = setTimeout(fetchCount, 500)
    return () => clearTimeout(tid)
  }, [mode, colId, activeTargetSheet, refId, refSheet, selRef, lookup, moveFilters, destColId, destSheet, overwriteDest, inputType, manualInputText])

  async function uploadRef() {
    if (!refFile || !label) return
    setUploadMessage('')
    setUploadError('')
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    const form = new FormData(); form.append('file', refFile)
    const pRes = await fetch('/api/lots/preview', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: form })
    const pData = await pRes.json()
    if (!pRes.ok) { setUploadError('Failed to parse file preview.'); return }
    const sRes = await fetch('/api/lots/references', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ tempId: pData.tempId, label, sheets: pData.sheets }) })
    if (sRes.ok) {
      setRefFile(null); setLabel(''); loadRefs(); setUploadMessage('Reference saved successfully!')
      setTimeout(() => setUploadMessage(''), 4000)
    } else {
      const e = await sRes.json()
      setUploadError(e.message || 'Failed to save reference.')
    }
  }

  async function applyRef() {
    setApplyMessage('')
    setApplyError('')
    if (!colId || !refId || !lookup.targetColumn || !lookup.refColumn) return
    const validMap = dataMap.filter((m) => m.targetColumn && m.refColumn)
    const validFilters = moveFilters.filter(f => f.col && f.selectedValues && f.selectedValues.size > 0)
    if (!validMap.length) { setApplyError('Add at least one data mapping.'); return }
    setApplyState('applying')
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const res = await fetch(`/api/lots/references/apply/${colId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ refId, refSheet: refSheet || (selRef?.sheets?.[0] ?? ''), targetSheet: activeTargetSheet, lookupMapping: lookup, dataMapping: validMap, overwriteExisting, filters: validFilters.map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })) })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setApplyMessage(data.message)
      setApplyState('idle')
    } catch (err) { setApplyError(err.message); setApplyState('idle') }
  }

  async function findNewCases() {
    setApplyMessage('')
    setApplyError('')
    const refIds = Object.keys(selectedRefFiles)
    if (!colId || !lookup.targetColumn || !refIds.every(id => lookup.refColumns?.[id]) || !newCasesTargetCol || !newCasesMarkerText) return

    const refFilesList = refIds.map((id) => ({
      id,
      sheet: selectedRefFiles[id],
      refColumn: lookup.refColumns[id]
    }))
    if (!refFilesList.length) { setApplyError('Select at least one reference file.'); return }

    setApplyState('applying')
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const res = await fetch(`/api/lots/references/find-new-cases/${colId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          targetSheet: activeTargetSheet,
          refFiles: refFilesList,
          lookupMapping: lookup,
          newMarker: { targetColumn: newCasesTargetCol, markText: newCasesMarkerText, overwriteExisting: true }
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setApplyMessage(data.message)
      setApplyState('idle')
    } catch (err) { setApplyError(err.message); setApplyState('idle') }
  }

  async function moveCases() {
    setApplyMessage('')
    setApplyError('')
    if (!colId || !destColId || !destSheet || !lookup.targetColumn) return
    const validFilters = moveFilters.filter(f => f.col && f.selectedValues && f.selectedValues.size > 0)
    if (moveFilters.length !== validFilters.length) return

    const manualValues = inputType === 'manual' ? manualInputText.split(',').map(s => s.trim()).filter(Boolean) : []
    if (inputType === 'manual') {
      if (manualValues.length === 0) return
    } else {
      if (!refId || !lookup.refColumn) return
    }

    setApplyState('applying')
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      const res = await fetch(`/api/lots/references/move-cases`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          sourceColId: colId,
          sourceSheet: activeTargetSheet,
          destColId,
          destSheet,
          isNewDestSheet,
          refId,
          refSheet: refSheet || (selRef?.sheets?.[0]?.name ?? ''),
          lookupMapping: lookup,
          filters: validFilters.map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })),
          deleteSource,
          overwriteDest,
          inputType,
          manualValues
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setApplyMessage(data.message)
      setApplyState('idle')
    } catch (err) { setApplyError(err.message); setApplyState('idle') }
  }
  async function openPreview() {
    setPreviewModalOpen(true)
    setPreviewLoading(true)
    setPreviewData([])
    setExpandedPreviewCases(new Set())

    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
    try {
      let res;
      if (mode === 'apply') {
        const validMap = dataMap.filter((m) => m.targetColumn && m.refColumn)
        const validFilters = moveFilters.filter(f => f.col && f.selectedValues && f.selectedValues.size > 0)
        res = await fetch(`/api/lots/references/apply-preview/${colId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ refId, refSheet: refSheet || (selRef?.sheets?.[0] ?? ''), targetSheet: activeTargetSheet, lookupMapping: lookup, dataMapping: validMap, overwriteExisting, filters: validFilters.map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })) })
        })
      } else if (mode === 'findNew') {
        const refIds = Object.keys(selectedRefFiles)
        const refFilesList = refIds.map((id) => ({ id, sheet: selectedRefFiles[id], refColumn: lookup.refColumns[id] }))
        res = await fetch(`/api/lots/references/find-new-cases-preview/${colId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            targetSheet: activeTargetSheet, refFiles: refFilesList, lookupMapping: lookup,
            newMarker: { targetColumn: newCasesTargetCol, markText: newCasesMarkerText, overwriteExisting: true }
          })
        })
      } else if (mode === 'move') {
        const validFilters = moveFilters.filter(f => f.col && f.selectedValues && f.selectedValues.size > 0)
        const manualValues = inputType === 'manual' ? manualInputText.split(',').map(s => s.trim()).filter(Boolean) : []
        res = await fetch(`/api/lots/references/move-cases-preview`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            sourceColId: colId, sourceSheet: activeTargetSheet, destColId, destSheet, isNewDestSheet,
            refId, refSheet: refSheet || (selRef?.sheets?.[0]?.name ?? ''), lookupMapping: lookup,
            filters: validFilters.map(f => ({ col: f.col, selectedValues: Array.from(f.selectedValues) })),
            deleteSource, overwriteDest,
            inputType, manualValues
          })
        })
      }
      const data = await res.json()
      if (res.ok) setPreviewData(data.preview || [])
    } catch (e) {
      console.error(e)
    } finally {
      setPreviewLoading(false)
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


  const handleFilterColChange = async (filterId, newCol) => {
    setMoveFilters(p => p.map(x => x.id === filterId ? { ...x, col: newCol, selectedValues: new Set() } : x))
    if (newCol && !colUniqueValues[newCol] && colId && activeTargetSheet) {
      try {
        const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
        const res = await fetch(`/api/lots/references/unique-values/${colId}?sheet=${encodeURIComponent(activeTargetSheet)}&col=${encodeURIComponent(newCol)}`, { headers: { 'Authorization': `Bearer ${token}` } })
        const data = await res.json()
        if (res.ok) setColUniqueValues(p => ({ ...p, [newCol]: data.uniqueValues }))
      } catch (e) { console.error(e) }
    }
  }

  function deleteRef() {
    if (!refId) return
    setDeleteConfirm(true)
  }

  async function confirmDeleteRef() {
    try {
      const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
      const res = await fetch(`/api/lots/references/${refId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } })
      if (!res.ok) throw new Error('Failed to delete')
      setRefId('')
      setLookup({ targetColumn: '', refColumn: '' })
      loadRefs()
      setDeleteConfirm(false)
    } catch (err) { setApplyError(err.message); setDeleteConfirm(false) }
  }

  return (
    <div className="admin-content">
      <div className="admin-heading"><div><span className="eyebrow">DATA REFERENCING</span><h1>Use previous data</h1><p>Look up values in past files to populate columns in your current collection.</p></div></div>

      <div className="ref-mode-tabs" style={{ display: 'flex', gap: 10, marginTop: 15, borderBottom: '1px solid #252525', paddingBottom: 15 }}>
        <button className={mode === 'apply' ? 'primary-button' : 'outlined-button'} onClick={() => { setMode('apply'); setApplyMessage(''); setApplyError(''); setLookup({ targetColumn: '', refColumn: '' }) }}>Apply Reference Data</button>
        <button className={mode === 'findNew' ? 'primary-button' : 'outlined-button'} onClick={() => { setMode('findNew'); setApplyMessage(''); setApplyError(''); setLookup({ targetColumn: '', refColumn: '' }) }}>Find New Cases</button>
        <button className={mode === 'move' ? 'primary-button' : 'outlined-button'} onClick={() => { setMode('move'); setApplyMessage(''); setApplyError(''); setLookup({ targetColumn: '', refColumn: '' }) }}>Move Cases</button>
      </div>

      <div className="ref-grid-layout" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginTop: 24 }}>
        <section className="panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 }}>
            <h2>1. Target workbook</h2>
          </div>
          <select
            value={colId}
            onChange={(e) => {
              const newColId = e.target.value;
              setColId(newColId);
              setTargetSheet('');
              setSelectedRefFiles(prev => {
                if (prev[newColId]) {
                  const next = { ...prev };
                  delete next[newColId];
                  return next;
                }
                return prev;
              });
              setLookup(prev => {
                if (prev.refColumns?.[newColId]) {
                  const nextRefCols = { ...prev.refColumns };
                  delete nextRefCols[newColId];
                  return { ...prev, refColumns: nextRefCols };
                }
                return prev;
              });
            }}
            style={{ marginTop: 8 }}
            required
            className={loadingCollections ? 'select-loading' : ''}
            disabled={loadingCollections}
          >
              {loadingCollections
                ? <option value="">Fetching workbooks…</option>
                : collectionsError
                  ? <option value="">Server is unreachable</option>
                  : collections.length === 0
                    ? <option value="">No workbooks available</option>
                    : <>
                      <option value="">-- Select Target Workbook --</option>
                      {collections.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </>
              }
          </select>
          {selCol && (
            <select value={targetSheet} onChange={(e) => setTargetSheet(e.target.value)} style={{ marginTop: 8 }} required>
              <option value="">— select sheet —</option>
              {selCol.sheets?.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
        </section>

        <section className="panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 32 }}>
            <h2>{mode !== 'findNew' ? (mode === 'move' ? '2. Reference Source' : '2. Reference workbook') : '2. Reference workbooks'}</h2>
          </div>

          {mode === 'move' && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" checked={inputType === 'reference'} onChange={() => { setInputType('reference'); setLookup({ targetColumn: '', refColumn: '' }) }} />
                Reference File
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input type="radio" checked={inputType === 'manual'} onChange={() => { setInputType('manual'); setLookup({ targetColumn: '', refColumn: '' }) }} />
                Manual Input
              </label>
            </div>
          )}

          {mode !== 'findNew' ? (
            inputType === 'manual' && mode === 'move' ? (
              <textarea 
                value={manualInputText}
                onChange={e => setManualInputText(e.target.value)}
                placeholder="Enter comma-separated values (e.g. LOAN1, LOAN2, LOAN3)"
                style={{ width: '100%', height: 100, background: '#111111', color: '#cccccc', border: '1px solid #252525', borderRadius: 6, padding: 10, boxSizing: 'border-box' }}
              />
            ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <select value={refId} onChange={(e) => { setRefId(e.target.value); setLookup({ targetColumn: '', refColumn: '' }) }} required
                  className={loadingReferences ? 'select-loading' : ''}
                  disabled={loadingReferences}
                  style={{ flex: 1 }}
                >
                  {loadingReferences ? (
                    <option value="">Fetching references…</option>
                  ) : referencesError ? (
                    <option value="">Server is unreachable</option>
                  ) : references.length === 0 ? (
                    <option value="">No reference files available</option>
                  ) : (
                    <>
                      <option value="">— select reference file —</option>
                      {references.some(r => r.isWorkbook !== false) && (
                        <optgroup label="Workbooks">
                          {references.filter(r => r.isWorkbook !== false).map((r) => <option key={r._id} value={r._id} disabled={r._id === colId && mode !== 'move'}>{r.name}</option>)}
                        </optgroup>
                      )}
                      {references.some(r => r.isWorkbook === false) && (
                        <optgroup label="Manual References">
                          {references.filter(r => r.isWorkbook === false).map((r) => <option key={r._id} value={r._id} disabled={r._id === colId && mode !== 'move'}>{r.name}</option>)}
                        </optgroup>
                      )}
                    </>
                  )}
                </select>
                {refId && <button className="icon-button" onClick={deleteRef} style={{ color: '#e88080', flexShrink: 0 }} title="Delete reference file"><Icon name="trash" size={16} /></button>}
              </div>
              {selRef?.sheets?.length > 0 && (
                <select value={refSheet} onChange={(e) => setRefSheet(e.target.value)} style={{ marginTop: 8 }} required>
                  <option value="">— select sheet —</option>
                  {selRef.sheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              )}
            </>
            )
          ) : (
            <div style={{ marginTop: 12, maxHeight: 200, overflowY: 'auto', overflowX: 'hidden', border: '1px solid #252525', borderRadius: 6, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {loadingReferences ? (
                <span style={{ color: '#666666', fontSize: 13 }}>Fetching references…</span>
              ) : referencesError ? (
                <span style={{ color: '#e88080', fontSize: 13 }}>Server is unreachable</span>
              ) : references.filter(r => r._id !== colId).length === 0 ? (
                <span style={{ color: '#666666', fontSize: 13 }}>No reference files available.</span>
              ) : (
                <>
                  {references.some(r => r.isWorkbook !== false && r._id !== colId) && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#777777', marginBottom: 6, textTransform: 'uppercase' }}>Workbooks</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {references.filter(r => r.isWorkbook !== false && r._id !== colId).map((r) => (
                          <div key={r._id} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', fontSize: 14, minWidth: 0 }}>
                              <input
                                type="checkbox"
                                style={{ flexShrink: 0 }}
                                checked={!!selectedRefFiles[r._id]}
                                onChange={(e) => {
                                  const next = { ...selectedRefFiles }
                                  if (e.target.checked) {
                                    next[r._id] = r.sheets?.[0]?.name ?? ''
                                  } else {
                                    delete next[r._id]
                                  }
                                  setSelectedRefFiles(next)
                                  setLookup({ targetColumn: '', refColumn: '' })
                                }}
                              />
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                            </label>
                            {selectedRefFiles[r._id] !== undefined && r.sheets && r.sheets.length > 0 && (
                              <select
                                value={selectedRefFiles[r._id]}
                                onChange={(e) => setSelectedRefFiles(prev => ({ ...prev, [r._id]: e.target.value }))}
                                style={{ padding: '2px 8px', fontSize: 13, height: 'auto', flex: '0 1 190px', minWidth: 0, textOverflow: 'ellipsis' }}
                              >
                                {r.sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                              </select>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {references.some(r => r.isWorkbook === false && r._id !== colId) && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#777777', marginBottom: 6, marginTop: 4, textTransform: 'uppercase' }}>Manual References</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {references.filter(r => r.isWorkbook === false && r._id !== colId).map((r) => (
                          <div key={r._id} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', fontSize: 14, minWidth: 0 }}>
                              <input
                                type="checkbox"
                                style={{ flexShrink: 0 }}
                                checked={!!selectedRefFiles[r._id]}
                                onChange={(e) => {
                                  const next = { ...selectedRefFiles }
                                  if (e.target.checked) {
                                    next[r._id] = r.sheets?.[0]?.name ?? ''
                                  } else {
                                    delete next[r._id]
                                  }
                                  setSelectedRefFiles(next)
                                  setLookup({ targetColumn: '', refColumn: '' })
                                }}
                              />
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                            </label>
                            {selectedRefFiles[r._id] !== undefined && r.sheets && r.sheets.length > 0 && (
                              <select
                                value={selectedRefFiles[r._id]}
                                onChange={(e) => setSelectedRefFiles(prev => ({ ...prev, [r._id]: e.target.value }))}
                                style={{ padding: '2px 8px', fontSize: 13, height: 'auto', flex: '0 1 190px', minWidth: 0, textOverflow: 'ellipsis' }}
                              >
                                {r.sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                              </select>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {selCol && (mode !== 'findNew' ? (inputType === 'manual' && mode === 'move' ? true : selRef) : Object.keys(selectedRefFiles).length > 0) && (
        <section className="panel" style={{ padding: 22, marginTop: 15 }}>
          <h2>3. Lookup Match</h2>
          <p style={{ color: '#888888', fontSize: 11, marginBottom: 12 }}>Which column connects these two files?</p>
          <div className="ref-lookup-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 20px 1fr', gap: 10, alignItems: 'center' }}>
            <select value={lookup.targetColumn} onChange={(e) => setLookup({ ...lookup, targetColumn: e.target.value })} required disabled={!activeTargetSheet}>
              <option value="">{activeTargetSheet ? `— Target column (${activeTargetSheet}) —` : '— Select target sheet first —'}</option>
              {activeTargetColumns.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
            </select>
            <span style={{ textAlign: 'center', color: '#666666' }}>=</span>
            {mode !== 'findNew' ? (
              inputType === 'manual' && mode === 'move' ? (
                <div style={{ color: '#888888', fontSize: 13, fontStyle: 'italic', display: 'flex', alignItems: 'center', height: '40px', padding: '0 10px', background: '#141414', border: '1px solid #252525', borderRadius: 6 }}>
                  Values from manual input
                </div>
              ) : (
              <select value={lookup.refColumn} onChange={(e) => setLookup({ ...lookup, refColumn: e.target.value })} required disabled={!selRef || (selRef.sheets?.length > 1 && !refSheet)}>
                <option value="">{!selRef ? '— Select reference file first —' : ((selRef.sheets?.length > 1 && !refSheet) ? '— Select reference sheet first —' : `— Reference column (${selRef.name}) —`)}</option>
                {activeRefColumns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                {Object.entries(selectedRefFiles).map(([id, sheet]) => {
                  const r = references.find(x => x._id === id)
                  if (!r) return null
                  const rCols = r.sheets?.find(s => s.name === sheet)?.rawColumns?.length ? r.sheets.find(s => s.name === sheet).rawColumns : (r.sheets?.find(s => s.name === sheet)?.standardColumns?.map(c => c.label) ?? [])
                  return (
                    <select key={id} value={lookup.refColumns?.[id] || ''} onChange={(e) => setLookup({ ...lookup, refColumns: { ...(lookup.refColumns || {}), [id]: e.target.value } })} required>
                      <option value="">— Reference column ({r.name}{sheet ? ` - ${sheet}` : ''}) —</option>
                      {rCols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )
                })}
              </div>
            )}
          </div>

          <h2 style={{ marginTop: 30 }}>4. {mode === 'apply' ? 'Data to Map' : (mode === 'findNew' ? 'Mark New Cases' : 'Filters')}</h2>

          {mode === 'apply' && (
            <>
              <p style={{ color: '#888888', fontSize: 11, marginBottom: 12 }}>Which columns from the reference file should be copied into the collection?</p>
              <div className="std-col-list">
                {dataMap.map((dm, i) => (
                  <div key={i} className="filter-row">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
                      <select className="filter-col-select" value={dm.refColumn} onChange={(e) => setDataMap((p) => p.map((x, idx) => idx === i ? { ...x, refColumn: e.target.value } : x))} required style={dm.refColumn === '__CUSTOM__' ? { width: 'auto', flex: '0 0 auto' } : { flex: 1 }}>
                        <option value="">— Reference column —</option>
                        <option value="__CUSTOM__">✎ Custom text</option>
                        <option value="__CUSTOM_DATE__">📅 Custom date</option>
                        {activeRefColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      {dm.refColumn === '__CUSTOM__' && (
                        <input
                          className="std-col-custom"
                          value={dm.customText || ''}
                          onChange={(e) => setDataMap((p) => p.map((x, idx) => idx === i ? { ...x, customText: e.target.value } : x))}
                          placeholder="Enter text"
                          style={{ flex: '1 1 0', height: 40, boxSizing: 'border-box', border: '1px solid #252525', borderRadius: 6, padding: '0 10px', background: '#141414', color: '#cccccc' }}
                        />
                      )}
                      {dm.refColumn === '__CUSTOM_DATE__' && (
                        <input
                          type="date"
                          className="std-col-custom"
                          value={dm.customText || ''}
                          onChange={(e) => setDataMap((p) => p.map((x, idx) => idx === i ? { ...x, customText: e.target.value } : x))}
                          style={{ flex: '1 1 0', height: 40, boxSizing: 'border-box', border: '1px solid #252525', borderRadius: 6, padding: '0 10px', background: '#141414', color: '#cccccc' }}
                        />
                      )}
                    </div>
                    <span className="mapping-arrow">→</span>
                    <select className="filter-col-select" value={dm.targetColumn} onChange={(e) => setDataMap((p) => p.map((x, idx) => idx === i ? { ...x, targetColumn: e.target.value } : x))} required style={{ flex: 1 }}>
                      <option value="">— Target column —</option>
                      {activeTargetColumns.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
                    </select>
                    {dataMap.length > 1 && <button className="icon-button filter-remove" onClick={() => setDataMap((p) => p.filter((_, idx) => idx !== i))}><Icon name="trash" size={14} /></button>}
                  </div>
                ))}
              </div>
              <button className="outlined-button" type="button" style={{ marginTop: 16, width: 'max-content', padding: '6px 12px' }} onClick={() => setDataMap((p) => [...p, { targetColumn: '', refColumn: '' }])}>
                <Icon name="plus" size={13} /> Add mapping
              </button>
            </>
          )}

          {mode === 'findNew' && (
            <>
              <p style={{ color: '#888888', fontSize: 11, marginBottom: 12 }}>Select the target column to write the marker into, and the text to use.</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select value={newCasesTargetCol} onChange={e => setNewCasesTargetCol(e.target.value)} style={{ flex: 1, minHeight: '40px', boxSizing: 'border-box' }} required>
                  <option value="">— Target column ({activeTargetSheet}) —</option>
                  {activeTargetColumns.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
                </select>
                <input value={newCasesMarkerText} onChange={e => setNewCasesMarkerText(e.target.value)} placeholder="Marker text (e.g. NEW)" style={{ flex: 1, height: '40px', boxSizing: 'border-box' }} />
              </div>
            </>
          )}

          {(mode === 'move' || mode === 'apply') && (
            <>
              {mode === 'apply' && <h2 style={{ marginTop: 30 }}>5. Filters (Optional)</h2>}
              <p style={{ color: '#888888', fontSize: 11, marginBottom: 12 }}>Filter which cases to {mode === 'apply' ? 'update' : 'move'} (optional). Only matched cases will be {mode === 'apply' ? 'updated' : 'moved'}.</p>
              <div className="filters-section">
                {moveFilters.length === 0 && <p style={{ fontSize: 12, color: '#777777', marginBottom: 12 }}>No filters applied. All matching cases from the reference will be {mode === 'apply' ? 'updated' : 'moved'}.</p>}
                {moveFilters.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
                    {moveFilters.map((f, i) => (
                      <div key={f.id} style={{ background: '#181818', padding: 16, borderRadius: 6, border: '1px solid #252525' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <span style={{ fontSize: 12, color: '#cccccc', fontWeight: 700 }}>Filter Column</span>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                            <select value={f.col} onChange={(e) => handleFilterColChange(f.id, e.target.value)} style={{ flex: 1 }} required>
                              <option value="">— select filter column —</option>
                              {activeTargetColumns.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
                            </select>
                            <button className="icon-button filter-remove" onClick={() => setMoveFilters(p => p.filter(x => x.id !== f.id))}><Icon name="trash" size={16} /></button>
                          </div>
                        </div>

                        {f.col && (
                          <div style={{ marginTop: 12 }}>
                            <span style={{ fontSize: 12, color: '#777777', display: 'block', marginBottom: 8 }}>Select values to match:</span>
                            <div style={{ maxHeight: 150, overflowY: 'auto', background: '#111111', padding: 8, borderRadius: 4, border: '1px solid #252525' }}>
                              {!colUniqueValues[f.col] ? <div style={{ fontSize: 12, color: '#777777' }}>Loading values...</div> :
                                colUniqueValues[f.col].length === 0 ? <div style={{ fontSize: 12, color: '#777777' }}>No values found</div> : (
                                  colUniqueValues[f.col].map(val => (
                                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
                                      <input type="checkbox" checked={f.selectedValues.has(val)} onChange={() => setMoveFilters(p => p.map(x => {
                                        if (x.id !== f.id) return x
                                        const newSet = new Set(x.selectedValues)
                                        if (newSet.has(val)) newSet.delete(val)
                                        else newSet.add(val)
                                        return { ...x, selectedValues: newSet }
                                      }))} />
                                      {val === '__BLANKS__' ? <em style={{ color: '#777777' }}>(Blanks)</em> : val}
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
                <button className="outlined-button" type="button" style={{ alignSelf: 'flex-start', width: 'max-content' }} onClick={() => setMoveFilters(p => [...p, { id: Date.now(), col: '', selectedValues: new Set() }])}>
                  <Icon name="plus" size={13} /> Add filter
                </button>
              </div>
            </>
          )}

          {mode === 'move' && (
            <>
              <h2 style={{ marginTop: 30 }}>5. Destination</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginTop: 12 }}>
                <select
                  value={destColId}
                  onChange={(e) => {
                    setDestColId(e.target.value);
                    setDestSheet('');
                    setIsNewDestSheet(false);
                  }}
                  required
                >
                  <option value="">— select destination workbook —</option>
                  {collections.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>

                {destColId && (
                  !isNewDestSheet ? (
                    <select value={destSheet} onChange={(e) => { if (e.target.value === '__NEW__') { setIsNewDestSheet(true); setDestSheet('') } else setDestSheet(e.target.value) }} required>
                      <option value="">— select destination sheet —</option>
                      {(collections.find(c => c._id === destColId)?.sheets || []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                      <option value="__NEW__">+ Add new sheet...</option>
                    </select>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input style={{ flex: 1, height: 38, border: '1px solid #5ad4bc', background: '#141414', color: '#e5edf4', borderRadius: 8, padding: '0 12px' }} value={destSheet} onChange={(e) => setDestSheet(e.target.value)} placeholder="New sheet name" autoFocus required />
                      <button type="button" className="icon-button" onClick={() => { setIsNewDestSheet(false); setDestSheet('') }}><Icon name="close" size={14} /></button>
                    </div>
                  )
                )}
              </div>
            </>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 30 }}>
            {mode === 'apply' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderBottom: '1px solid #252525', paddingBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#cccccc', cursor: 'pointer' }}>
                  <input type="checkbox" checked={overwriteExisting} onChange={(e) => setOverwriteExisting(e.target.checked)} />
                  Overwrite existing data
                </label>
              </div>
            )}

            {mode === 'move' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderBottom: '1px solid #252525', paddingBottom: 20 }}>
                <div style={{ display: 'flex', gap: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#cccccc', cursor: 'pointer' }}>
                    <input type="checkbox" checked={overwriteDest} onChange={(e) => setOverwriteDest(e.target.checked)} />
                    Overwrite existing cases
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#e88080', cursor: 'pointer' }}>
                    <input type="checkbox" checked={deleteSource} onChange={(e) => setDeleteSource(e.target.checked)} />
                    Delete source cases
                  </label>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#cccccc' }}>
                  {mode === 'findNew' ? (
                    newCasesCount !== null ? (isCounting ? 'Calculating...' : <strong style={{ color: '#5cce9d', fontWeight: 600 }}>{newCasesCount} new cases found</strong>) : 'Fill details to calculate new cases.'
                  ) : (mode === 'move' ? (
                    moveStats !== null ? (
                      isCounting ? 'Calculating...' :
                        <span>
                          <strong style={{ color: '#5cce9d', fontWeight: 600 }}>{moveStats.actuallyMoved} cases</strong> will be {deleteSource ? 'moved' : 'copied'}.
                          {moveStats.skippedCount > 0 && <span style={{ marginLeft: 6, color: '#e88080' }}>({moveStats.skippedCount} skipped as duplicates)</span>}
                          {(destColId && destSheet && moveStats.destExistingCount !== undefined) && <span style={{ marginLeft: 6 }}>Total in destination: <strong>{moveStats.destExistingCount + moveStats.actuallyMoved}</strong></span>}
                        </span>
                    ) : 'Fill mappings to calculate cases to move.'
                  ) : (
                    updatedCasesCount !== null ? (isCounting ? 'Calculating...' : <strong style={{ color: '#5cce9d', fontWeight: 600 }}>{updatedCasesCount} cases will be updated</strong>) : 'Fill mappings to calculate updated cases.'
                  ))}
                </span>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  className="outlined-button"
                  style={{ padding: '12px', fontSize: 14 }}
                  disabled={
                    applyState === 'applying' || !lookup.targetColumn ||
                    (mode === 'apply' ? (!lookup.refColumn || !colId || !refId || dataMap.some(dm => !dm.targetColumn || !dm.refColumn) || (selRef?.sheets?.length > 1 && !refSheet) || moveFilters.some(f => !f.col || !f.selectedValues || f.selectedValues.size === 0) || updatedCasesCount === 0) :
                      (mode === 'findNew' ? (!newCasesTargetCol || !newCasesMarkerText || Object.keys(selectedRefFiles).length === 0 || !Object.keys(selectedRefFiles).every(id => lookup.refColumns?.[id]) || newCasesCount === 0) :
                        (inputType === 'manual' ? (!colId || !manualInputText.trim() || !destColId || !destSheet || moveFilters.some(f => !f.col || !f.selectedValues || f.selectedValues.size === 0) || !moveStats || moveStats.actuallyMoved === 0) : (!lookup.refColumn || !colId || !refId || !destColId || !destSheet || moveFilters.some(f => !f.col || !f.selectedValues || f.selectedValues.size === 0) || !moveStats || moveStats.actuallyMoved === 0))
                      ))
                  }
                  onClick={openPreview}
                >
                  <Icon name="eye" size={16} /> View Preview
                </button>
                <button
                  className="primary-button"
                  style={{ flex: 1, padding: '12px', fontSize: 14 }}
                  disabled={
                    applyState === 'applying' || !lookup.targetColumn ||
                    (mode === 'apply' ? (!lookup.refColumn || !colId || !refId || dataMap.some(dm => !dm.targetColumn || !dm.refColumn) || (selRef?.sheets?.length > 1 && !refSheet) || moveFilters.some(f => !f.col || !f.selectedValues || f.selectedValues.size === 0) || updatedCasesCount === 0) :
                      (mode === 'findNew' ? (!newCasesTargetCol || !newCasesMarkerText || Object.keys(selectedRefFiles).length === 0 || !Object.keys(selectedRefFiles).every(id => lookup.refColumns?.[id]) || newCasesCount === 0) :
                        (inputType === 'manual' ? (!colId || !manualInputText.trim() || !destColId || !destSheet || moveFilters.some(f => !f.col || !f.selectedValues || f.selectedValues.size === 0) || !moveStats || moveStats.actuallyMoved === 0) : (!lookup.refColumn || !colId || !refId || !destColId || !destSheet || moveFilters.some(f => !f.col || !f.selectedValues || f.selectedValues.size === 0) || !moveStats || moveStats.actuallyMoved === 0))
                      ))
                  }
                  onClick={mode === 'apply' ? applyRef : (mode === 'findNew' ? findNewCases : moveCases)}
                >
                  {applyState === 'applying' ? 'Processing…' : (mode === 'apply' ? 'Apply Reference Data & Regenerate Excel' : (mode === 'findNew' ? 'Mark New Cases & Regenerate Excel' : 'Move Cases'))}
                </button>

                {applyMessage && (
                  <a className="outlined-button" style={{ background: downloadProgress !== null ? `linear-gradient(to right, #419b74 ${downloadProgress}%, transparent ${downloadProgress}%)` : 'transparent', color: '#5cce9d', borderColor: '#5cce9d', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px', cursor: downloadProgress !== null ? 'wait' : 'pointer', pointerEvents: downloadProgress !== null ? 'none' : 'auto' }} onClick={(e) => {
                    e.preventDefault();
                    if (downloadProgress === null) downloadWb(colId);
                  }}>
                    <Icon name="download" size={16} /> {downloadProgress !== null ? `${downloadProgress}%` : 'Download file'}
                  </a>
                )}
              </div>
            </div>
          </div>
          {applyError && <div style={{ background: '#3b1d1d', color: '#e88080', padding: '10px 14px', borderRadius: 6, marginTop: 16, fontSize: 13, border: '1px solid #8a4b4b' }}>{applyError}</div>}
          {applyMessage && <div style={{ background: '#1d3b2c', color: '#80e8a8', padding: '10px 14px', borderRadius: 6, marginTop: 16, fontSize: 13, border: '1px solid #4b8a61' }}>{applyMessage}</div>}
        </section>
      )}

      {/* Upload Reference Panel below */}
      <section className="panel" style={{ padding: 22, marginTop: 40, borderStyle: 'dashed' }}>
        <h2>Upload new reference file</h2>
        <div className="ref-upload-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 20, alignItems: 'end', marginTop: 15 }}>
          <label style={{ margin: 0, display: 'grid', gap: 8, color: '#cccccc', fontSize: 12, fontWeight: 700 }}>Reference File<input type="file" accept=".xlsx,.xls" onChange={(e) => setRefFile(e.target.files[0])} style={{ height: '40px', padding: '7px 12px', boxSizing: 'border-box' }} /></label>
          <label style={{ margin: 0, display: 'grid', gap: 8, color: '#cccccc', fontSize: 12, fontWeight: 700 }}>Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. IDFC Sept 2025" style={{ height: '40px', padding: '0 12px', boxSizing: 'border-box' }} /></label>
          <button className="outlined-button" onClick={uploadRef} disabled={!refFile || !label} style={{ height: '40px', boxSizing: 'border-box' }}>Save Reference</button>
        </div>
        {uploadError && <div style={{ background: '#3b1d1d', color: '#e88080', padding: '10px 14px', borderRadius: 6, marginTop: 16, fontSize: 13, border: '1px solid #8a4b4b' }}>{uploadError}</div>}
        {uploadMessage && <div style={{ background: '#1d3b2c', color: '#80e8a8', padding: '10px 14px', borderRadius: 6, marginTop: 16, fontSize: 13, border: '1px solid #4b8a61' }}>{uploadMessage}</div>}
      </section>

      {deleteConfirm && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteConfirm(false)}>
          <div className="modal">
            <button className="close-button" onClick={() => setDeleteConfirm(false)}><Icon name="close" size={16} /></button>
            <span className="eyebrow" style={{ color: '#e88080' }}>DELETE REFERENCE</span>
            <h2>Are you sure?</h2>
            <p>This reference file will be permanently deleted. Are you sure you want to proceed?</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              <button type="button" className="outlined-button" style={{ flex: 1 }} onClick={() => setDeleteConfirm(false)}>Cancel</button>
              <button type="button" className="primary-button" style={{ flex: 1, background: '#a54d4d', color: '#ffd6d6', boxShadow: 'none' }} onClick={confirmDeleteRef}>Delete File</button>
            </div>
          </div>
        </div>
      )}

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
                              {mode !== 'move' && caseItem.changes?.map((change, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                  <span style={{ color: '#777777' }}>{change.col}:</span>
                                  <span style={{ color: '#e88080', textDecoration: 'line-through' }}>{formatPreviewValue(change.old)}</span>
                                  <Icon name="arrow" size={12} style={{ color: '#5cce9d' }} />
                                  <span style={{ color: '#5cce9d', fontWeight: 600 }}>{formatPreviewValue(change.new)}</span>
                                </div>
                              ))}
                              {mode === 'move' && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                  <span style={{ color: '#777777' }}>Destination:</span>
                                  <span style={{ color: '#5cce9d', fontWeight: 600 }}>{caseItem.destination}</span>
                                </div>
                              )}
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

      {fetchError && (
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
          <span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{fetchError}</span>
        </div>
      )}
    </div>
  )
}
