import { useEffect, useRef, useState } from 'react';
import { formatCardDate, parseCardUsage, parseCardUsages } from './card-usage';
import { cachePreview, getCachedPreview, type CardUsageData } from './mail-preview-cache';
import { mailBodyText, type MailBody } from './mail-body-text';

const cache = new Map<string, Promise<CardUsageData>>();
let active = 0;
const waiting: (() => void)[] = [];

async function readUsage(id: string, subject: string, from: string, load: () => Promise<MailBody>) {
  const existing = cache.get(id);
  if (existing) return existing;
  const pending = (async () => {
    const stored = await getCachedPreview('messages', id);
    if (stored) return stored;
    if (active >= 3) await new Promise<void>(resolve => waiting.push(resolve));
    else active++;
    try {
      const body = await load();
      const text = mailBodyText(body);
      const result = { identity: parseCardUsage(subject, from, text), usages: parseCardUsages(subject, from, text) };
      await cachePreview('messages', id, result);
      return result;
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  })();
  cache.set(id, pending);
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  try { return await pending; }
  catch (error) { cache.delete(id); throw error; }
}

export function CardUsageRow({ mail, senderName, receivedDate, load }: {
  mail: { id: string; subject: string; from: string; unread: boolean };
  senderName: string;
  receivedDate: string;
  load: () => Promise<MailBody>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const loader = useRef(load);
  loader.current = load;
  const [usageData, setUsageData] = useState<CardUsageData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void readUsage(mail.id, mail.subject, mail.from, () => loader.current()).then(data => {
        if (!cancelled) { setUsageData(data); setState('ready'); }
      }).catch(() => { if (!cancelled) setState('error'); });
    });
    if (ref.current) observer.observe(ref.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [mail.id]);
  const usages = usageData?.usages ?? parseCardUsages(mail.subject, mail.from);
  const identity = usageData?.identity ?? parseCardUsage(mail.subject, mail.from);
  return <span ref={ref} className={`card-usage-list ${mail.unread ? 'unread' : ''}`}>
    <span className="card-usage-header"><span className="card-usage-identity">
      <span className="card-usage-name" title={identity.name || senderName}>{identity.name || senderName}</span>
      {identity.brand && identity.brand.toUpperCase() !== 'JCB' && <span className="card-usage-brand">{identity.brand.toUpperCase()}</span>}
    </span><span className="mail-date" title="受信日時">{receivedDate}</span></span>
    {usages.map((usage, index) => {
      const content = usage.merchant || mail.subject || '利用内容の記載なし';
      return <span key={index} className="card-usage">
        <span className="card-usage-date" title={usage.date ? `利用日時 ${usage.date}` : `利用日記載なし・受信 ${receivedDate}`}>{usage.date ? formatCardDate(usage.date) : '日付記載なし'}</span>
        <span className="card-usage-content" title={content}>{content}</span>
        <span className={`card-usage-amount ${usage.amount ? '' : 'unknown'}`}>{usage.amount || (state === 'loading' ? '読込中…' : state === 'error' ? '取得できません' : '金額記載なし')}</span>
      </span>;
    })}
  </span>;
}
