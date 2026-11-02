import { filterPlaces } from "./model.js";
export const layerId = (ns) =>
  ({ saunachelin: "sauna", tabelog: "food", shopping: "shopping" })[ns];
export const brands = {
  "outlet-mall": "Outlet malls",
  gu: "GU",
  uniqlo: "UNIQLO",
  "global-work": "GLOBAL WORK",
  workman: "WORKMAN",
  shimamura: "Shimamura",
  avail: "Avail",
  birthday: "Birthday",
  chambre: "Chambre",
  divalo: "Divalo",
};
export const formats = {
  standard: "Standard",
  workman: "WORKMAN",
  "workman-plus": "WORKMAN Plus",
  "workman-colors": "WORKMAN Colors",
  "workman-girl": "WORKMAN Girl",
  "workman-pro": "WORKMAN Pro",
};
export function badge(p) {
  if (!p.shopping) return p.key.startsWith("saunachelin:") ? "♨" : "食";
  return p.shopping.brandId === "workman"
    ? {
        workman: "W",
        "workman-plus": "W+",
        "workman-colors": "C",
        "workman-girl": "G",
        "workman-pro": "PRO",
      }[p.shopping.formatId] || "W"
    : {
        "outlet-mall": "OUT",
        gu: "GU",
        uniqlo: "U",
        "global-work": "GW",
        shimamura: "S",
        avail: "AV",
        birthday: "B",
        chambre: "CH",
        divalo: "D",
      }[p.shopping.brandId] || "SHOP";
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
