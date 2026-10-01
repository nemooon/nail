import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Message } from '../gmail/gmail.ts'

export const categories = ['カード利用', '配送', 'ショッピング', '契約・サブスク', '予約', 'プロモーション', 'その他'] as const
export type Category = typeof categories[number]
export type Classifications = Record<string, Category>
const path = resolve(import.meta.dirname, '../../.local/.classifications.json')
const rulesPath = resolve(import.meta.dirname, '../../.local/.classification-rules.json')

export type Classification = { category: Category; reason: string; source: 'manual' | 'sender-rule' | 'subject' | 'gmail' | 'unknown' }
export type SenderRule = { email: string; category: Category; subjectContains?: string; after: number }

export function senderEmail(from: string): string {
  return (from.match(/<([^<>\s@]+@[^<>\s]+)>/)?.[1]
    ?? from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '').toLowerCase()
}

const subjectRules: { category: Category; pattern: RegExp; reason: string }[] = [
  { category: 'カード利用', pattern: /(?:カード|jcb|visa|デビット|ショッピング).{0,12}(?:ご利用のお知らせ|利用速報|利用通知|利用明細|ご利用がありました)|(?:ご利用のお知らせ|利用速報).{0,12}(?:カード|jcb|visa|デビット)/i, reason: '件名にカードの利用通知を示す語があります' },
  { category: '配送', pattern: /(?:お荷物|荷物|宅急便|配送).{0,18}(?:お届け|配達|発送|完了|予定|不在|通知|追跡)|(?:お届け|配達).{0,12}(?:完了|予定|通知|しました)|発送完了|出荷完了|ご不在連絡/i, reason: '件名に配送状況を示す語があります' },
  { category: '予約', pattern: /(?:予約|ご予約).{0,16}(?:確定|完了|申込|受付|変更|キャンセル|確認)|(?:確定|完了|申込|受付|変更|キャンセル).{0,12}(?:予約|ご予約)/i, reason: '件名に予約の確定・変更などを示す語があります' },
  { category: 'ショッピング', pattern: /(?:ご注文|注文|購入).{0,20}(?:確認|受付|完了|確定|ありがとう|発送|返金)|(?:発送|出荷|返金).{0,12}(?:お知らせ|通知|完了|しました)|お支払い(?:完了|確認)/i, reason: '件名に注文・購入・返金を示す語があります' },
  { category: '契約・サブスク', pattern: /(?:サブスクリプション|契約|プラン|会員|利用規約|手数料率|プレミアム).{0,40}(?:更新|変更|終了|請求|改定|改訂|確定)|(?:請求|料金).{0,12}(?:確定|変更|改定|改訂|お知らせ)|お振替内容確定/i, reason: '件名に契約・請求の変更を示す語があります' },
]
const promotionPattern = /クーポン|セール|キャンペーン|割引|特典|おすすめ|オススメ|ポイント.{0,5}(?:還元|アップ)|(?:\d+%|\d+％)\s*(?:off|オフ)|本日限定|期間限定/i

export function classify(message: Message, overrides: Classifications = {}, rules: SenderRule[] = []): Classification {
  const manual = overrides[message.id]
  if (manual) return { category: manual, reason: 'このメールに設定した分類', source: 'manual' }
  const email = senderEmail(message.from)
  const subject = message.subject.normalize('NFKC')
  const timestamp = Number(message.internalDate)
  const matchingRule = [...rules].reverse().find(rule => rule.email === email && timestamp > rule.after && (!rule.subjectContains || subject.toLowerCase().includes(rule.subjectContains.normalize('NFKC').toLowerCase())))
  if (matchingRule) return { category: matchingRule.category, reason: matchingRule.subjectContains ? `送信元と件名「${matchingRule.subjectContains}」のルール` : '送信元に設定した今後のルール', source: 'sender-rule' }
  for (const rule of subjectRules) {
    if (rule.pattern.test(subject)) return { category: rule.category, reason: rule.reason, source: 'subject' }
  }
  if (promotionPattern.test(subject)) return { category: 'プロモーション', reason: '件名に広告・特典を示す語があります', source: 'subject' }
  if (message.labelIds?.includes('CATEGORY_PROMOTIONS')) return { category: 'プロモーション', reason: 'Gmail のプロモーション分類', source: 'gmail' }
  return { category: 'その他', reason: '明確な分類条件が見つかりません', source: 'unknown' }
}

export async function readClassifications(): Promise<Classifications> {
  try { return JSON.parse(await readFile(path, 'utf8')) as Classifications }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function setClassification(id: string, category: Category): Promise<Classifications> {
  const current = await readClassifications()
  current[id] = category
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(current), { mode: 0o600 })
  await rename(temporary, path)
  return current
}

export async function readSenderRules(): Promise<SenderRule[]> {
  try { return JSON.parse(await readFile(rulesPath, 'utf8')) as SenderRule[] }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function addSenderRule(rule: SenderRule): Promise<void> {
  const current = await readSenderRules()
  current.push(rule)
  const temporary = `${rulesPath}.tmp`
  await writeFile(temporary, JSON.stringify(current), { mode: 0o600 })
  await rename(temporary, rulesPath)
}
