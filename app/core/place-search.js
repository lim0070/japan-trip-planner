// One place matcher for Discover and Saved Spots.
// It only compares text the data already holds: every stored name, every
// address part, a Shopping place's brand display name and the names of the
// other records in its confirmed alias group. It never invents readings,
// translations or romanizations.
import { brands } from "./shopping-catalog.js";

// Spaces, middle dots and similar separators are ignored.
const SEP = /[\s·•‧∙⋅・･、，,/]+/gu;

// Fold text for comparison: full/half width (NFKC), case, katakana to
// hiragana, and separate or combining voicing marks composed onto the kana
// before them. A missing voicing mark is never added or dropped, so ウェルヒー
// stays different from ウェルビー.
export function fold(text) {
  return String(text ?? "")
    .replace(/゛/g, "゙")
    .replace(/゜/g, "゚")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶヽヾ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[‐-―−]/g, "-");
}
const compact = (text) => fold(text).replace(SEP, "");
export const terms = (query) => fold(query).split(SEP).filter(Boolean);

// Ranks: lower is better. -1 means no match.
export const RANK = {
  nameExact: 0,
  namePrefix: 1,
  nameContains: 2,
  aliasOrBrand: 3,
  address: 4,
};

const strings = (o) =>
  Object.values(o || {}).filter((v) => typeof v === "string" && v.trim());
const fieldCache = new WeakMap(),
  groupCache = new WeakMap();
function fields(p) {
  let f = fieldCache.get(p);
  if (!f) {
    const brandId = p.shopping?.brandId;
    f = {
      names: strings(p.names).map(compact).filter(Boolean),
      brand:
        brandId && Object.hasOwn(brands, brandId)
          ? [compact(brands[brandId])].filter(Boolean)
          : [],
      address: strings(p.address).map(compact).filter(Boolean),
    };
    fieldCache.set(p, f);
  }
  return f;
}
function aliasNames(p, aliases, places) {
  const g = aliases?.get?.(p.key);
  if (!g || !places?.get) return [];
  let hit = groupCache.get(g);
  if (!hit || hit.places !== places) {
    hit = { places, names: [] };
    for (const key of g.memberKeys || []) {
      const member = places.get(key);
      if (member) hit.names.push(...fields(member).names);
    }
    groupCache.set(g, hit);
  }
  return hit.names;
}
function tier(t, f, alias) {
  let best = -1;
  for (const n of f.names) {
    if (n === t) return RANK.nameExact;
    if (n.startsWith(t)) best = RANK.namePrefix;
    else if (best < 0 && n.includes(t)) best = RANK.nameContains;
  }
  if (best >= 0) return best;
  if (f.brand.some((n) => n.includes(t)) || alias.some((n) => n.includes(t)))
    return RANK.aliasOrBrand;
  if (f.address.some((n) => n.includes(t))) return RANK.address;
  return -1;
}

// Returns null for an empty query (no text filter), otherwise a function
// place -> rank (-1 when the place does not match). Every query term must be
// found in one field of the same place; different terms may use different
// fields of that place.
// context.aliases: Map placeKey -> confirmed alias group ({ memberKeys }).
// context.places: Map placeKey -> place, used to read the members' names.
export function placeMatcher(query, context = {}) {
  const ts = terms(query);
  if (!ts.length) return null;
  const whole = ts.join("");
  return (p) => {
    if (!p) return -1;
    const f = fields(p),
      alias = aliasNames(p, context.aliases, context.places);
    let worst = 0;
    for (const t of ts) {
      const r = tier(t, f, alias);
      if (r < 0) return -1;
      worst = Math.max(worst, r);
    }
    if (ts.length === 1) return worst;
    const w = tier(whole, f, alias);
    return w >= 0 ? Math.min(w, worst) : worst;
  };
}
