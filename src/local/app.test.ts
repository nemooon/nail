import assert from 'node:assert/strict'
import { test } from 'node:test'
import app, { extractBody } from './app.ts'

test('HTML mail removes active content and external images', () => {
  const html = '<style>@import url(https://tracker.example/css); .card{background-color:#abc;padding:12px;background-image:url(https://tracker.example/pixel)}</style><div class="card">Hello</div><script>alert(1)</script><img src="https://tracker.example/pixel" onerror="alert(1)"><a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a>'
  const result = extractBody({ id: 'a', threadId: 'a', payload: { mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } } })
  assert.match(result.html, /Hello/)
  assert.doesNotMatch(result.html, /<script|<img|javascript:/)
  assert.match(result.html, /target="_blank"/)
  assert.match(result.html, /class="card"/)
  assert.match(result.css, /background-color:#abc/)
  assert.doesNotMatch(result.css, /@import|background-image|tracker\.example/)
  assert.equal(result.imageCount, 1)
  const withImages = extractBody({ id: 'a', threadId: 'a', payload: { mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } } }, true)
  assert.match(withImages.html, /<img src="https:\/\/tracker\.example\/pixel"/)
  assert.doesNotMatch(withImages.html, /onerror/)
})

test('local API rejects non-local hosts and foreign write origins', async () => {
  const foreignHost = await app.request(new Request('http://evil.example/api/status', { headers: { Host: 'evil.example' } }))
  assert.equal(foreignHost.status, 403)
  const foreignOrigin = await app.request(new Request('http://127.0.0.1:8767/api/sync', {
    method: 'POST', headers: { Host: '127.0.0.1:8767', Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}',
  }))
  assert.equal(foreignOrigin.status, 403)
})

test('decoded Gmail UTF-8 body takes precedence over a stale ISO-2022-JP MIME header', () => {
  const body = '日本語の本文です'
  const result = extractBody({ id: 'a', threadId: 'a', payload: {
    mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=ISO-2022-JP' }],
    body: { data: Buffer.from(body, 'utf8').toString('base64url') },
  } })
  assert.equal(result.text, body)
  assert.doesNotMatch(result.text, /\uFFFD/)
})

test('real ISO-2022-JP escape sequences still decode', () => {
  const result = extractBody({ id: 'a', threadId: 'a', payload: {
    mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=ISO-2022-JP' }],
    body: { data: Buffer.from('1b2442467c4b5c386c1b2842', 'hex').toString('base64url') },
  } })
  assert.equal(result.text, '日本語')
})
