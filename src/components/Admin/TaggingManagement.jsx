import React, { useState, useEffect } from 'react'
import { Icon } from '../Shared.jsx'

const TAGS = [
  'Address', 'Bucket', 'Collected Amount', 'Customer Name', 'Dealer', 'EMI Amount', 'EMI End Date',
  'EMI Start Date', 'FOS', 'Father Name', 'Loan No', 'Lot', 'Mailing Landmark', 'Mobile number', 'Mode of Payment',
  'New Case', 'PTP', 'Number of EMI Paid', 'POS', 'Paid Date', 'Pin Code',
  'Previous Paid Date', 'Product', 'Reference mobile', 'Reference name',
  'Registration Number', 'Status', 'Tenure', 'Time', 'Vehicle'
]

const REF_TAGS = ['Reference mobile', 'Reference name']

export function TaggingManagement({ collectionId, sheetName, availableColumns, setCollections }) {
  const [tagMap, setTagMap] = useState({})
  const [customTags, setCustomTags] = useState([])
  const [newCustomTagName, setNewCustomTagName] = useState('')
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')
  const [dirtyMap, setDirtyMap] = useState(null)

  useEffect(() => {
    const initial = {}
    const foundCustomTags = new Set()
    for (const t of TAGS) {
      initial[t] = []
    }
    for (const col of availableColumns) {
      if (col.tag) {
        const tags = col.tag.split(',').map(t => t.trim())
        for (const t of tags) {
          if (!initial[t]) {
            initial[t] = []
            if (!TAGS.includes(t)) {
              foundCustomTags.add(t)
            }
          }
          initial[t].push(col.label)
        }
      }
    }
    setTagMap(initial)
    setCustomTags(Array.from(foundCustomTags))
  }, [availableColumns])

  useEffect(() => {
    if (!dirtyMap) return
    const timeoutId = setTimeout(() => {
      saveTags(dirtyMap)
      setDirtyMap(null)
    }, 500)
    return () => clearTimeout(timeoutId)
  }, [dirtyMap])

  const handleTagChange = (tag, index, newCol) => {
    const isRef = tag === 'Reference name' || tag === 'Reference number' || tag === 'Reference mobile'
    let isConflict = false
    let conflictingTag = ''

    if (newCol !== '') {
      for (const [t, cols] of Object.entries(tagMap)) {
        if (t !== tag && cols.includes(newCol)) {
          const tIsRef = t === 'Reference name' || t === 'Reference number' || t === 'Reference mobile'
          if (!(isRef && tIsRef)) {
            isConflict = true
            conflictingTag = t
            break
          }
        }
      }
    }

    if (isConflict) {
      setSaveError(`Column "${newCol}" is already assigned to "${conflictingTag}".`)
      setSaveState('error')
      setTimeout(() => setSaveState(s => s === 'error' ? 'idle' : s), 3000)
      
      setTagMap(prev => {
        const newMap = { ...prev }
        const arr = [...(newMap[tag] || [])]
        arr[index] = ''
        newMap[tag] = arr
        return newMap
      })
      return
    }

    setTagMap(prev => {
      const newMap = { ...prev }
      const arr = [...(newMap[tag] || [])]
      if (newCol === '') {
        arr.splice(index, 1)
      } else {
        arr[index] = newCol
      }
      newMap[tag] = arr
      setDirtyMap(newMap)
      return newMap
    })
  }

  const addDropdown = (tag) => {
    setTagMap(prev => {
      const arr = [...(prev[tag] || [])]
      arr.push('')
      return { ...prev, [tag]: arr }
    })
  }

  const handleAddCustomTag = () => {
    const name = newCustomTagName.trim()
    if (!name) return
    if (TAGS.includes(name) || customTags.includes(name)) {
      setNewCustomTagName('')
      return
    }
    setCustomTags(prev => [...prev, name])
    setTagMap(prev => ({ ...prev, [name]: [] }))
    setNewCustomTagName('')
  }

  const removeCustomTag = (tag) => {
    setCustomTags(prev => prev.filter(t => t !== tag))
    setTagMap(prev => {
      const newMap = { ...prev }
      delete newMap[tag]
      setDirtyMap(newMap)
      return newMap
    })
  }

  const saveTags = async (mapToSave) => {
    setSaveState('saving')
    setSaveError('')

    const payload = {}
    for (const [tag, cols] of Object.entries(mapToSave)) {
      for (const c of cols) {
        if (c) {
          if (payload[c]) {
            const existingTags = payload[c].split(',')
            if (existingTags.includes(tag)) continue

            const allTags = [...existingTags, tag]
            const isOnlyRefTags = allTags.every(t => t === 'Reference name' || t === 'Reference number' || t === 'Reference mobile')
            if (!isOnlyRefTags) {
              setSaveError(`Column "${c}" cannot be assigned to multiple tags unless they are Reference Name and Reference Number/Mobile.`)
              setSaveState('error')
              return
            }
            payload[c] += `,${tag}`
          } else {
            payload[c] = tag
          }
        }
      }
    }

    try {
      const res = await fetch(`/api/collections/${collectionId}/tags`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetName, tagsMapping: payload })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setSaveState('saved')
      setCollections(prev => prev.map(c => c._id === collectionId ? data.collection : c))
      setTimeout(() => setSaveState(s => s === 'saved' ? 'idle' : s), 2000)
    } catch (err) {
      setSaveError(err.message)
      setSaveState('error')
    }
  }

  const renderTagRow = (tag, isRef, isCustom) => {
    const selectedCols = tagMap[tag] || []
    const dropdowns = selectedCols.length === 0 ? [''] : selectedCols

    return (
      <div key={tag} className="tag-row" style={{ display: 'grid', gridTemplateColumns: '250px 1fr auto', gap: 16, alignItems: 'center', background: '#181818', padding: '12px 16px', borderRadius: 6, border: '1px solid #252525' }}>
        <span style={{ fontWeight: 600, color: '#eeeeee', fontSize: 13 }}>{tag}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {dropdowns.map((col, idx) => (
            <select
              key={idx}
              value={col}
              onChange={(e) => handleTagChange(tag, idx, e.target.value)}
              style={{ minWidth: 200 }}
              required
            >
              <option value="">None</option>
              {availableColumns.filter(c => !c._delete).map(c => (
                <option key={c.label} value={c.label}>{c.label}</option>
              ))}
            </select>
          ))}

          {isRef && dropdowns[dropdowns.length - 1] !== '' && (
            <button type="button" className="icon-button" onClick={() => addDropdown(tag)} title="Add another column">
              <Icon name="plus" size={16} />
            </button>
          )}
        </div>
        <div>
          {isCustom && (
            <button type="button" className="icon-button filter-remove" onClick={() => removeCustomTag(tag)} title="Remove custom tag">
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <p style={{ color: '#777777', fontSize: 13, margin: 0 }}>
          Assign columns to predefined tags. Tags help identify important data later.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {TAGS.map(tag => renderTagRow(tag, REF_TAGS.includes(tag), false))}
      </div>

      <div style={{ marginTop: 32 }}>
        <h3 style={{ fontSize: 14, color: '#eeeeee', marginBottom: 12 }}>Custom Tags</h3>
        <p style={{ color: '#777777', fontSize: 13, marginBottom: 16 }}>
          Create your own tags and assign them to columns.
        </p>

        {customTags.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {customTags.map(tag => renderTagRow(tag, false, true))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="New tag name"
            value={newCustomTagName}
            onChange={e => setNewCustomTagName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddCustomTag()}
            style={{ width: 250 }}
          />
          <button type="button" className="outlined-button" onClick={handleAddCustomTag} disabled={!newCustomTagName.trim()}>
            <Icon name="plus" size={14} /> Add custom tag
          </button>
        </div>
      </div>


      {saveState !== 'idle' && (
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
          {saveState === 'saving' && <><Icon name="spinner" size={16} className="spin-icon" /><span style={{ color: '#777777', fontSize: 13, fontWeight: 600 }}>Saving changes...</span></>}
          {saveState === 'saved' && <><Icon name="check" size={16} style={{ color: '#5cce9d' }} /><span style={{ color: '#5cce9d', fontSize: 13, fontWeight: 600 }}>All tags saved</span></>}
          {saveState === 'error' && <><Icon name="close" size={16} style={{ color: '#e88080' }} /><span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{saveError || 'Error saving tags'}</span></>}
        </div>
      )}
    </div>
  )
}
