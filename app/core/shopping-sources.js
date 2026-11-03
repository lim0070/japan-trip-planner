import { bytes, readBounded, byteOrder } from "./shopping-bundle.js";
import { parseJSON, digest, verifyFeed } from "./contracts.js";
import { emptyAliases } from "./shopping-aliases.js";
export const GLOBAL = {
  records: 20000,
  expanded: 32 * 1024 * 1024,
  wire: 24 * 1024 * 1024,
  derivative: 4 * 1024 * 1024,
  ancillary: 2 * 1024 * 1024,
  storage: 96 * 1024 * 1024,
};
const exact = (o, ks) =>
  o &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  Object.keys(o).length === ks.length &&
  ks.every((k) => Object.hasOwn(o, k));
const int = (v, max, min = 0) =>
  Number.isSafeInteger(v) && v >= min && v <= max;
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const sha = (v) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
export const safePath = (p) =>
  typeof p === "string" &&
  p.length <= 200 &&
  /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(p) &&
  !p.split("/").some((x) => x.includes(".."));
const descriptor = (d, max) =>
  exact(d, ["path", "sha256", "bytes"]) &&
  safePath(d.path) &&
  hex(d.sha256) &&
  int(d.bytes, max, 1);
const stamp = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d\d-\d\dT/.test(s) &&
  Number.isFinite(Date.parse(s));
const fail = (m) => {
  throw Error("Shopping sources: " + m);
};
export function checkTotals(metrics) {
  for (const field of [
    "records",
    "expanded",
    "wire",
    "derivative",
    "ancillary",
  ]) {
    if (metrics.some((m) => !int(m[field] ?? 0, GLOBAL[field])))
      fail(field + " metrics");
    if (metrics.reduce((n, m) => n + (m[field] || 0), 0) > GLOBAL[field])
      fail(field + " aggregate limit");
  }
}
export function packageMetrics(pkg) {
  if (pkg.metrics) return pkg.metrics;
  const m = pkg.manifest;
  return {
    records: pkg.feed.places.length,
    expanded: bytes(pkg.feed) + 1,
    wire: m ? m.chunks.reduce((n, d) => n + d.bytes, 0) : bytes(pkg.feed) + 1,
    derivative: 0,
    ancillary: m
      ? (pkg.manifestBytes || bytes(m) + 1) +
        m.aliases.bytes +
        m.inputs.bytes +
        m.licenses.index.bytes +
        m.licenses.files.reduce((n, d) => n + d.bytes, 0)
      : bytes(pkg.notices),
  };
}
export async function validateRegistry(r) {
  if (
    !exact(r, [
      "schemaVersion",
      "kind",
      "generation",
      "generatedAt",
      "datasetVersion",
      "packages",
    ]) ||
    r.schemaVersion !== 1 ||
    r.kind !== "shopping-source-registry" ||
    !stamp(r.generatedAt) ||
    !int(r.generation, Number.MAX_SAFE_INTEGER, 1) ||
    !sha(r.datasetVersion) ||
    !Array.isArray(r.packages) ||
    r.packages.length !== 2
  )
    fail("registry shape");
  for (const [i, p] of r.packages.entries())
    if (
      !exact(p, ["id", "path", "sha256", "bytes", "metrics"]) ||
      p.id !== ["overture", "osm"][i] ||
      !safePath(p.path) ||
      !hex(p.sha256) ||
      !int(p.bytes, 128 * 1024, 1) ||
      !exact(p.metrics, [
        "records",
        "expanded",
        "wire",
        "derivative",
        "ancillary",
      ]) ||
      !Object.entries(p.metrics).every(([k, v]) =>
        int(v, GLOBAL[k], k === "derivative" ? 0 : 1),
      )
    )
      fail("package descriptor");
  if (r.packages[0].path === r.packages[1].path) fail("package paths");
  checkTotals([...r.packages.map((p) => p.metrics), { ancillary: 128 * 1024 }]);
  const { datasetVersion, generatedAt, ...content } = r;
  if ((await digest(content)) !== datasetVersion) fail("registry checksum");
  return r;
}
export async function readRegistry(url, fetcher = fetch) {
  return validateRegistry(
    parseJSON((await readBounded(url, 128 * 1024, null, fetcher)).text),
  );
}
export async function loadOSM(url, { fetcher = fetch, expected = null } = {}) {
  const root = new URL("./", url),
    raw = await readBounded(url, 128 * 1024, expected, fetcher),
    m = parseJSON(raw.text);
  if (
    !exact(m, [
      "schemaVersion",
      "kind",
      "license",
      "generatedAt",
      "feedDatasetVersion",
      "sourceExtract",
      "files",
      "datasetVersion",
    ]) ||
    m.schemaVersion !== 1 ||
    m.kind !== "shopping-osm-package" ||
    m.license !== "ODbL-1.0" ||
    !stamp(m.generatedAt) ||
    !sha(m.datasetVersion) ||
    !sha(m.feedDatasetVersion) ||
    !Array.isArray(m.files) ||
    m.files.length < 7 ||
    m.files.length > 32 ||
    !m.files.every((d) => descriptor(d, 8 * 1024 * 1024)) ||
    new Set(m.files.map((d) => d.path)).size !== m.files.length
  )
    fail("OSM inventory");
  if (
    !exact(m.sourceExtract, ["url", "bytes", "md5", "dataTimestamp"]) ||
    typeof m.sourceExtract.url !== "string" ||
    !m.sourceExtract.url.startsWith("https://download.geofabrik.de/") ||
    !int(m.sourceExtract.bytes, Number.MAX_SAFE_INTEGER, 1) ||
    !/^[a-f0-9]{32}$/.test(m.sourceExtract.md5) ||
    !Number.isFinite(Date.parse(m.sourceExtract.dataTimestamp))
  )
    fail("extract metadata");
  // OSM inventory binds generatedAt. V1 feeds/v2 Overture manifests exclude it.
  const { datasetVersion, ...content } = m;
  if ((await digest(content)) !== datasetVersion)
    fail("OSM inventory checksum");
  const byPath = new Map(m.files.map((d) => [d.path, d])),
    fd = byPath.get("shopping-osm.v1.json"),
    dd = byPath.get("osm-derivative.v1.json");
  for (const p of [
    "ODbL-1.0.txt",
    "ATTRIBUTION.txt",
    "source-and-modifications.json",
    "extract.meta.json",
    "coverage.json",
  ])
    if (!byPath.has(p)) fail("missing OSM resource");
  if (!fd || !dd || dd.bytes > GLOBAL.derivative) fail("OSM feed/derivative");
  const metrics = {
    records: 0,
    expanded: 0,
    wire: fd.bytes,
    derivative: dd.bytes,
    ancillary:
      raw.bytes +
      m.files
        .filter((d) => d !== fd && d !== dd)
        .reduce((n, d) => n + d.bytes, 0),
  };
  if (metrics.ancillary > GLOBAL.ancillary) fail("OSM ancillary limit");
  const resources = {};
  let feed;
  for (const d of m.files) {
    const r = await readBounded(
      new URL(d.path, root),
      d === fd
        ? 8 * 1024 * 1024
        : d === dd
          ? GLOBAL.derivative
          : GLOBAL.ancillary,
      d,
      fetcher,
    );
    if (d === fd) feed = await verifyFeed(parseJSON(r.text));
    else resources[d.path] = r.text;
  }
  if (
    feed.source.namespace !== "shopping" ||
    feed.datasetVersion !== m.feedDatasetVersion ||
    !feed.places.every(
      (p) =>
        /^shopping:osm:(node|way|relation):\d+$/.test(p.key) &&
        [...p.provenance, ...p.location.provenance].every(
          (e) => e.sourceKind === "openstreetmap",
        ),
    )
  )
    fail("OSM source boundary");
  const derivative = parseJSON(resources["osm-derivative.v1.json"]);
  if (!Array.isArray(derivative) || derivative.length > 20000)
    fail("derivative shape");
  const mod = parseJSON(resources["source-and-modifications.json"]);
  if (
    mod.license !== "ODbL-1.0" ||
    mod.sourceMd5 !== m.sourceExtract.md5 ||
    mod.machineReadableDerivative !== "osm-derivative.v1.json" ||
    mod.dataAccess?.path !== dd.path ||
    mod.dataAccess.sha256 !== dd.sha256 ||
    mod.dataAccess.bytes !== dd.bytes ||
    !Array.isArray(mod.algorithmFiles) ||
    !mod.algorithmFiles.length ||
    !mod.algorithmFiles.every(
      (p) => byPath.has(p) && p.startsWith("algorithms/"),
    )
  )
    fail("OSM source offer");
  metrics.records = feed.places.length;
  metrics.expanded = bytes(feed) + 1;
  checkTotals([metrics]);
  const offer = `OpenStreetMap source component (${feed.datasetVersion}), under ODbL1.0. Complete immutable source package: ${new URL("package-inventory.v1.json", root).href}\nComplete selected derivative: ${new URL(dd.path, root).href}\nSHA256 ${dd.sha256}; ${dd.bytes} bytes. Source snapshots and this component retain ODbL; user trip notes are separate. Offline source-complete exports include the bound files under their own package directory.`;
  const notices = {};
  for (const name of [
    "ODbL-1.0.txt",
    "ATTRIBUTION.txt",
    "source-and-modifications.json",
  ]) {
    if (resources[name].length > 40000) fail("notice text limit");
    notices["shopping:osm-" + feed.datasetVersion + "-" + name] =
      resources[name];
  }
  notices["shopping:osm-" + feed.datasetVersion + "-SOURCE-DOWNLOAD.txt"] =
    offer;
  return {
    feed,
    manifest: m,
    aliases: emptyAliases(),
    notices,
    resources,
    inventoryText: raw.text,
    metrics,
    offerRoot: root.href,
  };
}
export const isOSM = (p) => p.key.startsWith("shopping:osm:");
export function shoppingPreferences(saved) {
  return {
    overture: typeof saved?.overture === "boolean" ? saved.overture : true,
    osm: typeof saved?.osm === "boolean" ? saved.osm : true,
  };
}
export function preserveSourceVersions(previous, feeds) {
  return {
    ...previous,
    ...Object.fromEntries(
      Object.entries(feeds).map(([id, f]) => [
        id === "shopping:osm" ? "shopping:osm" : f.source.namespace,
        f.datasetVersion,
      ]),
    ),
  };
}
