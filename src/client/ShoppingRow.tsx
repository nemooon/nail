import { useEffect, useRef, useState } from 'react';
import { parseShoppingPreview, type ShoppingPreview } from './shopping-preview';
import { cachePreview, getCachedPreview } from './mail-preview-cache';
import { mailBodyText, type MailBody } from './mail-body-text';

const pending = new Map<string, Promise<ShoppingPreview>>();
let active = 0;
const waiting: (() => void)[] = [];

async function readShopping(id: string, subject: string, from: string, load: () => Promise<MailBody>) {
  const existing = pending.get(id);
  if (existing) return existing;
  const request = (async () => {
    const stored = await getCachedPreview('shopping', id);
    if (stored) return stored;
    const subjectPreview = parseShoppingPreview(subject, '', from);
    if (subjectPreview.orderNumber && !/モノタロウ|monotaro/i.test(`${from} ${subject}`)) {
      await cachePreview('shopping', id, subjectPreview);
      return subjectPreview;
    }
    if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try {
      const body = await load();
      const preview = parseShoppingPreview(subject, mailBodyText(body), from);
      await cachePreview('shopping', id, preview);
      return preview;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  })();
  pending.set(id, request);
  if (pending.size > 200) pending.delete(pending.keys().next().value!);
  try { return await request; }
  catch (error) { pending.delete(id); throw error; }
}

export function ShoppingRow({ mail, senderName, receivedDate, load, onPreview, resolvedOrderNumber }: {
  mail: { id: string; from: string; subject: string; unread: boolean };
  senderName: string;
  receivedDate: string;
  load: () => Promise<MailBody>;
  onPreview: (id: string, preview: ShoppingPreview) => void;
  resolvedOrderNumber?: string;
}) {
  const loader = useRef(load);
  loader.current = load;
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  const [preview, setPreview] = useState<ShoppingPreview | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readShopping(mail.id, mail.subject, mail.from, () => loader.current()).then(result => {
      if (!cancelled) {
        setPreview(result);
        previewCallback.current(mail.id, result);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [mail.id, mail.subject, mail.from]);
  return <span className="shopping-preview">
    <span className={`shopping-sender ${mail.unread ? 'unread' : ''}`}>{senderName}</span>
    <span className="mail-date">{receivedDate}</span>
    <span className={`shopping-subject ${mail.unread ? 'unread' : ''}`} title={mail.subject}>{mail.subject || '(件名なし)'}</span>
    {(resolvedOrderNumber || preview?.orderNumber || preview?.receiptNumber) && <span className="shopping-order" title={resolvedOrderNumber || preview?.orderNumber ? `注文番号 ${resolvedOrderNumber || preview?.orderNumber}` : `受付番号 ${preview?.receiptNumber}`}><small>{resolvedOrderNumber || preview?.orderNumber ? '注文 ' : '受付 '}</small>{resolvedOrderNumber || preview?.orderNumber || preview?.receiptNumber}</span>}
  </span>;
}
