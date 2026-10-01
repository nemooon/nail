import { Hono } from 'hono'
import sanitizeHtml from 'sanitize-html'
import postcss from 'postcss'
import { stat } from 'node:fs/promises'
import { GmailClient, GmailError, type Message, type RawMessage, type RawPart } from '../gmail/gmail.ts'
import { getAccessToken, MODIFY_SCOPE, readToken, verifyOwner } from './oauth.ts'
import { store, statePath } from './local-store.ts'
import { sync } from '../gmail/sync.ts'
import { addSenderRule, categories, classify, readClassifications, readSenderRules, senderEmail, setClassification } from './classifications.ts'

const app = new Hono()
const idPattern = /^[a-zA-Z0-9_-]+$/
let activeSync: Promise<void> | null = null

app.use('/api/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  const host = c.req.header('host') ?? ''
  if (!['127.0.0.1:8767', 'localhost:8767'].includes(host)) return c.json({ error: 'Local access only' }, 403)
  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin')
    if (origin && !['http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) {
      return c.json({ error: 'Invalid origin' }, 403)
    }
    if (!c.req.header('content-type')?.startsWith('application/json')) return c.json({ error: 'JSON required' }, 415)
  }
  await next()
})

async function client() {
  const token = await getAccessToken()
  await verifyOwner(token)
  return new GmailClient(token)
}

async function runSync() {
  if (!activeSync) {
    activeSync = (async () => {
      await sync(await client(), store)
    })().finally(() => { activeSync = null })
  }
  await activeSync
}

function dateSort(a: Message, b: Message) {
  return Number(b.internalDate || 0) - Number(a.internalDate || 0)
}

async function classified(messages: Message[]) {
  const [overrides, rules] = await Promise.all([readClassifications(), readSenderRules()])
  return messages.map(message => ({ ...message, classification: classify(message, overrides, rules) }))
}

function getHeader(part: RawPart | undefined, name: string): string {
  return part?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function decode(data: string | undefined, part: RawPart): string {
  if (!data) return ''
  const bytes = Buffer.from(data, 'base64url')
  const charset = getHeader(part, 'Content-Type').match(/charset\s*=\s*"?([^";\s]+)/i)?.[1] ?? 'utf-8'
  // Gmail's parsed payload can contain UTF-8 bytes even when the original MIME
  // header still declares ISO-2022-JP. Keep real escape-sequence mail intact.
  if (/^iso-2022-jp$/i.test(charset) && bytes.includes(0x1b)) {
    return new TextDecoder(charset).decode(bytes)
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch {
    try { return new TextDecoder(charset).decode(bytes) }
    catch { return bytes.toString('utf8') }
  }
}

const emailCssProperties = new Set([
  'color', 'background-color', 'font-size', 'font-family', 'font-weight', 'font-style',
  'line-height', 'text-align', 'text-decoration', 'vertical-align', 'display', 'opacity',
  'width', 'height', 'max-width', 'min-width', 'border', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-collapse', 'border-spacing', 'padding',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
])

function sanitizeEmailCss(input: string) {
  try {
    const root = postcss.parse(input.replace(/<!--|-->/g, ''))
    root.walkComments(comment => { comment.remove() })
    root.walkAtRules(rule => {
      if (rule.name.toLowerCase() !== 'media' || !/^[\w\s():.,%-]{1,200}$/.test(rule.params)) rule.remove()
    })
    root.walkRules(rule => {
      if (rule.selector.length > 500 || /[<>]|url\s*\(/i.test(rule.selector)) rule.remove()
    })
    root.walkDecls(declaration => {
      if (!emailCssProperties.has(declaration.prop.toLowerCase()) || declaration.value.length > 500 || /[<>]|url\s*\(|expression\s*\(|@import|\\/i.test(declaration.value)) declaration.remove()
    })
    return root.toString().replace(/</g, '\\3C ')
  } catch { return '' }
}

export function extractBody(raw: RawMessage, loadImages = false) {
  const found: { html: string; text: string } = { html: '', text: '' }
  function visit(part: RawPart | undefined) {
    if (!part) return
    if (!part.body?.attachmentId && !/^attachment\b/i.test(getHeader(part, 'Content-Disposition')) && part.body?.data) {
      if (part.mimeType === 'text/html' && !found.html) found.html = decode(part.body.data, part)
      if (part.mimeType === 'text/plain' && !found.text) found.text = decode(part.body.data, part)
    }
    part.parts?.forEach(visit)
  }
  visit(raw.payload)
  const css = [...found.html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map(match => sanitizeEmailCss(match[1])).filter(Boolean).join('\n')
  const imageCount = (found.html.match(/<img\b/gi) ?? []).length
  const color = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i
  const length = /^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%|pt|vh|vw))$/i
  const spacing = /^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%|pt))(?:\s+(?:0|\d+(?:\.\d+)?(?:px|em|rem|%|pt))){0,3}$/i
  const html = found.html ? sanitizeHtml(found.html, {
    allowedTags: [...new Set([...sanitizeHtml.defaults.allowedTags.filter(tag => tag !== 'img'), 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'span', ...(loadImages ? ['img'] : [])])],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title'], '*': ['class', 'align', 'width', 'height', 'colspan', 'rowspan', 'style'] },
    allowedSchemesByTag: { img: ['https'] },
    allowedStyles: { '*': {
      color: [color], 'background-color': [color], 'font-family': [/^[\w\s,'"-]+$/],
      'font-size': [length], 'font-weight': [/^(?:normal|bold|[1-9]00)$/i],
      'font-style': [/^(?:normal|italic)$/i], 'line-height': [length, /^\d+(?:\.\d+)?$/],
      'text-align': [/^(?:left|right|center|justify|start|end)$/i],
      'text-decoration': [/^(?:none|underline|line-through)$/i],
      'vertical-align': [/^(?:top|middle|bottom|baseline)$/i],
      width: [length, /^auto$/i], 'max-width': [length, /^none$/i],
      height: [length, /^auto$/i],
      padding: [spacing], 'padding-top': [length], 'padding-right': [length], 'padding-bottom': [length], 'padding-left': [length],
      margin: [spacing, /^auto$/i], 'margin-top': [length, /^auto$/i], 'margin-right': [length, /^auto$/i], 'margin-bottom': [length, /^auto$/i], 'margin-left': [length, /^auto$/i],
      'border-collapse': [/^(?:collapse|separate)$/i],
      'border-spacing': [spacing],
    } },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
    transformTags: { a: (_tag, attrs) => ({ tagName: 'a', attribs: { ...attrs, target: '_blank', rel: 'noopener noreferrer' } }) },
  }) : ''
  return { html, text: found.text, css, imageCount }
}

async function listQuery(query: string, pageToken?: string) {
  const api = await client()
  const page = await api.search(`${query} -in:trash -in:spam`, pageToken)
  const ids = page.messages ?? []
  const messages: Message[] = []
  for (let offset = 0; offset < ids.length; offset += 5) {
    const batch = await Promise.all(ids.slice(offset, offset + 5).map(item => api.get(item.id)))
    for (const raw of batch) {
      if (!raw) continue
      const headers = raw.payload?.headers ?? []
      const header = (name: string) => headers.find(h => h.name.toLowerCase() === name)?.value ?? ''
      messages.push({
        id: raw.id, threadId: raw.threadId, from: header('from'), subject: header('subject'),
        internalDate: raw.internalDate ?? '', unread: raw.labelIds?.includes('UNREAD') ?? false,
        labelIds: raw.labelIds ?? [],
      })
    }
  }
  return { messages: await classified(messages.sort(dateSort)), nextPageToken: page.nextPageToken ?? null }
}

app.get('/api/status', async c => {
  const token = await readToken()
  let lastSyncedAt: string | null = null
  try { lastSyncedAt = (await stat(statePath)).mtime.toISOString() } catch { /* no snapshot yet */ }
  return c.json({ connected: Boolean(token), canModify: token?.scopes?.includes(MODIFY_SCOPE) ?? false, lastSyncedAt })
})

app.get('/api/messages', async c => {
  const snapshot = await store.load()
  return c.json({ messages: await classified(Object.values(snapshot.messages).sort(dateSort)), indexed: Object.keys(snapshot.messages).length, syncing: Boolean(activeSync) })
})

app.get('/api/classifications', async c => c.json(await readClassifications()))

app.put('/api/messages/:id/classification', async c => {
  const id = c.req.param('id')
  if (!idPattern.test(id)) return c.json({ error: 'Invalid message ID' }, 400)
  const body = await c.req.json().catch(() => null) as { category?: unknown; scope?: unknown; subjectContains?: unknown } | null
  if (!categories.includes(body?.category as typeof categories[number])) return c.json({ error: 'Invalid category' }, 400)
  if (body?.scope && !['one', 'sender'].includes(body.scope as string)) return c.json({ error: 'Invalid scope' }, 400)
  if (body?.scope === 'sender') {
    if (body.subjectContains !== undefined && (typeof body.subjectContains !== 'string' || body.subjectContains.length > 100)) return c.json({ error: 'Invalid subject condition' }, 400)
    const snapshot = await store.load()
    const message = snapshot.messages[id]
    const from = message?.from ?? getHeader((await (await client()).get(id))?.payload, 'From')
    const email = senderEmail(from)
    if (!email) return c.json({ error: '送信元アドレスを取得できません' }, 400)
    const subjectContains = typeof body.subjectContains === 'string' ? body.subjectContains.trim() : ''
    await addSenderRule({ email, category: body.category as typeof categories[number], subjectContains: subjectContains || undefined, after: Date.now() })
  }
  const values = await setClassification(id, body?.category as typeof categories[number])
  return c.json({ category: values[id] })
})

app.post('/api/sync', async c => {
  await runSync()
  const snapshot = await store.load()
  return c.json({ messages: await classified(Object.values(snapshot.messages).sort(dateSort)) })
})

app.get('/api/search', async c => {
  const query = (c.req.query('q') ?? '').trim()
  const pageToken = c.req.query('pageToken')
  if (!query || query.length > 300) return c.json({ error: 'Invalid query' }, 400)
  return c.json(await listQuery(query, pageToken))
})

app.get('/api/archive', async c => c.json(await listQuery('-in:inbox -in:sent -in:drafts', c.req.query('pageToken'))))

app.get('/api/messages/:id', async c => {
  const id = c.req.param('id')
  if (!idPattern.test(id)) return c.json({ error: 'Invalid message ID' }, 400)
  const raw = await (await client()).full(id)
  return c.json({
    id: raw.id,
    from: getHeader(raw.payload, 'From'),
    subject: getHeader(raw.payload, 'Subject'),
    date: getHeader(raw.payload, 'Date'),
    ...extractBody(raw, c.req.query('images') === '1'),
  })
})

async function assertModify() {
  const token = await readToken()
  return Boolean(token?.scopes?.includes(MODIFY_SCOPE))
}

app.post('/api/messages/:id/action', async c => {
  const id = c.req.param('id')
  if (!idPattern.test(id)) return c.json({ error: 'Invalid message ID' }, 400)
  if (!await assertModify()) return c.json({ error: 'Gmail の変更権限が必要です' }, 403)
  const body = await c.req.json().catch(() => null) as { action?: string } | null
  const api = await client()
  if (body?.action === 'read') await api.modify(id, [], ['UNREAD'])
  else if (body?.action === 'unread') await api.modify(id, ['UNREAD'], [])
  else if (body?.action === 'archive') await api.modify(id, [], ['INBOX'])
  else if (body?.action === 'trash') await api.trash(id)
  else return c.json({ error: 'Invalid action' }, 400)
  await runSync()
  return c.json({ ok: true })
})

app.post('/api/messages/bulk', async c => {
  if (!await assertModify()) return c.json({ error: 'Gmail の変更権限が必要です' }, 403)
  const body = await c.req.json().catch(() => null) as { ids?: unknown; action?: string } | null
  const ids = body?.ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || !ids.every(id => typeof id === 'string' && idPattern.test(id))) {
    return c.json({ error: 'Invalid message IDs' }, 400)
  }
  if (!['read', 'archive', 'trash'].includes(body?.action ?? '')) return c.json({ error: 'Invalid action' }, 400)
  const api = await client()
  const completed: string[] = []
  const failed: string[] = []
  for (let offset = 0; offset < ids.length; offset += 5) {
    await Promise.all(ids.slice(offset, offset + 5).map(async id => {
      try {
        if (body?.action === 'read') await api.modify(id, [], ['UNREAD'])
        if (body?.action === 'archive') await api.modify(id, [], ['INBOX'])
        if (body?.action === 'trash') await api.trash(id)
        completed.push(id)
      } catch { failed.push(id) }
    }))
  }
  await runSync()
  return c.json({ completed, failed }, failed.length ? 207 : 200)
})

app.onError((error, c) => {
  console.error(JSON.stringify({ event: 'api_error', path: c.req.path, status: error instanceof GmailError ? error.status : 500 }))
  return c.json({ error: error instanceof GmailError ? `Gmail API エラー (${error.status})` : error instanceof Error ? error.message : 'Internal error' }, error instanceof GmailError ? 502 : 500)
})

export default app
