/* Store frames separately; wait for transaction commit before opening the editor. */
const DB_NAME = 'FullPageCaptureDB';
const DB_VERSION = 2;
const STORE_NAME = 'captures';
function openDB() {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['captureId', 'index'] });
    };
    req.onsuccess = () => {
      if (blocked) { req.result.close(); return; }
      req.result.onversionchange = () => req.result.close(); resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { blocked = true; reject(new Error('Hãy đóng các tab Editor cũ rồi thử lại.')); };
  });
}
async function dbTransaction(stores, mode, operation) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Không thể lưu dữ liệu ảnh.'));
      const req = operation(tx);
      if (req) req.onsuccess = () => { result = req.result; };
    });
  } finally { db.close(); }
}
async function saveCaptureData(id, data) {
  await dbTransaction([STORE_NAME], 'readwrite', tx => tx.objectStore(STORE_NAME).put({ ...data, id, timestamp: Date.now() }));
  return id;
}
function getCaptureData(id) { return dbTransaction([STORE_NAME], 'readonly', tx => tx.objectStore(STORE_NAME).get(id)); }
function saveCaptureChunk(captureId, index, blob) {
  return dbTransaction(['chunks'], 'readwrite', tx => tx.objectStore('chunks').put({ captureId, index, blob }));
}
async function getCaptureChunk(captureId, index) {
  const chunk = await dbTransaction(['chunks'], 'readonly', tx => tx.objectStore('chunks').get([captureId, index]));
  if (!chunk) throw new Error('Không tìm thấy lát ảnh.');
  return chunk.blob;
}
function deleteCaptureData(id) {
  return dbTransaction([STORE_NAME, 'chunks'], 'readwrite', tx => {
    tx.objectStore(STORE_NAME).delete(id);
    return tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
  });
}
if (typeof module !== 'undefined') module.exports = { saveCaptureData, getCaptureData, deleteCaptureData, saveCaptureChunk, getCaptureChunk };
