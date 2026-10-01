import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { authorizationUrl, createPkce, exchangeCode, readClient, saveToken, verifyOwner } from './oauth.ts'

type Options = { closeAfterSuccess?: boolean }

export async function startOAuthServer(options: Options = {}) {
  const client = await readClient()
  const pending = new Map<string, { verifier: string; createdAt: number }>()
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost:8766')
    if (request.method !== 'GET' || !['/', '/oauth/callback'].includes(url.pathname)) {
      response.writeHead(404).end()
      return
    }
    if (url.pathname === '/') {
      for (const [key, value] of pending) if (Date.now() - value.createdAt > 10 * 60_000) pending.delete(key)
      const state = randomBytes(32).toString('base64url')
      const { verifier, challenge } = createPkce()
      pending.set(state, { verifier, createdAt: Date.now() })
      response.writeHead(302, { Location: authorizationUrl(client, state, challenge), 'Cache-Control': 'no-store' }).end()
      return
    }
    const state = url.searchParams.get('state') ?? ''
    const attempt = pending.get(state)
    pending.delete(state)
    if (!attempt || Date.now() - attempt.createdAt > 10 * 60_000) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('認証状態が一致しないか、期限が切れました。')
      return
    }
    const code = url.searchParams.get('code')
    if (!code) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('認証が完了しませんでした。')
      return
    }
    try {
      const token = await exchangeCode(client, code, attempt.verifier)
      await verifyOwner(token.access_token)
      if (!token.refresh_token) throw new Error('更新トークンが取得できませんでした。再同意してください')
      await saveToken(token)
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('認証が完了しました。このタブを閉じて Nail Mail に戻ってください。')
      console.log('Gmail 認証が完了しました。')
      if (options.closeAfterSuccess) server.close()
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('認証を保存できませんでした。ターミナルを確認してください。')
      console.error(error instanceof Error ? error.message : String(error))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(8766, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  if (options.closeAfterSuccess) setTimeout(() => server.close(), 10 * 60_000).unref()
  return server
}
