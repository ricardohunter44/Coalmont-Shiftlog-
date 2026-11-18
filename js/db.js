// Jobflow local database (IndexedDB). Everything lives on this device.
// Stores: jobs, entries (log), files (metadata), blobs (file bytes + thumbnails), config, time (hours).
const NAME = 'jobflow';
const VERSION = 2;
let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('jobs')) d.createObjectStore('jobs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' }).createIndex('jobId', 'jobId');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' }).createIndex('jobId', 'jobId');
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('config')) d.createObjectStore('config', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('time')) d.createObjectStore('time', { keyPath: 'id' }).createIndex('date', 'date');
    };
    r.onsuccess = () => {
      const d = r.result;
      d.onversionchange = () => { d.close(); location.reload(); };
      d.onclose = () => { dbp = null; }; // phone closed the connection (e.g. app was in the background): reopen next time
      resolve(d);
    };
    r.onerror = () => { dbp = null; reject(r.error); };
    r.onblocked = () => reject(new Error('Jobflow is open in another tab. Close it and reload.'));
  });
  return dbp;
}

async function tx(stores, mode, fn, retried) {
  const d = await openDB();
  let t;
  try { t = d.transaction(stores, mode); }
  catch (e) {
    if (retried || e.name !== 'InvalidStateError') throw e;
    dbp = null; try { d.close(); } catch {}
    return tx(stores, mode, fn, true); // connection was closed under us: reopen once and retry
  }
  return new Promise((resolve, reject) => {
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Save was cancelled.'));
    try { fn(t, v => { out = v; }); } catch (e) { try { t.abort(); } catch {} reject(e); }
  });
}

export const getAll = store => tx([store], 'readonly', (t, set) => {
  const r = t.objectStore(store).getAll(); r.onsuccess = () => set(r.result);
});
export const get = (store, id) => tx([store], 'readonly', (t, set) => {
  const r = t.objectStore(store).get(id); r.onsuccess = () => set(r.result);
});
export const put = (store, value) => tx([store], 'readwrite', t => { t.objectStore(store).put(value); });
export const del = (store, id) => tx([store], 'readwrite', t => { t.objectStore(store).delete(id); });

// ops: [['put', store, value] | ['del', store, id], ...] — all or nothing.
export function batch(ops) {
  if (!ops.length) return Promise.resolve();
  const stores = [...new Set(ops.map(o => o[1]))];
  return tx(stores, 'readwrite', t => {
    for (const [op, store, v] of ops) {
      if (op === 'put') t.objectStore(store).put(v);
      else t.objectStore(store).delete(v);
    }
  });
}
