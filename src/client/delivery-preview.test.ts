import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDeliveryDisplayDate, parseDeliveryPreview, requesterByTracking, trackingKey } from './delivery-preview.ts';

test('delivery dates display in Japanese month and day format', () => {
  assert.equal(formatDeliveryDisplayDate('09/23'), '9月23日');
  assert.equal(formatDeliveryDisplayDate('10/01'), '10月1日');
});

test('fills a missing requester from the same tracking number only when names agree', () => {
  const previews = {
    first: { trackingNumber: '1234-5678-9012', requester: 'サンプル商店' },
    second: { trackingNumber: '123456789012' },
    other: { trackingNumber: '999999999999', requester: '別の店舗' },
  };
  assert.equal(requesterByTracking(previews)[trackingKey(previews.second.trackingNumber)], 'サンプル商店');
  assert.equal(requesterByTracking({ ...previews, conflict: { trackingNumber: '123456789012', requester: '別の依頼主' } })[trackingKey(previews.second.trackingNumber)], undefined);
});

test('tracking numbers match across formatting differences', () => {
  assert.equal(trackingKey('1234-5678-9012'), trackingKey('123456789012'));
  assert.notEqual(trackingKey('1234-5678-9012'), trackingKey('1234-5678-9013'));
});

test('extracts a tracking number and completion date on following lines', () => {
  assert.deepEqual(parseDeliveryPreview('お届け完了のお知らせ', '■お届け完了日\n2026/10/01(木) 12:30\n■送り状番号\n1234-5678-9012'), {
    trackingNumber: '1234-5678-9012', date: '10/01', status: '完了',
  });
});

test('extracts a scheduled date and tracking number without reading a URL token', () => {
  assert.deepEqual(parseDeliveryPreview('お荷物のお届け予定', '■お届け予定日：2026年10月2日\n追跡番号：123456789012\nhttps://example.test/123456789999'), {
    trackingNumber: '123456789012', date: '10/02', status: '予定',
  });
});

test('keeps unknown values unknown and uses a date from a delivery subject', () => {
  assert.deepEqual(parseDeliveryPreview('10月3日お届け予定', 'ご確認ください'), { date: '10/03', status: '予定' });
  assert.deepEqual(parseDeliveryPreview('配送のお知らせ', 'https://example.test/123456789012'), {});
});

test('extracts a number labeled 送り状 No. and a date in a sentence', () => {
  assert.deepEqual(parseDeliveryPreview('配送のお知らせ', 'お届け予定は【2026/10/04(日)】です。\n■送り状 No. :123456789012'), {
    trackingNumber: '123456789012', date: '10/04', status: '予定',
  });
});

test('shows an explicitly labeled requester without treating prose as a name', () => {
  assert.deepEqual(parseDeliveryPreview('配送のお知らせ', '■ご依頼主     :(株)サンプル商店\n■送り状番号:123456789012'), {
    requester: '(株)サンプル商店', trackingNumber: '123456789012',
  });
  assert.deepEqual(parseDeliveryPreview('配送のお知らせ', '・送り主からの荷物をお届けします。'), {});
});

test('recognizes a requester named in the shipment sentence', () => {
  assert.deepEqual(parseDeliveryPreview('配送のお知らせ', 'サンプル商店様からのお荷物をお届けします。'), {
    requester: 'サンプル商店',
  });
  assert.deepEqual(parseDeliveryPreview('配送のお知らせ', 'お客様からのお荷物をお届けします。'), {});
});
