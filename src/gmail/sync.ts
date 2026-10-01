import { GmailError, toMessage, type GmailApi, type Message } from './gmail.ts'

export type Snapshot = {
  cursor: string | null
  messages: Record<string, Message>
  pending?: {
    baseline: string
    pageToken?: string
    scanned?: boolean
    messages: Record<string, Message>
  }
}

export interface Store {
  load(): Promise<Snapshot>
  save(snapshot: Snapshot): Promise<void>
}

export type Progress = (event: { phase: 'full' | 'delta'; indexed: number; estimate?: number }) => void

async function refresh(api: GmailApi, messages: Record<string, Message>, ids: Iterable<string>) {
  const unique = [...new Set(ids)]
  for (let offset = 0; offset < unique.length; offset += 5) {
    await Promise.all(unique.slice(offset, offset + 5).map(async id => {
      const message = toMessage(await api.get(id))
      if (message) messages[id] = message
      else delete messages[id]
    }))
  }
}

async function applyHistory(api: GmailApi, messages: Record<string, Message>, cursor: string): Promise<string> {
  let pageToken: string | undefined
  let latest = cursor
  do {
    const page = await api.history(cursor, pageToken)
    const changed = new Set<string>()
    for (const record of page.history ?? []) {
      for (const item of record.messagesAdded ?? []) changed.add(item.message.id)
      for (const item of record.messagesDeleted ?? []) changed.add(item.message.id)
      for (const item of record.labelsAdded ?? []) changed.add(item.message.id)
      for (const item of record.labelsRemoved ?? []) changed.add(item.message.id)
    }
    await refresh(api, messages, changed)
    pageToken = page.nextPageToken
    latest = page.historyId
  } while (pageToken)
  return latest
}

export async function sync(api: GmailApi, store: Store, progress?: Progress): Promise<Snapshot> {
  let state = await store.load()
  // Older snapshots predate the label index used by the live screen.
  if (Object.values(state.messages).some(message => !message.labelIds)) {
    state = { cursor: null, messages: {} }
    await store.save(state)
  }
  if (state.cursor && !state.pending) {
    const messages = { ...state.messages }
    try {
      const cursor = await applyHistory(api, messages, state.cursor)
      state = { cursor, messages }
      await store.save(state)
      progress?.({ phase: 'delta', indexed: Object.keys(messages).length })
      return state
    } catch (error) {
      if (!(error instanceof GmailError && error.status === 404)) throw error
      state = { ...state, pending: undefined }
    }
  }

  for (let restart = 0; restart < 2; restart++) {
    if (!state.pending) {
      state.pending = { baseline: (await api.profile()).historyId, messages: {} }
      await store.save(state)
    }
    let estimate: number | undefined
    try {
      if (!state.pending.scanned) {
        do {
          const page = await api.list(state.pending.pageToken)
          estimate = page.resultSizeEstimate
          await refresh(api, state.pending.messages, (page.messages ?? []).map(m => m.id))
          state.pending.pageToken = page.nextPageToken
          state.pending.scanned = !page.nextPageToken
          await store.save(state)
          progress?.({ phase: 'full', indexed: Object.keys(state.pending.messages).length, estimate })
        } while (!state.pending.scanned)
      }
      const cursor = await applyHistory(api, state.pending.messages, state.pending.baseline)
      state = { cursor, messages: state.pending.messages }
      await store.save(state)
      return state
    } catch (error) {
      if (!(error instanceof GmailError && (error.status === 400 || error.status === 404))) throw error
      // A saved page token or baseline history ID can expire. Start a new scan.
      state.pending = undefined
      await store.save(state)
      if (restart === 1) throw error
    }
  }
  throw new Error('Full synchronization failed')
}
