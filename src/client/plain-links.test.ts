import assert from 'node:assert/strict'
import { test } from 'node:test'
import { linkifyPlainText } from './plain-links.ts'

test('plain mail links HTTP URLs and preserves surrounding text', () => {
  const input = '配送状況: https://example.com/track?id=1&lang=ja。\n次はこちら (http://example.org/a_(b))。'
  const parts = linkifyPlainText(input)
  assert.equal(parts.map(part => part.text).join(''), input)
  assert.deepEqual(parts.filter(part => part.href).map(part => part.href), [
    'https://example.com/track?id=1&lang=ja',
    'http://example.org/a_(b)',
  ])
})

test('plain mail does not link unsupported or invalid URLs', () => {
  const input = 'javascript:alert(1) mailto:test@example.com https://'
  assert.deepEqual(linkifyPlainText(input), [{ text: input }])
})
