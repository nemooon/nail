import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Message } from '../gmail/gmail.ts'
import { classify } from './classifications.ts'

function mail(subject: string, labelIds: string[] = []): Message {
  return { id: 'm1', threadId: 't1', from: 'Store <news@example.test>', subject, internalDate: '2000', unread: true, labelIds }
}

test('clear transactional subjects outrank Gmail promotions', () => {
  assert.equal(classify(mail('【お知らせ】お荷物お届け予定日', ['CATEGORY_PROMOTIONS'])).category, '配送')
  assert.equal(classify(mail('ご予約が確定しました')).category, '予約')
  assert.equal(classify(mail('カードご利用のお知らせ')).category, 'カード利用')
  assert.equal(classify(mail('【ご注文受付完了】ありがとうございます')).category, 'ショッピング')
  assert.equal(classify(mail('ご注文ありがとうございます。次回使えるクーポンをお送りします')).category, 'ショッピング')
  assert.equal(classify(mail('利用規約の改訂について')).category, '契約・サブスク')
})

test('marketing and ambiguous messages stay out of important notifications', () => {
  assert.equal(classify(mail('本日限定！配送無料キャンペーン')).category, 'プロモーション')
  assert.equal(classify(mail('迅速な配達、現地倉庫から発送', ['CATEGORY_PROMOTIONS'])).category, 'プロモーション')
  assert.equal(classify(mail('ご案内')).category, 'その他')
})

test('manual correction and future sender rules have precedence', () => {
  const message = mail('ご案内')
  const rules = [{ email: 'news@example.test', category: '予約' as const, after: 1000, subjectContains: 'ご案内' }]
  assert.equal(classify(message, {}, rules).category, '予約')
  assert.equal(classify(message, { m1: 'その他' }, rules).category, 'その他')
  assert.equal(classify({ ...message, internalDate: '1000' }, {}, rules).category, 'その他')
  assert.equal(classify({ ...message, subject: '別の件名' }, {}, rules).category, 'その他')
})
