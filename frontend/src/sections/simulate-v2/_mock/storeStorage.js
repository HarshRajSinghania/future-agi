/*
  Where the prototype store is kept between visits.

  It used to be localStorage, but a few improvement runs with their full
  transcripts pass the browser's ~5 MB limit — every save then failed
  silently and anything added afterwards (moved agents, new environments)
  was gone on the next load. IndexedDB has room for it. localStorage stays
  the fallback when IndexedDB isn't there, and an older cache found in it is
  read once and then cleared to give that space back.

  Saves are queued in the order they're made: IndexedDB runs transactions on
  the same store first-come first-served, so a page that hydrates right
  after another one saved reads what was saved.
*/
const DB = "fagi.simulate";
const STORE = "state";

let dbPromise = null;
const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("no indexedDB"));
      return;
    }
    const req = window.indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
};

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

const lsGet = (key) => {
  try { return window.localStorage.getItem(key); } catch { return null; }
};
const lsSet = (key, raw) => {
  try { window.localStorage.setItem(key, raw); } catch { /* full or private mode — in-memory only */ }
};
const lsClear = (key) => {
  try { window.localStorage.removeItem(key); } catch { /* nothing to give back */ }
};

/** The saved state as a JSON string, or null. */
export async function readStored(key) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    await done(tx);
    if (typeof req.result === "string") return req.result;
  } catch {
    /* fall through to localStorage */
  }
  return lsGet(key);
}

/** Save the state (a JSON string). An older localStorage copy is cleared once it's safely in IndexedDB. */
export async function writeStored(key, raw) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(raw, key);
    await done(tx);
    if (lsGet(key) !== null) lsClear(key);
  } catch {
    lsSet(key, raw);
  }
}

/** Read, change and save in one step — `fn` gets the parsed state and returns the next one. */
export async function updateStored(key, fn) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const req = os.get(key);
    req.onsuccess = () => {
      const raw = typeof req.result === "string" ? req.result : lsGet(key);
      if (!raw) return;
      try { os.put(JSON.stringify(fn(JSON.parse(raw))), key); } catch { /* leave what's saved */ }
    };
    await done(tx);
  } catch {
    const raw = lsGet(key);
    try { if (raw) lsSet(key, JSON.stringify(fn(JSON.parse(raw)))); } catch { /* leave what's saved */ }
  }
}
