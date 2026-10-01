import { createHash, randomBytes } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const OWNER_EMAIL = 'nemooon@gmail.com'
export const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
export const CLIENT_PATH = resolve(import.meta.dirname, '../../.local/.oauth-client.json')
export const TOKEN_PATH = resolve(import.meta.dirname, '../../.local/.oauth-token.json')

type Client = { client_id: string; client_secret: string; redirect_uris: string[] }
export type SavedToken = { access_token: string; refresh_token?: string; expires_at: number; scopes?: string[] }

export async function readClient(): Promise<Client> {
  const data = JSON.parse(await readFile(CLIENT_PATH, 'utf8')) as { web?: Client }
  const client = data.web
  if (!client?.client_id || !client.client_secret || !client.redirect_uris?.includes('http://localhost:8766/oauth/callback')) {
    throw new Error('OAuth クライアント設定が不正です')
  }
  return client
}

export async function readToken(): Promise<SavedToken | null> {
  try {
    return JSON.parse(await readFile(TOKEN_PATH, 'utf8')) as SavedToken
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function saveToken(token: SavedToken): Promise<void> {
  const temporary = `${TOKEN_PATH}.tmp`
  await writeFile(temporary, JSON.stringify(token), { mode: 0o600 })
  await rename(temporary, TOKEN_PATH)
}

export function createPkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function authorizationUrl(client: Client, state: string, challenge: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: 'http://localhost:8766/oauth/callback',
    response_type: 'code',
    scope: MODIFY_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    login_hint: OWNER_EMAIL,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

async function requestToken(params: URLSearchParams): Promise<SavedToken> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  if (!response.ok) throw new Error(`OAuth トークン取得に失敗しました (${response.status})`)
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string }
  const scopes = result.scope?.split(' ')
  if (!result.access_token || (scopes && !scopes.some(scope => scope === SCOPE || scope === MODIFY_SCOPE))) {
    throw new Error('Gmail 権限が許可されていません')
  }
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token,
    expires_at: Date.now() + (result.expires_in ?? 3600) * 1000,
    scopes,
  }
}

export async function exchangeCode(client: Client, code: string, verifier: string): Promise<SavedToken> {
  const token = await requestToken(new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: 'http://localhost:8766/oauth/callback',
    grant_type: 'authorization_code',
    code_verifier: verifier,
  }))
  if (!token.scopes?.includes(MODIFY_SCOPE)) throw new Error('Gmail の変更権限が許可されていません')
  return token
}

export async function getAccessToken(): Promise<string> {
  const saved = await readToken()
  if (!saved) throw new Error('未認証です。先に node auth.ts を実行してください')
  if (Date.now() + 60_000 < saved.expires_at) return saved.access_token
  if (!saved.refresh_token) throw new Error('更新トークンがありません。node auth.ts で再認証してください')
  const client = await readClient()
  const refreshed = await requestToken(new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: saved.refresh_token,
    grant_type: 'refresh_token',
  }))
  await saveToken({ ...refreshed, scopes: refreshed.scopes ?? saved.scopes, refresh_token: saved.refresh_token })
  return refreshed.access_token
}

export async function verifyOwner(accessToken: string): Promise<void> {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`Gmail アカウントの確認に失敗しました (${response.status})`)
  const profile = await response.json() as { emailAddress?: string }
  if (profile.emailAddress?.toLowerCase() !== OWNER_EMAIL) throw new Error('許可された Gmail アカウントと異なります')
}
