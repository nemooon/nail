import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GmailClient } from './gmail.ts'

test('read and archive changes use Gmail labels; trash has an empty body', async () => {
  const requests: { url: string; options: RequestInit }[] = []
  const fetcher: typeof fetch = async (input, options) => {
    requests.push({ url: String(input), options: options ?? {} })
    return new Response('{}', { status: 200 })
  }
  const api = new GmailClient('test-token', fetcher)
  await api.modify('abc', [], ['UNREAD'])
  await api.modify('abc', [], ['INBOX'])
  await api.trash('abc')
  assert.equal(requests.length, 3)
  assert.equal(new URL(requests[0].url).pathname, '/gmail/v1/users/me/messages/abc/modify')
  assert.deepEqual(JSON.parse(String(requests[0].options.body)), { addLabelIds: [], removeLabelIds: ['UNREAD'] })
  assert.deepEqual(JSON.parse(String(requests[1].options.body)), { addLabelIds: [], removeLabelIds: ['INBOX'] })
  assert.equal(new URL(requests[2].url).pathname, '/gmail/v1/users/me/messages/abc/trash')
  assert.equal(requests[2].options.body, undefined)
})
