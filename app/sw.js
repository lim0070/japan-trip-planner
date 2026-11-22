const PREFIX = "japan-trip-planner-shell-",
  CACHE = PREFIX + "v52";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "main.js",
  "personal-google-map.js",
  "directions-panel.js",
  "core/direction-search.js",
  "core/flower-nagai-data.js",
  "day-tools.js",
  "offline-regions.js",
  "shared-day.html",
  "shared-day.js",
  "core/shared-day.js",
  "vendor/qr-encoder.js",
  "vendor/QR-LICENSE.txt",
  "phone-plan.js",
  "now-mode.js",
  "station-tools.js",
  "station-downloads.js",
  "station-delivery.js",
  "transit-tools.js",
  "calendar-tools.js",
  "nihombashi-event.js",
  "japan-depth.js",
  "core/japan-depth.js",
  "together.js",
  "core/together.js",
  "core/prefecture-map.js",
  "core/yamagata-rail.js",
  "local-planning.js",
  "core/local-planning.js",
  "core/remaining-day.js",
  "core/model.js",
  "core/place-search.js",
  "core/map-stations.js",
  "core/map-lookup.js",
  "core/day-plan.js",
  "core/timetable.js",
  "core/timetable-plan.js",
  "core/planner-timetable.js",
  "core/winter-transit-data.js",
  "core/layers.js",
  "core/layer-choices.js",
  "map-symbols.js",
  "icons/map/cuisine-icons.svg",
  "icons/map/credits.html",
  "icons/map/round/avail.svg",
  "icons/map/round/birthday.svg",
  "icons/map/round/chambre.svg",
  "icons/map/round/costco.png",
  "icons/map/round/divalo.svg",
  "icons/map/round/global-work.svg",
  "icons/map/round/gu.png",
  "icons/map/round/hands.png",
  "icons/map/round/life-supermarket.png",
  "icons/map/round/lopia.png",
  "icons/map/round/nitori.png",
  "icons/map/round/outlet-mall.svg",
  "icons/map/round/shimamura.png",
  "icons/map/round/uniqlo.png",
  "icons/map/round/workman.png",
  "icons/map/assets/avail.svg",
  "icons/map/assets/birthday.svg",
  "icons/map/assets/chambre.svg",
  "icons/map/assets/costco.png",
  "icons/map/assets/divalo.svg",
  "icons/map/assets/global-work.svg",
  "icons/map/assets/gu.png",
  "icons/map/assets/hands.png",
  "icons/map/assets/life-supermarket.png",
  "icons/map/assets/lopia.png",
  "icons/map/assets/nitori.png",
  "icons/map/assets/outlet-mall.svg",
  "icons/map/assets/shimamura.png",
  "icons/map/assets/uniqlo.png",
  "icons/map/assets/workman.png",
  "core/shopping-bundle.js",
  "core/shopping-sources.js",
  "core/source-exports.js",
  "core/shopping-aliases.js",
  "core/shopping-catalog.js",
  "core/zip.js",
  "core/handoff.js",
  "core/contracts.js",
  "core/merge.js",
  "storage/db.js",
  "storage/shopping-approved.js",
  "storage/shopping-overlay.js",
  "storage/shopping-history.js",
  "storage/shopping-closure.js",
  "storage/shopping-reviewed-closures.js",
  "storage/shopping-reviewed-facts.js",
  "storage/shopping-sano.js",
  "storage/shopping-mixed.js",
  "storage/shopping-hours.js",
  "storage/shopping-release.js",
  "storage/shopping-generation24.js",
  "storage/shopping-generation25.js",
  "storage/shopping-generation26.js",
  "storage/shopping-generation27.js",
  "storage/shopping-reviewed-delta.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/leaflet.js",
  "vendor/leaflet.css",
  "vendor/leaflet.markercluster.js",
  "vendor/MarkerCluster.css",
  "vendor/MarkerCluster.Default.css",
];
self.addEventListener("install", (e) =>
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const signal = AbortSignal.timeout(20000);
      await cache.addAll(FILES.map(path => new Request(
        new URL(path, self.location.href), { cache: "reload", signal },
      )));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })()),
);
self.addEventListener("message", (e) => {
  if (e.data?.type === "ACTIVATE") self.skipWaiting();
});
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(PREFIX) && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url),
    base = new URL("./", self.location.href);
  if (
    e.request.method !== "GET" ||
    u.origin !== base.origin ||
    u.pathname.endsWith("/config.json")
  )
    return;
  u.hash = "";
  const navigation =
    e.request.mode === "navigate" && u.pathname.startsWith(base.pathname);
  const asset = FILES.find((p) => new URL(p, base).href === u.href);
  if (!asset && !navigation) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (navigation) {
        const documents = ["shared-day.html", "icons/map/credits.html"];
        const document = documents.find(path => new URL(path, base).pathname === u.pathname) || "index.html";
        return (await cache.match(new URL(document, base).href)) || fetch(e.request);
      }
      return (await cache.match(e.request)) || fetch(e.request);
    })(),
  );
});
