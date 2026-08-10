import React from 'react'

export function Icon({ name, size = 18, className = '', style }) {
  const paths = {
    grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
    cases: 'M4 6h16M4 12h16M4 18h11',
    upload: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 20h14',
    users: 'M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20m14-10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    mapping: 'M4 7h11m3 0h2M4 17h3m3 0h10M15 4v6M7 14v6',
    search: 'm20 20-4.5-4.5M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z',
    bell: 'M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8.5 12h5',
    chevron: 'm8 10 4 4 4-4',
    'chevron-down': 'm8 10 4 4 4-4',
    'chevron-up': 'm16 14-4-4-4 4',
    'chevron-left': 'm14 16-4-4 4-4',
    'chevron-right': 'm10 8 4 4-4 4',
    'sidebar-collapse': 'M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5z M9 3v18 M16 15l-3-3 3-3',
    'sidebar-expand': 'M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H5z M9 3v18 M14 9l3 3-3 3',
    phone: 'M7.5 3h3l1.3 4.2-2.1 1.7a15.4 15.4 0 0 0 5.5 5.5l1.7-2.1 4.1 1.3v3A2.5 2.5 0 0 1 18.5 19C10 19 5 14 5 5.5A2.5 2.5 0 0 1 7.5 3Z',
    calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    download: 'M12 3v12m0 0 4-4m-4 4-4-4M5 20h14',
    arrow: 'M5 12h14m-5-5 5 5-5 5',
    close: 'm6 6 12 12M18 6 6 18',
    lock: 'M7 11V8a5 5 0 0 1 10 0v3m-11 0h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z',
    sort: 'M8 5v14m0 0-3-3m3 3 3-3m8-11v14m0-14 3 3m-3-3-3 3',
    filter: 'M4 5h16l-6 7v5l-4 2v-7L4 5Z',
    check: 'm5 12 4 4L19 6',
    file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5V8h4.5M8 13h8M8 17h5',
    spinner: 'M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
    plus: 'M12 5v14M5 12h14',
    drag: 'M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01',
    wand: 'M15 4l5 5-9.5 9.5-5.5 1.5 1.5-5.5L15 4ZM13 6l5 5',
    layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
    undo: 'M3 10h10a5 5 0 0 1 5 5v2M3 10l5 5M3 10l5-5',
    link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
    shield: 'M12 3 4 7v5c0 5.25 3.5 9.74 8 11 4.5-1.26 8-5.75 8-11V7l-8-4Z',
    copy: 'M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2m-4 0h-4m4 0v4M8 4v4h8V4',
    tag: 'M20 7H12l-2-4H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z',
    clock: 'M12 2a10 10 0 1 1 0 20A10 10 0 0 1 12 2zm0 5v5l4 2',
    'arrow-left': 'M19 12H5m0 0 7 7m-7-7 7-7',
    'logout': 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M8 17l-5-5 5-5M15 12H3',
    'pencil': 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7m-1.5-9.5a2.121 2.121 0 0 1 3 3L10 17l-4 1 1-4 10.5-10.5z',
    'eye': 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    'eye-off': 'M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20',
    'settings': 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'
  }
  return (
    <svg className={`icon${className ? ' ' + className : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={style}>
      <path d={paths[name] || ''} />
    </svg>
  )
}

export function Header({ user, role, onLogout }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef(null);

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="topbar">
      <a className="brand" href="#top">
        <img src="/icons/icon.png" width="29" height="29" alt="Recovr logo" style={{ borderRadius: '9px' }} />
        <span><b>Recovr</b></span>
      </a>
      <div className="topbar-actions">
        <div className="profile-menu-container" ref={menuRef} style={{ position: 'relative' }}>
          <div className="profile" onClick={() => setMenuOpen(!menuOpen)} style={{ cursor: 'pointer' }}>
            <span className="avatar">{user[0]}</span>
            <span className="desktop-only"><strong>{user}</strong><small>{role}</small></span>
          </div>
          {menuOpen && (
            <div className="profile-dropdown animate-dropdown" style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: '#181818', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '8px', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.5)', minWidth: '160px' }}>
              <button onClick={onLogout} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '8px 12px', background: 'transparent', border: '1px solid #ef4444', borderRadius: '6px', color: '#ef4444', cursor: 'pointer', fontSize: '14px', fontWeight: 500, transition: 'background 0.2s' }} onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }} onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <Icon name="logout" size={16} />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export function Metric({ label, value, note, tone }) {
  return (
    <article className={`metric ${tone}`}>
      <div><span>{label}</span><strong>{value}</strong></div>
      <p>{note}</p>
    </article>
  )
}

/** Single shimmer bar. width/height are CSS values e.g. "120px", "1em", "60%". */
export function Skeleton({ width = '100%', height = '14px', style }) {
  return (
    <span
      className="skeleton"
      style={{ width, height, display: 'inline-block', ...style }}
    />
  )
}

/** Stack of N shimmer lines simulating a text block or list. */
export function SkeletonBlock({ rows = 3, rowHeight = '14px', gap = '10px', widths }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: rows }).map((_, i) => {
        const w = widths ? widths[i % widths.length] : (i === rows - 1 ? '65%' : '100%')
        return (
          <span
            key={i}
            className="skeleton-block"
            style={{ width: w, height: rowHeight }}
          />
        )
      })}
    </div>
  )
}

/**
 * Full-page skeleton that mirrors the admin-content layout:
 * heading (eyebrow + h1 + subtitle) and N accordion/panel skeletons below.
 * Use this as an early return while data is being fetched for a whole page.
 */
export function PageSkeleton({ panels = 2, showButton = false }) {
  return (
    <div className="page-skeleton">
      {/* Heading row */}
      <div className="page-skeleton-heading">
        <div className="page-skeleton-heading-left">
          <span className="skeleton-block" style={{ width: 100, height: 10, borderRadius: 4 }} />
          <span className="skeleton-block" style={{ width: 240, height: 28, borderRadius: 6 }} />
          <span className="skeleton-block" style={{ width: 320, height: 13, borderRadius: 4 }} />
        </div>
        {showButton && (
          <span className="skeleton-block" style={{ width: 140, height: 36, borderRadius: 8 }} />
        )}
      </div>

      {/* Panel accordion skeletons */}
      {Array.from({ length: panels }).map((_, i) => (
        <div key={i} className="page-skeleton-panel" style={{ marginBottom: 16 }}>
          {/* Panel header bar */}
          <div className="page-skeleton-panel-header">
            <span className="skeleton-block" style={{ width: 160, height: 16, borderRadius: 4 }} />
            <span className="skeleton-block" style={{ width: 18, height: 18, borderRadius: '50%' }} />
          </div>
          {/* Skeleton rows inside panel */}
          {[100, 75, 90].map((w, j) => (
            <div key={j} className="skeleton-table-row" style={{ borderBottom: j < 2 ? '1px solid #1e1e1e' : 'none' }}>
              <span className="skeleton-block" style={{ width: '30%', height: 13, borderRadius: 4, flexShrink: 0 }} />
              <span className="skeleton-block" style={{ width: `${w - 30}%`, height: 13, borderRadius: 4 }} />
              <span className="skeleton-block" style={{ width: '15%', height: 13, borderRadius: 4, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Skeleton rows for a data table body. Renders N rows each with `cols` shimmer cells. */
export function SkeletonTableRows({ rows = 5, cols = 4 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} style={{ borderBottom: '1px solid #1e1e1e' }}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} style={{ padding: '16px 16px' }}>
              <span
                className="skeleton-block"
                style={{
                  width: j === 0 ? '40px' : j === cols - 1 ? '60%' : `${60 + Math.round(Math.sin(i * cols + j) * 20)}%`,
                  height: '13px',
                  borderRadius: '4px'
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function formatDetailValue(tag, rawVal) {
  if (rawVal === undefined || rawVal === null || String(rawVal).trim().toLowerCase() === 'none') return '—'
  const val = String(rawVal).trim()
  const lowerTag = tag.toLowerCase()

  if (lowerTag.includes('date') || lowerTag.includes('time')) {
    const d = new Date(val)
    if (!isNaN(d) && val.length >= 8) {
      return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(d)
    }
  }

  if (lowerTag.includes('mobile') || lowerTag.includes('phone') || lowerTag.includes('contact')) {
    const phoneRegex = /\d{10,}/g
    const phones = val.match(phoneRegex) || []
    if (phones.length > 0) return phones.join(', ')
    return val.replace(/^[\s,]+|[\s,]+$/g, '')
  }

  return val
}

export function CaseAdditionalDetails({ caseData }) {
  const td = caseData.tagData || {}
  const excludeTags = ['new case', 'loan no', 'fos', 'pin code', 'address', 'customer name']

  const expandTags = Object.keys(td).filter(t => !excludeTags.includes(t.toLowerCase()) && td[t])

  const expandTagElements = []
  const processedTags = new Set()

  for (const tag of expandTags) {
    if (processedTags.has(tag)) continue

    const lowerTag = tag.toLowerCase()

    if ((lowerTag === 'reference number' || lowerTag === 'reference mobile') && expandTags.some(t => t.toLowerCase() === 'reference name')) {
      continue
    }

    const rawVal = td[tag]

    if (lowerTag === 'reference name') {
      processedTags.add(tag)
      const mobTag = expandTags.find(t => t.toLowerCase() === 'reference number' || t.toLowerCase() === 'reference mobile')
      const mobVal = mobTag ? td[mobTag] : null

      if (mobTag) processedTags.add(mobTag)

      const isIdentical = (v1, v2) => {
        if (!v1 || !v2) return false
        if (typeof v1 === 'string' && typeof v2 === 'string' && v1 === v2) return true
        if (Array.isArray(v1) && Array.isArray(v2) && v1.length === v2.length && v1.every((val, i) => val === v2[i])) return true
        return false
      }

      if (mobTag && isIdentical(rawVal, mobVal)) {
        const arr = Array.isArray(rawVal) ? rawVal : [rawVal]
        let refIndexCounter = 1

        for (let cIdx = 0; cIdx < arr.length; cIdx++) {
          const combined = arr[cIdx]
          if (!combined || typeof combined !== 'string') continue

          const phoneRegex = /\d{10,}/g
          const phones = combined.match(phoneRegex) || []
          let namesStr = combined.replace(phoneRegex, '|')
          let rawNames = namesStr.split(/[|,]/)
          let names = rawNames
            .map(n => n.replace(/\s+\.$/, '').replace(/^[^a-zA-Z0-9.]+|[^a-zA-Z0-9.]+$/g, '').trim())
            .filter(n => n.length > 1)
          names = names.map(n => n.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '))

          const max = Math.max(phones.length, names.length)
          for (let i = 0; i < max; i++) {
            const n = names[i] || `Reference ${refIndexCounter}`
            const p = phones[i] || null
            if (n && n !== `Reference ${refIndexCounter}`) {
              expandTagElements.push(
                <div key={`RefName_${cIdx}_${i}`} className="fos-detail-item">
                  <span className="fos-detail-label">Reference Name {refIndexCounter}</span>
                  <strong className="fos-detail-val">{n}</strong>
                </div>
              )
            }
            if (p) {
              expandTagElements.push(
                <div key={`RefPhone_${cIdx}_${i}`} className="fos-detail-item">
                  <span className="fos-detail-label">{mobTag} {refIndexCounter}</span>
                  <strong className="fos-detail-val">{p}</strong>
                </div>
              )
            }
            refIndexCounter++
          }
        }
        continue
      }

      const nameArr = Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : [])
      const mobArr = Array.isArray(mobVal) ? mobVal : (mobVal ? [mobVal] : [])

      const maxLen = Math.max(nameArr.length, mobArr.length)
      for (let i = 0; i < maxLen; i++) {
        if (i < nameArr.length) {
          expandTagElements.push(
            <div key={`RefName_${i}`} className="fos-detail-item">
              <span className="fos-detail-label">{tag} {i + 1}</span>
              <strong className="fos-detail-val">{formatDetailValue(tag, nameArr[i])}</strong>
            </div>
          )
        }
        if (i < mobArr.length) {
          expandTagElements.push(
            <div key={`RefPhone_${i}`} className="fos-detail-item">
              <span className="fos-detail-label">{mobTag || 'Reference Number'} {i + 1}</span>
              <strong className="fos-detail-val">{formatDetailValue(mobTag || 'Reference Number', mobArr[i])}</strong>
            </div>
          )
        }
      }
      continue
    }

    if (Array.isArray(rawVal)) {
      rawVal.forEach((v, i) => {
        expandTagElements.push(
          <div key={`${tag}_${i}`} className="fos-detail-item">
            <span className="fos-detail-label">{tag} {i + 1}</span>
            <strong className="fos-detail-val">{formatDetailValue(tag, v)}</strong>
          </div>
        )
      })
      continue
    }

    expandTagElements.push(
      <div key={tag} className="fos-detail-item">
        <span className="fos-detail-label">{tag}</span>
        <strong className="fos-detail-val">{formatDetailValue(tag, rawVal)}</strong>
      </div>
    )
  }

  return expandTagElements.length > 0 ? expandTagElements : (
    <div style={{ color: '#777777', fontSize: 13 }}>No additional standard data available for this case.</div>
  )
}
