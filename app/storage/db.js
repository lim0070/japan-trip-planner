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
import { approvedShopping, validateApprovedShoppingChanges } from "./shopping-approved.js";
import { decodeShoppingHistory, encodeShoppingHistory } from "./shopping-history.js";
import { closureRegistry, normalizeClosureParent, validateClosureUpdate } from "./shopping-closure.js";
import { reviewedClosureRegistry, validateReviewedClosures } from "./shopping-reviewed-closures.js";
import { currentShoppingRelease, generation24Release, generation25Release, generation26Release, shoppingRelease } from "./shopping-release.js";
import { generation24Registry, validateGeneration24 } from "./shopping-generation24.js";
import { generation25Registry, validateGeneration25 } from "./shopping-generation25.js";
import { generation26Registry, validateGeneration26 } from "./shopping-generation26.js";
import { generation27Registry, validateGeneration27 } from "./shopping-generation27.js";
import { tenantHoursRegistry, validateTenantHoursUpdate } from "./shopping-hours.js";
import { mixedRegistry, validateMixedUpdate } from "./shopping-mixed.js";
import { sanoRegistry, validateSanoUpdate } from "./shopping-sano.js";
import { reviewedFactsRegistry, validateReviewedFacts } from "./shopping-reviewed-facts.js";
import {
  makeShoppingOverlay,
  makeShoppingSuccessor,
  makeCompactShoppingSuccessor,
  readShoppingOverlay,
  readShoppingSuccessor,
  readCompactShoppingSuccessor,
} from "./shopping-overlay.js";
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
async function verifiedCachedFeed(row, namespace) {
  for (const value of [row?.current, row?.previous]) {
    if (value?.source?.namespace !== namespace) continue;
    try {
      return await verifyFeed(value);
    } catch {
      // A damaged current entry cannot hide a valid previous feed.
    }
  }
  return null;
}

export async function feed(namespace, path, onCached) {
  const old = await read("feeds", namespace);
  const cached = await verifiedCachedFeed(old, namespace);
  if (cached) onCached?.(cached);
  try {
    const fresh = await verifyFeed(
      parseJSON((await readBounded(path, 20 * 1024 * 1024)).text),
    );
    if (fresh.source.namespace !== namespace)
      throw Error("Wrong source namespace");
    if (cached && cached === old?.current && cached.datasetVersion === fresh.datasetVersion)
      return { value: fresh, error: null };
    const winner = await new Promise((resolve, reject) => {
      const tx = db.transaction("feeds", "readwrite");
      const store = tx.objectStore("feeds");
      const get = store.get(namespace);
      let other;
      get.onsuccess = () => {
        const row = get.result;
        if (row?.revision === old?.revision &&
            row?.current?.datasetVersion === old?.current?.datasetVersion)
          store.put({
            current: fresh,
            previous: cached,
            revision: (old?.revision || 0) + 1,
          }, namespace);
        else other = row;
      };
      tx.oncomplete = () => resolve(other);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || Error("Source cache update aborted"));
    });
    return { value: (await verifiedCachedFeed(winner, namespace)) || fresh, error: null };
  } catch (e) {
    if (cached) return { value: cached, error: e.message };
    throw e;
  }
}

// A whole package (records + notices + aliases) is committed in one IDB transaction.
// Never activate a feed before its licences or use mixed release members.
const REGISTRY_KEY = "shopping-codec-registry";
const OVERLAY_KEY = "shopping-region-overlay";
const SUCCESSOR_KEY = "shopping-region-history";
const COMPACT_KEY = "shopping-region-compact-history";
const CHAIN_KEY = "shopping-region-parent-history";
const APPROVED_KEY = "shopping-region-approved-history";
const HISTORY_ARCHIVE_KEY = "shopping-history-archive-v1";
const CLOSURE_KEY = "shopping-region-closure-history";
const REVIEWED_CLOSURES_KEY = "shopping-region-reviewed-closures";
const GENERATION_27_KEY = "shopping-region-reviewed-generation27";
const GENERATION_26_KEY = "shopping-region-reviewed-generation26";
const GENERATION_25_KEY = "shopping-region-reviewed-generation25";
const GENERATION_24_KEY = "shopping-region-reviewed-generation24";
const TENANT_HOURS_KEY = "shopping-region-tenant-hours";
const MIXED_KEY = "shopping-region-mixed";
const SANO_KEY = "shopping-region-sano";
const REVIEWED_FACTS_KEY = "shopping-region-reviewed-facts";
const REGION_REGISTRY = "../data/shopping-sources.region.v1.json";
const SUCCESSOR_REGISTRY = "../data/shopping-sources.successor.v1.json";
const COMPACT_REGISTRY = "../data/shopping-sources.successor.v2.json";
const CHAIN_REGISTRY = "../data/shopping-sources.successor.v3.json";
const APPROVED_REGISTRY = "../data/shopping-sources.successor.v4.json";
const CLOSURE_REGISTRY = "../data/shopping-sources.successor.v5.json";
const REVIEWED_CLOSURES_REGISTRY = "../data/shopping-sources.successor.v6.json";
const REVIEWED_FACTS_REGISTRY = "../data/shopping-sources.successor.v7.json";
const COMPACT_BASE_REGISTRY_VERSION =
  "sha256:2cce080f64be5966d0992fd99c1fcf1d5bc7695437803ca35ca26d545b0d22ef";
const CHAIN_BASE_REGISTRY_VERSION =
  "sha256:837a3c2121494c03532afebaf09f6d1f6faedcf1b0a651dd7893092fda0d88d5";
const APPROVED_BASE_REGISTRY_VERSION =
  "sha256:72bc2de7f7a7769892a90d8814f61ba336f5969cff88866d8f94ddbe50219a79";
const REGION_REGISTRY_VERSION = "sha256:ef3a33a3478309280c86c47da998ca20515b5e3201a5861ecc5acd4bcdcbcd45";
const REGION_BASE = "sha256:2d3dfb2122c4918a17446b79585706e27fa43f687b9c0c943452c002dd96b668";
const packageKey = (id) => id === "osm" ? "shopping-codec-osm" : "shopping-codec-bundle";
const legacyKey = (id) => id === "osm" ? "shopping-osm" : "shopping-bundle";
const artifact = (p) => p?.kind === "shopping-legacy-reference" ? p.artifact :
  p?.manifest?.datasetVersion || p?.feed?.datasetVersion;
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
function checkIndependentShopping(pkg) {
  if (pkg.feed.places.some(p =>
    p.key.startsWith("shopping:osm:") ||
    [...p.provenance, ...p.location.provenance].some(
      e => e.sourceKind === "openstreetmap")))
    throw Error("OSM fields must remain in their independent source package");
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
    keys = [...regionRows, REGISTRY_KEY];
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
          const same = artifact(current || owned?.current) === artifact(fresh), next = {
            current: storedPackage(fresh, id, rows[oldKey]),
            previous: storedPackage(same ? row.previous : current, id, rows[oldKey]) ||
              (same ? owned?.previous : owned?.current) || null,
            revision: owned ? (owned.revision || 0) + (same ? 0 : 1) : 1,
          }, peerRow = compactRow(rows[otherKey], peer, rows[oldPeer]);
          if (id === "overture" && rows[OVERLAY_KEY] && !regionBase({ [key]: next }))
            return stop("Shopping history needs the pinned national base");
          const writeOwn = !owned || next.revision !== owned.revision ||
            !sameStored(next.current, owned.current) || !sameStored(next.previous, owned.previous);
          const writePeer = peerRow && (!sameStored(peerRow.current, rows[otherKey].current) ||
            !sameStored(peerRow.previous, rows[otherKey].previous));
          if ((writeOwn || writePeer) && regionStorageBytes({ ...rows, [key]: next, [otherKey]: peerRow }) > GLOBAL.storage)
            return stop("Shopping storage budget");
          if (writeOwn) store.put(next, key);
          if (writePeer) store.put(peerRow, otherKey);
          result = same ? (current || fresh) : fresh;
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
    checkIndependentShopping(fresh);
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

const legacyHistoryRows = [
  OVERLAY_KEY,
  SUCCESSOR_KEY,
  COMPACT_KEY,
  CHAIN_KEY,
  APPROVED_KEY,
  HISTORY_ARCHIVE_KEY,
  CLOSURE_KEY,
  REVIEWED_CLOSURES_KEY,
  REVIEWED_FACTS_KEY,
  SANO_KEY,
  MIXED_KEY,
  TENANT_HOURS_KEY,
];
const legacyRegistryRows = [REGISTRY_KEY, "shopping-registry"];
const regionRows = [
  ...legacyHistoryRows,
  GENERATION_24_KEY,
  GENERATION_25_KEY,
  GENERATION_26_KEY,
  GENERATION_27_KEY,
  packageKey("overture"),
  packageKey("osm"),
  legacyKey("overture"),
  legacyKey("osm"),
];

function regionStorageBytes(rows) {
  return regionRows.reduce((sum, key) => sum + bytes(rows[key] || {}), 0);
}

function regionBase(rows) {
  const row = rows[packageKey("overture")];
  return [row?.current, row?.previous].find(p =>
    !isReference(p) && p?.manifest?.datasetVersion === REGION_BASE);
}

function writeRegionRows(update, storageLimit = GLOBAL.storage, extraKeys = []) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("feeds", "readwrite");
    const store = tx.objectStore("feeds");
    const rows = {};
    const keys = [...regionRows, ...extraKeys];
    let pending = keys.length;
    let error;
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(error || tx.error || Error("Shopping overlay was not committed"));
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        rows[key] = request.result;
        if (--pending) return;
        try {
          const changed = update(rows);
          if (!changed) return;
          const [key, row] = changed;
          if (regionStorageBytes({ ...rows, [key]: row }) > storageLimit)
            throw Error("Shopping storage budget");
          store.put(row, key);
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
    }
  });
}

// Keep each previously released reader's active row and exact pinned parent.
// The earlier entries of these two rows are independently based on gen 7 / 12.
const pinnedHistory = new Map([[SUCCESSOR_KEY, 12], [COMPACT_KEY, 15]]);
const archivableKeys = [...pinnedHistory.keys()];

export async function compactShoppingHistory() {
  const keys = [...archivableKeys, HISTORY_ARCHIVE_KEY];
  const rows = await feedRows(keys);
  const archive = { ...rows[HISTORY_ARCHIVE_KEY] };
  const replacements = {};
  for (const key of archivableKeys) {
    const row = rows[key];
    if (!Array.isArray(row) || row.at(-1)?.generation !== pinnedHistory.get(key) ||
        row.length < 2) continue;
    const previous = archive[key] ? await decodeShoppingHistory(archive[key]) : [];
    const entries = [...previous, ...row.slice(0, -1)];
    if (entries.some((entry, index) => !Number.isSafeInteger(entry.generation) ||
        entry.generation >= row.at(-1).generation ||
        (index > 0 && entry.generation <= entries[index - 1].generation)))
      throw Error("Shopping history generations are out of order");
    const encoded = await encodeShoppingHistory(entries);
    const restored = await decodeShoppingHistory(encoded);
    if (JSON.stringify(restored) !== JSON.stringify(entries))
      throw Error("Shopping history round trip failed");
    archive[key] = encoded;
    replacements[key] = row.slice(-1);
  }
  if (!Object.keys(replacements).length) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("feeds", "readwrite");
    const store = tx.objectStore("feeds"), current = {};
    let remaining = regionRows.length, changed = false, error;
    tx.oncomplete = () => resolve(changed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(error || tx.error || Error("Shopping history migration aborted"));
    for (const key of regionRows) {
      const get = store.get(key);
      get.onsuccess = () => {
        current[key] = get.result;
        if (--remaining) return;
        try {
          if (keys.some((k) => JSON.stringify(current[k]) !== JSON.stringify(rows[k]))) return;
          const next = { ...current, ...replacements, [HISTORY_ARCHIVE_KEY]: archive };
          const size = regionStorageBytes(next);
          if (size > GLOBAL.storage || size >= regionStorageBytes(current))
            throw Error("Shopping history migration exceeds the storage budget");
          for (const [k, row] of Object.entries(replacements)) store.put(row, k);
          store.put(archive, HISTORY_ARCHIVE_KEY);
          changed = true;
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
    }
  });
}

function saveRegionOverlay(overlay, registry) {
  return writeRegionRows(rows => {
    if (regionBase(rows)?.manifest.datasetVersion !== overlay.baseArtifact)
      throw Error("Shopping overlay base changed");
    const existing = rows[OVERLAY_KEY];
    if (existing && existing.registryVersion !== registry.datasetVersion)
      throw Error("Shopping overlay cannot replace retained history");
    if (!existing) return [OVERLAY_KEY, { registryVersion: registry.datasetVersion, overlay }];
  });
}

async function regionPackage(baseline, baselineRegistry, path) {
  const rows = await feedRows(regionRows);
  const base = regionBase(rows);
  const cached = rows[OVERLAY_KEY];
  try {
    const url = new URL(path, location.href);
    const registry = await readRegistry(url);
    if (baselineRegistry?.generation !== 6 || registry.generation !== 7 ||
        canonical(registry.packages[1]) !== canonical(baselineRegistry.packages[1]))
      throw Error("Shopping region registry does not match the pinned base release");
    if (cached?.registryVersion === registry.datasetVersion)
      return { ...await readShoppingOverlay(base, cached.overlay), error: null };
    if (cached || !base) throw Error("Shopping region base or retained history unavailable");

    const expected = registry.packages[0];
    const fresh = await loadBundle(new URL(expected.path, url), { expected });
    if (canonical(packageMetrics(fresh)) !== canonical(expected.metrics))
      throw Error("Package metrics do not match registry");
    checkIndependentShopping(fresh);
    validateAliases(fresh.aliases, fresh.feed, base.aliases);
    const overlay = makeShoppingOverlay(base, fresh);
    await readShoppingOverlay(base, overlay);
    await saveRegionOverlay(overlay, registry);
    return { ...fresh, error: null };
  } catch (e) {
    if (cached) {
      try {
        return { ...await readShoppingOverlay(base, cached.overlay), error: e.message };
      } catch {
        // If the exact base cannot be read, show the last complete base package.
      }
    }
    if (baseline) return { ...baseline, error: e.message };
    throw e;
  }
}

export async function shoppingSourcesWithRegion(onPackage, path = REGION_REGISTRY) {
  let baseline;
  const registry = await shoppingSources((id, pkg) => {
    if (id === "overture") baseline = pkg;
    else onPackage(id, pkg);
  });
  try {
    onPackage("overture", await regionPackage(baseline, registry, path));
  } catch (e) {
    onPackage("overture", null, e.message);
  }
  return registry;
}

function generationSeven(rows) {
  const row = rows[OVERLAY_KEY];
  const base = regionBase(rows);
  if (!base || row?.registryVersion !== REGION_REGISTRY_VERSION)
    throw Error("Pinned Shopping generation 7 is unavailable");
  return readShoppingOverlay(base, row.overlay);
}

function compactBaseEntry(rows) {
  return rows[SUCCESSOR_KEY]?.find(entry =>
    entry.generation === 12 && entry.registryVersion === COMPACT_BASE_REGISTRY_VERSION);
}

async function generationTwelve(rows) {
  const entry = compactBaseEntry(rows);
  if (!entry) throw Error("Pinned Shopping generation 12 is unavailable");
  return readShoppingSuccessor(await generationSeven(rows), entry.overlay);
}

function chainBaseEntry(rows) {
  return rows[COMPACT_KEY]?.find(entry =>
    entry.generation === 15 && entry.registryVersion === CHAIN_BASE_REGISTRY_VERSION);
}

async function generationFifteen(rows) {
  const entry = chainBaseEntry(rows);
  if (!entry) throw Error("Pinned Shopping generation 15 is unavailable");
  return readCompactShoppingSuccessor(await generationTwelve(rows), entry.overlay);
}

function approvedBaseEntry(rows) {
  return rows[CHAIN_KEY]?.find(entry =>
    entry.generation === 16 && entry.registryVersion === APPROVED_BASE_REGISTRY_VERSION);
}

async function generationSixteen(rows) {
  const entry = approvedBaseEntry(rows);
  if (!entry) throw Error("Pinned Shopping generation 16 is unavailable");
  const chain = rows[CHAIN_KEY];
  return readSuccessorHistory(await generationFifteen(rows),
    chain.slice(0, chain.indexOf(entry) + 1), chainedSuccessors);
}

// A separate row and endpoint keep generation 12 readable by v2.5.3.
// Each compact entry references generation 12 directly, so a later entry
// remains readable independently of the other compact entries.
const standardSuccessors = {
  key: SUCCESSOR_KEY,
  baseGeneration: 7,
  baseEntry: rows => rows[OVERLAY_KEY],
  readBase: generationSeven,
  makeOverlay: makeShoppingSuccessor,
  readOverlay: readShoppingSuccessor,
};
const compactSuccessors = {
  key: COMPACT_KEY,
  baseGeneration: 12,
  baseEntry: compactBaseEntry,
  readBase: generationTwelve,
  makeOverlay: makeCompactShoppingSuccessor,
  readOverlay: readCompactShoppingSuccessor,
};
const chainedSuccessors = {
  ...compactSuccessors,
  key: CHAIN_KEY,
  baseGeneration: 15,
  baseEntry: chainBaseEntry,
  readBase: generationFifteen,
  chained: true,
};
const approvedSuccessors = {
  ...compactSuccessors,
  key: APPROVED_KEY,
  baseGeneration: 16,
  baseEntry: approvedBaseEntry,
  readBase: generationSixteen,
  storageLimit: approvedShopping.storage,
  async readRegistry(url) {
    if (!approvedShopping.registry) throw Error("Approved Shopping package is unavailable");
    const { text } = await readBounded(url, 128 * 1024, approvedShopping.registry);
    const registry = await validateRegistry(parseJSON(text), approvedShopping.expanded);
    if (registry.generation !== approvedShopping.generation)
      throw Error("Shopping registry is outside the approved release");
    return registry;
  },
  validateUpdate: validateApprovedShoppingChanges,
};

const closureSuccessors = {
  ...compactSuccessors,
  key: CLOSURE_KEY,
  baseGeneration: 17,
  baseEntry: rows => rows[APPROVED_KEY]?.find(entry => entry.generation === 17),
  async readBase(rows) {
    const entry = this.baseEntry(rows);
    if (!entry) throw Error("Pinned Shopping generation 17 is unavailable");
    return normalizeClosureParent(await readCompactShoppingSuccessor(await generationSixteen(rows), entry.overlay));
  },
  async readRegistry(url) {
    const { text } = await readBounded(url, 128 * 1024, closureRegistry);
    const registry = await validateRegistry(parseJSON(text));
    if (registry.generation !== 18) throw Error("Unexpected Shopping closure registry");
    return registry;
  },
  validateUpdate: validateClosureUpdate,
};

const reviewedClosures = {
  ...compactSuccessors,
  key: REVIEWED_CLOSURES_KEY,
  baseGeneration: 18,
  baseEntry: rows => rows[CLOSURE_KEY]?.find(entry => entry.generation === 18 &&
    entry.registryVersion === "sha256:d927b7314e1f1cde291edb2a22cd3f0cb30f1649aa4297ee4b78559106268b54"),
  async readBase(rows) {
    const entry = this.baseEntry(rows);
    if (!entry) throw Error("Pinned Shopping generation 18 is unavailable");
    return readCompactShoppingSuccessor(await closureSuccessors.readBase(rows), entry.overlay);
  },
  async readRegistry(url) {
    const { text } = await readBounded(url, 128 * 1024, reviewedClosureRegistry);
    const registry = await validateRegistry(parseJSON(text));
    if (registry.generation !== 19) throw Error("Unexpected Shopping closures registry");
    return registry;
  },
  validateUpdate: validateReviewedClosures,
};

const reviewedFacts = {
  ...compactSuccessors,
  key: REVIEWED_FACTS_KEY,
  baseGeneration: 19,
  baseEntry: rows => rows[REVIEWED_CLOSURES_KEY]?.find(entry => entry.generation === 19 &&
    entry.registryVersion === "sha256:f8b940c5f2dbcab0c2be027306675c9dae2ac1f10801abc6faf8136451e50a67"),
  async readBase(rows) {
    const entry = this.baseEntry(rows);
    if (!entry) throw Error("Pinned Shopping generation 19 is unavailable");
    return readCompactShoppingSuccessor(await reviewedClosures.readBase(rows), entry.overlay);
  },
  async readRegistry(url) {
    const { text } = await readBounded(url, 128 * 1024, reviewedFactsRegistry);
    const registry = await validateRegistry(parseJSON(text));
    if (registry.generation !== 20) throw Error("Unexpected Shopping facts registry");
    return registry;
  },
  validateUpdate: validateReviewedFacts,
};

const sanoSuccessor = {
  ...compactSuccessors,
  key: SANO_KEY,
  baseGeneration: 20,
  baseEntry: rows => rows[REVIEWED_FACTS_KEY]?.find(entry => entry.generation === 20 &&
    entry.registryVersion === "sha256:ca61042f99004541c309fc03c0939efcf3f302293a814d9a1bb9451f71e68e9c"),
  async readBase(rows) {
    const entry = this.baseEntry(rows);
    if (!entry) throw Error("Pinned Shopping generation 20 is unavailable");
    return readCompactShoppingSuccessor(await reviewedFacts.readBase(rows), entry.overlay);
  },
  async readRegistry(url) {
    const { text } = await readBounded(url, 128 * 1024, sanoRegistry);
    const registry = await validateRegistry(parseJSON(text));
    if (registry.generation !== 21) throw Error("Unexpected Sano Shopping registry");
    return registry;
  },
  validateUpdate: validateSanoUpdate,
};

const mixedSuccessor = {
  ...compactSuccessors,
  key: MIXED_KEY,
  baseGeneration: 21,
  baseEntry: rows => rows[SANO_KEY]?.find(entry => entry.generation === 21 &&
    entry.registryVersion === "sha256:65fa82c59479aeaf7a696ef537f3fbfc25fb696335c05df69d83f250b98a62c1"),
  async readBase(rows) {
    const entry = this.baseEntry(rows);
    if (!entry) throw Error("Pinned Shopping generation 21 is unavailable");
    return readCompactShoppingSuccessor(await sanoSuccessor.readBase(rows), entry.overlay);
  },
  async readRegistry(url) {
    const { text } = await readBounded(url, 128 * 1024, mixedRegistry);
    const registry = await validateRegistry(parseJSON(text));
    if (registry.generation !== 22) throw Error("Unexpected Shopping mixed registry");
    return registry;
  },
  validateUpdate: validateMixedUpdate,
};

const tenantHoursSuccessor = {
  ...compactSuccessors,
  key: TENANT_HOURS_KEY,
  baseGeneration: 22,
  baseEntry: rows => rows[MIXED_KEY]?.find(entry => entry.generation === 22 &&
    entry.registryVersion === "sha256:46e6e4ce39766bbad8ad96799a3b8d46ee58d37287dd99352852f350f891ce21"),
  async readBase(rows) {
    const entry = this.baseEntry(rows);
    if (!entry) throw Error("Pinned Shopping generation 22 is unavailable");
    return readCompactShoppingSuccessor(await mixedSuccessor.readBase(rows), entry.overlay);
  },
  async readRegistry(url) {
    const { text } = await readBounded(url, 128 * 1024, tenantHoursRegistry);
    const registry = await validateRegistry(parseJSON(text));
    if (registry.generation !== 23) throw Error("Unexpected Shopping tenant hours registry");
    return registry;
  },
  validateUpdate: validateTenantHoursUpdate,
};

const gen23Release = shoppingRelease("sha256:924f5d22672f63699da8b930ab0c88d88c831348c65492eb7cf2d344f7868a49");
const gen23RegistryVersion = "sha256:47975d8b73a7278a1a467e17f3e7cf5992394ea710d336f039f754630bf0ffb0";

const generation24 = {
  ...compactSuccessors,
  key: GENERATION_24_KEY,
  baseGeneration: 23,
  release: generation24Release,
  parentArtifact: gen23Release.artifact,
  baseEntry: rows => rows[TENANT_HOURS_KEY]?.find(entry =>
    entry.generation === 23 && entry.registryVersion === gen23RegistryVersion),
  baseAvailable(rows) {
    return !!directPackage(rows, gen23Release) ||
      !!regionBase(rows) && rows[OVERLAY_KEY]?.registryVersion === REGION_REGISTRY_VERSION &&
        artifact(this.baseEntry(rows)?.overlay.package) === gen23Release.artifact;
  },
  async readBase(rows) {
    const direct = directPackage(rows, gen23Release);
    if (direct) return verifyDirectPackage(direct);
    const entry = this.baseEntry(rows);
    if (!entry) throw Error("Pinned Shopping generation 23 is unavailable");
    return readCompactShoppingSuccessor(await tenantHoursSuccessor.readBase(rows), entry.overlay);
  },
  async readRegistry(url) {
    return readPinnedShoppingRegistry(url, generation24Registry, this.release);
  },
  validateUpdate: validateGeneration24,
};

const generation25 = reviewedSuccessor(
  GENERATION_25_KEY, generation25Release, generation24, generation25Registry, validateGeneration25,
);
const generation26 = reviewedSuccessor(
  GENERATION_26_KEY, generation26Release, generation25, generation26Registry, validateGeneration26,
);

const generation27 = reviewedSuccessor(
  GENERATION_27_KEY, currentShoppingRelease, generation26, generation27Registry, validateGeneration27,
);

function reviewedSuccessor(key, release, parent, registry, validateUpdate) {
  return {
    ...compactSuccessors,
    key,
    baseGeneration: parent.release.generation,
    release,
    parentArtifact: parent.release.artifact,
    baseAvailable(rows) {
      if (directPackage(rows, parent.release)) return true;
      const overlay = storedReleaseOverlay(rows[parent.key], parent.release);
      return overlay?.baseArtifact === parent.parentArtifact && parent.baseAvailable(rows);
    },
    async readBase(rows) {
      const base = await readRetainedRelease(rows, parent);
      if (!base) throw Error("Pinned Shopping generation " + parent.release.generation + " is unavailable");
      return base;
    },
    async readRegistry(url) {
      return readPinnedShoppingRegistry(url, registry, release);
    },
    validateUpdate,
  };
}

async function readPinnedShoppingRegistry(url, descriptor, release) {
  const { text } = await readBounded(url, 128 * 1024, descriptor);
  const registry = await validateRegistry(parseJSON(text));
  if (registry.generation !== release.generation || registry.datasetVersion !== release.registryVersion)
    throw Error("Unexpected Shopping registry for generation " + release.generation);
  return registry;
}

async function readSuccessorHistory(base, history, format) {
  if (format.chained) {
    for (const entry of history) base = await format.readOverlay(base, entry.overlay);
    return base;
  }
  const head = history.at(-1);
  return head ? format.readOverlay(base, head.overlay) : base;
}

function appendShoppingSuccessor(base, overlay, registry, expectedHead, format) {
  return writeRegionRows(rows => {
    const available = format.baseAvailable
      ? format.baseAvailable(rows)
      : !!regionBase(rows) && rows[OVERLAY_KEY]?.registryVersion === REGION_REGISTRY_VERSION &&
        artifact(format.baseEntry(rows)?.overlay.package) === artifact(base);
    if (!available)
      throw Error("Shopping successor base changed");
    const history = rows[format.key] || [];
    const head = history.at(-1);
    if (head?.registryVersion === registry.datasetVersion) return;
    if (head?.registryVersion !== expectedHead?.registryVersion ||
        registry.generation <= (head?.generation ?? format.baseGeneration))
      throw Error("Stale Shopping successor generation");
    const parentArtifact = format.chained && head ? artifact(head.overlay.package) : artifact(base);
    if (overlay.baseArtifact !== parentArtifact)
      throw Error("Shopping successor parent changed");
    return [format.key, [...history, {
      generation: registry.generation,
      registryVersion: registry.datasetVersion,
      overlay,
    }]];
  }, format.storageLimit);
}

async function successorPackage(fallback, baselineRegistry, path, format) {
  const rows = await feedRows(regionRows);
  const history = rows[format.key] || [];
  const head = history.at(-1);
  let previous;
  try {
    const base = await format.readBase(rows);
    previous = await readSuccessorHistory(base, history, format);
    const url = new URL(path, location.href);
    const registry = await (format.readRegistry || readRegistry)(url);
    if (baselineRegistry?.generation !== 6 || registry.generation <= format.baseGeneration ||
        canonical(registry.packages[1]) !== canonical(baselineRegistry.packages[1]))
      throw Error("Shopping successor registry does not match the pinned OSM release");
    if (head?.registryVersion === registry.datasetVersion)
      return { ...previous, error: null };
    if (registry.generation <= (head?.generation ?? format.baseGeneration))
      throw Error("Stale Shopping successor generation");
    const expected = registry.packages[0];
    const fresh = await loadBundle(new URL(expected.path, url), { expected });
    if (canonical(packageMetrics(fresh)) !== canonical(expected.metrics))
      throw Error("Package metrics do not match registry");
    checkIndependentShopping(fresh);
    validateAliases(fresh.aliases, fresh.feed, previous.aliases);
    const parent = format.chained ? previous : base;
    const overlay = format.makeOverlay(parent, fresh);
    await format.validateUpdate?.(parent, fresh, overlay);
    await format.readOverlay(parent, overlay);
    await appendShoppingSuccessor(base, overlay, registry, head, format);
    return { ...fresh, error: null };
  } catch (e) {
    if (previous && head) return { ...previous, error: e.message };
    if (fallback) return { ...fallback, error: e.message };
    throw e;
  }
}

async function shoppingSourcesWithSuccessor(onPackage, path, prior, format) {
  let fallback;
  const registry = await prior((id, pkg) => {
    if (id === "overture") fallback = pkg;
    else onPackage(id, pkg);
  });
  try {
    onPackage("overture", await successorPackage(fallback, registry, path, format));
  } catch (e) {
    onPackage("overture", null, e.message);
  }
  return registry;
}

export function shoppingSourcesWithRegionHistory(onPackage, path = SUCCESSOR_REGISTRY) {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithRegion, standardSuccessors);
}

export function shoppingSourcesWithCompactHistory(onPackage, path = COMPACT_REGISTRY) {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithRegionHistory, compactSuccessors);
}

export function shoppingSourcesWithParentHistory(onPackage, path = CHAIN_REGISTRY) {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithCompactHistory, chainedSuccessors);
}

export async function shoppingSourcesWithApprovedHistory(onPackage, path = APPROVED_REGISTRY) {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithParentHistory, approvedSuccessors);
}

export async function shoppingSourcesWithRecoveredHistory(onPackage, path = CLOSURE_REGISTRY) {
  // Allow the pinned approved release to load before recovering storage.
  return shoppingSourcesWithSuccessor(onPackage, path, async receive => {
    const registry = await shoppingSourcesWithApprovedHistory(receive);
    try {
      await compactShoppingHistory();
    } catch (error) {
      // IDB abort leaves the old rows usable even on engines lacking gzip streams.
      console.warn("Shopping history could not be compacted:", error.message);
    }
    return registry;
  }, closureSuccessors);
}

export function shoppingSourcesWithReviewedClosures(onPackage, path = REVIEWED_CLOSURES_REGISTRY) {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithRecoveredHistory, reviewedClosures);
}

export function shoppingSourcesWithReviewedFacts(onPackage, path = REVIEWED_FACTS_REGISTRY) {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithReviewedClosures, reviewedFacts);
}

export function shoppingSourcesWithSano(onPackage, path = "../data/shopping-sources.successor.v8.json") {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithReviewedFacts, sanoSuccessor);
}

export function shoppingSourcesWithMixedUpdate(onPackage, path = "../data/shopping-sources.successor.v9.json") {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithSano, mixedSuccessor);
}

export function shoppingSourcesWithTenantHours(onPackage, path = "../data/shopping-sources.successor.v10.json") {
  return shoppingSourcesWithSuccessor(onPackage, path, shoppingSourcesWithMixedUpdate, tenantHoursSuccessor);
}

async function retainedShoppingVersion(version, rows) {
  if (!rows[OVERLAY_KEY]) return null;
  const base = await generationSeven(rows);
  if (artifact(base) === version) return base;
  const chain = rows[CHAIN_KEY] || [];
  const approved = rows[APPROVED_KEY] || [];
  const closure = rows[CLOSURE_KEY] || [];
  const reviewed = rows[REVIEWED_CLOSURES_KEY] || [];
  const facts = rows[REVIEWED_FACTS_KEY] || [];
  const sano = rows[SANO_KEY] || [];
  const mixed = rows[MIXED_KEY] || [];
  const hours = rows[TENANT_HOURS_KEY] || [];
  const archive = rows[HISTORY_ARCHIVE_KEY];
  const [standard, compact] = await Promise.all(archivableKeys.map(async key => {
    const active = rows[key] || [];
    try {
      return archive?.[key] ? [...await decodeShoppingHistory(archive[key]), ...active] : active;
    } catch (error) {
      // A damaged archive cannot replace or hide a live rollback head.
      console.warn("Shopping history archive unavailable:", error.message);
      return active;
    }
  }));
  const history = [...standard, ...compact, ...chain, ...approved, ...closure, ...reviewed, ...facts, ...sano, ...mixed, ...hours];
  let entry = history.find(({ overlay }) => artifact(overlay.package) === version);
  if (!entry) {
    const matches = history.filter(({ overlay }) => overlay.package.feed.datasetVersion === version);
    if (base.feed.datasetVersion === version) return matches.length ? null : base;
    if (matches.length === 1) entry = matches[0];
  }
  if (!entry) return null;
  if (hours.includes(entry))
    return readCompactShoppingSuccessor(await tenantHoursSuccessor.readBase(rows), entry.overlay);
  if (mixed.includes(entry))
    return readCompactShoppingSuccessor(await mixedSuccessor.readBase(rows), entry.overlay);
  if (sano.includes(entry))
    return readCompactShoppingSuccessor(await sanoSuccessor.readBase(rows), entry.overlay);
  if (facts.includes(entry))
    return readCompactShoppingSuccessor(await reviewedFacts.readBase(rows), entry.overlay);
  if (reviewed.includes(entry))
    return readCompactShoppingSuccessor(await reviewedClosures.readBase(rows), entry.overlay);
  if (closure.includes(entry))
    return readCompactShoppingSuccessor(await closureSuccessors.readBase(rows), entry.overlay);
  if (approved.includes(entry))
    return readCompactShoppingSuccessor(await generationSixteen(rows), entry.overlay);
  const chainIndex = chain.indexOf(entry);
  if (chainIndex >= 0)
    return readSuccessorHistory(await generationFifteen(rows), chain.slice(0, chainIndex + 1), chainedSuccessors);
  if (compact.includes(entry))
    return readCompactShoppingSuccessor(await generationTwelve(rows), entry.overlay);
  return readShoppingSuccessor(base, entry.overlay);
}

// Cold profiles use the exact reviewed materialized package. Upgrades retain
// their exact parent and commit only a verified compact overlay.
const shoppingDataRoot = () => new URL("../data/", location.href);

function matchesRelease(pkg, release = currentShoppingRelease) {
  return artifact(pkg) === release.artifact && pkg?.feed?.datasetVersion === release.feedVersion;
}

function directPackage(rows, release) {
  const row = rows[packageKey("overture")];
  return [row?.current, row?.previous].find(pkg => matchesRelease(pkg, release));
}

async function verifyDirectPackage(pkg) {
  await verifyFeed(pkg.feed);
  validateAliases(pkg.aliases, pkg.feed);
  checkIndependentShopping(pkg);
  return pkg;
}

async function readReleasedShopping(expected) {
  const candidate = await loadBundle(new URL(expected.path, shoppingDataRoot()), { expected });
  checkIndependentShopping(candidate);
  checkTotals([packageMetrics(candidate)]);
  return candidate;
}

function storedReleaseOverlay(history, release) {
  const entry = history?.at(-1);
  return entry?.registryVersion === release.registryVersion &&
    artifact(entry.overlay?.package) === release.artifact ? entry.overlay : null;
}

async function readRetainedRelease(rows, format) {
  const direct = directPackage(rows, format.release);
  if (direct) return verifyDirectPackage(direct);
  const overlay = storedReleaseOverlay(rows[format.key], format.release);
  if (!overlay) return null;
  const candidate = await format.readOverlay(await format.readBase(rows), overlay);
  return matchesRelease(candidate, format.release) ? candidate : null;
}

async function retainedShoppingForRelease(format, primary = null) {
  const row = primary || await shoppingCacheState("overture");
  const direct = [row.current, row.previous].find(pkg => matchesRelease(pkg, format.release));
  if (direct) return verifyDirectPackage(direct);
  if (!storedReleaseOverlay(await read("feeds", format.key), format.release)) return null;
  return readRetainedRelease(await feedRows(regionRows), format);
}

function hasLegacyShoppingRows() {
  const keys = [...legacyHistoryRows, ...legacyRegistryRows, GENERATION_24_KEY, GENERATION_25_KEY, GENERATION_26_KEY, GENERATION_27_KEY];
  return new Promise((resolve, reject) => {
    const tx = db.transaction("feeds"), store = tx.objectStore("feeds");
    let historical = false;
    for (const key of keys) {
      const request = store.getKey(key);
      request.onsuccess = () => { historical ||= request.result !== undefined; };
    }
    tx.oncomplete = () => resolve(historical);
    tx.onabort = () => reject(tx.error || Error("Shopping history lookup interrupted"));
  });
}

function storeDirectShopping(candidate, release) {
  return writeRegionRows(rows => {
    const key = packageKey("overture");
    const row = resolvedRow(rows[key], rows[legacyKey("overture")]);
    if ((row.current && !matchesRelease(row.current, release)) || row.previous ||
        [...legacyHistoryRows, ...legacyRegistryRows, GENERATION_24_KEY, GENERATION_25_KEY, GENERATION_26_KEY, GENERATION_27_KEY]
          .some(key => rows[key] !== undefined))
      throw Error("Shopping history appeared during the cold download");
    const osm = resolvedRow(rows[packageKey("osm")], rows[legacyKey("osm")]).current;
    checkTotals([packageMetrics(candidate), ...(osm ? [packageMetrics(osm)] : []),
      { ancillary: 128 * 1024 }]);
    // Existing loaders count this row. An older open tab cannot exceed the
    // retained budget by writing history alongside the direct snapshot.
    return [key, { current: candidate, previous: null, revision: row.revision + 1 }];
  }, GLOBAL.storage, legacyRegistryRows);
}

async function shoppingSourcesForRelease(onPackage, format, parentRelease, recoverParent) {
  const { release } = format;
  const oldPrimary = await shoppingCacheState("overture");
  const retained = await retainedShoppingForRelease(format, oldPrimary).catch(() => null);
  let parent = null;
  if (!retained) {
    const directParent = [oldPrimary.current, oldPrimary.previous].find(pkg => matchesRelease(pkg, parentRelease));
    if (directParent) parent = await verifyDirectPackage(directParent).catch(() => null);
    if (!parent && ([oldPrimary.current, oldPrimary.previous].some(pkg => pkg && !matchesRelease(pkg, release)) ||
        await hasLegacyShoppingRows())) {
      parent = await format.readBase(await feedRows(regionRows)).catch(() => null);
      if (!parent) {
        await recoverParent(onPackage);
        parent = await format.readBase(await feedRows(regionRows)).catch(() => null);
        if (!parent) return;
      }
    }
  }

  const osmRow = await shoppingCacheState("osm");
  const previousOsm = [osmRow.current, osmRow.previous].find(p =>
    p?.feed?.datasetVersion === release.osmVersion);
  if (retained) onPackage("overture", retained);
  else if (parent) onPackage("overture", { ...parent, error: "Checking for a Shopping update" });
  if (previousOsm) onPackage("osm", previousOsm);
  if (retained && previousOsm) return;

  const registry = format.readRegistry(new URL(release.registryPath, shoppingDataRoot()));
  const load = async (id, prior, action) => {
    if (prior) return;
    try {
      const descriptor = (await registry).packages.find(p => p.id === id);
      onPackage(id, await action(descriptor));
    } catch (error) {
      // A concurrent legacy activation may have completed while we waited.
      const cached = id === "overture"
        ? (await retainedShoppingForRelease(format).catch(() => null)) || parent
        : await osmVersion(release.osmVersion);
      onPackage(id, cached ? { ...cached, error: error.message } : null, error.message);
    }
  };
  await Promise.all([
    load("overture", retained, async expected => {
      const candidate = await readReleasedShopping(expected);
      if (!matchesRelease(candidate, release) ||
          canonical(packageMetrics(candidate)) !== canonical(expected.metrics))
        throw Error("Current Shopping package differs from its reviewed registry");
      if (parent) {
        const overlay = format.makeOverlay(parent, candidate);
        format.validateUpdate(parent, candidate, overlay);
        await format.readOverlay(parent, overlay);
        await appendShoppingSuccessor(parent, overlay, await registry, undefined, format);
      } else await storeDirectShopping(candidate, release);
      return candidate;
    }),
    load("osm", previousOsm, async expected => {
      const candidate = await loadOSM(new URL(expected.path, shoppingDataRoot()), { expected });
      if (candidate.feed.datasetVersion !== release.osmVersion ||
          canonical(packageMetrics(candidate)) !== canonical(expected.metrics))
        throw Error("OSM package differs from its reviewed registry");
      return activateShoppingPackage("osm", candidate, osmRow.revision);
    }),
  ]);
}

export function shoppingSourcesWithGeneration24(onPackage) {
  return shoppingSourcesForRelease(onPackage, generation24, gen23Release, shoppingSourcesWithTenantHours);
}

export function shoppingSourcesWithGeneration25(onPackage) {
  return shoppingSourcesForRelease(onPackage, generation25, generation24Release, shoppingSourcesWithGeneration24);
}

export function shoppingSourcesWithGeneration26(onPackage) {
  return shoppingSourcesForRelease(onPackage, generation26, generation25Release, shoppingSourcesWithGeneration25);
}

export function shoppingCurrentSources(onPackage) {
  return shoppingSourcesForRelease(onPackage, generation27, generation26Release, shoppingSourcesWithGeneration26);
}

export async function shoppingRegionVersion(version) {
  const rows = await feedRows(regionRows);
  const release = shoppingRelease(version);
  const direct = release && directPackage(rows, release);
  if (direct) return direct;
  const format = [generation24, generation25, generation26, generation27].find(item => item.release.generation === release?.generation);
  if (format && storedReleaseOverlay(rows[format.key], format.release))
    return readRetainedRelease(rows, format);
  const retained = await retainedShoppingVersion(version, rows);
  if (retained) return retained;

  const expected = release;
  if (!expected || !navigator.onLine) return null;
  try {
    const candidate = await readReleasedShopping(expected);
    if (artifact(candidate) !== expected.artifact || candidate.feed.datasetVersion !== expected.feedVersion)
      throw Error("Historical Shopping version differs from the pinned release");
    return candidate;
  } catch {
    return null;
  }
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
