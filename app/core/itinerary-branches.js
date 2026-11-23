import { brands } from "./shopping-catalog.js";
import { distance, located, visitDestination } from "./model.js";
import { fold, placeMatcher, RANK } from "./place-search.js";

// Store names already used by the Shopping catalogue.
const alternate = {
  workman:["ワークマン", "WORKMAN Colors", "WORKMAN Plus"], uniqlo:["ユニクロ"],
  gu:["ジーユー"], "global-work":["グローバルワーク"], shimamura:["しまむら"],
  avail:["アベイル"], birthday:["バースデイ"], chambre:["シャンブル"], divalo:["ディバロ"],
  paseos:["パシオス"], costco:["コストコ"], lopia:["ロピア"], nitori:["ニトリ"],
  hands:["Hands", "Tokyu Hands", "ハンズ"], "life-supermarket":["ライフスーパー"],
};
const labels = Object.entries(brands).flatMap(([id,label]) =>
  [label,...(alternate[id] ?? [])].map(name => ({id,label,name:fold(name)})));

export function suggestedBrands(text) {
  const query = fold(text);
  const matched = new Map();
  for (const { id, label, name } of labels) {
    const latin = /^[a-z0-9 ]+$/u.test(name);
    const keyword = name.replace(/[.*+?^$\x7b\x7d()|[\]\\]/g, "\\$&");
    if (latin ? new RegExp(`(?:^|[^a-z0-9])${keyword}(?:$|[^a-z0-9])`, "u").test(query) : query.includes(name))
      matched.set(id, label);
  }
  return [...matched.values()];
}

export function branchOrigins(state, tripId, dayId = "") {
  const stops = new Map(state.stops.map(stop => [stop.id, stop]));
  const days = state.days.filter(day => day.tripId === tripId && (!dayId || day.id === dayId));
  return days.flatMap(day => [
    day.planStartAnchor?.place,
    ...day.stopIds.map(id => visitDestination(stops.get(id))),
    day.planEndAnchor?.place,
  ].filter(Boolean).map(place => ({day, place})));
}

export function itineraryBranches(catalogue, origins, query, radius, aliases = new Map()) {
  const term = fold(query).trim();
  const selectedBrand = labels.find(row => row.name === term)?.id;
  const matcher = placeMatcher(query);
  const originPoints = origins.filter(({place}) => located(place));
  const prefectures = new Set(origins.map(({place}) => fold(place.address.prefecture || "")).filter(Boolean));
  const cities = new Set(origins.map(({place}) => fold(place.address.city || "")).filter(Boolean));
  const groups = new Map();
  for (const place of catalogue) {
    const rank = selectedBrand ? -1 : matcher?.(place) ?? -1;
    if (!place.shopping || ["closed","relocated"].includes(place.operatingStatus.value) ||
        (selectedBrand ? place.shopping.brandId !== selectedBrand : rank < 0 || rank > RANK.aliasOrBrand)) continue;
    const key = aliases.get(place.key)?.groupId ?? place.key;
    const site = located(place);
    let nearest = null;
    if (site) for (const origin of originPoints) {
      const km = distance(place.location, origin.place.location);
      if (!nearest || km < nearest.km) nearest = { ...origin, km };
    }
    const sameArea = prefectures.has(fold(place.address.prefecture || "")) || cities.has(fold(place.address.city || ""));
    const previous = groups.get(key);
    if (!previous || (nearest?.km ?? Infinity) < (previous.nearest?.km ?? Infinity))
      groups.set(key,{place,nearest,sameArea,site});
  }
  return { total:groups.size, originCount:originPoints.length,
    ranked:[...groups.values()].filter(row => row.nearest?.km <= radius).sort((a,b) => a.nearest.km-b.nearest.km),
    addressOnly:[...groups.values()].filter(row => !row.site && row.sameArea) };
}
