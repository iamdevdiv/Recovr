import { useState, useEffect } from 'react'

/**
 * Returns the current network online status and updates reactively
 * when the device gains or loses connectivity.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    function handleOnline()  { setOnline(true)  }
    function handleOffline() { setOnline(false) }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return online
}
