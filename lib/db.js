const DB_NAME = 'FBFeedFilterDB';
const DB_VERSION = 1;
const POSTS_STORE = 'posts';
const MEDIA_STORE = 'media';

let dbInstance = null;

/**
 * Opens or returns the singleton IndexedDB connection.
 */
function getDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      return resolve(dbInstance);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(POSTS_STORE)) {
        db.createObjectStore(POSTS_STORE, { keyPath: 'postId' });
      }

      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'url' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error("[FB DB] Database error:", event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Saves or updates a post record in IndexedDB.
 */
export async function savePost(post) {
  if (!post || !post.postId) return;
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(POSTS_STORE, 'readwrite');
    const store = tx.objectStore(POSTS_STORE);

    const request = store.put(post);

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves all stored posts from IndexedDB.
 */
export async function getAllPosts() {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(POSTS_STORE, 'readonly');
    const store = tx.objectStore(POSTS_STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Unconditionally saves any intercepted media item to IndexedDB.
 */
export async function saveMediaBlob(url, base64Data, mimeType = 'image/jpeg') {
  if (!url) return;

  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite');
      const store = tx.objectStore(MEDIA_STORE);

      // Clean/strip URL tracking parameters if necessary, or use raw URL as key
      store.put({
        url: url,
        base64Data: base64Data,
        mimeType: mimeType,
        timestamp: Date.now()
      });

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[FB DB] Error saving media blob:', err);
  }
}

/**
 * Flexible retrieval by URL, src, or id
 */
export async function getMediaBlob(key) {
  if (!key) return null;
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const store = tx.objectStore(MEDIA_STORE);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clears all data from both object stores.
 */
export async function clearAllData() {
  const db = await getDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([POSTS_STORE, MEDIA_STORE], 'readwrite');
    tx.objectStore(POSTS_STORE).clear();
    tx.objectStore(MEDIA_STORE).clear();

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Gets total count of cached media blobs.
 */
export async function getMediaCount() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MEDIA_STORE, 'readonly');
    const store = tx.objectStore(MEDIA_STORE);
    const request = store.count();

    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error);
  });
}
