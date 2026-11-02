import { blank } from "../core/model.js";
import { loadBundle, readBounded } from "../core/shopping-bundle.js";
import { emptyAliases, validateAliases } from "../core/shopping-aliases.js";
import { validateState, verifyFeed, parseJSON } from "../core/contracts.js";
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
    const fresh = await verifyFeed(
      parseJSON((await readBounded(path, 20 * 1024 * 1024)).text),
    );
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

// A whole package (records + notices + aliases) is committed in one IDB transaction.
// Never activate a feed before its licences or use mixed release members.
export async function shopping(
  bundlePath = "../data/shopping-bundle/shopping.bundle.v2.json",
) {
  const old = await read("feeds", "shopping-bundle");
  let fresh,
    error = null;
  try {
    fresh = await loadBundle(new URL(bundlePath, location.href));
    validateAliases(
      fresh.aliases,
      fresh.feed,
      old?.current?.aliases || emptyAliases(),
    );
  } catch (e) {
    error = e.message;
    if (old?.current) return { ...old.current, error };
    if (old?.previous) return { ...old.previous, error };
    fresh = await legacyShopping();
  }
  if (
    old?.current?.manifest?.datasetVersion !== fresh.manifest?.datasetVersion ||
    old?.current?.feed.datasetVersion !== fresh.feed.datasetVersion ||
    !old?.current
  ) {
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("feeds", "readwrite");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () =>
          reject(tx.error || Error("Shopping activation aborted."));
        tx.objectStore("feeds").put(
          { current: fresh, previous: old?.current || old?.previous || null },
          "shopping-bundle",
        );
      });
    } catch (e) {
      if (old?.current) return { ...old.current, error: e.message };
      if (old?.previous) return { ...old.previous, error: e.message };
      throw e;
    }
  }
  return { ...fresh, error: fresh.manifest ? null : error };
}
async function legacyShopping() {
  const feed = await verifyFeed(
    parseJSON(
      (await readBounded("../data/shopping.v1.json", 20 * 1024 * 1024)).text,
    ),
  );
  if (feed.source.namespace !== "shopping")
    throw Error("Wrong legacy shopping namespace");
  const files = parseJSON(
    (await readBounded("../data/shopping-LICENSES/index.json", 128 * 1024))
      .text,
  );
  if (
    !Array.isArray(files) ||
    !files.length ||
    files.length > 1000 ||
    files.some(
      (f) => typeof f !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(f),
    ) ||
    new Set(files).size !== files.length
  )
    throw Error("Invalid shopping notice inventory");
  const notices = {};
  let total = 0;
  for (const file of files) {
    const r = await readBounded("../data/shopping-LICENSES/" + file, 160000);
    total += r.bytes;
    if (total > 2 * 1024 * 1024 || r.text.length > 40000)
      throw Error("Shopping notice limit");
    notices["shopping-" + feed.datasetVersion + "-" + file] = r.text;
  }
  return { feed, aliases: emptyAliases(), notices, manifest: null };
}
