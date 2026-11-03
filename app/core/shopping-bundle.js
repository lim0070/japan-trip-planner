// Versioned transport only. Saved SourcePlaces remain the ordinary v1 shape.
import {
  canonical,
  digest,
  parseJSON,
  validateFeed,
  verifyFeed,
  validEvidence,
  validPlace,
  validLink,
  guardTree,
} from "./contracts.js";
export const LIMITS = Object.freeze({
  manifest: 128 * 1024,
  chunk: 4 * 1024 * 1024,
  expandedChunk: 8 * 1024 * 1024,
  wire: 24 * 1024 * 1024,
  expanded: 32 * 1024 * 1024,
  aliases: 2 * 1024 * 1024,
  ancillary: 2 * 1024 * 1024,
  places: 20000,
  chunks: 128,
});
const enc = new TextEncoder(),
  fail = (m) => {
    throw Error("Shopping bundle: " + m);
  };
export const bytes = (x) =>
  enc.encode(typeof x === "string" ? x : JSON.stringify(x)).length;
const exact = (o, keys) =>
  o &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  Object.keys(o).length === keys.length &&
  keys.every((k) => Object.hasOwn(o, k));
const int = (x, max, min = 0) =>
  Number.isSafeInteger(x) && x >= min && x <= max;
const hash = (x) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const version = (x) => typeof x === "string" && /^sha256:[a-f0-9]{64}$/.test(x);
const brand = (x) =>
  typeof x === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x);
const pathOK = (x) =>
  typeof x === "string" &&
  x.length <= 200 &&
  /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/[A-Za-z0-9_.-]+$|^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/.test(
    x,
  ) &&
  !x.split("/").some((s) => s.includes(".."));
const desc = (d, max) =>
  exact(d, ["path", "sha256", "bytes"]) &&
  pathOK(d.path) &&
  hash(d.sha256) &&
  int(d.bytes, max, 1);
export const makeFeed = (source, generatedAt, places, datasetVersion) => ({
  schemaVersion: 1,
  source,
  lists: [],
  places,
  datasetVersion,
  generatedAt,
});
export const byteOrder = (a, b) => {
  const x = enc.encode(a),
    y = enc.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++)
    if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
// Count bytes from the decoded HTTP body (before UTF8 decoding), never Content-Length.
export async function readBounded(url, max, expected = null, fetcher = fetch) {
  const r = await fetcher(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok || !r.body) fail("resource unavailable");
  const reader = r.body.getReader(),
    decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let count = 0;
  const parts = [],
    blocks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > max || (expected && count > expected.bytes))
        fail("response byte limit");
      parts.push(decoder.decode(value, { stream: true }));
      blocks.push(value);
    }
    parts.push(decoder.decode());
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  if (expected && count !== expected.bytes)
    fail("response byte count mismatch");
  const data = new Uint8Array(count);
  let offset = 0;
  for (const b of blocks) {
    data.set(b, offset);
    offset += b.length;
  }
  const sha = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (expected && sha !== expected.sha256) fail("resource checksum");
  return { text: parts.join(""), bytes: count, sha256: sha };
}
export async function validateManifest(m) {
  if (
    !exact(m, [
      "schemaVersion",
      "kind",
      "datasetVersion",
      "generatedAt",
      "source",
      "logicalDatasetVersion",
      "placeCount",
      "expandedBytes",
      "chunks",
      "aliases",
      "inputs",
      "licenses",
    ]) ||
    m.schemaVersion !== 2 ||
    m.kind !== "shopping-bundle" ||
    !version(m.datasetVersion) ||
    !version(m.logicalDatasetVersion) ||
    !int(m.placeCount, LIMITS.places, 1) ||
    !int(m.expandedBytes, LIMITS.expanded, 1) ||
    !Array.isArray(m.chunks) ||
    !int(m.chunks.length, LIMITS.chunks, 1)
  )
    fail("manifest shape");
  validateFeed(makeFeed(m.source, m.generatedAt, [], m.logicalDatasetVersion));
  if (m.source.namespace !== "shopping") fail("namespace");
  if (
    !desc(m.aliases, LIMITS.aliases) ||
    !desc(m.inputs, LIMITS.ancillary) ||
    !exact(m.licenses, ["index", "files"]) ||
    !desc(m.licenses.index, LIMITS.ancillary) ||
    !Array.isArray(m.licenses.files) ||
    !int(m.licenses.files.length, 1000, 1) ||
    !m.licenses.files.every((d) => desc(d, LIMITS.ancillary))
  )
    fail("ancillary descriptor");
  if (
    new Set(m.licenses.files.map((d) => d.path.split("/").at(-1))).size !==
    m.licenses.files.length
  )
    fail("duplicate notice basename");
  const seen = new Set();
  let wire = 0,
    count = 0,
    expanded =
      bytes(makeFeed(m.source, m.generatedAt, [], m.logicalDatasetVersion)) + 1;
  const parts = new Map();
  let previous = "";
  for (const d of m.chunks) {
    if (
      !exact(d, [
        "path",
        "brandId",
        "part",
        "sha256",
        "bytes",
        "placeCount",
        "expandedBytes",
        "feedDatasetVersion",
      ]) ||
      !pathOK(d.path) ||
      !hash(d.sha256) ||
      !brand(d.brandId) ||
      !int(d.part, 128, 1) ||
      !int(d.bytes, LIMITS.chunk, 1) ||
      !int(d.placeCount, 500, 1) ||
      !int(d.expandedBytes, LIMITS.expandedChunk, 1) ||
      !version(d.feedDatasetVersion)
    )
      fail("chunk descriptor");
    if (
      (previous && byteOrder(previous, d.brandId) > 0) ||
      d.part !== (parts.get(d.brandId) || 0) + 1
    )
      fail("chunk order");
    previous = d.brandId;
    parts.set(d.brandId, d.part);
    if (
      d.expandedBytes <
      bytes(makeFeed(m.source, m.generatedAt, [], d.feedDatasetVersion)) +
        1 +
        d.placeCount * 2 +
        Math.max(0, d.placeCount - 1)
    )
      fail("expanded descriptor lower bound");
    wire += d.bytes;
    count += d.placeCount;
    expanded +=
      d.expandedBytes -
      (bytes(makeFeed(m.source, m.generatedAt, [], d.feedDatasetVersion)) + 1);
  }
  expanded += m.chunks.length - 1;
  if (
    wire > LIMITS.wire ||
    count !== m.placeCount ||
    expanded !== m.expandedBytes
  )
    fail("aggregate budget/count");
  const ancillary =
    m.inputs.bytes +
    m.licenses.index.bytes +
    m.licenses.files.reduce((n, d) => n + d.bytes, 0);
  if (ancillary > LIMITS.ancillary) fail("ancillary budget");
  for (const d of [
    ...m.chunks,
    m.aliases,
    m.inputs,
    m.licenses.index,
    ...m.licenses.files,
  ]) {
    if (seen.has(d.path)) fail("duplicate resource path");
    seen.add(d.path);
  }
  const { datasetVersion, generatedAt, ...content } = m;
  if ((await digest(content)) !== datasetVersion) fail("manifest checksum");
  return m;
}
// JSON transport cannot contain sparse arrays or extra array properties. Check
// direct decoder calls too, rather than relying on Array.every skipping holes.
function denseTree(value, depth = 0) {
  if (depth > 32) fail("chunk nesting");
  if (Array.isArray(value)) {
    if (value.length > 20000 || Object.keys(value).length !== value.length)
      fail("sparse/extra array fields");
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) fail("sparse array");
      denseTree(value[i], depth + 1);
    }
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) denseTree(v, depth + 1);
  }
}
function dictionarySizes(values, valid, label) {
  if (!Array.isArray(values) || values.length > 20000)
    fail(label + " dictionary");
  let previous = null;
  const sizes = [];
  for (const value of values) {
    if (!valid(value)) fail(label + " dictionary entry");
    // Canonical JSON escapes lone surrogates; raw-string UTF8 would conflate them.
    const raw = enc.encode(canonical(value));
    if (previous) {
      let cmp = 0;
      for (let i = 0; i < Math.min(previous.length, raw.length); i++) {
        if (previous[i] !== raw[i]) { cmp = previous[i] - raw[i]; break; }
      }
      if (!cmp) cmp = previous.length - raw.length;
      if (cmp >= 0) fail(label + " dictionary ordering/duplicates");
    }
    sizes.push(raw.byteLength);
    previous = raw;
  }
  return sizes;
}
const placeKeys = ["schemaVersion", "key", "sourceId", "names", "address",
  "category", "location", "operatingStatus", "hoursText", "hours", "awards",
  "memberships", "hallOfFame", "shopping", "provenanceRefs"];
const locationKeys = ["lat", "lng", "availability", "confidence", "method",
  "verifiedAt", "provenanceRefs"];
function checkedAdd(a, b, cap) {
  const n = a + b;
  if (!Number.isSafeInteger(n) || n < 0 || n > cap)
    fail("expanded chunk budget");
  return n;
}
function arraySize(refs, sizes, max, cap) {
  if (!Array.isArray(refs) || refs.length > max)
    fail("invalid reference array");
  let n = 2;
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (!Object.hasOwn(refs, i) || !int(ref, sizes.length - 1))
      fail("invalid dictionary reference");
    n = checkedAdd(n, sizes[ref] + (i ? 1 : 0), cap);
  }
  return n;
}
// Validate and count exact UTF8 expansion before allocating referenced arrays
// or copying dictionary objects. Empty validation placeholders never expand refs.
export function preflightChunk(c, d, m) {
  const v3 = c?.schemaVersion === 3;
  if (!exact(c, ["schemaVersion", "kind", "brandId", "part", "evidence",
      ...(v3 ? ["texts", "links"] : []), "places"]) ||
      ![2, 3].includes(c.schemaVersion) || c.kind !== "shopping-place-chunk" ||
      !brand(c.brandId) || c.brandId !== d.brandId ||
      !int(c.part, 128, 1) || c.part !== d.part ||
      !int(d.placeCount, 500, 1) || !int(d.expandedBytes, LIMITS.expandedChunk, 1) ||
      !int(m.expandedBytes, LIMITS.expanded, 1) ||
      !Array.isArray(c.places) || c.places.length !== d.placeCount)
    fail("chunk shape");
  denseTree(c);
  guardTree(c);
  const cap = Math.min(LIMITS.expandedChunk, d.expandedBytes, m.expandedBytes);
  let n = bytes(makeFeed(m.source, m.generatedAt, [], d.feedDatasetVersion)) + 1;
  n = checkedAdd(n, 0, cap);
  const evidenceSizes = dictionarySizes(c.evidence, validEvidence, "evidence"),
    textSizes = v3 ? dictionarySizes(c.texts,
      (x) => typeof x === "string" && x.length <= 2000, "text") : null,
    linkSizes = v3 ? dictionarySizes(c.links, validLink, "link") : null;
  let previous = "";
  const empty = [];
  for (let i = 0; i < c.places.length; i++) {
    const p = c.places[i];
    if (!exact(p, [...placeKeys, ...(v3 ? ["reviewNoteRefs", "linkRefs"] :
        ["reviewNotes", "links"])]) || !exact(p.location, locationKeys) ||
        !exact(p.operatingStatus, ["value", "checkedAt", v3 ? "noteRef" : "note"]) ||
        typeof p.key !== "string" || (previous && byteOrder(previous, p.key) >= 0) ||
        p.shopping?.brandId !== d.brandId)
      fail("wire record shape/identity/order");
    // Reuse existing logical validators without allocating anything referenced.
    const {provenanceRefs, location, ...base} = p;
    const {provenanceRefs: locRefs, ...loc} = location;
    const logical = {...base, provenance: empty, location: {...loc, provenance: empty}};
    if (v3) {
      delete logical.reviewNoteRefs; delete logical.linkRefs;
      logical.reviewNotes = empty; logical.links = empty;
      logical.operatingStatus = {value: p.operatingStatus.value,
        checkedAt: p.operatingStatus.checkedAt, note: null};
    }
    if (!validPlace(logical)) fail("wire logical fields");
    previous = p.key;
    const a = arraySize(provenanceRefs, evidenceSizes, 500, cap),
      b = arraySize(locRefs, evidenceSizes, 500, cap);
    let size = bytes(p) - bytes(provenanceRefs) - bytes(locRefs) - 8;
    let review, links, note;
    if (v3) {
      note = p.operatingStatus.noteRef;
      if (note !== null && !int(note, textSizes.length - 1))
        fail("invalid note reference");
      review = arraySize(p.reviewNoteRefs, textSizes, 500, cap);
      links = arraySize(p.linkRefs, linkSizes, 100, cap);
      size -= bytes(p.reviewNoteRefs) + bytes(p.linkRefs) + bytes(note) + 9;
    }
    // Subtract every packed field first: subsequent additions are monotonic,
    // including cases where a multi-digit reference is longer than empty text.
    size = checkedAdd(size, 0, cap);
    size = checkedAdd(size, a, cap);
    size = checkedAdd(size, b, cap);
    if (v3) {
      size = checkedAdd(size, review, cap);
      size = checkedAdd(size, links, cap);
      size = checkedAdd(size, note === null ? 4 : textSizes[note], cap);
    }
    n = checkedAdd(n, size + (i ? 1 : 0), cap);
  }
  if (n !== d.expandedBytes) fail("expanded byte mismatch");
  return n;
}
export async function hydrateChunk(c, d, m) {
  preflightChunk(c, d, m);
  const places = c.places.map((wire) => {
    const p = structuredClone(wire), refs = p.provenanceRefs,
      locRefs = p.location.provenanceRefs;
    delete p.provenanceRefs; delete p.location.provenanceRefs;
    p.provenance = refs.map((i) => ({...c.evidence[i]}));
    p.location.provenance = locRefs.map((i) => ({...c.evidence[i]}));
    if (c.schemaVersion === 3) {
      const review = p.reviewNoteRefs, links = p.linkRefs,
        note = p.operatingStatus.noteRef;
      delete p.reviewNoteRefs; delete p.linkRefs; delete p.operatingStatus.noteRef;
      p.reviewNotes = review.map((i) => c.texts[i]);
      p.links = links.map((i) => ({...c.links[i]}));
      p.operatingStatus.note = note === null ? null : c.texts[note];
    }
    return p;
  });
  const feed = makeFeed(m.source, m.generatedAt, places, d.feedDatasetVersion);
  if (bytes(feed) + 1 !== d.expandedBytes) fail("hydrated byte mismatch");
  return verifyFeed(feed);
}
export async function loadBundle(
  url,
  { fetcher = fetch, expected = null } = {},
) {
  const root = new URL("./", url),
    manifestData = await readBounded(url, LIMITS.manifest, expected, fetcher),
    m = await validateManifest(parseJSON(manifestData.text));
  const get = (d, limit) =>
    readBounded(new URL(d.path, root), limit, d, fetcher);
  const records = [];
  let cursor = 0,
    stopped = false;
  const jobs = await Promise.allSettled(
    [0, 1].map(async () => {
      try {
        while (!stopped && cursor < m.chunks.length) {
          const i = cursor++,
            d = m.chunks[i];
          const c = parseJSON((await get(d, LIMITS.chunk)).text);
          records[i] = (await hydrateChunk(c, d, m)).places;
        }
      } catch (e) {
        stopped = true;
        throw e;
      }
    }),
  );
  const failure = jobs.find((j) => j.status === "rejected");
  if (failure) throw failure.reason;
  const places = records.flat().sort((a, b) => byteOrder(a.key, b.key));
  const feed = makeFeed(
    m.source,
    m.generatedAt,
    places,
    m.logicalDatasetVersion,
  );
  if (bytes(feed) + 1 !== m.expandedBytes) fail("logical size");
  await verifyFeed(feed);
  const aliases = parseJSON((await get(m.aliases, LIMITS.aliases)).text);
  // Imported lazily to keep identity helpers usable without a network loader.
  const { validateAliases } = await import("./shopping-aliases.js");
  validateAliases(aliases, feed);
  const inputs = parseJSON((await get(m.inputs, LIMITS.ancillary)).text);
  if (
    !exact(inputs, ["schemaVersion", "kind", "files", "derivation"]) ||
    inputs.schemaVersion !== 1 ||
    inputs.kind !== "shopping-inputs" ||
    typeof inputs.derivation !== "string" ||
    inputs.derivation.length > 2000 ||
    !Array.isArray(inputs.files) ||
    inputs.files.length > 10000 ||
    !inputs.files.every(
      (f) =>
        exact(f, ["path", "sha256", "bytes", "datasetVersion"]) &&
        typeof f.path === "string" &&
        f.path.length <= 2000 &&
        !f.path.startsWith("/") &&
        !f.path.includes("..") &&
        hash(f.sha256) &&
        int(f.bytes, Number.MAX_SAFE_INTEGER, 1) &&
        version(f.datasetVersion),
    ) ||
    new Set(inputs.files.map((f) => f.path)).size !== inputs.files.length
  )
    fail("input inventory");
  const index = parseJSON((await get(m.licenses.index, LIMITS.ancillary)).text);
  if (
    !exact(index, [
      "schemaVersion",
      "kind",
      "attribution",
      "files",
      "sourceToNoticePath",
    ]) ||
    index.schemaVersion !== 1 ||
    index.kind !== "shopping-license-index" ||
    index.attribution !== m.source.attribution ||
    canonical(index.files) !== canonical(m.licenses.files) ||
    !m.licenses.files.some((d) => d.path === index.sourceToNoticePath)
  )
    fail("notice inventory");
  const notices = {};
  for (const d of m.licenses.files) {
    const text = (await get(d, LIMITS.ancillary)).text;
    if (text.length > 40000) fail("notice text limit");
    notices[
      "shopping:overture-" +
        m.logicalDatasetVersion +
        "-" +
        d.path.split("/").at(-1)
    ] = text;
  }
  return {
    feed,
    aliases,
    notices,
    manifest: m,
    manifestBytes: manifestData.bytes,
    offerRoot: root.href,
  };
}
