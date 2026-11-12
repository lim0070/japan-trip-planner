import { dates, segmentKey } from "./model.js";
const fail = (m) => {
  throw Error(m);
};
const obj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const str = (x, max = 2000) => typeof x === "string" && x.length <= max;
const nonempty = (x) => str(x) && x.trim().length > 0;
const identifier = (x) =>
  typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(x);
const bool = (x) => typeof x === "boolean";
const num = (x, min, max) =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const integer = (x, min, max) => Number.isInteger(x) && num(x, min, max);
const one =
  (...values) =>
  (x) =>
    values.includes(x);
const nullable = (v) => (x) => x === null || v(x);
const array =
  (v, max = 20000) =>
  (x) =>
    Array.isArray(x) && x.length <= max && x.every((item) => v(item));
const record = (v) => (x) =>
  obj(x) && Object.values(x).every((item) => v(item));
const shape = (fields) => (x) =>
  obj(x) &&
  Object.keys(x).length === Object.keys(fields).length &&
  Object.entries(fields).every(([k, v]) => Object.hasOwn(x, k) && v(x[k]));
const optionalFields = (base, fields) => (x) => {
  if (!obj(x)) return false;
  const core = { ...x };
  for (const [key, check] of Object.entries(fields)) {
    if (Object.hasOwn(x, key) && !check(x[key])) return false;
    delete core[key];
  }
  return base(core);
};
const date = (x) =>
  str(x) &&
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x + "T00:00:00Z")) &&
  new Date(x + "T00:00:00Z").toISOString().slice(0, 10) === x;
const stamp = (x) =>
  str(x) &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x) &&
  Number.isFinite(Date.parse(x));
const url = (x) => {
  try {
    const u = new URL(x);
    return (
      str(x, 2048) &&
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
};
const ns = nullable(str),
  nd = nullable(date),
  version = one(1),
  minutes = (x) => integer(x, 0, 10080);
const evidence = shape({
  field: nonempty,
  sourceKind: nonempty,
  url: nullable(url),
  observedAt: nullable((x) => date(x) || stamp(x)),
  note: ns,
});
export const validEvidence = evidence;
const interval = shape({
  startMinute: (x) => integer(x, 0, 1439),
  endMinute: (x) => integer(x, 1, 2880),
});
const intervals = (x) =>
  x === null ||
  (array(interval, 48)(x) &&
    x.every(
      (r, i) =>
        r.endMinute > r.startMinute &&
        (i === 0 || r.startMinute >= x[i - 1].endMinute),
    ));
export const validHours = shape({
  schemaVersion: version,
  timeZone: one("Asia/Tokyo"),
  weekly: shape(
    Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((k) => [
        k,
        intervals,
      ]),
    ),
  ),
  exceptions: (x) => record(intervals)(x) && Object.keys(x).every(date),
  checkedAt: nd,
  sourceUrl: nullable(url),
});
const names = shape({ ja: ns, en: ns, romaji: ns, branchJa: ns });
const address = shape({
  ja: ns,
  en: ns,
  prefecture: ns,
  city: ns,
  postalCode: ns,
});
const locShape = shape({
  lat: nullable((x) => num(x, -90, 90)),
  lng: nullable((x) => num(x, -180, 180)),
  availability: one("located", "unknown"),
  confidence: one("high", "medium", "low", "unknown"),
  method: ns,
  provenance: array(evidence, 500),
  verifiedAt: nd,
});
const location = (x) =>
  locShape(x) &&
  (x.lat === null) === (x.lng === null) &&
  (x.availability === "unknown") === (x.lat === null);
const operatingStatus = shape({
  value: one("active", "closed", "relocated", "renamed", "unknown"),
  checkedAt: nd,
  note: ns,
});
const link = shape({
  kind: one("official", "source", "list", "standalone", "navigation", "other"),
  label: str,
  url,
});
export const validLink = link;
const fields = {
  names,
  address,
  category: ns,
  location,
  operatingStatus,
  hoursText: nullable((x) => str(x, 20000)),
  hours: nullable(validHours),
  links: array(link, 100),
  reviewNotes: array(str, 500),
};
const overrides = (x) =>
  obj(x) &&
  Object.entries(x).every(([k, v]) => Object.hasOwn(fields, k) && fields[k](v));
const award = (x) =>
  shape({
    year: nullable((y) => integer(y, 1900, 2200)),
    type: one("ranked", "special", "hall_of_fame"),
    rank: nullable((r) => integer(r, 1, 10000)),
    title: ns,
  })(x) && (x.type === "ranked" ? x.rank !== null : x.rank === null);
const basePlace = shape({
  schemaVersion: version,
  key: nonempty,
  sourceId: nonempty,
  ...fields,
  awards: array(award, 1000),
  memberships: array(
    shape({ listId: nonempty, firstTimePick: nullable(bool) }),
    1000,
  ),
  hallOfFame: nullable(
    shape({ inductedYear: nullable((y) => integer(y, 1900, 2200)) }),
  ),
  provenance: array(evidence, 500),
});
const shoppingMetadata = shape({
  brandId: (x) => typeof x === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x),
  formatId: (x) =>
    typeof x === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x),
});
export const validPlace = (x) => {
  if (!obj(x)) return false;
  const { shopping, ...base } = x;
  return (
    basePlace(base) &&
    (!Object.hasOwn(x, "shopping") || shoppingMetadata(shopping))
  );
};
const sourceRef = shape({
  key: nonempty,
  sourceId: nonempty,
  datasetVersion: nonempty,
});
const local = shape({
  schemaVersion: version,
  id: identifier,
  sourceRef: nullable(sourceRef),
  snapshot: validPlace,
  overrides,
  createdAt: stamp,
  updatedAt: stamp,
});
const flag = shape({
  schemaVersion: version,
  placeKey: nonempty,
  favourite: bool,
  visited: bool,
  updatedAt: nullable(stamp),
});
export const validThresholds = shape({
  dayMinutes: (x) => integer(x, 1, 10080),
  lateFinishMinute: (x) => integer(x, 0, 1439),
  longWalkMinutes: (x) => integer(x, 1, 10080),
  longWalkKm: (x) => num(x, 0.01, 10000),
  longTrainKm: (x) => num(x, 0.01, 10000),
});
const trip = shape({
  schemaVersion: version,
  id: identifier,
  name: nonempty,
  startDate: date,
  endDate: date,
  timeZone: one("Asia/Tokyo"),
  notes: (x) => str(x, 20000),
  dayIds: array(identifier, 366),
  unassignedStopIds: array(identifier),
  thresholds: validThresholds,
  createdAt: stamp,
  updatedAt: stamp,
});
const clockMinute = (x) => integer(x, 0, 1439);
const day = optionalFields(shape({
  schemaVersion: version,
  id: identifier,
  tripId: identifier,
  date,
  startMinute: (x) => integer(x, 0, 1439),
  stopIds: array(identifier),
}), { planEndMinute: clockMinute });
const stopBase = shape({
  schemaVersion: version,
  id: identifier,
  tripId: identifier,
  placeId: identifier,
  placeSnapshot: validPlace,
  placeOverrides: overrides,
  notes: (x) => str(x, 20000),
  durationMinutes: minutes,
});
const stop = optionalFields(stopBase, {
  sourceDatasetVersion: nullable(nonempty),
  planLocked: bool,
  fixedStartMinute: clockMinute,
});
const routeCheck = shape({
  provider: one("google", "jorudan"),
  date,
  departMinute: clockMinute,
  minutes,
  access: minutes,
  egress: minutes,
  endpoints: (x) => str(x, 20000),
});
const segment = optionalFields(shape({
  schemaVersion: version,
  tripId: identifier,
  fromStopId: identifier,
  toStopId: identifier,
  mode: one("walk", "train", "drive"),
  estimatedMinutes: nullable(minutes),
  manualMinutes: nullable(minutes),
  estimateModel: one("rough-v1"),
  coordinateFingerprint: (x) => str(x, 20000),
  overrideFingerprint: nullable((x) => str(x, 20000)),
}), { routeCheck });
const settings = shape({
  theme: one("system", "light", "dark"),
  defaultMode: one("walk", "train", "drive"),
  thresholds: validThresholds,
});
const stateFields = {
  schemaVersion: version,
  trips: array(trip, 100),
  days: array(day, 36600),
  stops: array(stop),
  segments: array(segment, 40000),
  places: array(local),
  flags: array(flag, 100000),
  settings,
  sourceVersions: record(nonempty),
};
export function guardTree(x, depth = 0) {
  if (depth > 32) fail("File is too deeply nested.");
  if (obj(x) || Array.isArray(x))
    for (const [k, v] of Object.entries(x)) {
      if (["__proto__", "constructor", "prototype"].includes(k))
        fail("Unsafe object key.");
      guardTree(v, depth + 1);
    }
}
export function parseJSON(text) {
  if (new TextEncoder().encode(text).length > 20 * 1024 * 1024)
    fail("File exceeds 20 MiB.");
  const x = JSON.parse(text);
  guardTree(x);
  return x;
}
function unique(rows, key = "id") {
  const ids = rows.map((x) => (typeof key === "function" ? key(x) : x[key]));
  if (new Set(ids).size !== ids.length) fail("Duplicate IDs.");
}
const licenseTexts = (x) =>
  record((v) => str(v, 40000))(x) && Object.keys(x).length <= 1000;
export function validateState(s) {
  guardTree(s);
  if (
    !shape({ ...stateFields, imports: record(str) })(
      Object.fromEntries(
        Object.entries(s).filter(([k]) => k !== "dataLicenses"),
      ),
    ) ||
    (Object.hasOwn(s, "dataLicenses") && !licenseTexts(s.dataLicenses))
  )
    fail("Invalid state fields, types or limits.");
  for (const k of ["trips", "days", "stops", "places"]) unique(s[k]);
  unique(s.flags, "placeKey");
  unique(s.segments, segmentKey);
  const ts = new Map(s.trips.map((x) => [x.id, x])),
    ds = new Map(s.days.map((x) => [x.id, x])),
    ss = new Map(s.stops.map((x) => [x.id, x])),
    ps = new Map(s.places.map((x) => [x.id, x]));
  const usedDays = [],
    usedStops = [];
  for (const t of s.trips) {
    if (
      t.startDate > t.endDate ||
      Date.parse(t.endDate) - Date.parse(t.startDate) > 365 * 86400000
    )
      fail("Trip dates must span 1–366 days.");
    const expected = dates(t.startDate, t.endDate);
    if (expected.length !== t.dayIds.length) fail("Missing trip days.");
    t.dayIds.forEach((id, i) => {
      const d = ds.get(id);
      if (!d || d.tripId !== t.id || d.date !== expected[i])
        fail("Invalid day reference.");
      usedDays.push(id);
    });
    for (const id of t.unassignedStopIds) {
      if (ss.get(id)?.tripId !== t.id) fail("Invalid unassigned stop.");
      usedStops.push(id);
    }
  }
  for (const d of s.days) {
    if (!ts.has(d.tripId)) fail("Unknown trip.");
    for (const id of d.stopIds) {
      if (ss.get(id)?.tripId !== d.tripId) fail("Invalid stop reference.");
      usedStops.push(id);
    }
  }
  if (
    usedDays.length !== s.days.length ||
    new Set(usedDays).size !== usedDays.length ||
    usedStops.length !== s.stops.length ||
    new Set(usedStops).size !== usedStops.length
  )
    fail("Duplicate or orphan day/stop.");
  for (const p of s.places) {
    if (
      p.sourceRef &&
      (p.sourceRef.key !== p.snapshot.key ||
        p.sourceRef.sourceId !== p.snapshot.sourceId)
    )
      fail("Source identity mismatch.");
    if (!p.snapshot.key.endsWith(":" + p.snapshot.sourceId))
      fail("Invalid source key.");
  }
  for (const st of s.stops)
    if (!ps.has(st.placeId) || !ts.has(st.tripId))
      fail("Unknown place or trip.");
  const pairs = new Set();
  for (const d of s.days)
    for (let i = 1; i < d.stopIds.length; i++)
      pairs.add(d.tripId + "|" + d.stopIds[i - 1] + "|" + d.stopIds[i]);
  const seen = new Set();
  for (const seg of s.segments) {
    const key = [seg.tripId, seg.fromStopId, seg.toStopId].join("|");
    if (!pairs.has(key) || seen.has(key))
      fail("Invalid or duplicate travel segment.");
    seen.add(key);
    if ((seg.manualMinutes === null) !== (seg.overrideFingerprint === null))
      fail("Invalid manual travel provenance.");
    if (seg.routeCheck) {
      const { provider, minutes, access, egress } = seg.routeCheck;
      if (
        seg.manualMinutes !== minutes + access + egress ||
        (provider === "jorudan" && seg.mode !== "train") ||
        (provider === "google" && (access !== 0 || egress !== 0))
      )
        fail("Invalid checked route.");
    }
  }
  if (seen.size !== pairs.size) fail("Missing travel segments.");
  return s;
}
const list = shape({
  listId: nonempty,
  titleJa: str,
  category: nonempty,
  region: nonempty,
  year: (x) => integer(x, 1900, 2200),
  sourceUrl: url,
  expectedCount: (x) => integer(x, 0, 20000),
  regionDefinition: str,
});
export function validateFeed(f) {
  guardTree(f);
  if (
    !shape({
      schemaVersion: version,
      datasetVersion: nonempty,
      generatedAt: stamp,
      source: shape({
        namespace: one("saunachelin", "tabelog", "shopping"),
        title: nonempty,
        standaloneUrl: nullable(url),
        inputFiles: array(nonempty, 10),
        inputSha256: record((x) => str(x) && /^[0-9a-f]{64}$/.test(x)),
        attribution: str,
      }),
      lists: array(list, 1000),
      places: array(validPlace),
    })(f)
  )
    fail("Source snapshot has invalid fields.");
  unique(f.places, "key");
  unique(f.lists, "listId");
  const ids = new Set(f.lists.map((l) => l.listId));
  for (const p of f.places) {
    if (p.key !== f.source.namespace + ":" + p.sourceId)
      fail("Invalid source identity.");
    if (
      f.source.namespace === "shopping" &&
      (!p.shopping || p.awards.length || p.memberships.length)
    )
      fail("Invalid shopping metadata or award relationships.");
    unique(p.memberships, "listId");
    if (p.memberships.some((m) => !ids.has(m.listId)))
      fail("Missing award list.");
  }
  return f;
}
export const canonical = (x) =>
  Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : obj(x)
      ? "{" +
        Object.keys(x)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(x[k]))
          .join(",") +
        "}"
      : JSON.stringify(x);
export async function digest(x) {
  return (
    "sha256:" +
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(typeof x === "string" ? x : canonical(x)),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}
export async function verifyFeed(f) {
  validateFeed(f);
  const { datasetVersion, generatedAt, ...content } = f;
  if ((await digest(content)) !== datasetVersion)
    fail("Source snapshot checksum failed.");
  return f;
}
export function validateBackup(b) {
  if (
    !shape({
      ...stateFields,
      kind: one("full", "trip"),
      exportId: nonempty,
      exportedAt: stamp,
      appVersion: nonempty,
    })(
      Object.fromEntries(
        Object.entries(b).filter(([k]) => k !== "dataLicenses"),
      ),
    ) ||
    (Object.hasOwn(b, "dataLicenses") && !licenseTexts(b.dataLicenses))
  )
    fail("Unsupported backup version, fields or limits.");
  validateState({
    ...Object.fromEntries(Object.keys(stateFields).map((k) => [k, b[k]])),
    imports: {},
  });
  if (b.kind === "trip" && b.trips.length !== 1)
    fail("Per-trip file must contain one trip.");
  return b;
}
export function validateLegacy(x) {
  guardTree(x);
  if (
    !shape({
      schemaVersion: version,
      kind: one("standalone-flags"),
      source: one("saunachelin", "tabelog"),
      exportedAt: stamp,
      flags: array(
        shape({ sourceId: nonempty, favourite: bool, visited: bool }),
        100000,
      ),
    })(x)
  )
    fail("Invalid standalone flags export.");
  unique(x.flags, "sourceId");
  return x;
}
