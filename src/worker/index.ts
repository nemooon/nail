import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { GmailClient, GmailError, toMessage, type Message } from '../gmail/gmail.ts'
import { categories, classify, senderEmail, type Category, type Classifications, type SenderRule } from './classification.ts'
import { extractBody, getHeader } from './email-body.ts'

type Env = Cloudflare.Env & {
  APP_ORIGIN: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  TOKEN_ENCRYPTION_KEY: string
  OWNER_EMAIL: string
}
type Vars = { ownerSub: string }
type Snapshot = {
  cursor: string | null
  messages: Record<string, Message>
  pending?: { baseline: string; ids: string[]; offset: number; nextPageToken?: string; latest?: string; mode: 'full' | 'delta' }
}
type TokenResponse = { access_token: string; refresh_token?: string; scope?: string; expires_in?: number }
type UserInfo = { sub?: string; email?: string; email_verified?: boolean }
const app = new Hono<{ Bindings: Env; Variables: Vars }>()
const MODIFY = 'https://www.googleapis.com/auth/gmail.modify'
const ID = /^[a-zA-Z0-9_-]+$/
const encoder = new TextEncoder()

function requestOrigin(url: string, expected: string | undefined) {
  const origin = new URL(url).origin
  return origin === expected ? origin : null
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}
function base64url(bytes: Uint8Array) {
  let s = ''
  for (const byte of bytes) s += String.fromCharCode(byte)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function fromBase64url(value: string) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}
async function hash(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}
async function encryptionKey(secret: string) {
  const bytes = fromBase64url(secret)
  if (bytes.length !== 32) throw new Error('Invalid encryption key')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function encrypt(value: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(value)))
  return `${base64url(iv)}.${base64url(ciphertext)}`
}
async function decrypt(value: string, secret: string) {
  const [iv, encrypted] = value.split('.')
  if (!iv || !encrypted) throw new Error('Invalid encrypted token')
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(iv) }, await encryptionKey(secret), fromBase64url(encrypted))
  return new TextDecoder().decode(plaintext)
}
async function owner(env: Env) {
  return (await env.DB.prepare("SELECT value FROM app_state WHERE key = 'owner_sub'").first<{ value: string }>())?.value ?? null
}
async function saveState(env: Env, state: Snapshot) {
  await env.DB.prepare("INSERT INTO app_state (key, value) VALUES ('snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").bind(JSON.stringify(state)).run()
}
async function loadState(env: Env): Promise<Snapshot> {
  const row = await env.DB.prepare("SELECT value FROM app_state WHERE key = 'snapshot'").first<{ value: string }>()
  return row ? JSON.parse(row.value) as Snapshot : { cursor: null, messages: {} }
}
async function token(env: Env, sub: string) {
  const row = await env.DB.prepare('SELECT refresh_token_encrypted, scopes FROM oauth_tokens WHERE owner_sub = ?').bind(sub).first<{ refresh_token_encrypted: string; scopes: string }>()
  if (!row) throw new Error('Gmail の認証が必要です')
  const refreshToken = await decrypt(row.refresh_token_encrypted, env.TOKEN_ENCRYPTION_KEY)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  if (!response.ok) throw new Error(`Google トークン更新エラー (${response.status})`)
  const data = await response.json() as TokenResponse
  return { accessToken: data.access_token, scopes: row.scopes }
}
async function gmail(env: Env, sub: string) { return new GmailClient((await token(env, sub)).accessToken) }
async function classifications(env: Env) {
  const [manualRows, ruleRows] = await Promise.all([
    env.DB.prepare('SELECT message_id, category FROM classifications').all<{ message_id: string; category: Category }>(),
    env.DB.prepare('SELECT email, category, subject_contains, after_ms FROM sender_rules ORDER BY id').all<{ email: string; category: Category; subject_contains: string | null; after_ms: number }>(),
  ])
  const manual: Classifications = Object.fromEntries(manualRows.results.map(row => [row.message_id, row.category]))
  const rules: SenderRule[] = ruleRows.results.map(row => ({ email: row.email, category: row.category, subjectContains: row.subject_contains ?? undefined, after: row.after_ms }))
  return { manual, rules }
}
async function classified(env: Env, messages: Message[]) {
  const { manual, rules } = await classifications(env)
  return messages.sort((a, b) => Number(b.internalDate) - Number(a.internalDate)).map(message => ({ ...message, classification: classify(message, manual, rules) }))
}
async function syncStep(env: Env, sub: string) {
  const api = await gmail(env, sub)
  const state = await loadState(env)
  if (!state.pending) {
    if (!state.cursor) {
      state.pending = { mode: 'full', baseline: (await api.profile()).historyId, ids: [], offset: 0 }
    } else {
      try {
        const page = await api.history(state.cursor)
        const ids = new Set<string>()
        for (const record of page.history ?? []) {
          for (const item of record.messagesAdded ?? []) ids.add(item.message.id)
          for (const item of record.messagesDeleted ?? []) ids.add(item.message.id)
          for (const item of record.labelsAdded ?? []) ids.add(item.message.id)
          for (const item of record.labelsRemoved ?? []) ids.add(item.message.id)
        }
        state.pending = { mode: 'delta', baseline: state.cursor, ids: [...ids], offset: 0, nextPageToken: page.nextPageToken, latest: page.historyId }
      } catch (error) {
        if (!(error instanceof GmailError && error.status === 404)) throw error
        state.cursor = null
        state.pending = { mode: 'full', baseline: (await api.profile()).historyId, ids: [], offset: 0 }
      }
    }
  }
  const pending = state.pending
  if (pending.mode === 'full' && pending.ids.length === 0) {
    const page = await api.list(pending.nextPageToken)
    pending.ids = (page.messages ?? []).map(message => message.id)
    pending.offset = 0
    pending.nextPageToken = page.nextPageToken
  }
  const ids = pending.ids.slice(pending.offset, pending.offset + 24)
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(id => api.get(id)))
    for (let j = 0; j < batch.length; j++) {
      const message = toMessage(batch[j])
      if (message) state.messages[ids[i + j]] = message
      else delete state.messages[ids[i + j]]
    }
  }
  pending.offset += ids.length
  if (pending.offset >= pending.ids.length) {
    if (pending.nextPageToken) {
      if (pending.mode === 'full') {
        pending.ids = []
        pending.offset = 0
      } else {
        const page = await api.history(pending.baseline, pending.nextPageToken)
        const nextIds = new Set<string>()
        for (const record of page.history ?? []) {
          for (const item of record.messagesAdded ?? []) nextIds.add(item.message.id)
          for (const item of record.messagesDeleted ?? []) nextIds.add(item.message.id)
          for (const item of record.labelsAdded ?? []) nextIds.add(item.message.id)
          for (const item of record.labelsRemoved ?? []) nextIds.add(item.message.id)
        }
        pending.ids = [...nextIds]
        pending.offset = 0
        pending.nextPageToken = page.nextPageToken
        pending.latest = page.historyId
      }
    } else {
      state.cursor = pending.mode === 'full' ? pending.baseline : pending.latest ?? pending.baseline
      delete state.pending
    }
  }
  await saveState(env, state)
  return { state, incomplete: Boolean(state.pending) }
}

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  const hostOrigin = requestOrigin(c.req.url, c.env?.APP_ORIGIN)
  if (!hostOrigin) return c.json({ error: 'Invalid host' }, 403)
  const origin = c.req.header('origin')
  if (origin && origin !== hostOrigin) return c.json({ error: 'Invalid origin' }, 403)
  if (c.req.method !== 'GET') {
    if (origin !== hostOrigin) return c.json({ error: 'Invalid origin' }, 403)
    if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON required' }, 415)
  }
  await next()
})
app.get('/auth/start', async c => {
  const hostOrigin = requestOrigin(c.req.url, c.env?.APP_ORIGIN)
  if (!hostOrigin) return c.text('Invalid host', 403)
  const state = randomToken()
  const verifier = randomToken()
  const challenge = await hash(verifier)
  await c.env.DB.prepare('INSERT INTO oauth_flows (state_hash, verifier, expires_at) VALUES (?, ?, ?)').bind(await hash(state), verifier, Date.now() + 10 * 60_000).run()
  setCookie(c, 'nail_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/auth', maxAge: 600 })
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID, redirect_uri: `${hostOrigin}/auth/callback`, response_type: 'code',
    scope: `openid email ${MODIFY}`, access_type: 'offline', prompt: 'consent',
    state, code_challenge: challenge, code_challenge_method: 'S256', login_hint: c.env.OWNER_EMAIL,
  })
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})
app.get('/auth/callback', async c => {
  const hostOrigin = requestOrigin(c.req.url, c.env?.APP_ORIGIN)
  if (!hostOrigin) return c.text('Invalid host', 403)
  const state = c.req.query('state')
  const cookieState = getCookie(c, 'nail_oauth_state')
  deleteCookie(c, 'nail_oauth_state', { path: '/auth' })
  if (!state || !cookieState || state !== cookieState) return c.text('認証状態が一致しません', 400)
  const stateHash = await hash(state)
  const flow = await c.env.DB.prepare('SELECT verifier, expires_at FROM oauth_flows WHERE state_hash = ?').bind(stateHash).first<{ verifier: string; expires_at: number }>()
  await c.env.DB.prepare('DELETE FROM oauth_flows WHERE state_hash = ?').bind(stateHash).run()
  if (!flow || flow.expires_at < Date.now() || !c.req.query('code')) return c.text('認証期限切れです', 400)
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: c.req.query('code')!, client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET, redirect_uri: `${hostOrigin}/auth/callback`, grant_type: 'authorization_code', code_verifier: flow.verifier }),
  })
  if (!response.ok) return c.text('Google 認証に失敗しました', 502)
  const tokens = await response.json() as TokenResponse
  const infoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } })
  if (!infoResponse.ok) return c.text('Google アカウントを確認できません', 502)
  const info = await infoResponse.json() as UserInfo
  if (!info.sub || !info.email_verified || info.email?.toLowerCase() !== c.env.OWNER_EMAIL.toLowerCase()) return c.text('このアカウントは利用できません', 403)
  const existingOwner = await owner(c.env)
  if (existingOwner && existingOwner !== info.sub) return c.text('このアカウントは利用できません', 403)
  if (!tokens.scope?.split(' ').includes(MODIFY)) return c.text('Gmail の変更権限がありません', 403)
  if (tokens.refresh_token) {
    await c.env.DB.prepare('INSERT INTO oauth_tokens (owner_sub, refresh_token_encrypted, scopes) VALUES (?, ?, ?) ON CONFLICT(owner_sub) DO UPDATE SET refresh_token_encrypted = excluded.refresh_token_encrypted, scopes = excluded.scopes, updated_at = CURRENT_TIMESTAMP')
      .bind(info.sub, await encrypt(tokens.refresh_token, c.env.TOKEN_ENCRYPTION_KEY), tokens.scope).run()
  } else {
    const current = await c.env.DB.prepare('SELECT owner_sub FROM oauth_tokens WHERE owner_sub = ?').bind(info.sub).first()
    if (!current) return c.text('更新トークンが取得できませんでした。再認証してください', 403)
  }
  if (!existingOwner) await c.env.DB.prepare("INSERT INTO app_state (key, value) VALUES ('owner_sub', ?)").bind(info.sub).run()
  const session = randomToken()
  await c.env.DB.prepare('INSERT INTO sessions (id_hash, owner_sub, expires_at) VALUES (?, ?, ?)').bind(await hash(session), info.sub, Date.now() + 7 * 24 * 60 * 60_000).run()
  setCookie(c, 'nail_session', session, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 7 * 24 * 60 * 60 })
  return c.redirect(hostOrigin)
})
app.post('/auth/logout', async c => {
  const hostOrigin = requestOrigin(c.req.url, c.env?.APP_ORIGIN)
  if (!hostOrigin) return c.text('Invalid host', 403)
  const origin = c.req.header('origin')
  if (origin !== hostOrigin) return c.text('Invalid origin', 403)
  const session = getCookie(c, 'nail_session')
  if (session) await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(await hash(session)).run()
  deleteCookie(c, 'nail_session', { path: '/' })
  return c.redirect(hostOrigin)
})
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/status') return next()
  const session = getCookie(c, 'nail_session')
  if (!session) return c.json({ error: 'Google でログインしてください' }, 401)
  const row = await c.env.DB.prepare('SELECT owner_sub, expires_at FROM sessions WHERE id_hash = ?').bind(await hash(session)).first<{ owner_sub: string; expires_at: number }>()
  if (!row || row.expires_at < Date.now() || row.owner_sub !== await owner(c.env)) return c.json({ error: 'Google で再ログインしてください' }, 401)
  c.set('ownerSub', row.owner_sub)
  await next()
})
app.get('/api/status', async c => {
  const session = getCookie(c, 'nail_session')
  const row = session ? await c.env.DB.prepare('SELECT owner_sub, expires_at FROM sessions WHERE id_hash = ?').bind(await hash(session)).first<{ owner_sub: string; expires_at: number }>() : null
  const connected = Boolean(row && row.expires_at >= Date.now() && row.owner_sub === await owner(c.env))
  const state = connected ? await c.env.DB.prepare("SELECT updated_at FROM app_state WHERE key = 'snapshot'").first<{ updated_at: string }>() : null
  return c.json({ connected, canModify: connected, lastSyncedAt: state?.updated_at ? `${state.updated_at.replace(' ', 'T')}Z` : null })
})
app.get('/api/messages', async c => {
  const state = await loadState(c.env)
  return c.json({ messages: await classified(c.env, Object.values(state.messages)), indexed: Object.keys(state.messages).length, syncing: Boolean(state.pending) })
})
app.get('/api/classifications', async c => c.json((await classifications(c.env)).manual))
app.put('/api/messages/:id/classification', async c => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json({ error: 'Invalid message ID' }, 400)
  const body = await c.req.json().catch(() => null) as { category?: Category; scope?: 'one' | 'sender'; subjectContains?: string } | null
  if (!body || !categories.includes(body.category as Category) || (body.scope && !['one', 'sender'].includes(body.scope))) return c.json({ error: 'Invalid category' }, 400)
  if (body.scope === 'sender') {
    if (body.subjectContains !== undefined && (typeof body.subjectContains !== 'string' || body.subjectContains.length > 100)) return c.json({ error: 'Invalid subject condition' }, 400)
    const message = (await loadState(c.env)).messages[id]
    const from = message?.from ?? getHeader((await (await gmail(c.env, c.get('ownerSub'))).get(id))?.payload, 'From')
    const email = senderEmail(from)
    if (!email) return c.json({ error: '送信元アドレスを取得できません' }, 400)
    await c.env.DB.prepare('INSERT INTO sender_rules (email, category, subject_contains, after_ms) VALUES (?, ?, ?, ?)').bind(email, body.category, body.subjectContains?.trim() || null, Date.now()).run()
  }
  await c.env.DB.prepare('INSERT INTO classifications (message_id, category) VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET category = excluded.category').bind(id, body.category).run()
  return c.json({ category: body.category })
})
app.post('/api/sync', async c => {
  const result = await syncStep(c.env, c.get('ownerSub'))
  return c.json({ messages: await classified(c.env, Object.values(result.state.messages)), incomplete: result.incomplete })
})
async function listQuery(env: Env, sub: string, query: string, pageToken?: string) {
  const api = await gmail(env, sub)
  const page = await api.search(`${query} -in:trash -in:spam`, pageToken, 35)
  const messages: Message[] = []
  for (let offset = 0; offset < (page.messages ?? []).length; offset += 5) {
    const batch = await Promise.all((page.messages ?? []).slice(offset, offset + 5).map(item => api.get(item.id)))
    for (const raw of batch) {
      if (!raw) continue
      const headers = raw.payload?.headers ?? []
      const header = (name: string) => headers.find(h => h.name.toLowerCase() === name)?.value ?? ''
      messages.push({ id: raw.id, threadId: raw.threadId, from: header('from'), subject: header('subject'), internalDate: raw.internalDate ?? '', unread: raw.labelIds?.includes('UNREAD') ?? false, labelIds: raw.labelIds ?? [] })
    }
  }
  return { messages: await classified(env, messages), nextPageToken: page.nextPageToken ?? null }
}
app.get('/api/search', async c => {
  const query = (c.req.query('q') ?? '').trim()
  if (!query || query.length > 300) return c.json({ error: 'Invalid query' }, 400)
  return c.json(await listQuery(c.env, c.get('ownerSub'), query, c.req.query('pageToken')))
})
app.get('/api/archive', async c => c.json(await listQuery(c.env, c.get('ownerSub'), '-in:inbox -in:sent -in:drafts', c.req.query('pageToken'))))
app.get('/api/messages/:id', async c => {
  const id = c.req.param('id')
  if (!ID.test(id)) return c.json({ error: 'Invalid message ID' }, 400)
  const raw = await (await gmail(c.env, c.get('ownerSub'))).full(id)
  return c.json({ id: raw.id, from: getHeader(raw.payload, 'From'), subject: getHeader(raw.payload, 'Subject'), date: getHeader(raw.payload, 'Date'), ...extractBody(raw, c.req.query('images') === '1') })
})
async function doAction(api: GmailClient, id: string, action: string) {
  if (action === 'read') await api.modify(id, [], ['UNREAD'])
  else if (action === 'unread') await api.modify(id, ['UNREAD'], [])
  else if (action === 'archive') await api.modify(id, [], ['INBOX'])
  else if (action === 'trash') await api.trash(id)
  else throw new Error('Invalid action')
}
app.post('/api/messages/:id/action', async c => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => null) as { action?: string } | null
  if (!ID.test(id) || !['read', 'unread', 'archive', 'trash'].includes(body?.action ?? '')) return c.json({ error: 'Invalid action' }, 400)
  await doAction(await gmail(c.env, c.get('ownerSub')), id, body!.action!)
  const state = await loadState(c.env)
  if (body!.action === 'archive' || body!.action === 'trash') delete state.messages[id]
  else if (state.messages[id]) {
    state.messages[id].unread = body!.action === 'unread'
    state.messages[id].labelIds = (state.messages[id].labelIds ?? []).filter(label => label !== 'UNREAD')
    if (body!.action === 'unread') state.messages[id].labelIds!.push('UNREAD')
  }
  await saveState(c.env, state)
  return c.json({ ok: true })
})
app.post('/api/messages/bulk', async c => {
  const body = await c.req.json().catch(() => null) as { ids?: string[]; action?: string } | null
  if (!Array.isArray(body?.ids) || body.ids.length < 1 || body.ids.length > 500 || !body.ids.every(id => typeof id === 'string' && ID.test(id)) || !['read', 'archive', 'trash'].includes(body.action ?? '')) return c.json({ error: 'Invalid bulk action' }, 400)
  const api = await gmail(c.env, c.get('ownerSub'))
  const completed: string[] = []
  const failed: string[] = []
  if (body.action === 'trash' && body.ids.length > 35) return c.json({ error: 'ゴミ箱への一括移動は35通までです' }, 400)
  if (body.action === 'read' || body.action === 'archive') {
    const accessToken = (await token(c.env, c.get('ownerSub'))).accessToken
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify', {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: body.ids, addLabelIds: [], removeLabelIds: [body.action === 'read' ? 'UNREAD' : 'INBOX'] }),
    })
    if (!response.ok) throw new GmailError(response.status, 'Gmail batchModify failed')
    completed.push(...body.ids)
  } else {
    for (let i = 0; i < body.ids.length; i += 5) {
      await Promise.all(body.ids.slice(i, i + 5).map(async id => {
        try { await doAction(api, id, 'trash'); completed.push(id) } catch { failed.push(id) }
      }))
    }
  }
  const state = await loadState(c.env)
  for (const id of completed) {
    if (body.action === 'read' && state.messages[id]) {
      state.messages[id].unread = false
      state.messages[id].labelIds = state.messages[id].labelIds?.filter(label => label !== 'UNREAD')
    } else if (body.action !== 'read') delete state.messages[id]
  }
  await saveState(c.env, state)
  return c.json({ completed, failed }, failed.length ? 207 : 200)
})
app.onError((error, c) => {
  console.error(JSON.stringify({ event: 'worker_error', path: c.req.path.replace(/\/messages\/[a-zA-Z0-9_-]+/, '/messages/:id'), status: error instanceof GmailError ? error.status : 500, type: error instanceof Error ? error.name : 'Unknown' }))
  return c.json({ error: error instanceof GmailError ? `Gmail API エラー (${error.status})` : '処理に失敗しました' }, error instanceof GmailError ? 502 : 500)
})
export default app
