export type ShoppingPreview = { orderNumber?: string; receiptNumber?: string; productCodes?: string[] };

const orderLabel = /(?:ご注文番号|注文番号|受注番号|注文コード|ご注文ID|注文ID|オーダー番号|オーダーID|Order\s*(?:Number|No\.?|ID))(?:[】\s]*[:：#]\s*|】\s*|\s+|$)(.*)$/i;
const monotaroOrderLabel = /(?:注文書番号|ご注文番号|注文番号|受注番号|ご注文ID|注文ID|オーダー番号|オーダーID|Order\s*(?:Number|No\.?|ID))(?:[】\s]*[:：#]\s*|】\s*|\s+|$)(.*)$/i;
const orderValue = /^#?\s*([A-Z0-9][A-Z0-9-]{4,49})\b/i;
const pickupLabel = /(?:お?受け取り番号|受取番号)(?:[】\s]*[:：#]\s*|】\s*|\s+|$)(.*)$/;
const reservationLabel = /(?:ご予約番号|予約番号)(?:[】\s]*[:：#]\s*|】\s*|\s+|$)(.*)$/;
const receiptLabel = /受付番号(?:[】\s]*[:：#]\s*|】\s*|\s+|$)(.*)$/;
const shortValue = /^#?\s*([A-Z0-9][A-Z0-9-]{1,19})\b/i;

export function orderKey(number: string) {
  return number.normalize('NFKC').replace(/[\s#-]/g, '').toUpperCase();
}

function findNumber(sources: string[], label: RegExp, valuePattern: RegExp) {
  for (const source of sources) {
    const lines = source.normalize('NFKC').replace(/\r/g, '').split('\n').map(line => line.trim());
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].replace(/^[■●◆◇・【\s]+/, '');
      const labeled = line.match(label);
      if (!labeled) continue;
      const value = labeled[1].trim() || lines.slice(index + 1).find(next => next.trim()) || '';
      const number = value.match(valuePattern)?.[1];
      if (number && /\d/.test(number)) return number;
    }
  }
}

export function parseShoppingPreview(subject: string, body = '', from = ''): ShoppingPreview {
  const sources = [subject, body];
  const brand = `${from} ${subject}`;
  const isMonotaro = /モノタロウ|monotaro/i.test(brand);
  const specialNumber = /マクドナルド|mcdonald/i.test(brand)
    ? findNumber(sources, pickupLabel, shortValue)
    : /\bKFC\b|ケンタッキー/i.test(brand)
      ? findNumber(sources, reservationLabel, shortValue)
      : undefined;
  const orderNumber = specialNumber ?? findNumber(sources, isMonotaro ? monotaroOrderLabel : orderLabel, orderValue);
  if (!isMonotaro) return orderNumber ? { orderNumber } : {};
  const receiptNumber = findNumber(sources, receiptLabel, orderValue);
  const productCodes = [...new Set([...body.normalize('NFKC').matchAll(/注文コード\s*[:：]\s*([A-Z0-9][A-Z0-9-]{1,49})\b/gi)].map(match => orderKey(match[1])))].sort();
  return {
    ...(orderNumber ? { orderNumber } : {}),
    ...(receiptNumber ? { receiptNumber } : {}),
    ...(productCodes.length ? { productCodes } : {}),
  };
}

export function shoppingOrderNumbers(previews: Record<string, ShoppingPreview>, mails: { id: string; internalDate: string }[]) {
  const result: Record<string, string> = {};
  const dated = mails.map(mail => ({ ...mail, time: Number(mail.internalDate), preview: previews[mail.id] }));
  for (const mail of dated) {
    if (mail.preview?.orderNumber) result[mail.id] = mail.preview.orderNumber;
  }
  for (const receipt of dated) {
    const preview = receipt.preview;
    if (!preview?.receiptNumber || preview.orderNumber || !preview.productCodes?.length || !Number.isFinite(receipt.time)) continue;
    const receiptCodes = preview.productCodes;
    const candidates = new Map(dated.filter(mail => {
      const other = mail.preview;
      if (!other?.orderNumber || !other.productCodes) return false;
      return other.productCodes.length === receiptCodes.length
        && mail.time >= receipt.time && mail.time - receipt.time <= 7 * 86400000
        && other.productCodes.every((code, index) => code === receiptCodes[index]);
    }).map(mail => [orderKey(mail.preview!.orderNumber!), mail.preview!.orderNumber!] as const));
    if (candidates.size === 1) result[receipt.id] = [...candidates.values()][0];
  }
  return result;
}
