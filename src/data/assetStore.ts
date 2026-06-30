/**
 * 에셋(모델/텍스쳐 등) 바이너리 저장소 — IndexedDB.
 * localStorage는 용량 한계(~5MB)라 큰 GLB를 못 담으므로, 에셋 data URL은 IDB에 보관하고
 * localStorage 상품 데이터에는 에셋 메타(id/name/type)만 저장한다. id로 data URL을 조회한다.
 */
const DB_NAME = 'hp3-assets';
const STORE = 'assets';

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 에셋 data URL 저장 (id 키) */
export async function putAsset(id: string, dataUrl: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataUrl, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

/** 에셋 data URL 조회 */
export async function getAsset(id: string): Promise<string | undefined> {
  try {
    const db = await openDB();
    return await new Promise<string | undefined>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(id);
      r.onsuccess = () => resolve(r.result as string | undefined);
      r.onerror = () => resolve(undefined);
    });
  } catch { return undefined; }
}

/** 여러 에셋 id → data URL 맵 */
export async function getAssets(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(ids.map(async (id) => { const u = await getAsset(id); if (u) out[id] = u; }));
  return out;
}