/**
 * Speichert selbst geöffnete GLB-Dateien im Browser (IndexedDB), damit sie
 * nach einem Neuladen der Seite wieder in der Liste stehen. Nichts verlässt
 * das Gerät. Ist IndexedDB nicht verfügbar (z. B. privater Modus), bleibt
 * das Öffnen möglich – die Datei lebt dann nur bis zum Neuladen.
 */

const DB_NAME = 'glb-viewer';
const STORE = 'models';

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function displayName(fileName) {
  return fileName.replace(/\.glb$/i, '');
}

export async function listLocalModels() {
  try {
    return await run('readonly', (store) => store.getAll());
  } catch (err) {
    console.warn('Lokale Modelle konnten nicht gelesen werden:', err);
    return [];
  }
}

/** Speichert die Datei und gibt `{ id, name, blob }` zurück (`id` ist null, wenn nicht gespeichert). */
export async function saveLocalModel(file) {
  const record = { name: displayName(file.name), blob: file };
  try {
    const id = await run('readwrite', (store) => store.add(record));
    return { id, ...record };
  } catch (err) {
    console.warn('Modell konnte nicht im Browser gespeichert werden:', err);
    return { id: null, ...record };
  }
}

export async function deleteLocalModel(id) {
  if (id == null) return;
  try {
    await run('readwrite', (store) => store.delete(id));
  } catch (err) {
    console.warn('Lokales Modell konnte nicht gelöscht werden:', err);
  }
}
