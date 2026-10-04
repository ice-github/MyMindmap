import type { MindElixirData } from 'mind-elixir'

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'

const DB_NAME = 'my-mindmap'
const STORE = 'maps'
const KEY = 'current'
const DEBOUNCE_MS = 400

type PersistedRow = { version: 1; updatedAt: string; data: MindElixirData }

function hasIdb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export class MapPersistence {
  private timer: number | null = null
  private saving = false
  private pending: MindElixirData | null = null
  private memory: PersistedRow | null = null
  private idbFallback = false
  private listeners = new Set<(s: SaveState) => void>()

  onStateChange(cb: (s: SaveState) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private emit(s: SaveState): void {
    for (const cb of this.listeners) {
      try {
        cb(s)
      } catch {
        // ignore listener errors
      }
    }
  }

  async load(): Promise<PersistedRow | null> {
    if (!hasIdb()) {
      this.idbFallback = true
      return this.memory
    }
    try {
      const db = await openDb()
      try {
        const value = await new Promise<PersistedRow | null>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly')
          const store = tx.objectStore(STORE)
          const req = store.get(KEY)
          req.onsuccess = () => resolve((req.result as PersistedRow | undefined) ?? null)
          req.onerror = () => reject(req.error ?? new Error('load failed'))
        })
        db.close()
        return value
      } catch (e) {
        try {
          db.close()
        } catch {
          // ignore
        }
        throw e
      }
    } catch {
      this.idbFallback = true
      return this.memory
    }
  }

  saveQueued(data: MindElixirData): void {
    this.pending = data
    this.emit('dirty')
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.flush()
    }, DEBOUNCE_MS)
  }

  async saveNow(data: MindElixirData): Promise<void> {
    this.pending = data
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    await this.flush()
  }

  cancelPending(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    this.pending = null
  }

  private async flush(): Promise<void> {
    if (this.saving) return
    const data = this.pending
    if (!data) return
    this.pending = null
    this.saving = true
    this.emit('saving')
    try {
      const row: PersistedRow = { version: 1, updatedAt: new Date().toISOString(), data }
      await this.write(row)
      // If new edits arrived while saving, save them next.
      if (this.pending) {
        this.saving = false
        this.emit('dirty')
        await this.flush()
        return
      }
      this.emit('saved')
    } catch {
      // Keep pending edits in memory; surface failure without losing data.
      this.emit('error')
    } finally {
      this.saving = false
    }
  }

  private async write(row: PersistedRow): Promise<void> {
    this.memory = row
    if (!hasIdb() || this.idbFallback) return
    const db = await openDb()
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(row, KEY)
      await txDone(tx)
    } finally {
      try {
        db.close()
      } catch {
        // ignore
      }
    }
  }
}
