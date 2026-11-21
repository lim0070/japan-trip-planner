const japanBounds = [122.9, 24, 154, 45.6]; // lon/lat, including Japan's inhabited islands.

export function googleMapSearch(query) {
  const url = new URL("https://www.google.com/maps/search/");
  url.search = new URLSearchParams({ api: "1", query: query.trim() + ", Japan" });
  return url.href;
}

// Photon is the optional, traveler-triggered online lookup. Never call on input.
export async function photonPlaces(endpoint, query, fetcher = fetch) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw Error("Online lookup is unavailable.");
  url.search = new URLSearchParams({ q: query, bbox: japanBounds.join(","), limit: "8" });
  const response = await fetcher(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error("Online lookup is unavailable.");
  const data = await response.json();
  if (!Array.isArray(data.features)) throw Error("Online lookup returned unreadable results.");
  const results = new Map();
  for (const feature of data.features.slice(0, 8)) {
    const p = feature?.properties;
    const point = feature?.geometry;
    if (p?.countrycode !== "JP" || point?.type !== "Point" || !Array.isArray(point.coordinates)) continue;
    const [lng, lat] = point.coordinates;
    const [west, south, east, north] = japanBounds;
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < west || lng > east || lat < south || lat > north) continue;
    const parts = [p.name, [p.street, p.housenumber].filter(x => typeof x === "string").join(" "),
      p.locality, p.district, p.city, p.state, p.postcode]
      .filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, 120));
    if (!parts.length) continue;
    const label = [...new Set(parts)].join(" · ");
    results.set(lat + "," + lng, { label, lat, lng, source: "photon" });
  }
  return [...results.values()];
}
