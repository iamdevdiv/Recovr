// ─── Offline Queue — IndexedDB utility ───────────────────────────────────────
// Mirrors the SW's IndexedDB structure so the client can read and manage
// the offline mutation queue directly.

const DB_NAME    = 'fos-offline-queue'
const STORE_NAME = 'mutations'
const DB_VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

/**
 * Add a mutation to the queue.
 * @param {{ url: string, method: string, body: string, headers: object, queuedAt: number }} mutation
 */
export async function enqueue(mutation) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req   = store.add(mutation)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}

/**
 * Retrieve all queued mutations, ordered by insertion.
 * @returns {Promise<Array>}
 */
export async function getAll() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req   = store.getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror   = (e) => reject(e.target.error)
  })
}

/**
 * Remove a mutation from the queue by its IDB id.
 * @param {number} id
 */
export async function remove(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req   = store.delete(id)
    req.onsuccess = () => resolve()
    req.onerror   = (e) => reject(e.target.error)
  })
}

/**
 * Clear all queued mutations.
 */
export async function clearAll() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const req   = store.clear()
    req.onsuccess = () => resolve()
    req.onerror   = (e) => reject(e.target.error)
  })
}

/**
 * Get count of queued mutations.
 * @returns {Promise<number>}
 */
export async function count() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const req   = store.count()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = (e) => reject(e.target.error)
  })
}
