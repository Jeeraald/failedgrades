// IndexedDB wrapper for persisting unsaved draft records locally.
// Prevents data loss when the page is refreshed before the user clicks Save.

const DB_NAME = "mygrade_offline";
const DB_VERSION = 1;
const STORE = "drafts";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "classId" });
      }
    };
    req.onsuccess  = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror    = ()  => reject(req.error);
  });
}

export interface LocalDraft {
  classId: string;
  records: unknown[];
  dirtyIds: string[];
  savedAt: number;
}

export async function saveDraft(draft: LocalDraft): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(draft);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch {
    // Silently ignore — draft saving is best-effort
  }
}

export async function loadDraft(classId: string): Promise<LocalDraft | null> {
  try {
    const db = await openDB();
    return await new Promise<LocalDraft | null>((resolve, reject) => {
      const tx  = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(classId);
      req.onsuccess = () => resolve((req.result as LocalDraft) ?? null);
      req.onerror   = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearDraft(classId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(classId);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  } catch {
    // Silently ignore
  }
}
