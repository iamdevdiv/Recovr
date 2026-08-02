import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../Shared.jsx'

export function AdminOverview() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedMonths, setExpandedMonths] = useState(new Set())
  const [expandedWorkbooks, setExpandedWorkbooks] = useState(new Set())
  const [expandedSheets, setExpandedSheets] = useState(new Set())
  const [hiddenFosMap, setHiddenFosMap] = useState({})

  const savePreferences = (months, wbs, sheets) => {
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || '';
    fetch('/api/admin/overview-preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        expandedMonths: Array.from(months),
        expandedWorkbooks: Array.from(wbs),
        expandedSheets: Array.from(sheets)
      })
    }).catch(err => console.error('Failed to save preferences', err))
  }

  useEffect(() => {
    const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || '';
    fetch('/api/admin/overview-stats', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
      .then(res => res.json())
      .then(resData => {
        if (resData.message) throw new Error(resData.message)
        setData(resData.workbooks || [])
        
        const prefs = resData.overviewPreferences || {}
        const hasPrefs = prefs.expandedMonths?.length > 0 || prefs.expandedWorkbooks?.length > 0 || prefs.expandedSheets?.length > 0
        
        if (hasPrefs) {
          setExpandedMonths(new Set(prefs.expandedMonths || []))
          setExpandedWorkbooks(new Set(prefs.expandedWorkbooks || []))
          setExpandedSheets(new Set(prefs.expandedSheets || []))
        } else {
          // Default expansion if no prefs exist
          const mNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
          let latestStr = null
          let maxTime = 0
          for (const wb of (resData.workbooks || [])) {
            if (wb.year && wb.month) {
              const mIndex = mNames.indexOf(wb.month)
              const t = new Date(wb.year, mIndex === -1 ? 0 : mIndex).getTime()
              if (t > maxTime) {
                maxTime = t
                latestStr = `${wb.month} ${wb.year}`
              }
            }
          }
          if (!latestStr && resData.workbooks?.length > 0) {
             const firstWb = resData.workbooks[0]
             latestStr = `${firstWb.month} ${firstWb.year}`
          }
          if (latestStr) {
            const defaultMonths = new Set([latestStr])
            const defaultWbs = new Set()
            const defaultSheets = new Set()
            
            for (const wb of (resData.workbooks || [])) {
              if (`${wb.month} ${wb.year}` === latestStr) {
                defaultWbs.add(wb._id)
                wb.sheets?.forEach(s => defaultSheets.add(`${wb._id}_${s.name}`))
              }
            }
            
            setExpandedMonths(defaultMonths)
            setExpandedWorkbooks(defaultWbs)
            setExpandedSheets(defaultSheets)
          }
        }
        setLoading(false)
      })
      .catch(err => {
        if (err.message.includes('JSON') || err.message.includes('fetch')) {
          setError('Server is unreachable.')
        } else {
          setError(err.message)
        }
        setLoading(false)
      })
  }, [])

  if (loading) return (
    <div className="admin-content">
      {/* Heading */}
      <div className="admin-heading">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="skeleton-block" style={{ width: 110, height: 10, borderRadius: 3 }} />
          <span className="skeleton-block" style={{ width: 260, height: 36, borderRadius: 6 }} />
          <span className="skeleton-block" style={{ width: 310, height: 13, borderRadius: 4 }} />
        </div>
        <span className="skeleton-block" style={{ width: 148, height: 36, borderRadius: 8, flexShrink: 0 }} />
      </div>

      {/* Accordion groups */}
      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[0, 1].map(gi => (
          <div key={gi} style={{ border: '1px solid #1d2d3b', borderRadius: 8, overflow: 'hidden', background: '#141414' }}>
            {/* Accordion header — dark bar with month name + chevron */}
            <div style={{ padding: '12px 16px', background: '#181818', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1d2d3b' }}>
              <span className="skeleton-block" style={{ width: gi === 0 ? 90 : 78, height: 16, borderRadius: 4 }} />
              <span className="skeleton-block" style={{ width: 16, height: 16, borderRadius: 4 }} />
            </div>

            {/* Expanded content */}
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Workbook header row */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1a2c3a', paddingBottom: 8, marginBottom: 12 }}>
                  <span className="skeleton-block" style={{ width: gi === 0 ? 160 : 140, height: 15, borderRadius: 4 }} />
                  <span className="skeleton-block" style={{ width: 140, height: 13, borderRadius: 4 }} />
                </div>

                {/* Sheet section */}
                <div style={{ background: '#111111', border: '1px solid #152433', borderRadius: 6, padding: 16 }}>
                  {/* Sheet header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <span className="skeleton-block" style={{ width: 100, height: 14, borderRadius: 4 }} />
                    <span className="skeleton-block" style={{ width: 90, height: 28, borderRadius: 6 }} />
                  </div>

                  {/* Stat cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
                    {[0, 1].map(ci => (
                      <div key={ci} style={{ background: '#161616', padding: 12, borderRadius: 6, border: '1px solid #1a2c3a' }}>
                        <span className="skeleton-block" style={{ width: '60%', height: 11, borderRadius: 3, marginBottom: 10, display: 'block' }} />
                        <span className="skeleton-block" style={{ width: '75%', height: 22, borderRadius: 4, display: 'block' }} />
                      </div>
                    ))}
                  </div>

                  {/* Breakdown skeletons */}
                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 250 }}>
                      <span className="skeleton-block" style={{ width: 160, height: 12, borderRadius: 3, marginBottom: 12 }} />
                      <div style={{ borderTop: '2px solid #1a2c3a' }}>
                        {[0, 1, 2].map(ri => (
                          <div key={ri} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 4px', borderBottom: ri < 2 ? '1px solid #12202b' : 'none' }}>
                            <span className="skeleton-block" style={{ width: 80, height: 13, borderRadius: 3 }} />
                            <span className="skeleton-block" style={{ width: 40, height: 13, borderRadius: 3 }} />
                            <span className="skeleton-block" style={{ width: 70, height: 13, borderRadius: 3 }} />
                            <span className="skeleton-block" style={{ width: 30, height: 13, borderRadius: 3 }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  if (error) return (
    <div className="admin-content">
      <div className="admin-heading" style={{ marginBottom: 24 }}>
        <div>
          <span className="eyebrow">COLLECTION DESK</span>
          <h1>Operations overview</h1>
        </div>
      </div>
      <div style={{ background: '#1e1116', border: '1px solid #6b2a2a', borderRadius: 8, padding: '18px 22px', color: '#e88080', fontSize: 14 }}>
        <strong>Failed to load overview data:</strong> {error}
      </div>
    </div>
  )

  const grouped = (data || []).reduce((acc, wb) => {
    const key = (wb.month && wb.year) ? `${wb.month} ${wb.year}` : 'Unknown Month'
    if (!acc[key]) acc[key] = []
    acc[key].push(wb)
    return acc
  }, {})

  // Sort groups descending
  const mNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const sortedKeys = Object.keys(grouped).sort((a, b) => {
    const [ma, ya] = a.split(' ')
    const [mb, yb] = b.split(' ')
    const tA = new Date(parseInt(ya) || 0, mNames.indexOf(ma) === -1 ? 0 : mNames.indexOf(ma)).getTime()
    const tB = new Date(parseInt(yb) || 0, mNames.indexOf(mb) === -1 ? 0 : mNames.indexOf(mb)).getTime()
    return tB - tA
  })

  function toggleMonth(key) {
    const next = new Set(expandedMonths)
    next.has(key) ? next.delete(key) : next.add(key)
    setExpandedMonths(next)
    savePreferences(next, expandedWorkbooks, expandedSheets)
  }

  function toggleWorkbook(wbId) {
    const next = new Set(expandedWorkbooks)
    next.has(wbId) ? next.delete(wbId) : next.add(wbId)
    setExpandedWorkbooks(next)
    savePreferences(expandedMonths, next, expandedSheets)
  }

  function toggleSheet(sheetKey) {
    const next = new Set(expandedSheets)
    next.has(sheetKey) ? next.delete(sheetKey) : next.add(sheetKey)
    setExpandedSheets(next)
    savePreferences(expandedMonths, expandedWorkbooks, next)
  }

  function handleToggleFos(wbId, sheetName, fosName) {
    const key = `${wbId}_${sheetName}`
    setHiddenFosMap(prev => {
      const newSet = new Set(prev[key] || [])
      if (newSet.has(fosName)) {
        newSet.delete(fosName)
      } else {
        const wb = (data || []).find(w => w._id === wbId)
        const sheet = wb?.sheets?.find(s => s.name === sheetName)
        if (sheet && sheet.fosStats.length - newSet.size <= 1) return prev
        newSet.add(fosName)
      }
      return { ...prev, [key]: newSet }
    })
  }

  return (
    <div className="admin-content">
      <div className="admin-heading">
        <div>
          <span className="eyebrow">COLLECTION DESK</span>
          <h1>Operations overview</h1>
          <p>View stats based on your configured permissions.</p>
        </div>
        <button className="primary-button" onClick={() => navigate('/admin/upload')}>
          <Icon name="upload" /> Upload new lot
        </button>
      </div>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sortedKeys.length === 0 ? (
          <p style={{ color: '#555555' }}>No data available. Please check your permissions or upload a workbook.</p>
        ) : (
          sortedKeys.map(key => {
            const isExpanded = expandedMonths.has(key)
            const workbooks = grouped[key]

            // Recalculate per-sheet stats dynamically based on selected FOS
            const filteredWorkbooks = workbooks.map(wb => {
              const filteredSheets = wb.sheets.map(sheet => {
                const hiddenFos = hiddenFosMap[`${wb._id}_${sheet.name}`] || new Set()
                if (hiddenFos.size === 0) return sheet
                
                const filteredFosStats = sheet.fosStats.filter(f => !hiddenFos.has(f.fos))
                let newTotalPos = 0
                let newTotalCount = 0
                const newStatusMap = { statusPos: {}, statusCount: {} }
                
                filteredFosStats.forEach(fs => {
                  newTotalPos += fs.totalPos
                  newTotalCount += fs.totalCount
                  fs.statuses.forEach(st => {
                    newStatusMap.statusPos[st.status] = (newStatusMap.statusPos[st.status] || 0) + st.pos
                    newStatusMap.statusCount[st.status] = (newStatusMap.statusCount[st.status] || 0) + st.count
                  })
                })
                
                const overallStatuses = Object.keys(newStatusMap.statusPos).map(status => {
                  const pos = newStatusMap.statusPos[status]
                  const percentage = newTotalPos > 0 ? ((pos / newTotalPos) * 100).toFixed(2) : '0.00'
                  return { status, count: newStatusMap.statusCount[status], pos, percentage }
                }).sort((a,b) => a.status.localeCompare(b.status))
                
                return {
                  ...sheet,
                  totalPos: newTotalPos,
                  totalCount: newTotalCount,
                  fosStats: sheet.fosStats,
                  overallStats: {
                    totalPos: newTotalPos,
                    totalCount: newTotalCount,
                    statuses: overallStatuses
                  }
                }
              })
              const combinedCases = filteredSheets.reduce((sum, s) => sum + s.totalCount, 0)
              return { ...wb, sheets: filteredSheets, combinedCases }
            }).filter(wb => wb.combinedCases > 0) // Hide workbook if no cases match FOS

            if (filteredWorkbooks.length === 0) return null

            return (
              <div key={key} style={{ border: '1px solid #1d2d3b', borderRadius: 8, overflow: 'hidden', background: '#141414' }}>
                <div style={{ padding: '12px 16px', background: '#181818', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: isExpanded ? '1px solid #1d2d3b' : 'none' }}
                  onClick={() => toggleMonth(key)}>
                  <h3 style={{ margin: 0, fontSize: 16, color: '#cccccc' }}>{key}</h3>
                  <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} style={{ color: '#555555' }} />
                </div>
                {isExpanded && (
                  <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {filteredWorkbooks.map(wb => {
                      const isWbExpanded = expandedWorkbooks.has(wb._id);
                      return (
                      <div key={wb._id}>
                        <div 
                          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: isWbExpanded ? '1px solid #1a2c3a' : 'none', paddingBottom: 8, marginBottom: 12, cursor: 'pointer' }}
                          onClick={() => toggleWorkbook(wb._id)}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Icon name={isWbExpanded ? 'chevron-up' : 'chevron-down'} size={14} style={{ color: '#555555' }} />
                            <h4 style={{ margin: 0, fontSize: 15, color: '#aaaaaa' }}>{wb.name}</h4>
                          </div>
                          <span style={{ fontSize: 13, color: '#777777', fontWeight: 600 }}>Combined Cases: {wb.combinedCases.toLocaleString()}</span>
                        </div>
                        {isWbExpanded && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          {wb.sheets.map(sheet => {
                            // DRR calculation
                            const drrPercentage = sheet.drrPercentage !== undefined ? sheet.drrPercentage : 97
                            const targetPos = sheet.totalPos * (drrPercentage / 100)
                            const paidStatus = sheet.overallStats.statuses.find(s => s.status === 'PAID')
                            const currentPaidPos = paidStatus ? paidStatus.pos : 0
                            const diff = Math.max(0, targetPos - currentPaidPos)

                            let finalDays = 0
                            if (sheet.drrDaysOverride !== null && sheet.drrDaysOverride !== '') {
                              finalDays = Number(sheet.drrDaysOverride)
                            } else {
                              const mNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
                              const mIndex = mNames.indexOf(wb.month)
                              const now = new Date()
                              
                              if (wb.year === now.getFullYear() && mIndex === now.getMonth()) {
                                const daysInMonth = new Date(wb.year, mIndex + 1, 0).getDate()
                                finalDays = daysInMonth - now.getDate() + 1
                              } else if (wb.year > now.getFullYear() || (wb.year === now.getFullYear() && mIndex > now.getMonth())) {
                                finalDays = new Date(wb.year, mIndex + 1, 0).getDate()
                              }
                            }
                            
                            const drrValue = finalDays > 0 ? (diff / finalDays) : diff
                            const sheetKey = `${wb._id}_${sheet.name}`
                            const isSheetExpanded = expandedSheets.has(sheetKey)

                            return (
                            <div key={sheet.name} style={{ background: '#111111', border: '1px solid #152433', borderRadius: 6 }}>
                              <div 
                                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, cursor: 'pointer', borderBottom: isSheetExpanded ? '1px solid #1a2c3a' : 'none' }}
                                onClick={() => toggleSheet(sheetKey)}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <Icon name={isSheetExpanded ? 'chevron-up' : 'chevron-down'} size={14} style={{ color: '#555555' }} />
                                  <h5 style={{ margin: 0, fontSize: 14, color: '#888888' }}>{sheet.name}</h5>
                                </div>
                                <button className="outlined-button" onClick={(e) => { e.stopPropagation(); navigate(`/admin/cases?collectionId=${wb._id}&sheetName=${encodeURIComponent(sheet.name)}`) }} style={{ padding: '4px 10px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <Icon name="cases" size={14} /> View cases
                                </button>
                              </div>

                              {isSheetExpanded && (
                              <div style={{ padding: 16, paddingTop: 0 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24, marginTop: 16 }}>
                                  <div style={{ background: '#161616', padding: 12, borderRadius: 6, border: '1px solid #1a2c3a' }}>
                                    <div style={{ fontSize: 11, color: '#555555', textTransform: 'uppercase', marginBottom: 4 }}>Total POS</div>
                                    <div style={{ fontSize: 20, color: '#fff', fontWeight: 600 }}>₹{sheet.totalPos.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                  </div>
                                  <div style={{ background: '#161616', padding: 12, borderRadius: 6, border: '1px solid #1a2c3a' }}>
                                    <div style={{ fontSize: 11, color: '#555555', textTransform: 'uppercase', marginBottom: 4 }}>Total Cases</div>
                                    <div style={{ fontSize: 20, color: '#fff', fontWeight: 600 }}>{sheet.totalCount.toLocaleString()}</div>
                                  </div>
                                  <div style={{ background: '#161616', padding: 12, borderRadius: 6, border: '1px solid #1a2c3a' }}>
                                    <div style={{ fontSize: 11, color: '#555555', textTransform: 'uppercase', marginBottom: 4 }}>DRR</div>
                                    <div style={{ fontSize: 20, color: '#6be2c7', fontWeight: 600 }}>₹{drrValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                                  <div style={{ flex: 1, minWidth: 250 }}>
                                    <h6 style={{ margin: '0 0 12px 0', fontSize: 12, color: '#666666', textTransform: 'uppercase' }}>Overall Status Breakdown</h6>
                                    <div style={{ overflowX: 'auto' }}>
                                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 350 }}>
                                        <thead>
                                          <tr style={{ color: '#555555', borderBottom: '2px solid #1a2c3a' }}>
                                            <th style={{ textAlign: 'left', padding: '8px 4px' }}>Status</th>
                                            <th style={{ textAlign: 'right', padding: '8px 4px' }}>Cases</th>
                                            <th style={{ textAlign: 'right', padding: '8px 4px' }}>POS</th>
                                            <th style={{ textAlign: 'right', padding: '8px 4px' }}>%</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sheet.overallStats?.statuses.map(st => (
                                            <tr key={st.status} style={{ borderBottom: '1px solid #12202b', background: '#141414' }}>
                                              <td style={{ padding: '8px 4px', color: '#888888', fontWeight: 600 }}>{st.status}</td>
                                              <td style={{ textAlign: 'right', color: '#888888', padding: '8px 4px' }}>{st.count}</td>
                                              <td style={{ textAlign: 'right', color: '#888888', padding: '8px 4px' }}>₹{st.pos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                              <td style={{ textAlign: 'right', color: '#5cce9d', padding: '8px 4px' }}>{st.percentage}%</td>
                                            </tr>
                                          ))}
                                          <tr style={{ borderTop: '2px solid #1a2c3a', background: '#181818' }}>
                                            <td style={{ padding: '8px 4px', color: '#cccccc', fontWeight: 700 }}>TOTAL</td>
                                            <td style={{ textAlign: 'right', color: '#cccccc', fontWeight: 700, padding: '8px 4px' }}>{sheet.overallStats?.totalCount}</td>
                                            <td style={{ textAlign: 'right', color: '#cccccc', fontWeight: 700, padding: '8px 4px' }}>₹{sheet.overallStats?.totalPos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td style={{ textAlign: 'right', color: '#cccccc', fontWeight: 700, padding: '8px 4px' }}>100.00%</td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                  <div style={{ flex: 1, minWidth: 250 }}>
                                    <h6 style={{ margin: '0 0 12px 0', fontSize: 12, color: '#666666', textTransform: 'uppercase' }}>FOS Breakdown</h6>
                                    <div style={{ overflowX: 'auto' }}>
                                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 400 }}>
                                        <thead>
                                          <tr style={{ color: '#555555', borderBottom: '2px solid #1a2c3a' }}>
                                            <th style={{ width: '30px', textAlign: 'center', padding: '8px 4px' }}>On</th>
                                            <th style={{ textAlign: 'left', padding: '8px 4px' }}>FOS / Status</th>
                                            <th style={{ textAlign: 'right', padding: '8px 4px' }}>Cases</th>
                                            <th style={{ textAlign: 'right', padding: '8px 4px' }}>POS</th>
                                            <th style={{ textAlign: 'right', padding: '8px 4px' }}>%</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(sheet.fosStats || []).map(fosItem => {
                                            const hiddenFos = hiddenFosMap[`${wb._id}_${sheet.name}`] || new Set()
                                            const isHidden = hiddenFos.has(fosItem.fos)
                                            const isLastChecked = !isHidden && (sheet.fosStats.length - hiddenFos.size <= 1)
                                            return (
                                            <React.Fragment key={fosItem.fos}>
                                              <tr style={{ borderBottom: '1px solid #1a2c3a', background: '#141414' }}>
                                                <td style={{ textAlign: 'center', padding: '8px 4px' }}>
                                                  <input 
                                                    type="checkbox" 
                                                    checked={!isHidden} 
                                                    onChange={() => handleToggleFos(wb._id, sheet.name, fosItem.fos)}
                                                    disabled={isLastChecked}
                                                    style={{ cursor: isLastChecked ? 'not-allowed' : 'pointer', accentColor: '#6be2c7', opacity: isLastChecked ? 0.5 : 1 }}
                                                  />
                                                </td>
                                                <td style={{ padding: '8px 4px', color: '#cccccc', fontWeight: 600, opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>{fosItem.fos}</td>
                                                <td style={{ textAlign: 'right', color: '#cccccc', fontWeight: 600, padding: '8px 4px', opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>{fosItem.totalCount}</td>
                                                <td style={{ textAlign: 'right', color: '#cccccc', fontWeight: 600, padding: '8px 4px', opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>₹{fosItem.totalPos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                <td style={{ textAlign: 'right', color: '#cccccc', fontWeight: 600, padding: '8px 4px', opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none' }}>100.00%</td>
                                              </tr>
                                              {!isHidden && fosItem.statuses.map(st => (
                                                <tr key={`${fosItem.fos}-${st.status}`} style={{ borderBottom: '1px solid #12202b' }}>
                                                  <td></td>
                                                  <td style={{ padding: '6px 4px 6px 24px', color: '#888888' }}>{st.status}</td>
                                                  <td style={{ textAlign: 'right', color: '#888888', padding: '6px 4px' }}>{st.count}</td>
                                                  <td style={{ textAlign: 'right', color: '#888888', padding: '6px 4px' }}>₹{st.pos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                                  <td style={{ textAlign: 'right', color: '#5cce9d', padding: '6px 4px' }}>{st.percentage}%</td>
                                                </tr>
                                              ))}
                                            </React.Fragment>
                                          )})}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              )}
                            </div>
                          )})}
                        </div>
                        )}
                      </div>
                    )})}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
