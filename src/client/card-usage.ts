export function formatCardDate(value: string) {
  const match = value.normalize('NFKC').match(/^(?:\d{4}[年/.-])?(\d{1,2})[月/.-](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return '日付記載なし';
  const date = `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}`;
  return date;
}

export function parseCardUsage(subject: string, from: string, body = '') {
  const text = body.normalize('NFKC').replace(/\r/g, '');
  const field = (labels: string) => {
    for (const label of labels.split('|')) {
      const value = text.match(new RegExp(`(?:^|\\n)[ \\t]*[■●◆◇・【]*[ \\t]*(?:${label})(?:\\([^\\n)]*\\))?(?:[ \\t]*[】:：][ \\t]*|[ \\t]+|\\n)\\s*([^\\n]+)`, 'i'))?.[1]?.trim();
      if (value) return value;
    }
    return undefined;
  };
  const card = field('ご利用カード|カード名称|カード名');
  const identity = `${card ?? ''} ${subject} ${from}`.normalize('NFKC');
  const name = card ?? identity.match(/楽天カード|三井住友カード|エポスカード|イオンカード|セゾンカード|PayPayカード|dカード|au PAY カード|JCBカード|アメリカン・エキスプレス/i)?.[0];
  const brand = identity.match(/\b(VISA|Mastercard|JCB|AMEX|Diners(?: Club)?)\b|American Express|アメリカン・エキスプレス/i)?.[0];
  const amountField = field('ご利用金額|利用金額|ご利用額|利用額|お支払い金額');
  const amount = amountField?.match(/(?:[¥￥]\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:円|USD|JPY|EUR))/i)?.[0];
  const merchant = field('ご利用店名|ご利用店舗名|ご利用先|利用先|利用店舗|利用店名|ご利用内容|利用内容');
  const dateField = field('ご利用日時|利用日時|ご利用日|利用日');
  const date = dateField?.match(/(?:\d{4}[年/.-])?\d{1,2}[月/.-]\d{1,2}日?(?:\s+\d{1,2}:\d{2})?/)?.[0];
  return { name, brand, amount, merchant, date };
}


export function parseCardUsages(subject: string, from: string, body = '') {
  const text = body.normalize('NFKC').replace(/\r/g, '');
  const identity = parseCardUsage(subject, from, text);
  // Use a repeated field as the start of each transaction, keeping missing
  // fields within their own block rather than zipping separate value arrays.
  for (const labels of [
    'ご利用日時|利用日時|ご利用日|利用日',
    'ご利用店名|ご利用店舗名|ご利用先|利用先|利用店舗|利用店名',
    'ご利用金額|利用金額|ご利用額|利用額|お支払い金額',
  ]) {
    const marker = new RegExp(`^([ \\t]*[■●◆◇・【]*[ \\t]*(?:${labels})(?:\\([^\\n)]*\\))?(?:[ \\t]*[】:：]|[ \\t]+|$))`, 'gm');
    const starts = [...text.matchAll(marker)].map(match => match.index!);
    if (starts.length < 2) continue;
    return starts.map((start, index) => {
      const usage = parseCardUsage(subject, from, text.slice(start, starts[index + 1]));
      return { ...usage, name: usage.name ?? identity.name, brand: usage.brand ?? identity.brand };
    });
  }
  return [identity];
}
