export type DeliveryPreview = {
  trackingNumber?: string;
  requester?: string;
  date?: string;
  status?: '予定' | '完了';
};

export function trackingKey(number: string) {
  return number.replace(/\D/g, '');
}

export function requesterByTracking(previews: Record<string, DeliveryPreview>) {
  const groups = new Map<string, { name: string; normalized: string; conflict: boolean }>();
  for (const preview of Object.values(previews)) {
    if (!preview.trackingNumber || !preview.requester) continue;
    const key = trackingKey(preview.trackingNumber);
    if (!key) continue;
    const normalized = preview.requester.normalize('NFKC').replace(/\s+/g, '').replace(/様$/, '');
    const current = groups.get(key);
    if (!current) groups.set(key, { name: preview.requester, normalized, conflict: false });
    else if (current.normalized !== normalized) current.conflict = true;
  }
  return Object.fromEntries([...groups].filter(([, value]) => !value.conflict).map(([key, value]) => [key, value.name]));
}

export function formatDeliveryDisplayDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})$/);
  return match ? `${Number(match[1])}月${Number(match[2])}日` : value;
}

const trackingLabels = /^(?:送り状番号|[^:\n]{0,14}送り状\s*No\.?|お問い?合わせ番号|お問合せ番号|問合せ番号|追跡番号|伝票番号|荷物番号)/i;
const plannedLabels = /^(?:お届け予定日(?:時)?|配達予定日(?:時)?|お届け日時|配達予定日時)/;
const completedLabels = /^(?:お届け完了日(?:時)?|配達完了日(?:時)?|配達日時)/;
const requesterLabel = /^(?:ご依頼主|依頼主|荷送人|発送元|送り主|差出人)(?:様)?(?:[】\s]*[:：]\s*(.*)|[】\s]*)$/;
const trackingPattern = /\b(?:\d[ -]?){9,15}\d\b/;
const datePattern = /(?:\d{4}[年/.-]\s*)?\d{1,2}[月/.-]\s*\d{1,2}日?/;

function linesOf(text: string) {
  return text.normalize('NFKC').replace(/\r/g, '').split('\n').map(line => line.trim());
}

function afterLabel(lines: string[], index: number, label: RegExp) {
  const line = lines[index].replace(/^[■●◆◇・【\s]+/, '');
  const match = line.match(label);
  if (!match) return undefined;
  const sameLine = line.slice(match[0].length).replace(/^[】\s:：は]+/, '').trim();
  if (sameLine) return sameLine;
  return lines.slice(index + 1).find(next => next.length > 0);
}

function requesterOf(lines: string[]) {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].replace(/^[■●◆◇・【\s]+/, '');
    const match = line.match(requesterLabel);
    if (!match) continue;
    const value = (match[1] || lines.slice(index + 1).find(next => next.length > 0) || '').trim();
    if (value && !/^(?:[■●◆◇・【]|https?:\/\/)/.test(value)) return value.slice(0, 100);
  }
  for (const line of lines) {
    const match = line.match(/^([^。、「」【】]{2,60}?)\s*様からのお荷物/);
    const name = match?.[1]?.trim();
    if (name && !/^(?:お客|送り主|ご依頼主|差出人|発送元|配送会社|当社)$/.test(name)) return name;
  }
  return undefined;
}

export function formatDeliveryDate(value: string) {
  const match = value.normalize('NFKC').match(datePattern)?.[0];
  if (!match) return undefined;
  const parts = match.match(/(?:\d{4}[年/.-]\s*)?(\d{1,2})[月/.-]\s*(\d{1,2})/);
  return parts ? `${parts[1].padStart(2, '0')}/${parts[2].padStart(2, '0')}` : undefined;
}

export function parseDeliveryPreview(subject: string, body = ''): DeliveryPreview {
  const lines = linesOf(body);
  let trackingNumber: string | undefined;
  let plannedDate: string | undefined;
  let completedDate: string | undefined;
  for (let index = 0; index < lines.length; index++) {
    const numberText = afterLabel(lines, index, trackingLabels);
    if (!trackingNumber && numberText) trackingNumber = numberText.match(trackingPattern)?.[0]?.replace(/\s/g, '');
    const plannedText = afterLabel(lines, index, plannedLabels);
    if (!plannedDate && plannedText) plannedDate = formatDeliveryDate(plannedText);
    const completedText = afterLabel(lines, index, completedLabels);
    if (!completedDate && completedText) completedDate = formatDeliveryDate(completedText);
  }
  for (const line of lines) {
    if (line.includes('://')) continue;
    if (!plannedDate && /お届け予定|配達予定/.test(line)) plannedDate = formatDeliveryDate(line);
    if (!completedDate && /お届け完了|配達完了/.test(line)) completedDate = formatDeliveryDate(line);
  }
  // Some notifications print only the number, without a label. Do not read URLs.
  if (!trackingNumber) {
    trackingNumber = lines.filter(line => !line.includes('://'))
      .map(line => line.match(/^(?:\d[ -]?){9,15}\d$/)?.[0]?.replace(/\s/g, ''))
      .find(Boolean);
  }
  const subjectDate = formatDeliveryDate(subject);
  const tracking = trackingNumber ? { trackingNumber } : {};
  const requester = requesterOf(lines);
  const fields = requester ? { ...tracking, requester } : tracking;
  if (completedDate) return { ...fields, date: completedDate, status: '完了' };
  if (plannedDate) return { ...fields, date: plannedDate, status: '予定' };
  if (subjectDate && /配達完了|お届け完了|配達済み/.test(subject)) return { ...fields, date: subjectDate, status: '完了' };
  if (subjectDate && /お届け予定|配達予定/.test(subject)) return { ...fields, date: subjectDate, status: '予定' };
  return fields;
}
