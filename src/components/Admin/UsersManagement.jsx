import React, { useEffect, useState } from 'react'
import { Icon } from '../Shared.jsx'

// Default tags that should be visible by default (if the sheet has them)
const DEFAULT_VISIBLE_TAGS = [
  'Address', 'Bucket', 'Customer Name', 'Dealer', 'EMI Amount', 'EMI End Date',
  'EMI Start Date', 'Father Name', 'Loan No', 'Lot', 'Mailing Landmark', 'Mobile number', 'New Case',
  'PTP', 'Number of EMI Paid', 'POS', 'Previous Paid Date', 'Paid Date', 'Collected Amount',
  'Mode of Payment', 'Pin Code', 'Product', 'Reference mobile', 'Reference name', 
  'Reference name and mobile', 'Registration Number', 'Status', 'Tenure', 'Time', 'Vehicle'
]

export function UsersManagement() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Modals
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [showPermissionsModal, setShowPermissionsModal] = useState(false)

  // Form State
  const [selectedUser, setSelectedUser] = useState(null)
  const [employeeId, setEmployeeId] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('Field Employee')
  const [fosIdentifiers, setFosIdentifiers] = useState([]) // array of FOS IDs
  const [fosInput, setFosInput] = useState('')              // current typing value
  const [formError, setFormError] = useState('')
  const [showAddPassword, setShowAddPassword] = useState(false)
  const [showEditPassword, setShowEditPassword] = useState(false)

  // Permissions state
  const [workbooks, setWorkbooks] = useState([])
  const [permissions, setPermissions] = useState({})
  const [permSaving, setPermSaving] = useState(false)
  const [permSuccess, setPermSuccess] = useState('')
  const [expandedWorkbooks, setExpandedWorkbooks] = useState(new Set())
  const [expandedSheets, setExpandedSheets] = useState(new Set())
  const [adminFosOptions, setAdminFosOptions] = useState({})

  // Admin modules state
  const [showModulesModal, setShowModulesModal] = useState(false)
  const [adminModules, setAdminModules] = useState([])
  const [modulesSaving, setModulesSaving] = useState(false)

  const currentUserRole = localStorage.getItem('collectionAssistRole') || sessionStorage.getItem('collectionAssistRole') || 'Admin'

  const availableModules = [
    { id: 'overview', label: 'Overview' },
    { id: 'cases', label: 'Cases' },
    { id: 'upload', label: 'Upload Lots' },
    { id: 'mapping', label: 'Initial Mapping' },
    { id: 'workbooks', label: 'Workbooks' },
    { id: 'allocation', label: 'Allocation' },
    { id: 'referencing', label: 'Data Referencing' },
    { id: 'backups', label: 'Backups' },
    { id: 'users', label: 'Users' }
  ]

  useEffect(() => {
    fetchUsers()
  }, [])

  async function fetchUsers() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/users')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setUsers(data.users || [])
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('fetch')) {
        setError('Server is unreachable.')
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  async function openPermissionsModal(user) {
    setSelectedUser(user)
    setPermSuccess('')
    setFormError('')
    // Fetch workbooks + existing permissions in parallel
    const [wbRes, permRes] = await Promise.all([
      fetch('/api/allocation/workbooks'),
      fetch(`/api/users/${user._id}/permissions`)
    ])
    const wbData = await wbRes.json()
    const permData = await permRes.json()
    setWorkbooks(wbData.collections || [])
    setPermissions(permData.permissions || {})
    setExpandedWorkbooks(new Set((wbData.collections || []).map(w => w._id)))
    setExpandedSheets(new Set())
    setAdminFosOptions({})
    setShowPermissionsModal(true)

    if (user.role === 'Admin' || user.role === 'Manager') {
      const collections = wbData.collections || []
      collections.forEach(wb => {
        wb.sheets?.forEach(sheet => {
          const sheetKey = `${wb._id}__${sheet.name}`
          const fosCol = sheet.standardColumns?.find(c => c.tag === 'FOS')
          if (fosCol) {
            fetch(`/api/collections/${wb._id}/distinct?sheetName=${encodeURIComponent(sheet.name)}&column=${encodeURIComponent(fosCol.label)}`)
              .then(res => res.json())
              .then(data => {
                setAdminFosOptions(prevOpts => ({ ...prevOpts, [sheetKey]: data.values || [] }))
              })
              .catch(err => console.error(err))
          } else {
            setAdminFosOptions(prevOpts => ({ ...prevOpts, [sheetKey]: [] }))
          }
        })
      })
    }
  }

  function openAddModal() {
    setEmployeeId('')
    setName('')
    setPassword('')
    setRole('Field Employee')
    setFosIdentifiers([])
    setFosInput('')
    setFormError('')
    setShowAddPassword(false)
    setShowAddModal(true)
  }

  function openEditModal(user) {
    setSelectedUser(user)
    setEmployeeId(user.employeeId || '')
    setName(user.name || '')
    setRole(user.role)
    // Use new fosIdentifiers array
    const ids = user.fosIdentifiers?.length > 0 ? [...user.fosIdentifiers] : []
    setFosIdentifiers(ids)
    setFosInput('')
    setPassword('')
    setFormError('')
    setShowEditPassword(false)
    setShowEditModal(true)
  }

  function openDeleteModal(user) {
    setSelectedUser(user)
    setFormError('')
    setShowDeleteModal(true)
  }

  function openModulesModal(user) {
    setSelectedUser(user)
    setAdminModules(user.accessibleModules || ['overview', 'cases', 'upload', 'mapping', 'workbooks', 'allocation', 'referencing'])
    setFormError('')
    setPermSuccess('')
    setShowModulesModal(true)
  }

  async function handleAddSubmit(e) {
    e.preventDefault()
    setFormError('')
    if (!employeeId || !name || !password || !role) {
      setFormError('All fields are required.')
      return
    }
    const upperId = employeeId.toUpperCase()
    if (role === 'Field Employee' && !/^FOS\d{3}$/.test(upperId)) {
      setFormError('Field Employee ID must be in the format FOSXXX.')
      return
    }
    if ((role === 'Manager' || role === 'Admin') && !/^ADM\d{3}$/.test(upperId)) {
      setFormError('Manager and Admin IDs must be in the format ADMXXX.')
      return
    }

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employeeId.toUpperCase(), name, password, role, fosIdentifiers })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)

      setUsers(prev => [data.user, ...prev])
      setPermSuccess('User created successfully.')
      setTimeout(() => setPermSuccess(''), 3000)
      setShowAddModal(false)
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('fetch')) {
        setFormError('Server is unreachable.')
      } else {
        setFormError(err.message)
      }
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault()
    setFormError('')

    try {
      const body = { role, employeeId, name, fosIdentifiers }
      if (password) body.password = password

      const res = await fetch(`/api/users/${selectedUser._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)

      setUsers(prev => prev.map(u => u._id === selectedUser._id ? data.user : u))
      setPermSuccess('User updated successfully.')
      setTimeout(() => setPermSuccess(''), 3000)
      setShowEditModal(false)
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('fetch')) {
        setFormError('Server is unreachable.')
      } else {
        setFormError(err.message)
      }
    }
  }

  async function handleDeleteConfirm() {
    setFormError('')
    try {
      const res = await fetch(`/api/users/${selectedUser._id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.message)
      }

      setUsers(prev => prev.filter(u => u._id !== selectedUser._id))
      setPermSuccess('User deleted successfully.')
      setTimeout(() => setPermSuccess(''), 3000)
      setShowDeleteModal(false)
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('fetch')) {
        setFormError('Server is unreachable.')
      } else {
        setFormError(err.message)
      }
    }
  }

  async function handleSavePermissions() {
    setPermSaving(true)
    setPermSuccess('')
    try {
      const res = await fetch(`/api/users/${selectedUser._id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)
      setPermSuccess('Permissions saved successfully.')
      setTimeout(() => setPermSuccess(''), 3000)
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('fetch')) {
        setFormError('Server is unreachable.')
      } else {
        setFormError(err.message)
      }
    } finally {
      setPermSaving(false)
    }
  }

  async function handleSaveModules() {
    setModulesSaving(true)
    setPermSuccess('')
    setFormError('')
    try {
      const res = await fetch(`/api/users/${selectedUser._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessibleModules: adminModules })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message)

      setUsers(prev => prev.map(u => u._id === selectedUser._id ? data.user : u))
      setPermSuccess('Modules saved successfully.')
      setTimeout(() => setShowModulesModal(false), 1500)
    } catch (err) {
      if (err.message.includes('JSON') || err.message.includes('fetch')) {
        setFormError('Server is unreachable.')
      } else {
        setFormError(err.message)
      }
    } finally {
      setModulesSaving(false)
    }
  }

  function toggleWorkbook(wbId) {
    setPermissions(prev => {
      const current = prev[wbId] || { enabled: false, sheets: {} }
      const newEnabled = !current.enabled
      let newSheets = { ...(current.sheets || {}) }

      if (newEnabled) {
        const wb = workbooks.find(w => w._id === wbId)
        if (wb && wb.sheets) {
          wb.sheets.forEach(sheet => {
            const sheetTags = []
            if (sheet.standardColumns) {
              sheet.standardColumns.forEach(c => {
                if (c.tag && c.tag !== 'None') {
                  c.tag.split(',').forEach(t => sheetTags.push(t.trim()))
                }
              })
            }
            const uniqueSheetTags = [...new Set(sheetTags)]
            const sheetKey = `${wb._id}__${sheet.name}`

            const visibleTags = (selectedUser?.role === 'Admin' || selectedUser?.role === 'Manager')
              ? (adminFosOptions[sheetKey] || [])
              : uniqueSheetTags.filter(t => DEFAULT_VISIBLE_TAGS.includes(t))

            newSheets[sheet.name] = {
              ...newSheets[sheet.name],
              enabled: true,
              visibleTags: newSheets[sheet.name]?.visibleTags?.length > 0 ? newSheets[sheet.name].visibleTags : visibleTags
            }
          })
        }
      } else {
        Object.keys(newSheets).forEach(sheetName => {
          newSheets[sheetName] = {
            ...newSheets[sheetName],
            enabled: false
          }
        })
      }

      return { ...prev, [wbId]: { ...current, enabled: newEnabled, sheets: newSheets } }
    })
  }

  function toggleSheet(wbId, sheetName, sheetTags) {
    setPermissions(prev => {
      const wb = prev[wbId] || { enabled: true, sheets: {} }
      const currentSheet = (wb.sheets || {})[sheetName] || { enabled: false, visibleTags: [] }
      const newEnabled = !currentSheet.enabled
      const visibleTags = newEnabled && currentSheet.visibleTags.length === 0
        ? ((selectedUser?.role === 'Admin' || selectedUser?.role === 'Manager') ? sheetTags : sheetTags.filter(t => DEFAULT_VISIBLE_TAGS.includes(t)))
        : currentSheet.visibleTags
      const newSheets = {
        ...(wb.sheets || {}),
        [sheetName]: { enabled: newEnabled, visibleTags }
      }

      const anySheetEnabled = Object.values(newSheets).some(s => s.enabled)
      const wbEnabled = newEnabled ? true : anySheetEnabled

      return {
        ...prev,
        [wbId]: {
          ...wb,
          enabled: wbEnabled,
          sheets: newSheets
        }
      }
    })
  }

  function toggleTag(wbId, sheetName, tag) {
    setPermissions(prev => {
      const wb = prev[wbId] || { enabled: true, sheets: {} }
      const sheet = (wb.sheets || {})[sheetName] || { enabled: true, visibleTags: [] }
      const tags = sheet.visibleTags || []
      const newTags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag]
      return {
        ...prev,
        [wbId]: {
          ...wb,
          sheets: {
            ...(wb.sheets || {}),
            [sheetName]: { ...sheet, visibleTags: newTags }
          }
        }
      }
    })
  }

  function toggleAllTags(wbId, sheetName, allTags, selectAll) {
    setPermissions(prev => {
      const wb = prev[wbId] || { enabled: true, sheets: {} }
      const sheet = (wb.sheets || {})[sheetName] || { enabled: true, visibleTags: [] }
      return {
        ...prev,
        [wbId]: {
          ...wb,
          sheets: {
            ...(wb.sheets || {}),
            [sheetName]: { ...sheet, visibleTags: selectAll ? [...allTags] : [] }
          }
        }
      }
    })
  }

  function toggleWbExpand(wbId) {
    setExpandedWorkbooks(prev => {
      const s = new Set(prev)
      s.has(wbId) ? s.delete(wbId) : s.add(wbId)
      return s
    })
  }

  function toggleSheetExpand(key, wbId, sheet) {
    setExpandedSheets(prev => {
      const s = new Set(prev)
      if (s.has(key)) {
        s.delete(key)
      } else {
        s.add(key)
      }
      return s
    })
  }

  if (loading) return (
    <div className="admin-content">
      <div className="admin-heading">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="skeleton-block" style={{ width: 95, height: 10, borderRadius: 3 }} />
          <span className="skeleton-block" style={{ width: 210, height: 32, borderRadius: 6 }} />
          <span className="skeleton-block" style={{ width: 360, height: 13, borderRadius: 4 }} />
        </div>
        <span className="skeleton-block" style={{ width: 110, height: 36, borderRadius: 8, flexShrink: 0 }} />
      </div>

      <section className="panel" style={{ marginTop: 24, padding: '16px 24px' }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #252525' }}>
              <th style={{ padding: '12px 8px', width: '14%' }}><span className="skeleton-block" style={{ width: '70%', height: 12, borderRadius: 3 }} /></th>
              <th style={{ padding: '12px 8px', width: '24%' }}><span className="skeleton-block" style={{ width: '55%', height: 12, borderRadius: 3 }} /></th>
              <th style={{ padding: '12px 8px', width: '13%' }}><span className="skeleton-block" style={{ width: '65%', height: 12, borderRadius: 3 }} /></th>
              <th style={{ padding: '12px 8px', width: '33%' }}><span className="skeleton-block" style={{ width: '40%', height: 12, borderRadius: 3 }} /></th>
              <th style={{ padding: '12px 8px', width: '16%', textAlign: 'right' }}><span className="skeleton-block" style={{ width: '55%', height: 12, borderRadius: 3, marginLeft: 'auto', display: 'block' }} /></th>
            </tr>
          </thead>
          <tbody>
            {[75, 60, 80, 55, 70].map((nameW, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #252525' }}>
                <td style={{ padding: '15px 8px' }}><span className="skeleton-block" style={{ width: '65%', height: 14, borderRadius: 4 }} /></td>
                <td style={{ padding: '15px 8px' }}><span className="skeleton-block" style={{ width: `${nameW}%`, height: 14, borderRadius: 4 }} /></td>
                <td style={{ padding: '15px 8px' }}><span className="skeleton-block" style={{ width: 72, height: 22, borderRadius: 12 }} /></td>
                <td style={{ padding: '15px 8px' }}><span className="skeleton-block" style={{ width: '60%', height: 14, borderRadius: 4 }} /></td>
                <td style={{ padding: '15px 8px', textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <span className="skeleton-block" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                    <span className="skeleton-block" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                    <span className="skeleton-block" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )

  if (error) return (
    <div className="admin-content">
      <div className="admin-heading" style={{ marginBottom: 24 }}>
        <div>
          <span className="eyebrow">ACCESS CONTROL</span>
          <h1>Users Management</h1>
        </div>
      </div>
      <div style={{ background: '#111111', border: '1px solid #6b2a2a', borderRadius: 8, padding: '18px 22px', color: '#e88080', fontSize: 14 }}>
        <strong>Failed to load users:</strong> {error}
      </div>
    </div>
  )

  return (
    <div className="admin-content">
      <div className="admin-heading">
        <div>
          <span className="eyebrow">ACCESS CONTROL</span>
          <h1>Users Management</h1>
          <p>Manage access to the admin panel by creating or updating user roles.</p>
        </div>
        <button className="primary-button" onClick={openAddModal}>
          <Icon name="plus" size={16} /> Add User
        </button>
      </div>

      {error && <p className="form-error" style={{ marginBottom: 16 }}>{error}</p>}

      <section className="panel users-table-wrap" style={{ marginTop: 24, padding: '16px 24px' }}>
        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #252525' }}>
              <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500' }}>Employee ID</th>
              <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500' }}>Name</th>
              <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500' }}>Role</th>
              <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500' }}>FOS ID</th>
              <th style={{ padding: '12px 8px', color: '#777777', fontWeight: '500', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan="5" style={{ padding: '24px 8px', textAlign: 'center', color: '#777777' }}>No users found.</td></tr>
            ) : (
              users.map(user => (
                <tr key={user._id} style={{ borderBottom: '1px solid #252525' }}>
                  <td style={{ padding: '12px 8px', fontWeight: '500' }}>{user.employeeId}</td>
                  <td style={{ padding: '12px 8px' }}>{user.name}</td>
                  <td style={{ padding: '12px 8px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 12,
                      backgroundColor: user.role === 'Admin' ? '#e74c3c22' : user.role === 'Manager' ? '#f39c1222' : '#2ecc7122',
                      color: user.role === 'Admin' ? '#e74c3c' : user.role === 'Manager' ? '#f39c12' : '#2ecc71'
                    }}>
                      {user.role}
                    </span>
                  </td>
                  <td style={{ padding: '12px 8px', maxWidth: 200 }}>
                    {(() => {
                      const ids = user.fosIdentifiers?.length > 0 ? user.fosIdentifiers : []
                      return ids.length > 0
                        ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {ids.map(id => (
                              <span key={id} style={{ background: '#1a2a2a', color: '#6be2c7', border: '1px solid #2a3a3a', borderRadius: 10, padding: '1px 8px', fontSize: 12, fontWeight: 500 }}>{id}</span>
                            ))}
                          </div>
                        : <span style={{ color: '#555555' }}>—</span>
                    })()}
                  </td>
                  <td style={{ padding: '12px 8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                      {(user.role === 'Field Employee' || user.role === 'Admin' || user.role === 'Manager') && (
                        <button className="icon-button" title="Manage Permissions" onClick={() => openPermissionsModal(user)}
                          style={{ color: '#6be2c7' }}>
                          <Icon name="shield" size={16} />
                        </button>
                      )}
                      {currentUserRole === 'Admin' ? (
                        <button className="icon-button" title="Manage Modules" onClick={() => openModulesModal(user)}
                          style={{ color: '#5dade2' }}>
                          <Icon name="layers" size={16} />
                        </button>
                      ) : (
                        <div style={{ visibility: 'hidden' }} className="icon-button" aria-hidden="true">
                          <Icon name="layers" size={16} />
                        </div>
                      )}
                      <button className="icon-button" title="Edit User" onClick={() => openEditModal(user)}>
                        <Icon name="wand" size={16} />
                      </button>
                      <button className="icon-button filter-remove" title="Delete User" onClick={() => openDeleteModal(user)}>
                        <Icon name="trash" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { setShowAddModal(false); setFormError(''); } }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <button className="close-button" type="button" onClick={() => setShowAddModal(false)}><Icon name="close" size={20} /></button>
            <h2>Add new user</h2>
            <form onSubmit={handleAddSubmit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label>
                Employee ID
                <input
                  type="text"
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value.toUpperCase())}
                  placeholder="FOSXXX or ADMXXX"
                  autoFocus
                  required
                />
              </label>
              <label>
                Name
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Full name"
                  required
                />
              </label>
              <label>
                Password
                <div style={{ position: 'relative' }}>
                  <input
                    type={showAddPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                    style={{ paddingRight: 36, width: '100%', boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddPassword(p => !p)}
                    tabIndex="-1"
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#777777', cursor: 'pointer', padding: 4, display: 'flex' }}
                  >
                    <Icon name={showAddPassword ? 'eye-off' : 'eye'} size={16} />
                  </button>
                </div>
              </label>
              <label>
                Role
                <select value={role} onChange={e => setRole(e.target.value)} required>
                  <option value="Field Employee">Field Employee</option>
                  <option value="Manager">Manager</option>
                  <option value="Admin">Admin</option>
                </select>
              </label>
              <label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span>FOS Identifiers</span><span style={{ fontWeight: 'normal', color: '#777777' }}>(optional)</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 38, background: '#181818', border: `1px solid ${fosInput === ':focus' ? '#6be2c7' : '#2e2e2e'}`, borderRadius: 8, padding: '5px 12px', alignItems: 'center', cursor: 'text', transition: 'border-color .15s' }}
                  onClick={() => document.getElementById('fosInputAdd').focus()}>
                  {fosIdentifiers.map(id => (
                    <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1a2a2a', color: '#6be2c7', border: '1px solid #2a3a3a', borderRadius: 10, padding: '2px 8px', fontSize: 12, fontWeight: 500 }}>
                      {id}
                      <button type="button" onClick={() => setFosIdentifiers(prev => prev.filter(x => x !== id))}
                        style={{ background: 'none', border: 'none', color: '#6be2c7', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 14, opacity: 0.7 }}>×</button>
                    </span>
                  ))}
                  <input id="fosInputAdd" value={fosInput === ':focus' ? '' : fosInput} onChange={e => setFosInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const val = fosInput.trim()
                        if (val && !fosIdentifiers.includes(val)) setFosIdentifiers(prev => [...prev, val])
                        setFosInput('')
                      } else if (e.key === 'Backspace' && !fosInput) setFosIdentifiers(prev => prev.slice(0, -1))
                    }}
                    onFocus={() => {
                      const el = document.getElementById('fosInputAdd').parentElement;
                      el.style.borderColor = '#6be2c7';
                    }}
                    onBlur={() => { 
                      const el = document.getElementById('fosInputAdd').parentElement;
                      el.style.borderColor = '#2e2e2e';
                      const val = fosInput.trim(); 
                      if (val && !fosIdentifiers.includes(val)) setFosIdentifiers(prev => [...prev, val]); 
                      setFosInput('') 
                    }}
                    placeholder={fosIdentifiers.length === 0 ? 'Type and press Enter...' : ''}
                    style={{ border: 'none', outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: 14, flex: 1, minWidth: 80, padding: '2px 0' }}
                  />
                </div>
                <span style={{ fontSize: 11, color: '#555555', marginTop: 4, display: 'block' }}>Press Enter to add each ID</span>
              </label>



              <button type="submit" className="primary-button" style={{ marginTop: 8 }}>Create User</button>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { setShowEditModal(false); setFormError(''); } }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <button className="close-button" type="button" onClick={() => setShowEditModal(false)}><Icon name="close" size={20} /></button>
            <h2>Edit {selectedUser.employeeId}</h2>
            <form onSubmit={handleEditSubmit} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <label>
                Name
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Full name"
                  required
                />
              </label>
              <label>
                Role
                <select value={role} onChange={e => setRole(e.target.value)} required>
                  <option value="Field Employee">Field Employee</option>
                  <option value="Manager">Manager</option>
                  <option value="Admin">Admin</option>
                </select>
              </label>
              <label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span>FOS Identifiers</span><span style={{ fontWeight: 'normal', color: '#777777' }}>(optional)</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, minHeight: 38, background: '#181818', border: '1px solid #2e2e2e', borderRadius: 8, padding: '5px 12px', alignItems: 'center', cursor: 'text', transition: 'border-color .15s' }}
                  onClick={() => document.getElementById('fosInputEdit').focus()}>
                  {fosIdentifiers.map(id => (
                    <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1a2a2a', color: '#6be2c7', border: '1px solid #2a3a3a', borderRadius: 10, padding: '2px 8px', fontSize: 12, fontWeight: 500 }}>
                      {id}
                      <button type="button" onClick={() => setFosIdentifiers(prev => prev.filter(x => x !== id))}
                        style={{ background: 'none', border: 'none', color: '#6be2c7', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 14, opacity: 0.7 }}>×</button>
                    </span>
                  ))}
                  <input id="fosInputEdit" value={fosInput} onChange={e => setFosInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        const val = fosInput.trim()
                        if (val && !fosIdentifiers.includes(val)) setFosIdentifiers(prev => [...prev, val])
                        setFosInput('')
                      } else if (e.key === 'Backspace' && !fosInput) setFosIdentifiers(prev => prev.slice(0, -1))
                    }}
                    onFocus={() => {
                      const el = document.getElementById('fosInputEdit').parentElement;
                      el.style.borderColor = '#6be2c7';
                    }}
                    onBlur={() => { 
                      const el = document.getElementById('fosInputEdit').parentElement;
                      el.style.borderColor = '#2e2e2e';
                      const val = fosInput.trim(); 
                      if (val && !fosIdentifiers.includes(val)) setFosIdentifiers(prev => [...prev, val]); 
                      setFosInput('') 
                    }}
                    placeholder={fosIdentifiers.length === 0 ? 'Type and press Enter...' : ''}
                    style={{ border: 'none', outline: 'none', background: 'transparent', color: '#eeeeee', fontSize: 14, flex: 1, minWidth: 80, padding: '2px 0' }}
                  />
                </div>
                <span style={{ fontSize: 11, color: '#555555', marginTop: 4, display: 'block' }}>Press Enter to add each ID</span>
              </label>
              <label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span>New Password</span><span style={{ fontWeight: 'normal', color: '#777777' }}>(optional)</span>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showEditPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                    style={{ paddingRight: 36, width: '100%', boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(p => !p)}
                    tabIndex="-1"
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#777777', cursor: 'pointer', padding: 4, display: 'flex' }}
                  >
                    <Icon name={showEditPassword ? 'eye-off' : 'eye'} size={16} />
                  </button>
                </div>
              </label>



              <button type="submit" className="primary-button" style={{ marginTop: 8 }}>Save Changes</button>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Modal */}
      {showDeleteModal && selectedUser && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) { setShowDeleteModal(false); setFormError(''); } }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <button className="close-button" type="button" onClick={() => setShowDeleteModal(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow" style={{ color: '#e88080' }}>DANGER ZONE</span>
            <h2>Delete User</h2>
            <p>Are you sure you want to permanently delete user <strong>{selectedUser.employeeId}</strong>?</p>



            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button type="button" className="outlined-button" onClick={() => setShowDeleteModal(false)} style={{ flex: 1 }}>Cancel</button>
              <button type="button" className="primary-button" style={{ background: '#a13b3b', flex: 1 }} onClick={handleDeleteConfirm}>Delete User</button>
            </div>
          </div>
        </div>
      )}

      {/* Permissions Modal */}
      {showPermissionsModal && selectedUser && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowPermissionsModal(false)}>
          <div className="modal" style={{ maxWidth: 600, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <button className="close-button" type="button" onClick={() => setShowPermissionsModal(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow">DATA ACCESS</span>
            <h2 style={{ marginBottom: 4 }}>Permissions for {selectedUser.name}</h2>
            {selectedUser.role === 'Admin' ? (
              <div style={{ marginBottom: 16, marginTop: 4, padding: '12px', background: 'rgba(231, 76, 60, 0.1)', border: '1px solid rgba(231, 76, 60, 0.2)', borderRadius: 6 }}>
                <p style={{ margin: 0, fontSize: 12, color: '#e74c3c', fontWeight: 500 }}>Admins have unrestricted access to all cases. All data access configurations are bypassed.</p>
              </div>
            ) : (
              <p style={{ color: '#777777', fontSize: 12, marginBottom: 16, marginTop: 4 }}>
                {selectedUser.role === 'Field Employee'
                  ? 'Select which workbooks, sheets, and data tags this FOS can access.'
                  : `Select which workbooks, sheets, and FOS names this ${selectedUser.role.toLowerCase()} can access.`}
              </p>
            )}

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {workbooks.length === 0 ? (
                <div style={{ color: '#5a7a8a', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                  No workbooks found. Upload and configure workbooks first.
                </div>
              ) : workbooks.map(wb => {
                const wbPerm = permissions[wb._id] || { enabled: false, sheets: {} }
                const isExpanded = expandedWorkbooks.has(wb._id)
                return (
                  <div key={wb._id} style={{ border: `1px solid ${selectedUser.role === 'Admin' || wbPerm.enabled ? '#3a6b5e' : '#252525'}`, borderRadius: 8, background: selectedUser.role === 'Admin' || wbPerm.enabled ? '#0d2220' : '#181818' }}>
                    {/* Workbook header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: selectedUser.role === 'Admin' ? 'default' : 'pointer' }}
                      onClick={() => selectedUser.role !== 'Admin' && toggleWbExpand(wb._id)}>
                      {selectedUser.role !== 'Admin' && (
                        <input
                          type="checkbox"
                          checked={!!wbPerm.enabled}
                          onChange={e => toggleWorkbook(wb._id)}
                          onClick={e => e.stopPropagation()}
                          style={{ width: 15, height: 15, accentColor: '#6be2c7', cursor: 'pointer', flexShrink: 0 }}
                          title={wbPerm.enabled ? "Disable all sheets" : "Enable all sheets"}
                        />
                      )}
                      <Icon name="layers" size={15} style={{ color: selectedUser.role === 'Admin' || wbPerm.enabled ? '#6be2c7' : '#4a6070' }} />
                      <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: selectedUser.role === 'Admin' || wbPerm.enabled ? '#c8eee5' : '#777777' }}>{wb.name}</span>
                      <span style={{ fontSize: 10, color: '#555555' }}>{wb.sheets.length} sheets</span>
                      {selectedUser.role !== 'Admin' && (
                        <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} style={{ color: '#555555' }} />
                      )}
                    </div>

                    {/* Sheets */}
                    {isExpanded && selectedUser.role !== 'Admin' && (
                      <div style={{ borderTop: '1px solid #252525', padding: '8px 14px 12px' }}>
                        {wb.sheets.map(sheet => {
                          const sheetPerm = (wbPerm.sheets || {})[sheet.name] || { enabled: false, visibleTags: [] }
                          const sheetKey = `${wb._id}__${sheet.name}`
                          const isSheetExpanded = expandedSheets.has(sheetKey)
                          // Get all tags available on this sheet
                          const sheetTags = []
                          if (sheet.standardColumns) {
                            sheet.standardColumns.forEach(c => {
                              if (c.tag && c.tag !== 'None') {
                                c.tag.split(',').forEach(t => sheetTags.push(t.trim()))
                              }
                            })
                          }
                          const uniqueSheetTags = [...new Set(sheetTags)]
                          const visibleTags = sheetPerm.visibleTags || []
                          const allSelected = uniqueSheetTags.length > 0 && uniqueSheetTags.every(t => visibleTags.includes(t))

                          return (
                            <div key={sheet.name} style={{ marginLeft: 24, marginTop: 8, border: `1px solid ${sheetPerm.enabled ? '#2a4d42' : '#252525'}`, borderRadius: 6, background: sheetPerm.enabled ? '#0b1e1c' : '#141414' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer' }}
                                onClick={() => toggleSheetExpand(sheetKey, wb._id, sheet)}>
                                <input
                                  type="checkbox"
                                  checked={!!sheetPerm.enabled}
                                  disabled={selectedUser.role === 'Admin'}
                                  onChange={e => toggleSheet(wb._id, sheet.name, uniqueSheetTags)}
                                  onClick={e => e.stopPropagation()}
                                  style={{ width: 14, height: 14, accentColor: '#6be2c7', cursor: selectedUser.role === 'Admin' ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: selectedUser.role === 'Admin' ? 0.5 : 1 }}
                                />
                                <Icon name="file" size={13} style={{ color: sheetPerm.enabled ? '#5ad4bc' : '#3a5060' }} />
                                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: sheetPerm.enabled ? '#a8e8dc' : '#5a7a8a' }}>{sheet.name}</span>
                                {sheetPerm.enabled && (
                                  <span style={{ fontSize: 10, color: '#4a8070' }}>
                                    {(selectedUser.role === 'Admin' || selectedUser.role === 'Manager')
                                      ? (adminFosOptions[sheetKey] !== undefined ? `${visibleTags.filter(t => adminFosOptions[sheetKey].includes(t)).length}/${adminFosOptions[sheetKey].length} FOS` : 'Loading...')
                                      : `${visibleTags.filter(t => uniqueSheetTags.includes(t)).length}/${uniqueSheetTags.length} tags`}
                                  </span>
                                )}
                                <Icon name={isSheetExpanded ? 'chevron-up' : 'chevron-down'} size={12} style={{ color: '#3a5060' }} />
                              </div>

                              {/* Tag selection */}
                              {isSheetExpanded && sheetPerm.enabled && (
                                <div style={{ borderTop: '1px solid #1a2c3a', padding: '8px 12px' }}>
                                  {(selectedUser.role === 'Admin' || selectedUser.role === 'Manager') ? (
                                    <>

                                      {adminFosOptions[sheetKey] === undefined ? (
                                        <p style={{ fontSize: 11, color: '#555555', margin: 0 }}>Loading FOS names...</p>
                                      ) : adminFosOptions[sheetKey].length === 0 ? (
                                        <p style={{ fontSize: 11, color: '#555555', margin: 0 }}>No FOS data found for this sheet.</p>
                                      ) : (
                                        <>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                            <span style={{ fontSize: 10, color: '#555555', fontWeight: 600 }}>VISIBLE FOS NAMES</span>
                                            <button type="button" className="text-button" style={{ fontSize: 10, opacity: selectedUser.role === 'Admin' ? 0.5 : 1, cursor: selectedUser.role === 'Admin' ? 'not-allowed' : 'pointer' }}
                                              disabled={selectedUser.role === 'Admin'}
                                              onClick={() => toggleAllTags(wb._id, sheet.name, adminFosOptions[sheetKey], adminFosOptions[sheetKey].length > 0 && adminFosOptions[sheetKey].every(t => visibleTags.includes(t)) ? false : true)}>
                                              {(adminFosOptions[sheetKey].length > 0 && adminFosOptions[sheetKey].every(t => visibleTags.includes(t))) ? 'Deselect all' : 'Select all'}
                                            </button>
                                          </div>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {adminFosOptions[sheetKey].map(fos => {
                                              const isOn = visibleTags.includes(fos)
                                              return (
                                                <button
                                                  key={fos}
                                                  type="button"
                                                  disabled={selectedUser.role === 'Admin'}
                                                  onClick={() => toggleTag(wb._id, sheet.name, fos)}
                                                  style={{
                                                    padding: '3px 9px',
                                                    borderRadius: 20,
                                                    fontSize: 11,
                                                    border: `1px solid ${isOn ? '#3a7a6c' : '#2e2e2e'}`,
                                                    background: isOn ? '#123a32' : '#141414',
                                                    color: isOn ? '#7be4cf' : '#4a6275',
                                                    cursor: selectedUser.role === 'Admin' ? 'not-allowed' : 'pointer',
                                                    opacity: selectedUser.role === 'Admin' ? 0.7 : 1,
                                                    fontFamily: 'inherit',
                                                    transition: 'all .15s'
                                                  }}
                                                >
                                                  {fos}
                                                </button>
                                              )
                                            })}
                                          </div>
                                        </>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      {uniqueSheetTags.length === 0 ? (
                                        <p style={{ fontSize: 11, color: '#555555', margin: 0 }}>No tags configured for this sheet yet.</p>
                                      ) : (
                                        <>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                            <span style={{ fontSize: 10, color: '#555555', fontWeight: 600 }}>VISIBLE TAGS</span>
                                            <button type="button" className="text-button" style={{ fontSize: 10 }}
                                              onClick={() => toggleAllTags(wb._id, sheet.name, uniqueSheetTags, !allSelected)}>
                                              {allSelected ? 'Deselect all' : 'Select all'}
                                            </button>
                                          </div>
                                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {uniqueSheetTags.map(tag => {
                                              const isOn = visibleTags.includes(tag);
                                              return (
                                                <button
                                                  key={tag}
                                                  type="button"
                                                  onClick={() => toggleTag(wb._id, sheet.name, tag)}
                                                  style={{
                                                    padding: '3px 9px',
                                                    borderRadius: 20,
                                                    fontSize: 11,
                                                    border: `1px solid ${isOn ? '#3a7a6c' : '#2e2e2e'}`,
                                                    background: isOn ? '#123a32' : '#141414',
                                                    color: isOn ? '#7be4cf' : '#4a6275',
                                                    cursor: 'pointer',
                                                    fontFamily: 'inherit',
                                                    transition: 'all .15s'
                                                  }}
                                                >
                                                  {tag}
                                                </button>
                                              )
                                            })}
                                          </div>
                                        </>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>



            <div style={{ display: 'flex', gap: 12, marginTop: 16, paddingTop: 16, borderTop: '1px solid #252525' }}>
              <button type="button" className="outlined-button" onClick={() => setShowPermissionsModal(false)}>Cancel</button>
              <button type="button" className="primary-button" style={{ flex: 1, opacity: selectedUser.role === 'Admin' ? 0.5 : 1, cursor: selectedUser.role === 'Admin' ? 'not-allowed' : 'pointer' }} onClick={handleSavePermissions} disabled={permSaving || selectedUser.role === 'Admin'}>
                {permSaving ? <><Icon name="spinner" size={14} className="spin-icon" /> Saving...</> : 'Save Permissions'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Modules Modal */}
      {showModulesModal && selectedUser && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowModulesModal(false)}>
          <div className="modal" style={{ maxWidth: 400, width: '100%' }}>
            <button className="close-button" type="button" onClick={() => setShowModulesModal(false)}><Icon name="close" size={20} /></button>
            <span className="eyebrow">MODULE ACCESS</span>
            <h2 style={{ marginBottom: 4 }}>Modules for {selectedUser.name}</h2>
            {selectedUser.role === 'Admin' ? (
              <div style={{ marginBottom: 16, marginTop: 4, padding: '12px', background: 'rgba(231, 76, 60, 0.08)', border: '1px solid rgba(231, 76, 60, 0.2)', borderRadius: 6 }}>
                <p style={{ margin: 0, fontSize: 12, color: '#e74c3c', fontWeight: 500 }}>Admins have unrestricted access to all modules. Module restrictions don't apply to Admin users.</p>
              </div>
            ) : selectedUser.role === 'Field Employee' ? (
              <div style={{ marginBottom: 16, marginTop: 4, padding: '12px', background: 'rgba(100, 100, 100, 0.08)', border: '1px solid rgba(100, 100, 100, 0.2)', borderRadius: 6 }}>
                <p style={{ margin: 0, fontSize: 12, color: '#777777', fontWeight: 500 }}>Field Employees don't have access to admin modules.</p>
              </div>
            ) : (
              <p style={{ color: '#777777', fontSize: 12, marginBottom: 20 }}>
                Select which admin modules this manager can access.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {availableModules.map(mod => {
                const isAdmin = selectedUser.role === 'Admin'
                const isFOS = selectedUser.role === 'Field Employee'
                const checked = isAdmin ? true : isFOS ? false : adminModules.includes(mod.id)
                const disabled = isAdmin || isFOS
                return (
                  <label key={mod.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={e => {
                        if (disabled) return
                        if (e.target.checked) setAdminModules(p => [...p, mod.id])
                        else setAdminModules(p => p.filter(m => m !== mod.id))
                      }}
                      style={{ width: 16, height: 16, accentColor: '#6be2c7', cursor: disabled ? 'not-allowed' : 'pointer' }}
                    />
                    <span style={{ fontSize: 14, color: '#c8eee5' }}>{mod.label}</span>
                  </label>
                )
              })}
            </div>



            <div style={{ display: 'flex', gap: 12, marginTop: 24, paddingTop: 16, borderTop: '1px solid #252525' }}>
              <button type="button" className="outlined-button" onClick={() => setShowModulesModal(false)}>Close</button>
              {selectedUser.role === 'Manager' && (
                <button type="button" className="primary-button" style={{ flex: 1 }} onClick={handleSaveModules} disabled={modulesSaving}>
                  {modulesSaving ? <><Icon name="spinner" size={14} className="spin-icon" /> Saving...</> : 'Save Modules'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Toast Notification */}
      {(formError || permSuccess || permSaving || modulesSaving) && (
        <div style={{
          position: 'fixed',
          bottom: 32,
          right: 32,
          background: '#111111',
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
          {(permSaving || modulesSaving) && !permSuccess && !formError && <><Icon name="spinner" size={16} className="spin-icon" /><span style={{ color: '#777777', fontSize: 13, fontWeight: 600 }}>Saving...</span></>}
          {permSuccess && <><Icon name="check" size={16} style={{ color: '#5cce9d' }} /><span style={{ color: '#5cce9d', fontSize: 13, fontWeight: 600 }}>{permSuccess}</span></>}
          {formError && <><Icon name="close" size={16} style={{ color: '#e88080' }} /><span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{formError}</span></>}
        </div>
      )}
    </div>
  )
}
