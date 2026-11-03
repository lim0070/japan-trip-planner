import {
  GLOBAL,
  packageMetrics,
  checkTotals,
  readRegistry,
  loadOSM,
  validateRegistry,
} from "../core/shopping-sources.js";
import { bytes } from "../core/shopping-bundle.js";
import { blank } from "../core/model.js";
import { loadBundle, readBounded } from "../core/shopping-bundle.js";
import { emptyAliases, validateAliases } from "../core/shopping-aliases.js";
import {
  validateState,
  verifyFeed,
  parseJSON,
  canonical,
} from "../core/contracts.js";
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
const REGISTRY_KEY = "shopping-codec-registry";
const packageKey = (id) => id === "osm" ? "shopping-codec-osm" : "shopping-codec-bundle";
const legacyKey = (id) => id === "osm" ? "shopping-osm" : "shopping-bundle";
const artifact = (p) => p?.manifest?.datasetVersion || p?.feed?.datasetVersion;
const isReference = (p) => p?.kind === "shopping-legacy-reference";
function resolvePackage(value, legacy) {
  if (!isReference(value)) return value || null;
  if (!["shopping-bundle", "shopping-osm"].includes(value.key)) return null;
  return [legacy?.current, legacy?.previous].find(p =>
    p && !isReference(p) && artifact(p) === value.artifact) || null;
}
function resolvedRow(owned, legacy) {
  if (!owned) return {current: legacy?.current || null,
    previous: legacy?.previous || null, revision: 0};
  return {...owned, current: resolvePackage(owned.current, legacy),
    previous: resolvePackage(owned.previous, legacy)};
}
function storedPackage(value, id, legacy) {
  if (!value) return null;
  if ([legacy?.current, legacy?.previous].some(p =>
      p && !isReference(p) && artifact(p) === artifact(value)))
    return {kind:"shopping-legacy-reference", key:legacyKey(id), artifact:artifact(value)};
  return value;
}
function sameStored(a, b) {
  return a === b || (isReference(a) && isReference(b) &&
    a.key === b.key && a.artifact === b.artifact);
}
function compactRow(owned, id, legacy) {
  if (!owned) return owned;
  const current = storedPackage(resolvePackage(owned.current, legacy), id, legacy),
    previous = storedPackage(resolvePackage(owned.previous, legacy), id, legacy);
  // Preserve unresolved historical references, rather than substituting a version.
  return {...owned, current: current || owned.current,
    previous: previous || owned.previous};
}
function feedRows(keys) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("feeds"), store = tx.objectStore("feeds"), rows = {};
    for (const key of keys) {
      const r = store.get(key); r.onsuccess = () => rows[key] = r.result;
    }
    tx.oncomplete = () => resolve(rows);
    tx.onerror = () => reject(tx.error);
  });
}
export async function shoppingCacheState(id) {
  const key = packageKey(id), oldKey = legacyKey(id), rows = await feedRows([key, oldKey]);
  return resolvedRow(rows[key], rows[oldKey]);
}
async function currentPackage(key, error) {
  const row = await shoppingCacheState(key === packageKey("osm") ? "osm" : "overture");
  const p = row.current || row.previous;
  if (p) return {...p, error};
  throw Error(error || "Source unavailable");
}
// Cohort-specific pointers isolate cached old code. Legacy rows are read-only;
// references reuse exact legacy artifacts instead of duplicating hydrated history.
export function activateShoppingPackage(id, fresh, expectedRevision, registry = null) {
  const peer = id === "osm" ? "overture" : "osm", key = packageKey(id),
    otherKey = packageKey(peer), oldKey = legacyKey(id), oldPeer = legacyKey(peer),
    keys = [key, otherKey, oldKey, oldPeer, REGISTRY_KEY];
  return new Promise((resolve, reject) => {
    const tx = db.transaction("feeds", "readwrite"), store = tx.objectStore("feeds"), rows = {};
    let count = 0, result, message;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || Error(message));
    tx.onabort = () => reject(Error(message || "Shopping activation aborted"));
    const stop = m => {message = m; tx.abort()};
    for (const k of keys) {
      const r = store.get(k);
      r.onsuccess = () => {
        rows[k] = r.result;
        if (++count !== keys.length) return;
        try {
          const owned = rows[key], row = resolvedRow(owned, rows[oldKey]),
            current = row.current, other = resolvedRow(rows[otherKey], rows[oldPeer]);
          if (registry && (rows[REGISTRY_KEY]?.current?.datasetVersion !== registry.datasetVersion ||
              rows[REGISTRY_KEY].current.generation !== registry.generation))
            return stop("Stale shopping registry generation");
          if ((owned?.revision || 0) !== expectedRevision) {
            if (artifact(current) === artifact(fresh)) {result = current; return;}
            return stop("Stale shopping package generation");
          }
          if (registry) {
            const d = registry.packages.find(p => p.id === id);
            if (!d || canonical(d.metrics) !== canonical(packageMetrics(fresh)))
              return stop("Package metrics do not match registry");
          }
          if (id === "overture") validateAliases(fresh.aliases, fresh.feed,
            current?.aliases || emptyAliases());
          checkTotals([packageMetrics(fresh), ...(other.current ? [packageMetrics(other.current)] : []),
            {ancillary:128*1024}]);
          const same = artifact(current) === artifact(fresh), next = {
            current: storedPackage(fresh, id, rows[oldKey]),
            previous: storedPackage(same ? row.previous : current, id, rows[oldKey]),
            revision: owned ? (owned.revision || 0) + (same ? 0 : 1) : 1,
          }, peerRow = compactRow(rows[otherKey], peer, rows[oldPeer]);
          // Count actual stored bytes of BOTH cohorts, including both histories.
          if ([next, peerRow, rows[oldKey], rows[oldPeer]].reduce((n,p)=>n+bytes(p||{}),0) > GLOBAL.storage)
            return stop("Shopping storage budget");
          if (!owned || next.revision !== owned.revision ||
              !sameStored(next.current, owned.current) || !sameStored(next.previous, owned.previous))
            store.put(next, key);
          if (peerRow && (!sameStored(peerRow.current, rows[otherKey].current) ||
              !sameStored(peerRow.previous, rows[otherKey].previous))) store.put(peerRow, otherKey);
          result = same ? current : fresh;
        } catch (e) {stop(e.message)}
      };
      r.onerror = () => stop("Shopping pointer read failed");
    }
  });
}
export async function shopping(bundlePath = null, registry = null) {
  if (!bundlePath) {
    registry = registry || (await read("feeds", REGISTRY_KEY))?.current ||
      (await read("feeds", "shopping-registry"))?.current;
    bundlePath = registry
      ? new URL(
          registry.packages.find((p) => p.id === "overture").path,
          new URL("../data/", location.href),
        ).href
      : "../data/shopping-bundle/shopping.bundle.v2.json";
  }
  const old = await shoppingCacheState("overture");
  let fresh,
    error = null;
  try {
    fresh = await loadBundle(new URL(bundlePath, location.href), {
      expected: registry?.packages.find((p) => p.id === "overture") || null,
    });
    if (
      fresh.feed.places.some(
        (p) =>
          p.key.startsWith("shopping:osm:") ||
          [...p.provenance, ...p.location.provenance].some(
            (e) => e.sourceKind === "openstreetmap",
          ),
      )
    )
      throw Error("OSM fields must remain in their independent source package");
  } catch (e) {
    error = e.message;
    if (old?.current || old?.previous)
      return currentPackage(packageKey("overture"), error);
    if (registry) throw e;
    fresh = await legacyShopping();
  }
  try {
    fresh = await activateShoppingPackage(
      "overture",
      fresh,
      old?.revision || 0,
      registry,
    );
    return { ...fresh, error: fresh.manifest ? null : error };
  } catch (e) {
    return currentPackage(packageKey("overture"), e.message);
  }
}
export async function osmPackage(path, registry) {
  const old = await shoppingCacheState("osm");
  try {
    const expected = registry.packages.find((p) => p.id === "osm");
    const fresh = await loadOSM(new URL(path, location.href), { expected });
    const active = await activateShoppingPackage(
      "osm",
      fresh,
      old?.revision || 0,
      registry,
    );
    return { ...active, error: null };
  } catch (e) {
    return currentPackage(packageKey("osm"), e.message);
  }
}
export async function beginShoppingRegistry(registry) {
  await validateRegistry(registry);
  return new Promise((resolve, reject) => {
    const tx = db.transaction("feeds", "readwrite"),
      store = tx.objectStore("feeds");
    let message;
    tx.oncomplete = () => resolve(registry);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(Error(message || "Registry activation aborted"));
    const r = store.get(REGISTRY_KEY);
    r.onsuccess = () => {
      const old = r.result?.current;
      if (
        old &&
        (old.generation > registry.generation ||
          (old.generation === registry.generation &&
            old.datasetVersion !== registry.datasetVersion))
      ) {
        message = "Stale registry plan";
        tx.abort();
        return;
      }
      store.put({ current: registry }, REGISTRY_KEY);
    };
  });
}
export async function shoppingSources(
  onPackage = () => {},
  path = "../data/shopping-sources.codec.v1.json",
) {
  let registry;
  try {
    registry = await beginShoppingRegistry(
      await readRegistry(new URL(path, location.href)),
    );
  } catch (e) {
    registry = (await read("feeds", REGISTRY_KEY))?.current ||
      (await read("feeds", "shopping-registry"))?.current;
  }
  if (!registry) {
    try {
      onPackage("overture", await shopping());
    } catch (e) {
      onPackage("overture", null, e.message);
    }
    onPackage("osm", null, "OSM source registry unavailable");
    throw Error("OSM source registry unavailable");
  }
  const root = new URL("./", new URL(path, location.href));
  for (const d of registry.packages) {
    try {
      const pkg =
        d.id === "osm"
          ? await osmPackage(new URL(d.path, root).href, registry)
          : await shopping(new URL(d.path, root).href, registry);
      onPackage(d.id, pkg);
    } catch (e) {
      onPackage(d.id, null, e.message);
    }
  }
  return registry;
}
export async function osmVersion(version) {
  const row = await shoppingCacheState("osm"), legacy = await read("feeds", legacyKey("osm"));
  return [row.current, row.previous, legacy?.current, legacy?.previous].find(
    p => p?.feed?.datasetVersion === version) || null;
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
