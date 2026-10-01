export type Message = {
  id: string
  threadId: string
  from: string
  subject: string
  internalDate: string
  unread: boolean
  labelIds?: string[]
}

export type ListPage = {
  messages?: { id: string; threadId: string }[]
  nextPageToken?: string
  resultSizeEstimate?: number
}

export type RawMessage = {
  id: string
  threadId: string
  internalDate?: string
  labelIds?: string[]
  snippet?: string
  payload?: RawPart
}

export type RawPart = {
  mimeType?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; attachmentId?: string }
  parts?: RawPart[]
}

export type HistoryPage = {
  historyId: string
  nextPageToken?: string
  history?: {
    messagesAdded?: { message: { id: string } }[]
    messagesDeleted?: { message: { id: string } }[]
    labelsAdded?: { message: { id: string } }[]
    labelsRemoved?: { message: { id: string } }[]
  }[]
}

export interface GmailApi {
  profile(): Promise<{ historyId: string }>
  list(pageToken?: string): Promise<ListPage>
  get(id: string): Promise<RawMessage | null>
  history(startHistoryId: string, pageToken?: string): Promise<HistoryPage>
}

export class GmailError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export class GmailClient implements GmailApi {
  readonly calls = { profile: 0, list: 0, get: 0, history: 0 }
  private token: string
  private fetcher: typeof fetch

  constructor(token: string, fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {
    this.token = token
    this.fetcher = fetcher
  }

  async request<T>(path: string, params?: URLSearchParams): Promise<T> {
    const url = `${BASE}${path}${params ? `?${params}` : ''}`
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(url, {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      if (response.ok) return await response.json() as T
      if ((response.status === 429 || response.status >= 500) && attempt < 4) {
        const retryAfter = Number(response.headers.get('retry-after'))
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 32000)
          : Math.min(1000 * 2 ** attempt + Math.random() * 1000, 32000)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw new GmailError(response.status, `Gmail API ${response.status} (${path})`)
    }
  }

  async profile() {
    this.calls.profile++
    return this.request<{ historyId: string }>('/profile')
  }

  async list(pageToken?: string) {
    this.calls.list++
    const params = new URLSearchParams({ maxResults: '500' })
    params.append('labelIds', 'INBOX')
    if (pageToken) params.set('pageToken', pageToken)
    return this.request<ListPage>('/messages', params)
  }

  async get(id: string) {
    this.calls.get++
    const params = new URLSearchParams({ format: 'METADATA' })
    params.append('metadataHeaders', 'From')
    params.append('metadataHeaders', 'Subject')
    try {
      return await this.request<RawMessage>(`/messages/${encodeURIComponent(id)}`, params)
    } catch (error) {
      if (error instanceof GmailError && error.status === 404) return null
      throw error
    }
  }

  async history(startHistoryId: string, pageToken?: string) {
    this.calls.history++
    const params = new URLSearchParams({ startHistoryId, maxResults: '500' })
    if (pageToken) params.set('pageToken', pageToken)
    return this.request<HistoryPage>('/history', params)
  }

  async search(query: string, pageToken?: string, maxResults = 50) {
    const params = new URLSearchParams({ q: query, maxResults: String(maxResults) })
    if (pageToken) params.set('pageToken', pageToken)
    return this.request<ListPage>('/messages', params)
  }

  async full(id: string) {
    return this.request<RawMessage>(`/messages/${encodeURIComponent(id)}`, new URLSearchParams({ format: 'FULL' }))
  }

  async modify(id: string, addLabelIds: string[], removeLabelIds: string[]) {
    return this.write(`/messages/${encodeURIComponent(id)}/modify`, { addLabelIds, removeLabelIds })
  }

  async trash(id: string) {
    const path = `/messages/${encodeURIComponent(id)}/trash`
    const response = await this.fetcher(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
    })
    if (!response.ok) throw new GmailError(response.status, `Gmail API ${response.status} (${path})`)
  }

  private async write(path: string, body: object) {
    const response = await this.fetcher(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new GmailError(response.status, `Gmail API ${response.status} (${path})`)
  }
}

export function toMessage(raw: RawMessage | null): Message | null {
  if (!raw?.labelIds?.includes('INBOX')) return null
  const headers = raw.payload?.headers ?? []
  const header = (name: string) => headers.find(h => h.name.toLowerCase() === name)?.value ?? ''
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: header('from'),
    subject: header('subject'),
    internalDate: raw.internalDate ?? '',
    unread: raw.labelIds.includes('UNREAD'),
    labelIds: raw.labelIds,
  }
}
