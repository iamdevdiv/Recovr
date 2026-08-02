import React, { useState, useEffect, useRef } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { Header, Icon } from '../Shared.jsx'
import { AdminOverview } from './AdminOverview.jsx'
import { Cases } from './Cases.jsx'
import { UploadLots } from './UploadLots.jsx'
import { Mapping } from './Mapping.jsx'
import { TaggingManagement } from './TaggingManagement.jsx'
import { Allocation } from './Allocation.jsx'
import { SheetManagement } from './SheetManagement.jsx'
import { DataReferencing } from './DataReferencing.jsx'
import { Backups } from './Backups.jsx'
import { UsersManagement } from './UsersManagement.jsx'

export function Admin({ onLogout }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [drawerClosing, setDrawerClosing] = useState(false)
  const [, setPrefsUpdated] = useState(0)
  const location = useLocation()

  useEffect(() => {
    const handler = () => setPrefsUpdated(p => p + 1)
    window.addEventListener('prefsChanged', handler)
    return () => window.removeEventListener('prefsChanged', handler)
  }, [])

  function closeDrawer() {
    if (!mobileMenuOpen || drawerClosing) return
    setDrawerClosing(true)
    setTimeout(() => {
      setMobileMenuOpen(false)
      setDrawerClosing(false)
    }, 250)
  }

  // Auto-close mobile drawer on route change
  useEffect(() => {
    if (mobileMenuOpen) closeDrawer()
  }, [location.pathname])

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileMenuOpen])

  const nav = [
    ['overview', 'grid', 'Overview'],
    ['cases', 'cases', 'Cases'],
    ['upload', 'upload', 'Upload lots'],
    ['mapping', 'mapping', 'Initial mapping'],
    ['workbooks', 'layers', 'Workbooks'],
    ['allocation', 'users', 'Allocation'],
    ['referencing', 'link', 'Data referencing'],
    ['backups', 'clock', 'Backups'],
    ['users', 'users', 'Users'],
  ]

  const name = localStorage.getItem('collectionAssistName') || sessionStorage.getItem('collectionAssistName') || 'Divyanshu Tiwari'
  const employeeId = localStorage.getItem('collectionAssistEmployeeId') || sessionStorage.getItem('collectionAssistEmployeeId') || 'ADM629'
  const role = localStorage.getItem('collectionAssistRole') || sessionStorage.getItem('collectionAssistRole') || 'Admin'

  let accessibleModules = []
  try {
    const rawMods = localStorage.getItem('collectionAssistAccessibleModules') || sessionStorage.getItem('collectionAssistAccessibleModules')
    if (rawMods) accessibleModules = JSON.parse(rawMods)
  } catch (e) { }

  if (accessibleModules.length === 0) {
    if (role === 'Admin') {
      accessibleModules = ['overview', 'cases', 'upload', 'mapping', 'workbooks', 'allocation', 'referencing', 'backups', 'users']
    } else if (role === 'Manager') {
      accessibleModules = ['overview', 'cases', 'upload', 'mapping', 'workbooks', 'allocation', 'referencing', 'backups']
    }
  }

  let casesLink = '/admin/cases'
  try {
    const localPrefs = JSON.parse(localStorage.getItem(`lastViewedCases_${employeeId}`))
    if (localPrefs?.colId && localPrefs?.sheetName) {
      casesLink = `/admin/cases?collectionId=${localPrefs.colId}&sheetName=${encodeURIComponent(localPrefs.sheetName)}`
    }
  } catch (e) {}

  const filteredNav = nav.filter(([id]) => role === 'Admin' || accessibleModules.includes(id))

  return (
    <main className={`admin-shell ${isCollapsed ? 'collapsed' : ''}`}>
      {/* ── Mobile Topbar (visible only on mobile via CSS) ── */}
      <div className="admin-mobile-topbar">
        <a className="brand" href="#top">
          <img src="/icons/icon.png" width="27" height="27" alt="Recovr logo" style={{ borderRadius: '8px' }} />
          <span><b>Recovr</b></span>
        </a>
        <button
          className="admin-hamburger-btn"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Open navigation menu"
        >
          <Icon name="cases" size={20} />
        </button>
      </div>

      {/* ── Mobile Drawer Overlay ── */}
      {mobileMenuOpen && (
        <div className={`admin-mobile-backdrop${drawerClosing ? ' closing' : ''}`} onClick={closeDrawer}>
          <aside className={`admin-mobile-drawer${drawerClosing ? ' closing' : ''}`} onClick={e => e.stopPropagation()}>
            <div className="admin-drawer-header">
              <a className="brand" href="#top">
                <img src="/icons/icon.png" width="29" height="29" alt="Recovr logo" style={{ borderRadius: '9px' }} />
                <span><b>Recovr</b></span>
              </a>
              <button className="admin-drawer-close" onClick={closeDrawer}>
                <Icon name="close" size={18} />
              </button>
            </div>
            <nav className="admin-drawer-nav">
              {filteredNav.map(([id, icon, label]) => {
                const toPath = id === 'cases' ? casesLink : `/admin/${id}`
                return (
                  <NavLink
                    key={id}
                    to={toPath}
                    className={({ isActive }) => {
                      let active = isActive
                      if (id === 'cases' && location.pathname === '/admin/cases') active = true
                      return `admin-drawer-link${active ? ' active' : ''}`
                    }}
                  >
                    <Icon name={icon} size={17} />{label}
                  </NavLink>
                )
              })}
            </nav>
            <div className="admin-drawer-foot">
              <div className="admin-drawer-user">
                <span className="avatar">{name[0]}</span>
                <div>
                  <strong>{name}</strong>
                  <small>{employeeId} · {role}</small>
                </div>
              </div>
              <button className="admin-drawer-logout" onClick={onLogout}>
                <Icon name="logout" size={14} />
                Logout
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Desktop Sidebar (hidden on mobile via CSS) ── */}
      <aside className="sidebar">
        <div className="brand-container">
          <a className="brand" href="#top">
            <img src="/icons/icon.png" width="29" height="29" alt="Recovr logo" style={{ borderRadius: '9px' }} />
            <span className="brand-text"><b>Recovr</b></span>
          </a>
          <button
            className="collapse-btn-top"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Icon name={isCollapsed ? 'sidebar-expand' : 'sidebar-collapse'} size={18} />
          </button>
        </div>
        <nav>
          {filteredNav.map(([id, icon, label]) => {
            const toPath = id === 'cases' ? casesLink : `/admin/${id}`
            // We use standard isActive for styling. However, for 'cases', react-router's NavLink matches exactly on path.
            // Since the path could have query params, we need a custom function to match the base pathname.
            return (
              <NavLink
                key={id}
                to={toPath}
                className={({ isActive }) => {
                  // For cases, if current path is /admin/cases, it's active regardless of query params.
                  if (id === 'cases' && location.pathname === '/admin/cases') return 'active'
                  return isActive ? 'active' : ''
                }}
                title={isCollapsed ? label : ''}
              >
                <Icon name={icon} /><span className="nav-label">{label}</span>
              </NavLink>
            )
          })}
        </nav>
      </aside>
      <section className="admin-main">
        <Header user={name} role={employeeId} onLogout={onLogout} />
        <Routes>
          {(role === 'Admin' || accessibleModules.includes('overview')) && <Route path="overview" element={<AdminOverview />} />}
          {(role === 'Admin' || accessibleModules.includes('cases')) && <Route path="cases" element={<Cases />} />}
          {(role === 'Admin' || accessibleModules.includes('upload')) && <Route path="upload" element={<UploadLots />} />}
          {(role === 'Admin' || accessibleModules.includes('mapping')) && <Route path="mapping" element={<Mapping />} />}
          {(role === 'Admin' || accessibleModules.includes('workbooks')) && <Route path="workbooks" element={<SheetManagement />} />}
          {(role === 'Admin' || accessibleModules.includes('allocation')) && <Route path="allocation" element={<Allocation />} />}
          {(role === 'Admin' || accessibleModules.includes('referencing')) && <Route path="referencing" element={<DataReferencing />} />}
          {(role === 'Admin' || accessibleModules.includes('backups')) && <Route path="backups" element={<Backups />} />}
          {(role === 'Admin' || accessibleModules.includes('users')) && <Route path="users" element={<UsersManagement />} />}
          <Route path="*" element={<Navigate to={filteredNav.length > 0 ? `/admin/${filteredNav[0][0]}` : "overview"} replace />} />
        </Routes>
      </section>
    </main>
  )
}
