import { useEffect, useRef, useState } from 'react';
import { formatDeliveryDisplayDate, parseDeliveryPreview, type DeliveryPreview } from './delivery-preview';
import { cachePreview, getCachedPreview } from './mail-preview-cache';
import { mailBodyText, type MailBody } from './mail-body-text';

const pending = new Map<string, Promise<DeliveryPreview>>();
let active = 0;
const waiting: (() => void)[] = [];

async function readDelivery(id: string, subject: string, load: () => Promise<MailBody>) {
  const existing = pending.get(id);
  if (existing) return existing;
  const request = (async () => {
    const stored = await getCachedPreview('delivery', id);
    if (stored) return stored;
    if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try {
      const body = await load();
      const preview = parseDeliveryPreview(subject, mailBodyText(body));
      await cachePreview('delivery', id, preview);
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

export function DeliveryRow({ mail, senderName, receivedDate, load, onPreview, relatedRequester }: {
  mail: { id: string; subject: string; unread: boolean };
  senderName: string;
  receivedDate: string;
  load: () => Promise<MailBody>;
  onPreview: (id: string, preview: DeliveryPreview) => void;
  relatedRequester?: string;
}) {
  const loader = useRef(load);
  loader.current = load;
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    void readDelivery(mail.id, mail.subject, () => loader.current()).then(result => {
      if (!cancelled) { setPreview(result); setState('ready'); previewCallback.current(mail.id, result); }
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [mail.id, mail.subject]);
  const trackingNumber = preview?.trackingNumber ?? (state === 'loading' ? '読込中…' : state === 'error' ? '取得できません' : '番号記載なし');
  const date = preview?.date ? formatDeliveryDisplayDate(preview.date) : state === 'loading' ? '読込中…' : '日付記載なし';
  const requester = preview?.requester || relatedRequester;
  return <span className="delivery-preview">
    <span className={`delivery-sender ${mail.unread ? 'unread' : ''}`}>{senderName}</span>
    <span className="mail-date">{receivedDate}</span>
    <span className="delivery-details">
      <span className="delivery-summary">
        {requester && <span className="delivery-requester" title={`依頼主 ${requester}`}>依頼主 {requester}</span>}
        <span className="delivery-date" title={preview?.date ? `日付 ${preview.date}` : date}>{date}</span>
        {preview?.status && <span className="delivery-status">配送{preview.status}</span>}
      </span>
      <span className="delivery-tracking" title={preview?.trackingNumber ? `送り状番号 ${preview.trackingNumber}` : trackingNumber}>{preview?.trackingNumber && <small>送り状 </small>}{trackingNumber}</span>
    </span>
  </span>;
}
