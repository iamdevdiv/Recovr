import React, { useState } from 'react'
import { Icon } from './Shared.jsx'

export function Login({ credentials, setCredentials, login, loginError }) {
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  return (
    <main className="login-shell">
      <div className="login-orb orb-one" /><div className="login-orb orb-two" />
      <section className="login-card">
        <div className="brand">
          <img src="/icons/icon.png" width="29" height="29" alt="Recovr logo" style={{ borderRadius: '9px' }} />
          <span><b>Recovr</b></span>
        </div>
        <div className="login-heading"><h1>Welcome back</h1><p>Sign in with your employee credentials to continue.</p></div>
        <form onSubmit={(e) => login(e, rememberMe)}>
          <label>Employee ID<input value={credentials.id} onChange={(e) => setCredentials({ ...credentials, id: e.target.value })} placeholder="Enter your employee ID" autoComplete="username" autoFocus /></label>
          <label>Password
            <div style={{ position: 'relative' }}>
              <input value={credentials.password} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} type={showPassword ? 'text' : 'password'} placeholder="Enter your password" autoComplete="current-password" style={{ paddingRight: 36, width: '100%', boxSizing: 'border-box' }} />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#777777', cursor: 'pointer', padding: 4, display: 'flex' }}
                tabIndex="-1"
              >
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={16} />
              </button>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row', fontWeight: 'normal', color: '#777777', marginTop: '-4px', marginBottom: '12px' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
            Remember me for 30 days
          </label>

          <button className="primary-button" type="submit">Sign in <Icon name="arrow" /></button>
        </form>
      </section>
      {loginError && (
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
          <Icon name="close" size={16} style={{ color: '#e88080' }} />
          <span style={{ color: '#e88080', fontSize: 13, fontWeight: 600 }}>{loginError}</span>
        </div>
      )}
    </main>
  )
}
