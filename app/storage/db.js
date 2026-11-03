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
const packageKey = (id) => (id === "osm" ? "shopping-osm" : "shopping-bundle");
const artifact = (p) => p?.manifest?.datasetVersion || p?.feed?.datasetVersion;
async function currentPackage(key, error) {
  const row = await read("feeds", key);
  const p = row?.current || row?.previous;
  if (p) return { ...p, error };
  throw Error(error || "Source unavailable");
}
// Compare generations and derive previous inside the same transaction as activation.
export function activateShoppingPackage(
  id,
  fresh,
  expectedRevision,
  registry = null,
) {
  const key = packageKey(id),
    otherKey = packageKey(id === "osm" ? "overture" : "osm");
  return new Promise((resolve, reject) => {
    const tx = db.transaction("feeds", "readwrite"),
      store = tx.objectStore("feeds"),
      rows = {};
    let count = 0,
      result,
      message;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || Error(message));
    tx.onabort = () => reject(Error(message || "Shopping activation aborted"));
    const stop = (m) => {
      message = m;
      tx.abort();
    };
    for (const k of [key, otherKey, "shopping-registry"]) {
      const r = store.get(k);
      r.onsuccess = () => {
        rows[k] = r.result;
        if (++count !== 3) return;
        try {
          const old = rows[key],
            current = old?.current;
          if (
            registry &&
            (rows["shopping-registry"]?.current?.datasetVersion !==
              registry.datasetVersion ||
              rows["shopping-registry"].current.generation !==
                registry.generation)
          )
            return stop("Stale shopping registry generation");
          if ((old?.revision || 0) !== expectedRevision) {
            if (artifact(current) === artifact(fresh)) {
              result = current;
              return;
            }
            return stop("Stale shopping package generation");
          }
          if (registry) {
            const d = registry.packages.find((p) => p.id === id);
            if (!d || canonical(d.metrics) !== canonical(packageMetrics(fresh)))
              return stop("Package metrics do not match registry");
          }
          if (id === "overture")
            validateAliases(
              fresh.aliases,
              fresh.feed,
              current?.aliases || emptyAliases(),
            );
          const metrics = [
            packageMetrics(fresh),
            ...(rows[otherKey]?.current
              ? [packageMetrics(rows[otherKey].current)]
              : []),
            { ancillary: 128 * 1024 },
          ];
          checkTotals(metrics);
          const next = {
            current: fresh,
            previous: current || old?.previous || null,
            revision: (old?.revision || 0) + 1,
          };
          if (bytes(next) + bytes(rows[otherKey] || {}) > GLOBAL.storage)
            return stop("Shopping storage budget");
          if (artifact(current) === artifact(fresh)) {
            result = current;
            return;
          }
          store.put(next, key);
          if (id === "overture" && fresh.manifest) store.delete("shopping");
          result = fresh;
        } catch (e) {
          stop(e.message);
        }
      };
      r.onerror = () => stop("Shopping pointer read failed");
    }
  });
}
export async function shopping(bundlePath = null, registry = null) {
  if (!bundlePath) {
    registry = registry || (await read("feeds", "shopping-registry"))?.current;
    bundlePath = registry
      ? new URL(
          registry.packages.find((p) => p.id === "overture").path,
          new URL("../data/", location.href),
        ).href
      : "../data/shopping-bundle/shopping.bundle.v2.json";
  }
  const old = await read("feeds", "shopping-bundle");
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
      return currentPackage("shopping-bundle", error);
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
    return currentPackage("shopping-bundle", e.message);
  }
}
export async function osmPackage(path, registry) {
  const old = await read("feeds", "shopping-osm");
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
    return currentPackage("shopping-osm", e.message);
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
    const r = store.get("shopping-registry");
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
      store.put({ current: registry }, "shopping-registry");
    };
  });
}
export async function shoppingSources(
  onPackage = () => {},
  path = "../data/shopping-sources.v1.json",
) {
  let registry;
  try {
    registry = await beginShoppingRegistry(
      await readRegistry(new URL(path, location.href)),
    );
  } catch (e) {
    registry = (await read("feeds", "shopping-registry"))?.current;
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
  const row = await read("feeds", "shopping-osm");
  return (
    [row?.current, row?.previous].find(
      (p) => p?.feed.datasetVersion === version,
    ) || null
  );
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
