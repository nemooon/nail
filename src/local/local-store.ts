import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Snapshot, Store } from '../gmail/sync.ts'

export const statePath = resolve(process.env.GMAIL_SYNC_STATE ?? new URL('../../.local/.gmail-sync-state.json', import.meta.url).pathname)

export const store: Store = {
  async load() {
    try {
      return JSON.parse(await readFile(statePath, 'utf8')) as Snapshot
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { cursor: null, messages: {} }
      throw error
    }
  },
  async save(snapshot) {
    const temporary = `${statePath}.tmp`
    await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 })
    await rename(temporary, statePath)
  },
}
