import assert from 'node:assert/strict'
import test from 'node:test'
import { GmailError, type GmailApi, type HistoryPage, type ListPage, type RawMessage } from './gmail.ts'
import { sync, type Snapshot, type Store } from './sync.ts'

const raw = (id: string, labels = ['INBOX', 'UNREAD']): RawMessage => ({
  id, threadId: id, labelIds: labels, internalDate: '1',
  payload: { headers: [{ name: 'From', value: 'sender@example.test' }, { name: 'Subject', value: id }] },
})

function fixture() {
  let state: Snapshot = { cursor: null, messages: {} }
  const store: Store = {
    async load() { return structuredClone(state) },
    async save(next) { state = structuredClone(next) },
  }
  const items: Record<string, RawMessage> = { a: raw('a'), b: raw('b') }
  let historyCalls = 0
  let listCalls = 0
  const api: GmailApi = {
    async profile() { return { historyId: '10' } },
    async list(pageToken): Promise<ListPage> {
      listCalls++
      if (!pageToken) return { messages: [{ id: 'a', threadId: 'a' }], nextPageToken: 'page2', resultSizeEstimate: 2 }
      return { messages: [{ id: 'b', threadId: 'b' }], resultSizeEstimate: 2 }
    },
    async get(id) { return items[id] ?? null },
    async history(startHistoryId): Promise<HistoryPage> {
      historyCalls++
      assert.ok(startHistoryId === '10' || startHistoryId === '11')
      return startHistoryId === '10'
        ? { historyId: '11', history: [{ labelsRemoved: [{ message: { id: 'a' } }] }] }
        : { historyId: '12', history: [{ labelsRemoved: [{ message: { id: 'b' } }] }] }
    },
  }
  return { store, api, items, get state() { return state }, get historyCalls() { return historyCalls }, get listCalls() { return listCalls } }
}

test('full sync catches changes during scan; delta updates read and archive state', async () => {
  const f = fixture()
  f.items.a = raw('a', ['INBOX'])
  await sync(f.api, f.store)
  assert.equal(f.state.cursor, '11')
  assert.equal(f.state.messages.a.unread, false)
  assert.equal(f.listCalls, 2)
  f.items.b = raw('b', [])
  await sync(f.api, f.store)
  assert.equal(f.state.cursor, '12')
  assert.deepEqual(Object.keys(f.state.messages), ['a'])
  assert.equal(f.listCalls, 2)
})

test('interrupted full scan resumes from saved page', async () => {
  const f = fixture()
  let failed = false
  const api = { ...f.api, async list(pageToken?: string) {
    if (pageToken && !failed) { failed = true; throw new Error('network') }
    return f.api.list(pageToken)
  } }
  await assert.rejects(sync(api, f.store), /network/)
  assert.equal(f.state.pending?.pageToken, 'page2')
  await sync(api, f.store)
  assert.equal(f.state.pending, undefined)
  assert.equal(Object.keys(f.state.messages).length, 2)
  assert.equal(f.listCalls, 2)
})

test('expired history triggers a clean full sync', async () => {
  const f = fixture()
  await sync(f.api, f.store)
  f.items.b = raw('b', [])
  const api = { ...f.api, async history(cursor: string, pageToken?: string) {
    if (cursor === '11') throw new GmailError(404, 'expired')
    return f.api.history(cursor, pageToken)
  } }
  await sync(api, f.store)
  assert.deepEqual(Object.keys(f.state.messages), ['a'])
  assert.equal(f.listCalls, 4)
})

test('failed delta keeps the old cursor and retries every history page', async () => {
  const f = fixture()
  await sync(f.api, f.store)
  f.items.b = raw('b', [])
  let fail = true
  const api = { ...f.api, async history(cursor: string, pageToken?: string): Promise<HistoryPage> {
    if (!pageToken) return { historyId: '12', nextPageToken: 'next', history: [{ labelsRemoved: [{ message: { id: 'b' } }] }] }
    if (fail) { fail = false; throw new Error('network') }
    return { historyId: '13' }
  } }
  await assert.rejects(sync(api, f.store), /network/)
  assert.equal(f.state.cursor, '11')
  assert.equal(Object.keys(f.state.messages).length, 2)
  await sync(api, f.store)
  assert.equal(f.state.cursor, '13')
  assert.deepEqual(Object.keys(f.state.messages), ['a'])
})
