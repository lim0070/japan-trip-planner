const keyStorage = "japan-trip-personal-google-maps-key";
const keyFormat = /^[A-Za-z0-9_-]{20,180}$/;

export function hasGoogleMapsKey() {
  return Boolean(readKey());
}

function readKey() {
  try {
    const value = localStorage.getItem(keyStorage);
    return keyFormat.test(value || "") ? value : null;
  } catch {
    return null;
  }
}

export function saveGoogleMapsKey(raw) {
  const key = raw?.trim();
  if (raw !== null && !keyFormat.test(key || "")) throw Error("Enter a valid browser API key.");
  try {
    if (key) localStorage.setItem(keyStorage, key);
    else localStorage.removeItem(keyStorage);
  } catch {
    throw Error("This browser could not save the map preference.");
  }
}

function loadMaps(key, authFailed) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const callback = "plannerGoogleMapsReady";
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.search = new URLSearchParams({
      key, callback, loading: "async", v: "quarterly", region: "JP",
      auth_referrer_policy: "origin",
    });
    function fail() {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
      reject(Error("Google Maps did not load."));
    }
    const timer = setTimeout(fail, 15000);
    window.gm_authFailure = () => { authFailed(); fail(); };
    window[callback] = () => {
      clearTimeout(timer);
      delete window[callback];
      resolve(window.google?.maps);
    };
    script.async = true;
    script.referrerPolicy = "origin";
    script.onerror = fail;
    script.src = url.href;
    document.head.append(script);
  });
}

function setupOverlay({ MapOverlay, MapLine, MapPoint, native, leaf, host, leaflet, visible }) {
  const entries = new Map();
  const lines = new Map();
  const overlay = new MapOverlay();
  overlay.onAdd = () => {};
  overlay.focusMarker = layer => (entries.get(layer)?.node || host).focus({preventScroll:true});
  overlay.onRemove = () => {
    entries.forEach(({ node }) => node.remove());
    entries.clear();
    lines.forEach(line => line.setMap(null));
    lines.clear();
  };
  overlay.draw = () => {
    const projection = overlay.getProjection();
    const pane = overlay.getPanes()?.overlayMouseTarget;
    if (!visible() || !projection || !pane) return;
    const retained = new Set();
    leaf.eachLayer(layer => {
      if (layer instanceof leaflet.Polyline) {
        retained.add(layer);
        if (!lines.has(layer)) lines.set(layer, new MapLine({
          map: native, path: layer.getLatLngs().map(p => ({lat:p.lat, lng:p.lng})),
          strokeColor: layer.options.color, strokeOpacity: 0.8,
          strokeWeight: layer.options.weight, clickable: false,
        }));
        return;
      }
      if (!(layer instanceof leaflet.Marker)) return;
      const icon = layer.getElement();
      if (!icon?.isConnected) return;
      const {lat, lng} = layer.getLatLng();
      const position = new MapPoint(lat, lng);
      const anchor = projection.fromLatLngToDivPixel(position);
      const screen = projection.fromLatLngToContainerPixel(position);
      if (!anchor || !screen || screen.x < 0 || screen.y < 0 ||
          screen.x >= host.clientWidth || screen.y >= host.clientHeight) return;
      retained.add(layer);
      let entry = entries.get(layer);
      if (!entry) {
        const node = document.createElement("div");
        entry = { node, html: null };
        entries.set(layer, entry);
        if (layer.options.interactive !== false) {
          node.setAttribute("role", "button");
          node.tabIndex = 0;
          const activate = event => {
            event.preventDefault();
            layer.fire("click", {latlng: layer.getLatLng(), originalEvent: event}, true);
          };
          node.onclick = activate;
          node.onkeydown = event => { if (event.key === "Enter" || event.key === " ") activate(event); };
          MapOverlay.preventMapHitsAndGesturesFrom(node);
        }
        pane.append(node);
      }
      const { node } = entry;
      node.className = icon.className.replace(/\bleaflet-zoom-(?:animated|hide)\b/g, "") + " google-map-pin";
      if (entry.html !== icon.innerHTML) {
        entry.html = icon.innerHTML;
        node.innerHTML = entry.html;
      }
      for (const name of ["aria-label", "aria-description", "aria-pressed", "title"]) {
        const value = icon.getAttribute(name);
        if (value !== null) node.setAttribute(name, value);
        else if (name === "aria-label" && typeof layer.getChildCount === "function")
          node.setAttribute(name, layer.getChildCount() + " places");
        else node.removeAttribute(name);
      }
      const style = icon.style;
      node.style.width = style.width;
      node.style.height = style.height;
      node.style.pointerEvents = layer.options.interactive === false ? "none" : "auto";
      node.style.left = anchor.x + (parseFloat(style.marginLeft) || 0) + "px";
      node.style.top = anchor.y + (parseFloat(style.marginTop) || 0) + "px";
      node.style.zIndex = style.zIndex;
    });
    for (const [layer, {node}] of entries) {
      if (retained.has(layer)) continue;
      node.remove();
      entries.delete(layer);
    }
    for (const [layer, line] of lines) {
      if (retained.has(layer)) continue;
      line.setMap(null);
      lines.delete(layer);
    }
  };
  return overlay;
}

const latLng = value => value && { lat: value.lat(), lng: value.lng() };

export function createPersonalGoogleMap({ stage, leaf, leaflet, change }) {
  const host = stage.querySelector("#google-map");
  const credits = stage.querySelector("#google-map-data-credits");
  const key = readKey();
  let maps, native, overlay, geocoder, tilesDeadline;
  let failed = false, started = false, loaded = false;
  let mode = "off", frame = 0, offset = leaflet.point(0, 0), takingNativeView = false;

  function syncInsets() {
    const bounds = stage.getBoundingClientRect();
    const dock = document.querySelector(".panel-dock");
    const panel = document.getElementById("content");
    const inspector = document.getElementById("place-inspector");
    const mobile = matchMedia("(max-width:760px)").matches;
    const panelBox = (mobile ? dock : panel).getBoundingClientRect();
    const inspectorBox = inspector.getBoundingClientRect();
    const nav = document.querySelector(".bottom-nav").getBoundingClientRect();
    const left = mobile || panel.hidden ? 0 : Math.max(0, panelBox.right - bounds.left);
    const right = mobile || inspector.hidden ? 0 : Math.max(0, bounds.right - inspectorBox.left);
    const bottom = Math.max(bounds.bottom - nav.top, mobile ? bounds.bottom - panelBox.top : 0,
      mobile && !inspector.hidden ? bounds.bottom - inspectorBox.top : 0);
    host.style.left = left + "px";
    host.style.right = right + "px";
    host.style.bottom = bottom + "px";
    const rect = host.getBoundingClientRect();
    offset = leaflet.point((left - right) / 2, (rect.height - bounds.height) / 2);
    credits.style.left = (left + 6) + "px";
    credits.style.bottom = (bottom + 26) + "px";
  }

  function syncCamera() {
    if (!native || takingNativeView || (mode !== "active" && mode !== "loading")) return;
    const center = leaf.containerPointToLatLng(leaf.getSize().divideBy(2).add(offset));
    const zoom = leaf.getZoom();
    const current = latLng(native.getCenter());
    if (zoom !== native.getZoom() || !current || Math.abs(current.lat - center.lat) > 0.00001 ||
        Math.abs(current.lng - center.lng) > 0.00001)
      native.moveCamera({center: {lat:center.lat, lng:center.lng}, zoom});
  }

  function requestDraw() {
    if (mode !== "active" || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (mode !== "active") return;
      overlay?.draw();
      const source = leaf.getContainer().querySelector(".leaflet-control-attribution");
      if (source && credits.innerHTML !== source.innerHTML) credits.innerHTML = source.innerHTML;
      credits.hidden = !credits.textContent.trim();
    });
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    const active = next === "active";
    stage.dataset.mapProvider = active ? "google" : "osm";
    stage.dataset.googleMapState = next;
    host.inert = !active;
    host.setAttribute("aria-hidden", String(!active));
    leaf.getContainer().inert = active;
    leaf.getContainer().setAttribute("aria-hidden", String(active));
    credits.hidden = !active;
    overlay?.setMap(active ? native : null);
    change(next);
    if (active) {
      syncInsets();
      syncCamera();
      requestDraw();
    }
  }

  function fail() {
    failed = true;
    refresh();
  }

  async function connect() {
    started = true;
    try {
      maps = await loadMaps(key, fail);
      if (!maps || failed) return fail();
      const [{ Map: GoogleMap, OverlayView: MapOverlay, Polyline: MapLine }, { LatLng: MapPoint }] = await Promise.all([
        maps.importLibrary("maps"), maps.importLibrary("core"),
      ]);
      if (failed || !navigator.onLine) return;
      syncInsets();
      const center = leaf.containerPointToLatLng(leaf.getSize().divideBy(2).add(offset));
      native = new GoogleMap(host, {
        center: {lat: center.lat, lng: center.lng}, zoom: leaf.getZoom(), minZoom: 2, maxZoom: 19,
        disableDefaultUI: true, clickableIcons: false, gestureHandling: "greedy",
        renderingType: "RASTER", isFractionalZoomEnabled: false,
      });
      overlay = setupOverlay({ MapOverlay, MapLine, MapPoint, native, leaf, host, leaflet, visible: () => mode === "active" });
      armTilesDeadline();
      native.addListener("tilesloaded", () => {
        clearTimeout(tilesDeadline);
        loaded = true;
        refresh();
      });
      native.addListener("idle", () => {
        if (mode !== "active") return;
        const center = latLng(native.getCenter()), zoom = native.getZoom();
        if (!center || !Number.isFinite(zoom)) return;
        const target = leaf.unproject(leaf.project(center, zoom).subtract(offset), zoom);
        const old = leaf.getCenter();
        if (zoom !== leaf.getZoom() || Math.abs(target.lat - old.lat) > 0.00001 ||
            Math.abs(target.lng - old.lng) > 0.00001) {
          takingNativeView = true;
          leaf.setView(target, zoom, { animate:false });
          takingNativeView = false;
        }
        requestDraw();
      });
      native.addListener("click", event => {
        if (mode === "active" && event.latLng) leaf.fire("click", {latlng: latLng(event.latLng)});
      });
    } catch {
      if (navigator.onLine) fail();
    } finally {
      if (!native && !failed) started = false;
    }
  }

  function refresh() {
    if (!key) return;
    if (!navigator.onLine) {
      clearTimeout(tilesDeadline);
      return setMode("offline");
    }
    if (leaf.getContainer().classList.contains("regional-map-active")) return setMode("regional");
    if (failed) return setMode("unavailable");
    if (loaded) return setMode("active");
    setMode("loading");
    if (!started) void connect();
    else if (native) armTilesDeadline();
  }

  function armTilesDeadline() {
    clearTimeout(tilesDeadline);
    tilesDeadline = setTimeout(() => { if (!loaded && navigator.onLine) fail(); }, 18000);
  }

  if (key) {
    leaf.on("moveend zoomend", () => { syncCamera(); requestDraw(); });
    leaf.on("layeradd layerremove", requestDraw);
    new MutationObserver(refresh).observe(leaf.getContainer(), { attributes:true, attributeFilter:["class"] });
    const resize = new ResizeObserver(() => {
      if (mode !== "active" && mode !== "loading") return;
      syncInsets();
      syncCamera();
      requestDraw();
    });
    for (const element of [stage, document.querySelector(".panel-dock"),
      document.getElementById("content"), document.getElementById("place-inspector")]) resize.observe(element);
  }

  async function search(query) {
    if (mode !== "active") throw Error("Google Maps search is unavailable.");
    if (!geocoder) {
      const { Geocoder } = await maps.importLibrary("geocoding");
      geocoder = new Geocoder();
    }
    const address = /^(?:流山(?:市)?|ながれやま(?:し)?|nagareyama(?: city)?)$/iu.test(query.normalize("NFKC"))
      ? "流山市, 千葉県" : query;
    let timeout;
    const response = await Promise.race([
      geocoder.geocode({
        address, componentRestrictions: { country: "JP" }, region: "JP", fulfillOnZeroResults: true,
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error("Google Maps search timed out.")), 12000);
      }),
    ]).finally(() => clearTimeout(timeout));
    if (mode !== "active") throw Error("Google Maps search is unavailable.");
    return response.results.slice(0, 5).flatMap(result => {
      if (!result.address_components?.some(part => part.types.includes("country") && part.short_name === "JP"))
        return [];
      const point = latLng(result.geometry?.location);
      return point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && result.formatted_address
        ? [{ ...point, label: result.formatted_address, source: "google" }] : [];
    });
  }

  function focusMarker(layer) {
    requestDraw();
    requestAnimationFrame(() => { if (mode === "active") overlay.focusMarker(layer); });
  }

  return { refresh, requestDraw, focusMarker, search, active: () => mode === "active", mode: () => mode };
}
