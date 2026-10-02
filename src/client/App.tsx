import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, AppShell, Badge, Button, Divider, Group, Modal, Select, Stack, Switch, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconArchive, IconArrowLeft, IconBell, IconBrandGoogle, IconCheck, IconChevronRight, IconInbox, IconMail, IconMenu2, IconRefresh, IconSearch, IconSettings, IconTag, IconTrash, IconX } from '@tabler/icons-react';
import { linkifyPlainText } from './plain-links';
import { CardUsageRow } from './CardUsageRow';
import { DeliveryRow } from './DeliveryRow';
import { ShoppingRow } from './ShoppingRow';
import { requesterByTracking, trackingKey, type DeliveryPreview } from './delivery-preview';
import { orderKey, shoppingOrderNumbers, type ShoppingPreview } from './shopping-preview';
import { clearPreviewCache } from './mail-preview-cache';

type Mail = { id: string; threadId: string; from: string; subject: string; internalDate: string; unread: boolean; labelIds?: string[]; classification?: { category: Category; reason: string; source: string } };
type Detail = { id: string; from: string; subject: string; date: string; html: string; text: string; css: string; imageCount: number };
type Status = { connected: boolean; canModify: boolean; lastSyncedAt: string | null };
type View = 'inbox' | 'important' | 'promotions' | 'archive' | 'settings';
type Action = 'read' | 'unread' | 'archive' | 'trash';
type Page = { messages: Mail[]; nextPageToken: string | null };
type Category = 'カード利用' | '配送' | 'ショッピング' | '契約・サブスク' | '予約' | 'プロモーション' | 'その他';
const categories: Category[] = ['カード利用', '配送', 'ショッピング', '契約・サブスク', '予約', 'プロモーション', 'その他'];
const importantCategories = categories.slice(0, 5);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...options?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (response.status === 401 && import.meta.env.MODE === 'production') window.dispatchEvent(new Event('nail:auth-required'));
  if (!response.ok) throw new Error(body.error ?? `通信エラー (${response.status})`);
  return body;
}

function AuthScreen({ loading, error }: { loading: boolean; error: string }) {
  return <main className="auth-page">
    <div className="auth-card">
      <div className="auth-brand"><div className="brand-mark"><IconMail size={19} stroke={2} /></div><strong>nail</strong></div>
      <div className="auth-content">
        <Title order={1}>Gmail に接続</Title>
        <Text>Google アカウントでログインすると、メールの閲覧と整理を始められます。</Text>
        {error && !loading && <div className="auth-error" role="alert">{error}</div>}
        {loading ? <div className="auth-loading" role="status">接続状態を確認しています…</div> :
          <a className="auth-google-button" href="/auth/start"><IconBrandGoogle size={19} stroke={2} />Google でログイン</a>}
        <Text className="auth-note">登録済みのアカウントのみ利用できます。</Text>
      </div>
    </div>
  </main>;
}

function sender(raw: string) {
  const match = raw.match(/<([^<>\s@]+@[^<>\s]+)>/);
  const email = (match?.[1] ?? raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? raw).trim();
  const name = (match ? raw.slice(0, match.index) : email).trim().replace(/^["“]|["”]$/g, '').trim() || email;
  return { name, email };
}

function formatDate(ms: string) {
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat('ja-JP', { hour: 'numeric', minute: '2-digit' }).format(date);
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(date);
}

const views: { id: View; label: string; icon: typeof IconMail }[] = [
  { id: 'important', label: '重要な通知', icon: IconBell },
  { id: 'promotions', label: 'プロモーション', icon: IconTag },
  { id: 'inbox', label: 'すべてのメール', icon: IconInbox },
  { id: 'archive', label: 'アーカイブ', icon: IconArchive },
];

function PlainBody({ text }: { text: string }) {
  return <pre className="mail-plain-body">{linkifyPlainText(text).map((part, index) => part.href
    ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{part.text}</a>
    : <span key={index}>{part.text}</span>)}</pre>;
}

function HtmlBody({ html, css, showImages }: { html: string; css: string; showImages: boolean }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${showImages ? 'https: ' : ''}data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>html{font:14px/1.65 system-ui,sans-serif;color:#30384b}body{margin:12px;overflow-wrap:anywhere}table{max-width:100%}a{color:#4057ce}img{max-width:100%}${css}</style></head><body>${html}</body></html>`;
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let observer: ResizeObserver | undefined;
    const fit = () => {
      const document = frame.contentDocument;
      if (!document) return;
      frame.style.height = `${Math.max(160, document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0)}px`;
    };
    const onLoad = () => {
      observer?.disconnect();
      const document = frame.contentDocument;
      if (!document?.body) return;
      fit();
      observer = new ResizeObserver(fit);
      observer.observe(document.body);
      observer.observe(document.documentElement);
    };
    frame.addEventListener('load', onLoad);
    if (frame.contentDocument?.readyState === 'complete') onLoad();
    return () => { frame.removeEventListener('load', onLoad); observer?.disconnect(); };
  }, [html, css]);
  return <iframe ref={frameRef} className="mail-html-frame" title="メール本文" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" srcDoc={doc} />;
}

export default function App() {
  const [inbox, setInbox] = useState<Mail[]>([]);
  const [remote, setRemote] = useState<Mail[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ connected: false, canModify: false, lastSyncedAt: null });
  const [classifications, setClassifications] = useState<Record<string, Category>>({});
  const [view, setView] = useState<View>('important');
  const [categoryFilter, setCategoryFilter] = useState<Category | 'すべて'>('すべて');
  const [query, setQuery] = useState('');
  const [stack, setStack] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [highlightedDelivery, setHighlightedDelivery] = useState<string | null>(null);
  const [highlightedShopping, setHighlightedShopping] = useState<string | null>(null);
  const [deliveryPreviews, setDeliveryPreviews] = useState<Record<string, DeliveryPreview>>({});
  const [shoppingPreviews, setShoppingPreviews] = useState<Record<string, ShoppingPreview>>({});
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [loadExternalImages, setLoadExternalImages] = useState(() => localStorage.getItem('nail:load-external-images') !== 'false');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<'read' | 'archive' | 'trash' | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionCategory, setCorrectionCategory] = useState<Category>('その他');
  const [correctionScope, setCorrectionScope] = useState<'one' | 'sender'>('one');
  const [subjectContains, setSubjectContains] = useState('');
  const listRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const remoteRequest = useRef(0);
  const detailRequest = useRef(0);

  const loadInbox = useCallback(async () => {
    const result = await api<{ messages: Mail[] }>('/messages');
    setInbox(result.messages);
  }, []);

  const loadStatus = useCallback(async () => setStatus(await api<Status>('/status')), []);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      let incomplete = false;
      do {
        const result = await api<{ messages: Mail[]; incomplete?: boolean }>('/sync', { method: 'POST', body: '{}' });
        setInbox(result.messages);
        incomplete = Boolean(result.incomplete);
      } while (incomplete);
      await loadStatus();
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '同期に失敗しました'); }
    finally { setRefreshing(false); }
  }, [loadStatus, refreshing]);

  useEffect(() => {
    let active = true;
    api<Status>('/status').then(async nextStatus => {
      if (!active) return;
      setStatus(nextStatus);
      if (!nextStatus.connected) { setLoading(false); return; }
      const [result, nextClassifications] = await Promise.all([api<{ messages: Mail[] }>('/messages'), api<Record<string, Category>>('/classifications')]);
      if (!active) return;
      setInbox(result.messages); setClassifications(nextClassifications); setLoading(false);
    })
      .catch(cause => { if (!active) return; setError(cause instanceof Error ? cause.message : '読み込みに失敗しました'); setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (import.meta.env.MODE !== 'production') return;
    const requireAuth = () => {
      setStatus({ connected: false, canModify: false, lastSyncedAt: null });
      setInbox([]); setRemote([]); setSelected(null); setDetail(null); setError('');
    };
    window.addEventListener('nail:auth-required', requireAuth);
    return () => window.removeEventListener('nail:auth-required', requireAuth);
  }, []);

  useEffect(() => { if (!loading && status.connected) void refresh(); }, [loading, status.connected]); // Initial sync after cached data appears.

  useEffect(() => {
    const timer = window.setInterval(() => { if (status.connected && document.visibilityState === 'visible') void refresh(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh, status.connected]);

  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') { void loadStatus(); if (status.connected) void loadInbox(); } };
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [loadStatus, loadInbox, status.connected]);

  const loadRemote = useCallback(async (pageToken?: string) => {
    const request = ++remoteRequest.current;
    const path = query.trim()
      ? `/search?q=${encodeURIComponent(query.trim())}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      : `/archive${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    try {
      const result = await api<Page>(path);
      if (request !== remoteRequest.current) return;
      setRemote(current => pageToken ? [...current, ...result.messages] : result.messages);
      setNextPage(result.nextPageToken);
      setError('');
    } catch (cause) { if (request === remoteRequest.current) setError(cause instanceof Error ? cause.message : '一覧を取得できませんでした'); }
  }, [query]);

  useEffect(() => {
    if (!status.connected || (!query.trim() && view !== 'archive')) { setRemote([]); setNextPage(null); return; }
    const timer = window.setTimeout(() => { void loadRemote(); }, query.trim() ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [query, view, loadRemote, status.connected]);

  const categoryOf = useCallback((mail: Mail): Category => classifications[mail.id] ?? mail.classification?.category ?? (mail.labelIds?.includes('CATEGORY_PROMOTIONS') ? 'プロモーション' : 'その他'), [classifications]);
  const reasonOf = useCallback((mail: Mail) => classifications[mail.id] ? 'このメールに設定した分類' : mail.classification?.reason ?? '分類されていません', [classifications]);
  const promotions = useMemo(() => inbox.filter(mail => categoryOf(mail) === 'プロモーション'), [inbox, categoryOf]);
  const important = useMemo(() => inbox.filter(mail => importantCategories.includes(categoryOf(mail))), [inbox, categoryOf]);
  const stacks = useMemo(() => {
    const map = new Map<string, Mail[]>();
    for (const mail of promotions) {
      const key = sender(mail.from).email.toLowerCase();
      map.set(key, [...(map.get(key) ?? []), mail]);
    }
    return [...map].sort((a, b) => Number(b[1][0]?.internalDate ?? 0) - Number(a[1][0]?.internalDate ?? 0));
  }, [promotions]);
  const stackMails = promotions.filter(mail => sender(mail.from).email.toLowerCase() === stack);
  const visible = query.trim() || view === 'archive' ? remote : view === 'promotions' ? (stack ? stackMails : promotions) : view === 'important' ? important.filter(mail => categoryFilter === 'すべて' || categoryOf(mail) === categoryFilter) : inbox;
  const selectedMail = [...inbox, ...remote].find(mail => mail.id === selected) ?? null;
  const selectedTracking = view === 'important' && highlightedDelivery ? trackingKey(deliveryPreviews[highlightedDelivery]?.trackingNumber ?? '') : undefined;
  const shoppingNumbers = useMemo(() => shoppingOrderNumbers(shoppingPreviews, inbox), [shoppingPreviews, inbox]);
  const selectedOrder = view === 'important' && highlightedShopping ? orderKey(shoppingNumbers[highlightedShopping] ?? '') : undefined;
  const groupRequesters = useMemo(() => requesterByTracking(deliveryPreviews), [deliveryPreviews]);
  const showStacks = view === 'promotions' && !stack && !query.trim();

  const rememberDeliveryPreview = useCallback((id: string, preview: DeliveryPreview) => {
    setDeliveryPreviews(current => current[id] === preview ? current : { ...current, [id]: preview });
  }, []);
  const rememberShoppingPreview = useCallback((id: string, preview: ShoppingPreview) => {
    setShoppingPreviews(current => current[id] === preview ? current : { ...current, [id]: preview });
  }, []);

  function changeView(next: View) {
    setView(next); setQuery(''); setStack(null); setCategoryFilter('すべて'); setSelected(null); setHighlightedDelivery(null); setHighlightedShopping(null); setDetail(null); setNavOpen(false);
    listRef.current?.scrollTo(0, 0);
  }

  async function act(id: string, action: Action) {
    setBusy(true);
    try {
      await api<{ ok: boolean }>(`/messages/${encodeURIComponent(id)}/action`, { method: 'POST', body: JSON.stringify({ action }) });
      await loadInbox();
      if (view === 'archive' || query.trim()) await loadRemote();
      if (action === 'archive' || action === 'trash') { setSelected(null); setDetail(null); }
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '操作に失敗しました'); }
    finally { setBusy(false); }
  }

  async function selectMail(mail: Mail) {
    const request = ++detailRequest.current;
    setHighlightedDelivery(view === 'important' && categoryOf(mail) === '配送' ? mail.id : null);
    setHighlightedShopping(view === 'important' && categoryOf(mail) === 'ショッピング' ? mail.id : null);
    setSelected(mail.id); setDetail(null); setShowImages(loadExternalImages); setDetailLoading(true);
    detailRef.current?.scrollTo(0, 0);
    try {
      const loaded = await api<Detail>(`/messages/${encodeURIComponent(mail.id)}${loadExternalImages ? '?images=1' : ''}`);
      if (request !== detailRequest.current) return;
      setDetail(loaded);
      if (mail.unread && status.canModify) await act(mail.id, 'read');
    } catch (cause) { if (request === detailRequest.current) setError(cause instanceof Error ? cause.message : '本文を取得できませんでした'); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }

  function changeImagePreference(checked: boolean) {
    localStorage.setItem('nail:load-external-images', String(checked));
    setLoadExternalImages(checked);
  }

  async function loadImages() {
    if (!selected) return;
    const request = detailRequest.current;
    setDetailLoading(true);
    try {
      const loaded = await api<Detail>(`/messages/${encodeURIComponent(selected)}?images=1`);
      if (request !== detailRequest.current) return;
      setDetail(loaded);
      setShowImages(true);
      setError('');
    } catch (cause) { if (request === detailRequest.current) setError(cause instanceof Error ? cause.message : '画像を読み込めませんでした'); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  }

  async function confirmBulk() {
    if (!bulkAction || !stackMails.length) return;
    setBusy(true);
    try {
      const result = await api<{ completed: string[]; failed: string[] }>('/messages/bulk', {
        method: 'POST', body: JSON.stringify({ action: bulkAction, ids: stackMails.map(mail => mail.id) }),
      });
      await loadInbox();
      if (result.failed.length) setError(`${result.failed.length}通の操作に失敗しました。残りは Gmail に反映済みです。`);
      else setError('');
      if (bulkAction !== 'read') { setStack(null); setSelected(null); setDetail(null); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '一括操作に失敗しました'); }
    finally { setBusy(false); setBulkAction(null); }
  }

  async function saveClassification() {
    if (!selectedMail) return;
    setBusy(true);
    try {
      await api(`/messages/${encodeURIComponent(selectedMail.id)}/classification`, { method: 'PUT', body: JSON.stringify({ category: correctionCategory, scope: correctionScope, subjectContains: correctionScope === 'sender' ? subjectContains : undefined }) });
      setClassifications(current => ({ ...current, [selectedMail.id]: correctionCategory }));
      setCorrectionOpen(false);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分類を保存できませんでした'); }
    finally { setBusy(false); }
  }

  const title = query.trim() ? '検索結果' : stack ? (stackMails[0] ? sender(stackMails[0].from).name : '送信元') : views.find(item => item.id === view)?.label;
  const updated = status.lastSyncedAt ? new Intl.DateTimeFormat('ja-JP', { hour: 'numeric', minute: '2-digit' }).format(new Date(status.lastSyncedAt)) : '未同期';

  if (import.meta.env.MODE === 'production' && (loading || !status.connected)) return <AuthScreen loading={loading} error={error} />;

  return <AppShell navbar={{ width: 204, breakpoint: 'sm', collapsed: { mobile: !navOpen } }} padding={0}>
    <AppShell.Navbar className="sidebar">
      <div className="brand"><div className="brand-mark"><IconMail size={19} stroke={2} /></div><div><strong>nail</strong><small>受信を整える</small></div></div>
      <div className="nav-label">メールボックス</div>
      <Stack gap={3} className="side-nav">{views.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => changeView(id)}><Icon size={19} stroke={1.8} /><span>{label}</span></button>)}</Stack>
      <div className="nav-label settings-nav-label">アプリ</div>
      <button className={`nav-item settings-nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => changeView('settings')}><IconSettings size={19} stroke={1.8} /><span>設定</span></button>
      <div className="sidebar-bottom"><div className="connection-indicator" /><div><strong>{status.connected ? 'Gmail 接続済み' : '未接続'}</strong><span>{status.canModify ? '閲覧・整理ができます' : '現在は閲覧のみ'}</span>{(import.meta.env.MODE === 'production' || !status.canModify) && <a className="reauth-link" href={import.meta.env.MODE === 'production' ? '/auth/start' : 'http://localhost:8766/'} target="_blank" rel="noopener noreferrer">Gmail を再認証</a>}</div></div>
    </AppShell.Navbar>
    <AppShell.Main className="main-shell">
      <div className="mobile-topbar"><ActionIcon variant="subtle" color="dark" aria-label="メニュー" onClick={() => setNavOpen(true)}><IconMenu2 /></ActionIcon><strong>nail</strong><span /></div>
      <div className="workspace">
        {view === 'settings' ? <section className="settings-page" aria-label="設定">
          <div className="settings-page-inner"><Title order={1}>設定</Title><div className="settings-card"><div className="settings-card-heading"><IconMail size={18} stroke={1.8} /><strong>メールの表示</strong></div><Switch label="外部画像を自動で表示" description="HTML メールを開いたときに画像を読み込みます。オフにすると、メールごとに表示できます。" checked={loadExternalImages} onChange={event => changeImagePreference(event.currentTarget.checked)} /></div>{import.meta.env.MODE === 'production' && status.connected && <Button size="xs" variant="subtle" mt="md" onClick={async () => { await clearPreviewCache(); await fetch('/auth/logout', { method: 'POST' }); location.reload(); }}>ログアウト</Button>}</div>
        </section> : <>
        <section ref={listRef} className={`content-pane ${selectedMail ? 'detail-on-mobile' : ''}`} aria-label="メール一覧">
          <div className="content-head"><Title order={1}>{title}</Title><TextInput className="header-search" size="xs" leftSection={<IconSearch size={15} />} placeholder="Gmail を検索" aria-label="Gmail を検索" value={query} onChange={event => setQuery(event.currentTarget.value)} rightSection={query ? <ActionIcon size="sm" variant="subtle" color="gray" aria-label="検索を消去" onClick={() => setQuery('')}><IconX size={14} /></ActionIcon> : null} /><Text className="sync-label">更新 {updated}</Text><Tooltip label="新着を確認"><ActionIcon className="refresh-button" size="sm" radius="sm" variant="default" aria-label="更新" loading={refreshing} onClick={() => void refresh()}><IconRefresh size={16} /></ActionIcon></Tooltip></div>
          {error && <div className="live-error" role="alert">{error}<button onClick={() => setError('')} aria-label="エラーを閉じる"><IconX size={14} /></button></div>}
          {view === 'important' && !query && <div className="category-scroll"><Group gap={6} wrap="nowrap" className="category-tabs"><button className={`category-tab ${categoryFilter === 'すべて' ? 'current' : ''}`} onClick={() => setCategoryFilter('すべて')}>すべて <span>{important.length}</span></button>{importantCategories.map(item => <button key={item} className={`category-tab ${categoryFilter === item ? 'current' : ''}`} onClick={() => setCategoryFilter(item)}>{item}<span>{important.filter(mail => categoryOf(mail) === item).length}</span></button>)}</Group></div>}
          {stack && !query && <div className="stack-toolbar"><Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={() => setStack(null)}>送信元に戻る</Button><div className="stack-actions"><Button size="xs" variant="light" disabled={!status.canModify || busy || !stackMails.length} onClick={() => setBulkAction('read')} leftSection={<IconCheck size={15} />}>{stackMails.length}通を既読</Button><Button size="xs" variant="light" disabled={!status.canModify || busy || !stackMails.length} onClick={() => setBulkAction('archive')} leftSection={<IconArchive size={15} />}>{stackMails.length}通をアーカイブ</Button><Button size="xs" color="red" variant="subtle" disabled={!status.canModify || busy || !stackMails.length} onClick={() => setBulkAction('trash')}>ゴミ箱へ</Button></div></div>}
          <div className="list-heading"><div><strong>{showStacks ? '送信元' : 'メール'}</strong><span>{showStacks ? stacks.length : visible.length}</span></div><Text size="xs">{view === 'archive' || query ? 'Gmail の検索結果' : '新しい順'}</Text></div>
          <div className="mail-list">
            {showStacks ? stacks.map(([email, group]) => <button className="stack-row" key={email} onClick={() => { setStack(email); setSelected(null); }}><div className="stack-row-body"><strong>{sender(group[0].from).name}</strong><span>{group[0].subject}</span></div><Badge variant="light" color="indigo" radius="sm">{group.length}通</Badge><IconChevronRight size={17} className="chevron" /></button>) : visible.map(mail => <div key={mail.id} className={`mail-row ${selected === mail.id ? 'selected' : ''} ${selected !== mail.id && ((selectedTracking && trackingKey(deliveryPreviews[mail.id]?.trackingNumber ?? '') === selectedTracking) || (selectedOrder && orderKey(shoppingNumbers[mail.id] ?? '') === selectedOrder)) ? 'related' : ''}`}><button className="mail-row-main" onClick={() => void selectMail(mail)}><span className={`unread-mark ${mail.unread ? 'on' : ''}`} />{view === 'important' && !query.trim() && categoryOf(mail) === 'カード利用' ? <CardUsageRow mail={mail} senderName={sender(mail.from).name} receivedDate={formatDate(mail.internalDate)} load={() => api<Detail>(`/messages/${encodeURIComponent(mail.id)}`)} /> : view === 'important' && !query.trim() && categoryOf(mail) === '配送' ? <DeliveryRow mail={mail} senderName={sender(mail.from).name} receivedDate={formatDate(mail.internalDate)} load={() => api<Detail>(`/messages/${encodeURIComponent(mail.id)}`)} onPreview={rememberDeliveryPreview} relatedRequester={groupRequesters[trackingKey(deliveryPreviews[mail.id]?.trackingNumber ?? '')]} /> : view === 'important' && !query.trim() && categoryOf(mail) === 'ショッピング' ? <ShoppingRow mail={mail} senderName={sender(mail.from).name} receivedDate={formatDate(mail.internalDate)} load={() => api<Detail>(`/messages/${encodeURIComponent(mail.id)}`)} onPreview={rememberShoppingPreview} resolvedOrderNumber={shoppingNumbers[mail.id]} /> : <span className="mail-row-content"><span className="mail-row-top"><span className={`sender ${mail.unread ? 'unread' : ''}`}>{sender(mail.from).name}</span><span className="mail-date">{formatDate(mail.internalDate)}</span></span><span className={`mail-subject ${mail.unread ? 'unread' : ''}`}>{mail.subject || '(件名なし)'}</span>{categoryOf(mail) !== 'その他' && <span className="mail-category">{categoryOf(mail)}</span>}</span>}</button>{status.canModify && mail.labelIds?.includes('INBOX') && <Tooltip label="アーカイブ"><ActionIcon className="row-archive" variant="subtle" color="gray" aria-label={`${mail.subject}をアーカイブ`} disabled={busy} onClick={() => void act(mail.id, 'archive')}><IconArchive size={18} /></ActionIcon></Tooltip>}</div>)}
            {!loading && !showStacks && visible.length === 0 && <div className="empty-state"><IconInbox size={28} stroke={1.4} /><strong>該当するメールはありません</strong><span>{view === 'important' ? 'メール詳細から分類を設定できます。' : query || view === 'archive' ? '検索条件を変えてみてください。' : !status.connected ? 'ログインするとメールを表示します。' : '受信箱は空です。'}</span></div>}
            {loading && <div className="empty-state"><strong>メールを読み込み中</strong></div>}
          </div>
          {nextPage && (query.trim() || view === 'archive') && <div className="load-more"><Button variant="subtle" onClick={() => void loadRemote(nextPage)}>さらに読み込む</Button></div>}
        </section>
        <section ref={detailRef} className={`detail-pane ${selectedMail ? 'visible' : ''}`} aria-label="メール詳細">
          {selectedMail ? <><div className="detail-top"><Button className="detail-back" variant="subtle" leftSection={<IconArrowLeft size={17} />} onClick={() => setSelected(null)}>一覧へ</Button><Text size="xs" c="dimmed">{formatDate(selectedMail.internalDate)}</Text><ActionIcon variant="subtle" color="gray" aria-label="詳細を閉じる" onClick={() => setSelected(null)}><IconX size={18} /></ActionIcon></div><div className="detail-content">{categoryOf(selectedMail) !== 'その他' && <Badge variant="light" color="indigo" radius="sm">{categoryOf(selectedMail)}</Badge>}<Title order={2}>{selectedMail.subject || '(件名なし)'}</Title><div className="detail-sender"><div><Text fw={700} size="sm">{sender(selectedMail.from).name}</Text><Text size="xs" c="dimmed">{sender(selectedMail.from).email}</Text></div></div><Group gap={8} className="detail-actions"><Button size="xs" variant="light" leftSection={<IconArchive size={16} />} disabled={!status.canModify || busy || !selectedMail.labelIds?.includes('INBOX')} onClick={() => void act(selectedMail.id, 'archive')}>アーカイブ</Button><Button size="xs" variant="default" leftSection={<IconMail size={16} />} disabled={!status.canModify || busy} onClick={() => void act(selectedMail.id, selectedMail.unread ? 'read' : 'unread')}>{selectedMail.unread ? '既読にする' : '未読にする'}</Button><Button size="xs" color="red" variant="subtle" leftSection={<IconTrash size={16} />} disabled={!status.canModify || busy} onClick={() => void act(selectedMail.id, 'trash')}>ゴミ箱</Button></Group><Divider /><button className="classification-link" onClick={() => { setCorrectionCategory(categoryOf(selectedMail)); setCorrectionScope('one'); setSubjectContains(''); setCorrectionOpen(true); }}><IconSettings size={16} />分類を修正 <IconChevronRight size={14} /></button><Text size="xs" c="dimmed" className="classification-note">判定理由：{reasonOf(selectedMail)}</Text>{detailLoading && <Text size="sm" c="dimmed" mt="md">本文を読み込み中…</Text>}{detail && detail.imageCount > 0 && !showImages && <div className="image-prompt"><Button size="xs" variant="light" loading={detailLoading} onClick={() => void loadImages()}>画像 {detail.imageCount} 枚を表示</Button><Text size="xs" c="dimmed">外部画像は未読込です。</Text></div>}{detail && (detail.html ? <HtmlBody html={detail.html} css={detail.css} showImages={showImages} /> : <PlainBody text={detail.text || '本文はありません。'} />)}{!status.canModify && <Text size="xs" c="dimmed" mt="md">Gmail の変更権限を再認証すると整理操作を使えます。</Text>}</div></> : <div className="detail-placeholder"><div><IconMail size={30} stroke={1.3} /></div><strong>メールを選択</strong><span>一覧からメールを開くと、<br />ここに内容が表示されます。</span></div>}
        </section>
        </>}
      </div>
      <nav className="mobile-nav" aria-label="主な画面">{views.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? 'active' : ''} onClick={() => changeView(id)}><Icon size={20} stroke={1.8} /><span>{label}</span></button>)}<button className={view === 'settings' ? 'active' : ''} onClick={() => changeView('settings')}><IconSettings size={20} stroke={1.8} /><span>設定</span></button></nav>
    </AppShell.Main>
    <Modal opened={bulkAction !== null} onClose={() => setBulkAction(null)} title="まとめて操作" centered><Text size="sm">{stackMails[0] ? sender(stackMails[0].from).name : 'この送信元'}の受信箱内メール <strong>{stackMails.length}通</strong> を{bulkAction === 'read' ? '既読に' : bulkAction === 'archive' ? 'アーカイブ' : 'ゴミ箱へ移動'}します。</Text><Group justify="flex-end" mt="xl"><Button variant="default" onClick={() => setBulkAction(null)}>キャンセル</Button><Button color={bulkAction === 'trash' ? 'red' : 'indigo'} loading={busy} onClick={() => void confirmBulk()}>実行</Button></Group></Modal>
    <Modal opened={correctionOpen} onClose={() => setCorrectionOpen(false)} title="分類を修正" centered><Stack gap="md"><Text size="sm" c="dimmed">{selectedMail?.subject}</Text><Select label="分類先" data={categories} value={correctionCategory} onChange={value => value && setCorrectionCategory(value as Category)} /><Select label="適用範囲" data={[{ value: 'one', label: 'この1通だけ' }, { value: 'sender', label: '同じ送信元の今後のメールにも適用' }]} value={correctionScope} onChange={value => setCorrectionScope(value === 'sender' ? 'sender' : 'one')} />{correctionScope === 'sender' && <><Text size="xs" c="dimmed">送信元：{selectedMail ? sender(selectedMail.from).email : ''}</Text><TextInput label="件名に含む語（任意）" placeholder="例：予約確定" value={subjectContains} maxLength={100} onChange={event => setSubjectContains(event.currentTarget.value)} /><Text size="xs" c="dimmed">空欄なら、この送信元から今後届くメールすべてに適用します。現在のメールにも個別に適用します。</Text></>}<Text size="xs" c="dimmed">Gmail のラベルは変更しません。</Text><Group justify="flex-end"><Button variant="default" onClick={() => setCorrectionOpen(false)}>キャンセル</Button><Button loading={busy} onClick={() => void saveClassification()}>保存</Button></Group></Stack></Modal>
  </AppShell>;
}
