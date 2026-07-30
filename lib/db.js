const DB_NAME = 'FBFeedFilterDB';
const DB_VERSION = 1;
const POSTS_STORE = 'posts';
const MEDIA_STORE = 'media';

let dbInstance = null;

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

      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };

      dbInstance.onerror = (e) => {
        console.warn("[FB DB] DB Instance error:", e.target.error);
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onerror = (event) => {
      dbInstance = null;
      reject(event.target.error);
    };
  });
}

export async function savePost(newPost) {
  if (!newPost || !newPost.postId) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(POSTS_STORE, 'readwrite');
      const store = tx.objectStore(POSTS_STORE);

      const getReq = store.get(newPost.postId);

      getReq.onsuccess = () => {
        const existing = getReq.result;
        let postToSave = newPost;

        if (existing) {
          const combinedImages = Array.from(new Set([
            ...(existing.images || []),
            ...(newPost.images || [])
          ]));

          postToSave = {
            ...existing,
            ...newPost,
            text: (newPost.text && newPost.text.length >= (existing.text || '').length)
              ? newPost.text
              : existing.text,
            author: (newPost.author && newPost.author.name !== "Unknown Author")
              ? newPost.author
              : existing.author,
            images: combinedImages
          };
        }

        const putReq = store.put(postToSave);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.warn("[FB DB] Error saving post:", err?.message || err);
  }
}

export async function getAllPosts() {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(POSTS_STORE, 'readonly');
      const store = tx.objectStore(POSTS_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn("[FB DB] Error reading posts:", err?.message || err);
    return [];
  }
}

export async function saveMediaBlob(url, base64Data, mimeType = 'image/jpeg') {
  if (!url) return;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite');
      const store = tx.objectStore(MEDIA_STORE);

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
    console.warn('[FB DB] Error saving media blob:', err?.message || err);
  }
}

export async function getMediaBlob(key) {
  if (!key) return null;
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const store = tx.objectStore(MEDIA_STORE);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return null;
  }
}

export async function clearAllData() {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([POSTS_STORE, MEDIA_STORE], 'readwrite');
      tx.objectStore(POSTS_STORE).clear();
      tx.objectStore(MEDIA_STORE).clear();

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[FB DB] Error clearing data:", err?.message || err);
  }
}

export async function getMediaCount() {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readonly');
      const store = tx.objectStore(MEDIA_STORE);
      const request = store.count();

      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return 0;
  }
}
