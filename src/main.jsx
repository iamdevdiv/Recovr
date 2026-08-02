import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

const originalFetch = window.fetch;
window.fetch = async (...args) => {
  let [resource, config] = args;
  const token = localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken');
  
  if (token) {
    if (!config) config = {};
    if (!config.headers) config.headers = {};
    
    let hasAuth = false;
    if (config.headers instanceof Headers) {
      hasAuth = config.headers.has('Authorization');
      if (!hasAuth) config.headers.set('Authorization', `Bearer ${token}`);
    } else {
      for (const key in config.headers) {
        if (key.toLowerCase() === 'authorization') hasAuth = true;
      }
      if (!hasAuth) {
        config.headers['Authorization'] = `Bearer ${token}`;
      }
    }
    args[1] = config;
  }
  
  return originalFetch(...args);
};

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

// Register service worker for FOS offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        console.log('[SW] Registered, scope:', reg.scope)
        // Check for updates every 30 minutes
        setInterval(() => reg.update(), 30 * 60 * 1000)
      })
      .catch((err) => console.warn('[SW] Registration failed:', err))
  })
}
