// One place matcher for Discover and Saved Spots.
// It only compares text the data already holds: every stored name, every
// address part, a Shopping place's brand, its confirmed alias names and any
// reading the user saved. It never invents readings or translations.
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
  typo: 5,
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
function tier(t, f, alias, savedRomaji) {
  let best = -1;
  for (const n of f.names) {
    if (n === t) return RANK.nameExact;
    if (n.startsWith(t)) best = RANK.namePrefix;
    else if (best < 0 && n.includes(t)) best = RANK.nameContains;
  }
  if (best >= 0) return best;
  if (savedRomaji?.includes(t) || f.brand.some((n) => n.includes(t)) || alias.some((n) => n.includes(t)))
    return RANK.aliasOrBrand;
  if (f.address.some((n) => n.includes(t))) return RANK.address;
  return -1;
}

// Opt-in tolerance is limited to one edit or neighboring transposition in
// a Latin name. Different kana, addresses and unseen readings stay distinct.
function latinWord(value, minimum) {
  if (value.length < minimum || value.length > 80 || !/^\p{Script=Latin}+$/u.test(value)) return null;
  const letters = [...value];
  return letters.length >= minimum ? letters : null;
}

function latinNames(names) {
  const words = new Set();
  for (const name of names) {
    words.add(compact(name));
    for (const term of terms(name)) words.add(term);
  }
  return [...words].map(word => latinWord(word, 3)).filter(Boolean);
}

function oneTypo(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (i === a.length) return false;
    return a.slice(i + 1).join("") === b.slice(i + 1).join("") ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] &&
       a.slice(i + 2).join("") === b.slice(i + 2).join(""));
  }
  return a.length < b.length
    ? a.slice(i).join("") === b.slice(i + 1).join("")
    : a.slice(i + 1).join("") === b.slice(i).join("");
}

// Returns null for an empty query (no text filter), otherwise a function
// place -> rank (-1 when the place does not match). Every query term must be
// found in one field of the same place; different terms may use different
// fields of that place.
// context.aliases: Map placeKey -> confirmed alias group ({ memberKeys }).
// context.places: Map placeKey -> place, used to read the members' names.
// context.romajiByKey: Map placeKey -> a user-supplied stored romaji reading.
// context.allowTypos: true to suggest lower-ranked, one-typo Latin matches.
export function placeMatcher(query, context = {}) {
  const ts = terms(query);
  if (!ts.length) return null;
  const whole = ts.join("");
  const approximate = context.allowTypos === true ? ts.map(term => latinWord(term, 4)) : [];
  return (p) => {
    if (!p) return -1;
    const f = fields(p),
      alias = aliasNames(p, context.aliases, context.places),
      userRomaji = context.romajiByKey?.get(p.key),
      savedRomaji = userRomaji ? compact(userRomaji) : null;
    let worst = 0;
    let missing = null;
    for (const [i, t] of ts.entries()) {
      const r = tier(t, f, alias, savedRomaji);
      if (r < 0) {
        if (missing || !approximate[i]) return -1;
        missing = approximate[i];
      } else worst = Math.max(worst, r);
    }
    if (missing) {
      f.latinNames ??= latinNames(strings(p.names));
      const couldBe = name => oneTypo(missing, name);
      return f.latinNames.some(couldBe) ||
        (userRomaji && latinNames([userRomaji]).some(couldBe)) ||
        alias.some(name => {
          const letters = latinWord(name, 3);
          return letters && couldBe(letters);
        }) ? RANK.typo : -1;
    }
    if (ts.length === 1) return worst;
    const w = tier(whole, f, alias, savedRomaji);
    return w >= 0 ? Math.min(w, worst) : worst;
  };
}
