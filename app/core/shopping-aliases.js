import { flag } from "./model.js";
import { validEvidence, guardTree } from "./contracts.js";
const exact = (o, ks) =>
  o &&
  typeof o === "object" &&
  !Array.isArray(o) &&
  Object.keys(o).length === ks.length &&
  ks.every((k) => Object.hasOwn(o, k));
const str = (s) =>
  typeof s === "string" && s.trim().length > 0 && s.length <= 2000;
const stamp = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s) &&
  Number.isFinite(Date.parse(s));
const fail = () => {
  throw Error("Invalid shopping discovery aliases.");
};
export function validateAliases(a, feed, previous = emptyAliases()) {
  guardTree(a);
  if (
    !exact(a, ["schemaVersion", "kind", "sourceNamespace", "groups"]) ||
    a.schemaVersion !== 1 ||
    a.kind !== "shopping-discovery-aliases" ||
    a.sourceNamespace !== "shopping" ||
    !Array.isArray(a.groups) ||
    a.groups.length > 10000
  )
    fail();
  const places = new Map(feed.places.map((p) => [p.key, p])),
    keys = new Set(places.keys()),
    seen = new Set(),
    ids = new Set();
  for (const g of a.groups) {
    if (
      !exact(g, [
        "groupId",
        "operatorId",
        "nativeBranchId",
        "primaryKey",
        "memberKeys",
        "confirmedAt",
        "evidence",
      ]) ||
      ![g.groupId, g.operatorId, g.nativeBranchId, g.primaryKey].every(str) ||
      ids.has(g.groupId) ||
      !stamp(g.confirmedAt) ||
      !Array.isArray(g.memberKeys) ||
      g.memberKeys.length < 2 ||
      g.memberKeys.length > 500 ||
      !g.memberKeys.includes(g.primaryKey) ||
      !Array.isArray(g.evidence) ||
      g.evidence.length !== g.memberKeys.length
    )
      fail();
    const oldGroups = previous.groups.filter(
      (old) =>
        old.groupId === g.groupId ||
        (old.operatorId === g.operatorId &&
          old.nativeBranchId === g.nativeBranchId &&
          old.memberKeys.some((key) => g.memberKeys.includes(key))),
    );
    if (oldGroups.some((old) => old.primaryKey !== g.primaryKey)) fail();
    ids.add(g.groupId);
    const evidenceKeys = new Set();
    for (const key of g.memberKeys) {
      if (!keys.has(key) || !key.startsWith("shopping:") || seen.has(key))
        fail();
      seen.add(key);
    }
    if (
      new Set(g.memberKeys.map((k) => places.get(k).shopping.brandId)).size !==
      1
    )
      fail();
    const cmp = (a, b) => {
      const x = new TextEncoder().encode(a),
        y = new TextEncoder().encode(b);
      for (let i = 0; i < Math.min(x.length, y.length); i++)
        if (x[i] !== y[i]) return x[i] - y[i];
      return x.length - y.length;
    };
    if (g.memberKeys.some((k, i) => i && cmp(g.memberKeys[i - 1], k) >= 0))
      fail();
    for (const e of g.evidence) {
      if (
        !exact(e, ["memberKey", "records"]) ||
        !g.memberKeys.includes(e.memberKey) ||
        evidenceKeys.has(e.memberKey) ||
        !Array.isArray(e.records) ||
        !e.records.length ||
        e.records.length > 500 ||
        !e.records.every(validEvidence) ||
        !e.records.some(
          (r) =>
            r.observedAt &&
            r.url &&
            r.sourceKind === "official" &&
            r.field === "identity",
        )
      )
        fail();
      evidenceKeys.add(e.memberKey);
    }
  }
  return a;
}
export const emptyAliases = () => ({
  schemaVersion: 1,
  kind: "shopping-discovery-aliases",
  sourceNamespace: "shopping",
  groups: [],
});
export function aliasIndex(aliases) {
  const index = new Map();
  for (const g of aliases.groups)
    for (const key of g.memberKeys) index.set(key, g);
  return index;
}
export function effectiveFlag(flags, key, index = new Map()) {
  const keys = new Set(index.get(key)?.memberKeys || [key]);
  const rows = flags.filter((f) => keys.has(f.placeKey));
  return {
    placeKey: key,
    favourite: rows.some((f) => f.favourite),
    visited: rows.some((f) => f.visited),
  };
}
export function discoveryView(feed, flags, scheduled, index = new Map()) {
  const ps = feed.places.filter(
      (p) => !index.has(p.key) || index.get(p.key).primaryKey === p.key,
    ),
    ss = new Set(scheduled),
    ff = [...flags];
  for (const g of new Set(index.values())) {
    if (g.memberKeys.some((k) => scheduled.has(k))) ss.add(g.primaryKey);
    const f = effectiveFlag(flags, g.primaryKey, index);
    const i = ff.findIndex((x) => x.placeKey === g.primaryKey);
    if (i < 0) ff.push(f);
    else ff[i] = { ...ff[i], ...f };
  }
  return { feed: { ...feed, places: ps }, flags: ff, scheduled: ss };
}

export function setBranchFlag(state, key, field, value, index = new Map()) {
  if (!["favourite", "visited"].includes(field) || typeof value !== "boolean")
    throw Error("Invalid branch flag");
  for (const member of index.get(key)?.memberKeys || [key])
    flag(state, member, field, value);
}
