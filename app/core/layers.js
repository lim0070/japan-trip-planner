import { filterPlaces } from "./model.js";
export const layerId = (ns) =>
  ({ saunachelin: "sauna", tabelog: "food", shopping: "shopping" })[ns];
export {
  brands,
  formats,
  shoppingCategories,
  categoryFor,
} from "./shopping-catalog.js";
export function badge(p) {
  if (!p.shopping) return p.key.startsWith("saunachelin:") ? "♨" : "食";
  const workman = {
    workman: "W",
    "workman-plus": "W+",
    "workman-colors": "C",
    "workman-girl": "G",
    "workman-pro": "PRO",
  };
  const other = {
    "outlet-mall": "OUT",
    costco: "CO",
    lopia: "LO",
    "life-supermarket": "LF",
    nitori: "N",
    hands: "H",
    gu: "GU",
    uniqlo: "U",
    "global-work": "GW",
    shimamura: "S",
    avail: "AV",
    birthday: "B",
    chambre: "CH",
    divalo: "D",
  };
  if (p.shopping.brandId === "workman")
    return Object.hasOwn(workman, p.shopping.formatId)
      ? workman[p.shopping.formatId]
      : "W";
  return Object.hasOwn(other, p.shopping.brandId)
    ? other[p.shopping.brandId]
    : "SHOP";
}
export function combineLayers(
  feeds,
  visibility,
  filters,
  origins,
  scheduled,
  flags,
) {
  const rows = [],
    unknown = [],
    counts = {};
  for (const f of Object.values(feeds)) {
    const layer = layerId(f.source.namespace);
    if (!visibility[layer]) continue;
    const result = filterPlaces(
      f,
      filters[f.source.namespace],
      origins,
      scheduled,
      flags,
    );
    counts[layer] = {
      located: result.rows.length,
      unknown: result.unknown.length,
    };
    rows.push(...result.rows);
    unknown.push(...result.unknown);
  }
  rows.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
  return { rows, unknown, counts };
}

// Earlier saved preferences may omit Shopping. Only explicit booleans override defaults.
export function layerPreferences(saved) {
  return Object.fromEntries(["sauna", "food", "shopping"].map(id =>
    [id, saved && typeof saved[id] === "boolean" ? saved[id] : true]));
}
