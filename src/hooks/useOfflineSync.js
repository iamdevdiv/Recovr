import { useEffect, useRef, useCallback } from 'react'
import * as offlineQueue from '../utils/offlineQueue.js'

function getToken() {
  return localStorage.getItem('collectionAssistToken') || sessionStorage.getItem('collectionAssistToken') || ''
}

/**
 * Drains the offline mutation queue when the device comes online.
 * - Replays queued FOS mutations via POST /api/fos/cases/sync-queue
 * - On 409 conflict (admin wins), server value is accepted silently
 * - Calls onSyncComplete({ synced, conflicts }) so the UI can show a toast
 *
 * @param {boolean} isOnline       - Current online status from useOnlineStatus()
 * @param {function} onSyncComplete - Called with { synced, conflicts } after a sync run
 */
export function useOfflineSync(isOnline, onSyncComplete) {
  const syncInProgress = useRef(false)
  const wasOffline     = useRef(!isOnline)

  const sync = useCallback(async () => {
    if (syncInProgress.current) return

    const mutations = await offlineQueue.getAll()
    if (mutations.length === 0) return

    syncInProgress.current = true
    try {
      const res = await fetch('/api/fos/cases/sync-queue', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ mutations })
      })

      if (!res.ok) {
        // Server unavailable — leave queue intact for next attempt
        syncInProgress.current = false
        return
      }

      const data = await res.json()
      const synced    = (data.results || []).filter(r => r.status === 'ok').length
      const conflicts = (data.results || []).filter(r => r.status === 'conflict').length

      // Remove all successfully processed mutations (both 'ok' and 'conflict')
      // Conflicts are resolved on the server — admin value wins, no re-queue needed
      for (const mutation of mutations) {
        await offlineQueue.remove(mutation.id)
      }

      onSyncComplete?.({ synced, conflicts })
    } catch {
      // Network still failing — leave queue intact
    } finally {
      syncInProgress.current = false
    }
  }, [onSyncComplete])

  useEffect(() => {
    if (isOnline && wasOffline.current) {
      // Just came back online — drain the queue
      sync()
    }
    wasOffline.current = !isOnline
  }, [isOnline, sync])

  // Also attempt sync on first mount if online (handles page reload while queue exists)
  useEffect(() => {
    if (isOnline) {
      sync()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { sync }
}
