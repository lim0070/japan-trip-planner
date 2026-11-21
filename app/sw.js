const PREFIX = "japan-trip-planner-shell-",
  CACHE = PREFIX + "v39";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "main.js",
  "core/model.js",
  "core/place-search.js",
  "core/day-plan.js",
  "core/layers.js",
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
      if (navigation)
        return (
          (await cache.match(new URL("index.html", base).href)) ||
          fetch(e.request)
        );
      return (await cache.match(e.request)) || fetch(e.request);
    })(),
  );
});
