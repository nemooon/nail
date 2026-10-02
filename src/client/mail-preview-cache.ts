import type { parseCardUsage, parseCardUsages } from './card-usage';
import type { DeliveryPreview } from './delivery-preview';
import type { ShoppingPreview } from './shopping-preview';

export type CardUsageData = {
  identity: ReturnType<typeof parseCardUsage>;
  usages: ReturnType<typeof parseCardUsages>;
};

type PreviewKind = 'messages' | 'delivery' | 'shopping';
type PreviewData = { messages: CardUsageData; delivery: DeliveryPreview; shopping: ShoppingPreview };
const databaseName = 'nail-card-usage'; // Keep the existing database and its card previews.
const cacheVersion = 8;
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, cacheVersion);
      request.onupgradeneeded = event => {
        const db = request.result;
        if (event.oldVersion < 4 && db.objectStoreNames.contains('delivery')) db.deleteObjectStore('delivery');
        if (event.oldVersion < 8 && db.objectStoreNames.contains('shopping')) db.deleteObjectStore('shopping');
        for (const store of ['messages', 'delivery', 'shopping']) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch(error => { database = undefined; throw error; });
  }
  return database;
}

export async function getCachedPreview<K extends PreviewKind>(kind: K, id: string): Promise<PreviewData[K] | undefined> {
  if (!('indexedDB' in globalThis)) return undefined;
  try {
    const db = await openDatabase();
    return await new Promise<PreviewData[K] | undefined>((resolve, reject) => {
      const request = db.transaction(kind, 'readonly').objectStore(kind).get(id);
      request.onsuccess = () => resolve(request.result as PreviewData[K] | undefined);
      request.onerror = () => reject(request.error);
    });
  } catch { return undefined; }
}

export async function cachePreview<K extends PreviewKind>(kind: K, id: string, value: PreviewData[K]): Promise<void> {
  if (!('indexedDB' in globalThis)) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(kind, 'readwrite');
      transaction.objectStore(kind).put(value, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch { /* Browser storage may be disabled or full; the current view still works. */ }
}

export function clearPreviewCache(): Promise<void> {
  if (!('indexedDB' in globalThis)) return Promise.resolve();
  return openDatabase().then(db => Promise.all(['messages', 'delivery', 'shopping'].map(kind => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(kind, 'readwrite');
    transaction.objectStore(kind).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  })))).then(() => {}).catch(() => {});
}
