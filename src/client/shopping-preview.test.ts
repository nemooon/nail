import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderKey, parseShoppingPreview, shoppingOrderNumbers } from './shopping-preview.ts';

test('finds labeled order numbers in subjects and bodies', () => {
  assert.deepEqual(parseShoppingPreview('【注文番号】 1234567'), { orderNumber: '1234567' });
  assert.deepEqual(parseShoppingPreview('注文のお知らせ', '注文コード:ABCD12345'), { orderNumber: 'ABCD12345' });
  assert.deepEqual(parseShoppingPreview('注文のお知らせ', '【オーダーID】abc-123456-xy'), { orderNumber: 'abc-123456-xy' });
  assert.deepEqual(parseShoppingPreview('注文のお知らせ', '注文番号\n1234567'), { orderNumber: '1234567' });
  assert.deepEqual(parseShoppingPreview('[お知らせ] 商品の注文番号：1234567'), { orderNumber: '1234567' });
});

test('does not mistake prose, dates or tracking numbers for an order number', () => {
  assert.deepEqual(parseShoppingPreview('注文のお知らせ', '注文番号をご確認ください。\n送り状番号:123456789012'), {});
  assert.deepEqual(parseShoppingPreview('注文のお知らせ', '注文日:2026/10/02'), {});
});

test('uses McDonald\'s pickup number as its shopping order number', () => {
  assert.deepEqual(parseShoppingPreview('【モバイルオーダー】ご注文ありがとうございます', 'お受け取り番号：１２３', '日本マクドナルド <order@example.com>'), { orderNumber: '123' });
  assert.deepEqual(parseShoppingPreview('マクドナルド', '受け取り番号\nA123'), { orderNumber: 'A123' });
  assert.deepEqual(parseShoppingPreview('マクドナルド', '注文番号：999999\n受け取り番号：123'), { orderNumber: '123' });
  assert.deepEqual(parseShoppingPreview('別のお店', '受け取り番号：123'), {});
});

test('uses KFC reservation number as its shopping order number', () => {
  assert.deepEqual(parseShoppingPreview('【ご注文受付完了】ありがとうございます[KFCネットオーダー]', 'ご予約番号：１２３４', 'orders@example.com'), { orderNumber: '1234' });
  assert.deepEqual(parseShoppingPreview('ご注文受付完了', '予約番号\nAB-123', 'KFC <order@example.com>'), { orderNumber: 'AB-123' });
  assert.deepEqual(parseShoppingPreview('KFCネットオーダー', '注文番号：999999\nご予約番号：1234'), { orderNumber: '1234' });
  assert.deepEqual(parseShoppingPreview('別のお店', 'ご予約番号：1234'), {});
});

test('uses Monotaro order form number rather than a product order code', () => {
  const from = 'モノタロウ <orders@example.com>';
  assert.deepEqual(parseShoppingPreview('ご注文ありがとうございます', '注文コード：ITEM12345\n注文書番号：9876543210\n注文コード：ITEM67890', from), { orderNumber: '9876543210', productCodes: ['ITEM12345', 'ITEM67890'] });
  assert.deepEqual(parseShoppingPreview('ご注文ありがとうございます', '【注文書番号】\n9876543210', from), { orderNumber: '9876543210' });
  assert.deepEqual(parseShoppingPreview('注文コード：ITEM12345', '注文コード：ITEM67890', from), { productCodes: ['ITEM67890'] });
  assert.deepEqual(parseShoppingPreview('ご注文受付', '受付番号：12345678\n注文コード：ITEM12345\n注文コード：ITEM67890', from), { receiptNumber: '12345678', productCodes: ['ITEM12345', 'ITEM67890'] });
});

test('links a Monotaro receipt only to one matching later order', () => {
  const previews = {
    receipt: { receiptNumber: '12345678', productCodes: ['ITEM12345', 'ITEM67890'] },
    order: { orderNumber: '9876543210', productCodes: ['ITEM12345', 'ITEM67890'] },
    shipped: { orderNumber: '9876543210', productCodes: ['ITEM12345'] },
  };
  const day = 86400000;
  const mails = [
    { id: 'receipt', internalDate: String(day) },
    { id: 'order', internalDate: String(day + 60000) },
    { id: 'shipped', internalDate: String(day * 2) },
  ];
  assert.deepEqual(shoppingOrderNumbers(previews, mails), { receipt: '9876543210', order: '9876543210', shipped: '9876543210' });
  assert.equal(shoppingOrderNumbers({ ...previews, other: { orderNumber: '5555555555', productCodes: previews.receipt.productCodes } }, [...mails, { id: 'other', internalDate: String(day * 3) }]).receipt, undefined);
  assert.equal(shoppingOrderNumbers(previews, [mails[0], { ...mails[1], internalDate: String(day * 9) }]).receipt, undefined);
});

test('order number comparison ignores casing and separators', () => {
  assert.equal(orderKey('AB-1234-XY'), orderKey('ab1234xy'));
  assert.notEqual(orderKey('AB-1234-XY'), orderKey('AB-1235-XY'));
});
