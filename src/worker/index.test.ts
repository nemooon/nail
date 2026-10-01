import test from 'node:test'
import assert from 'node:assert/strict'
import app from './index.ts'

const env = { APP_ORIGIN: 'https://mail.example.com' }

test('unauthenticated browser cannot read Gmail data', async () => {
  for (const path of ['/api/messages', '/api/classifications', '/api/messages/example', '/api/search?q=test', '/api/archive']) {
    const response = await app.request(`https://mail.example.com${path}`, {}, env)
    assert.equal(response.status, 401, path)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
})

test('writes require the expected same-origin request', async () => {
  const endpoint = 'https://mail.example.com/api/sync'
  const missing = await app.request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, env)
  assert.equal(missing.status, 403)
  const foreign = await app.request(endpoint, { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{}' }, env)
  assert.equal(foreign.status, 403)
  const otherNailOrigin = await app.request(endpoint, { method: 'POST', headers: { Origin: 'https://nail.nemooon.workers.dev', 'Content-Type': 'application/json' }, body: '{}' }, env)
  assert.equal(otherNailOrigin.status, 403)
  const legacy = await app.request('https://foreign.example/api/messages', {}, env)
  assert.equal(legacy.status, 403)
})

test('missing origin configuration rejects requests', async () => {
  const response = await app.request('https://mail.example.com/api/messages')
  assert.equal(response.status, 403)
})
