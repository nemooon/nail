import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatCardDate, parseCardUsage, parseCardUsages } from './card-usage.ts';

test('card dates use the same month and day format without times', () => {
  assert.equal(formatCardDate('2026/10/1 9:05:32'), '10/01');
  assert.equal(formatCardDate('2026年10月1日 09:05'), '10/01');
  assert.equal(formatCardDate('2026-10-01'), '10/01');
  assert.equal(formatCardDate('10/1'), '10/01');
});

test('extracts labeled card transaction fields and normalizes full width text', () => {
  assert.deepEqual(parseCardUsage('カードご利用のお知らせ', '三井住友カード', 'カード名：三井住友カード VISA\nご利用店名：コンビニ\nご利用金額：１，２３４円\nご利用日時：2026/10/01 12:30'), {
    name: '三井住友カード VISA', brand: 'VISA', merchant: 'コンビニ', amount: '1,234円', date: '2026/10/01 12:30',
  });
});

test('does not infer a transaction amount or brand from unrelated body content', () => {
  const usage = parseCardUsage('楽天カード利用速報', '楽天カード', 'ポイント残高：5,000円\nVISAへの変更キャンペーン');
  assert.equal(usage.name, '楽天カード');
  assert.equal(usage.amount, undefined);
  assert.equal(usage.brand, undefined);
  assert.equal(usage.date, undefined);
  assert.equal(parseCardUsage('利用通知', 'カード会社', 'カード名義：山田太郎').name, undefined);
});

test('accepts labels followed by line breaks and yen prefixes', () => {
  const usage = parseCardUsage('カード利用通知', 'カード会社', '■ご利用先\nオンラインストア\n■ご利用金額\n￥2,500\n■ご利用日\n2026年10月1日');
  assert.equal(usage.merchant, 'オンラインストア');
  assert.equal(usage.amount, '¥2,500');
  assert.equal(usage.date, '2026年10月1日');
});

test('extracts diamond-prefixed transaction fields before generic usage headings', () => {
  const usage = parseCardUsage('カードご利用のお知らせ', '三井住友カード', 'ご利用内容：\n下記をご確認ください\n\nご利用カード：三井住友カード\n\n◇利用日：2026/10/01 12:30\n◇利用先：サンプル店舗\n◇利用金額：1,234円\n');
  assert.equal(usage.name, '三井住友カード');
  assert.equal(usage.merchant, 'サンプル店舗');
  assert.equal(usage.amount, '1,234円');
  assert.equal(usage.date, '2026/10/01 12:30');
});

test('JCB multiple transactions preserve order, duplicates and missing values', () => {
  const body = 'カード名称：JCBカード\n' + [
    '　　【ご利用日】　2026/10/01\n　　【ご利用金額】　 1,000円\n　　【ご利用先】　店舗A',
    '　　【ご利用日】　2026/10/01\n　　【ご利用先】　店舗B',
    '　　【ご利用日】　2026/10/01\n　　【ご利用金額】　 1,000円\n　　【ご利用先】　店舗A',
  ].join('\n\n');
  const usages = parseCardUsages('カードご利用のお知らせ', 'JCB', body);
  assert.equal(usages.length, 3);
  assert.deepEqual(usages.map(u => u.merchant), ['店舗A', '店舗B', '店舗A']);
  assert.deepEqual(usages.map(u => u.amount), ['1,000円', undefined, '1,000円']);
  assert.ok(usages.every(u => u.date === '2026/10/01' && u.name === 'JCBカード'));
});

test('JCB timestamp with timezone annotation is recognized', () => {
  const usages = parseCardUsages('カードご利用のお知らせ', 'JCB', '【ご利用日時（日本時間）】　2026/10/01 12:30\n【ご利用金額】　500円\n【ご利用先】　店舗A');
  assert.equal(usages.length, 1);
  assert.equal(usages[0].date, '2026/10/01 12:30');
  assert.equal(usages[0].amount, '500円');
});
