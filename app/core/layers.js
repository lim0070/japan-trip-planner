import { discoveryView } from "./shopping-aliases.js";
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
const keyMaps = new WeakMap();
function byKey(feed) {
  let m = keyMaps.get(feed);
  if (!m) keyMaps.set(feed, (m = new Map(feed.places.map((p) => [p.key, p]))));
  return m;
}
export function combineLayers(
  feeds,
  visibility,
  filters,
  origins,
  scheduled,
  flags,
  aliases = new Map(),
) {
  const rows = [],
    unknown = [],
    counts = {},
    sourceCounts = {};
  for (const [sourceKey, f] of Object.entries(feeds)) {
    const layer = layerId(f.source.namespace);
    if (!visibility[layer]) continue;
    const settings = filters[sourceKey] || filters[f.source.namespace];
    const packageId = sourceKey === "shopping:osm" ? "osm" : "overture";
    if (
      layer === "shopping" &&
      settings.packageVisibility?.[packageId] === false
    )
      continue;
    const view =
      f.source.namespace === "shopping"
        ? discoveryView(
            f,
            flags,
            scheduled,
            packageId === "osm" ? new Map() : aliases,
          )
        : { feed: f, flags, scheduled };
    const result = filterPlaces(
      view.feed,
      settings,
      origins,
      view.scheduled,
      view.flags,
      f.source.namespace === "shopping"
        ? {
            aliases: packageId === "osm" ? new Map() : aliases,
            places: byKey(f),
          }
        : {},
    );
    sourceCounts[sourceKey] = {
      located: result.rows.length,
      unknown: result.unknown.length,
    };
    counts[layer] = {
      located: (counts[layer]?.located || 0) + result.rows.length,
      unknown: (counts[layer]?.unknown || 0) + result.unknown.length,
    };
    rows.push(...result.rows);
    unknown.push(...result.unknown);
  }
  const byRank = (a, b) => (a.rank ?? 0) - (b.rank ?? 0);
  rows.sort((a, b) => byRank(a, b) || (a.km ?? Infinity) - (b.km ?? Infinity));
  unknown.sort(byRank);
  return { rows, unknown, counts, sourceCounts };
}

// Earlier saved preferences may omit Shopping. Only explicit booleans override defaults.
export function layerPreferences(saved) {
  return Object.fromEntries(
    ["sauna", "food", "shopping"].map((id) => [
      id,
      saved && typeof saved[id] === "boolean" ? saved[id] : true,
    ]),
  );
}
