import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import './App.css'
import { Login } from './components/Login.jsx'
import { FieldDashboard } from './components/FieldDashboard.jsx'
import { Admin } from './components/Admin/Admin.jsx'

function App() {
  const [session, setSession]         = useState(() => localStorage.getItem('collectionAssistSession') || sessionStorage.getItem('collectionAssistSession'))
  const [credentials, setCredentials] = useState({ id: '', password: '' })
  const [loginError, setLoginError]   = useState('')
  const [isCheckingSession, setIsCheckingSession] = useState(() => !sessionStorage.getItem('collectionAssistToken') && !localStorage.getItem('collectionAssistToken'))
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const path = location.pathname
    let title = 'Recovr'
    if (path === '/') title = 'Login - Recovr'
    else if (path.startsWith('/dashboard')) title = 'Dashboard - Recovr'
    else if (path.includes('/admin/overview')) title = 'Overview - Recovr'
    else if (path.includes('/admin/upload')) title = 'Upload Lots - Recovr'
    else if (path.includes('/admin/mapping')) title = 'Initial Mapping - Recovr'
    else if (path.includes('/admin/workbooks')) title = 'Workbooks - Recovr'
    else if (path.includes('/admin/allocation')) title = 'Allocation - Recovr'
    else if (path.includes('/admin/referencing')) title = 'Data Referencing - Recovr'
    else if (path.includes('/admin/users')) title = 'Users - Recovr'
    
    document.title = title
  }, [location])

  useEffect(() => {
    const handleStorage = (event) => {
      if (event.key === 'REQUESTING_SHARED_SESSION') {
        if (sessionStorage.getItem('collectionAssistToken')) {
          localStorage.setItem('SHARED_SESSION', JSON.stringify(sessionStorage));
          localStorage.removeItem('SHARED_SESSION');
        }
      } else if (event.key === 'SHARED_SESSION' && event.newValue) {
        const data = JSON.parse(event.newValue);
        for (const key in data) {
          sessionStorage.setItem(key, data[key]);
        }
        if (data.collectionAssistSession && !session) {
          setSession(data.collectionAssistSession);
        }
        setIsCheckingSession(false);
      }
    };

    window.addEventListener('storage', handleStorage);

    let timer;
    if (isCheckingSession) {
      localStorage.setItem('REQUESTING_SHARED_SESSION', Date.now().toString());
      localStorage.removeItem('REQUESTING_SHARED_SESSION');
      timer = setTimeout(() => setIsCheckingSession(false), 100);
    }

    return () => {
      window.removeEventListener('storage', handleStorage);
      if (timer) clearTimeout(timer);
    };
  }, [session, isCheckingSession])

  async function login(event, rememberMe) {
    event.preventDefault()
    if (!/^[a-z0-9]+$/i.test(credentials.id) || !credentials.password) { setLoginError('Enter an alphanumeric employee ID and password.'); return }
    try {
      const res  = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId: credentials.id, password: credentials.password, rememberMe }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Unable to sign in.')
      
      const storage = rememberMe ? localStorage : sessionStorage
      storage.setItem('collectionAssistToken', data.token)
      storage.setItem('collectionAssistSession', data.user.accountType)
      storage.setItem('collectionAssistEmployeeId', data.user.employeeId)
      storage.setItem('collectionAssistRole', data.user.role)
      storage.setItem('collectionAssistName', data.user.name)
      storage.setItem('collectionAssistAccessibleModules', JSON.stringify(data.user.accessibleModules || []))
      
      setSession(data.user.accountType); setLoginError('')
      if (data.user.accountType === 'admin') navigate('/admin/overview')
      else navigate('/dashboard')
    } catch (err) {
      setLoginError(err.message === 'Failed to fetch' ? 'Server not reachable — make sure npm run server is running.' : err.message)
    }
  }

  function handleLogout() {
    localStorage.removeItem('collectionAssistToken')
    localStorage.removeItem('collectionAssistSession')
    localStorage.removeItem('collectionAssistEmployeeId')
    localStorage.removeItem('collectionAssistRole')
    localStorage.removeItem('collectionAssistName')
    localStorage.removeItem('collectionAssistAccessibleModules')
    sessionStorage.removeItem('collectionAssistToken')
    sessionStorage.removeItem('collectionAssistSession')
    sessionStorage.removeItem('collectionAssistEmployeeId')
    sessionStorage.removeItem('collectionAssistRole')
    sessionStorage.removeItem('collectionAssistName')
    sessionStorage.removeItem('collectionAssistAccessibleModules')
    setSession(null)
    setCredentials({ id: '', password: '' })
    setLoginError('')
    navigate('/')
  }

  if (isCheckingSession) {
    return null; // Prevents UI flicker while syncing session from other tabs
  }

  return (
    <Routes>
      <Route path="/" element={!session ? <Login credentials={credentials} setCredentials={setCredentials} login={login} loginError={loginError} /> : <Navigate to={session === 'admin' ? '/admin/overview' : '/dashboard'} replace />} />
      <Route path="/admin/*" element={session === 'admin' ? <Admin onLogout={handleLogout} /> : <Navigate to="/" replace />} />
      <Route path="/dashboard/*" element={session ? <FieldDashboard onLogout={handleLogout} /> : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
