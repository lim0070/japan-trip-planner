import { blank } from "../core/model.js";
import { validateState, verifyFeed } from "../core/contracts.js";
let db,
  revision = 0;
export function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("japan-trip-planner", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("state");
      r.result.createObjectStore("feeds");
    };
    r.onsuccess = () => {
      db = r.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () =>
      reject(Error("Close another planner tab to update storage."));
  });
}
function read(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store),
      r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function load() {
  const row = await read("state", "current");
  if (!row) return blank();
  revision = row.revision;
  return validateState(row.value);
}
export function save(value) {
  validateState(value);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state");
    let message;
    const r = store.get("current");
    r.onsuccess = () => {
      if ((r.result?.revision || 0) !== revision) {
        message =
          "Another tab changed this planner. Export your edits, then reload.";
        tx.abort();
        return;
      }
      store.put({ revision: revision + 1, value }, "current");
    };
    tx.oncomplete = () => {
      revision++;
      resolve();
    };
    tx.onerror = () => reject(tx.error || Error("Storage failed."));
    tx.onabort = () =>
      reject(Error(message || tx.error?.message || "Save was not committed."));
  });
}
export async function feed(namespace, path) {
  const old = await read("feeds", namespace);
  try {
    const response = await fetch(path, {signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error("Source unavailable");
    const fresh = await verifyFeed(await response.json());
    if (fresh.source.namespace !== namespace)
      throw Error("Wrong source namespace");
    if (old?.current?.datasetVersion !== fresh.datasetVersion)
      await new Promise((resolve, reject) => {
        const tx = db.transaction("feeds", "readwrite");
        tx.objectStore("feeds").put(
          { current: fresh, previous: old?.current || null },
          namespace,
        );
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    return { value: fresh, error: null };
  } catch (e) {
    if (old?.current) return { value: old.current, error: e.message };
    if (old?.previous) return { value: old.previous, error: e.message };
    throw e;
  }
}
