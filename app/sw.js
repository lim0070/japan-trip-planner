const PREFIX = "japan-trip-planner-shell-",
  CACHE = PREFIX + "v1";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "main.js",
  "core/model.js",
  "core/contracts.js",
  "core/merge.js",
  "storage/db.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/leaflet.js",
  "vendor/leaflet.css",
  "vendor/leaflet.markercluster.js",
  "vendor/MarkerCluster.css",
  "vendor/MarkerCluster.Default.css",
  "../data/saunas.v1.json",
  "../data/food.v1.json",
];
self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))),
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
      if (u.pathname.endsWith(".v1.json")) {
        try {
          const r = await fetch(e.request);
          if (r.ok) return r;
          throw Error("Source unavailable");
        } catch {
          return (await cache.match(e.request)) || Response.error();
        }
      }
      return (await cache.match(e.request)) || fetch(e.request);
    })(),
  );
});
