const revision = "japan-planner-regional-maps-v1";
const selectionKey = "japan-planner-regional-map-selection";
const MiB = 1024 * 1024;
export const regionalMapBudget = 6 * MiB;
const packLimit = 4 * MiB;
const manifestLimit = 16 * 1024;
const docLimit = 64 * 1024;
const kinds = ["road", "rail", "water", "station", "place"];
const approvedRegions = new Set(["tokyo-central", "sendai-matsushima", "yamagata-city"]);
const assetNames = ["SOURCE.md", "LICENSE.txt"];

const ownFields = (value, required, optional = []) =>
  !!value && typeof value === "object" && !Array.isArray(value) &&
  required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const text = (value, limit) => typeof value === "string" && !!value.trim() &&
  value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const integer = (value, minimum, maximum) =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const coordinates = value => Array.isArray(value) && value.length === 2 &&
  Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180 &&
  Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
const bounds = value => Array.isArray(value) && value.length === 4 &&
  coordinates(value.slice(0, 2)) && coordinates(value.slice(2)) &&
  value[0] < value[2] && value[1] < value[3];
const digestShape = value => typeof value === "string" && /^(sha256:)?[a-f0-9]{64}$/.test(value);
function validRegion(region) {
  return ownFields(region, ["id", "name", "bbox", "path", "bytes", "sha256", "featureCount", "counts"]) &&
    approvedRegions.has(region.id) && text(region.name, 120) && bounds(region.bbox) &&
    region.path === "packs/" + region.id + ".geojson" &&
    integer(region.bytes, 1, packLimit) && digestShape(region.sha256) &&
    integer(region.featureCount, 1, 30000) &&
    ownFields(region.counts, [], kinds) && Object.keys(region.counts).length > 0 &&
    Object.values(region.counts).every(count => integer(count, 0, region.featureCount)) &&
    Object.values(region.counts).reduce((total, count) => total + count, 0) === region.featureCount;
}
function sourceDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(value)) return false;
  const date = new Date(value.length === 10 ? value + "T00:00:00Z" : value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10);
}
export function validateRegionManifest(data) {
  if (!ownFields(data, ["schemaVersion", "sourceDataAsOf", "attribution", "license", "regions", "sourcePath", "licensePath"]) ||
      data.schemaVersion !== 1 || !sourceDate(data.sourceDataAsOf) ||
      data.sourcePath !== "SOURCE.md" || data.licensePath !== "LICENSE.txt" ||
      !text(data.attribution, 240) || !data.attribution.includes("OpenStreetMap") ||
      !text(data.license, 120) || !/ODbL|Open Database License/i.test(data.license) ||
      !Array.isArray(data.regions) || !data.regions.length || data.regions.length > approvedRegions.size ||
      !data.regions.every(validRegion) ||
      new Set(data.regions.map(region => region.id)).size !== data.regions.length)
    throw Error("Regional map manifest is invalid.");
  return data;
}

function parseText(bytes, limit) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > limit)
    throw Error("Regional map file exceeded its expected size.");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
async function hash(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function parseRegionManifest(bytes, expectedHash) {
  if (expectedHash && await hash(bytes) !== expectedHash.replace(/^sha256:/, ""))
    throw Error("Regional map manifest checksum failed.");
  return validateRegionManifest(JSON.parse(parseText(bytes, manifestLimit)));
}

export async function readRegionFile(response, maximum, expectedBytes = null) {
  if (!response.ok || !response.body) throw Error("The regional map file is unavailable.");
  const limit = expectedBytes ?? maximum;
  if (!integer(limit, 1, maximum)) throw Error("Regional map file size is invalid.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw Error("Regional map file exceeded its expected size.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!length || (expectedBytes !== null && length !== expectedBytes))
    throw Error("Regional map file did not match its expected size.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function decodeRegionPack(region, bytes) {
  if (!validRegion(region) || !(bytes instanceof Uint8Array) || bytes.byteLength !== region.bytes)
    throw Error("Regional map file did not match its expected size.");
  if (await hash(bytes) !== region.sha256.replace(/^sha256:/, ""))
    throw Error("Regional map checksum failed.");
  const data = JSON.parse(parseText(bytes, packLimit));
  if (!ownFields(data, ["type", "bbox", "features"]) || data.type !== "FeatureCollection" ||
      !bounds(data.bbox) || data.bbox.some((value, index) => value !== region.bbox[index]) ||
      !Array.isArray(data.features) || data.features.length !== region.featureCount)
    throw Error("Regional map collection is invalid.");
  let vertices = 0;
  const counts = Object.fromEntries(kinds.map(kind => [kind, 0]));
  for (const feature of data.features) {
    if (!ownFields(feature, ["type", "geometry", "properties"], ["id"]) || feature.type !== "Feature" ||
        (Object.hasOwn(feature, "id") && !text(feature.id, 110) && !integer(feature.id, 1, Number.MAX_SAFE_INTEGER)) ||
        !ownFields(feature.geometry, ["type", "coordinates"]) ||
        !ownFields(feature.properties, ["kind", "class"], ["name", "nameJa", "nameEn", "ref"]))
      throw Error("Regional map feature is invalid.");
    const { geometry, properties } = feature;
    const { kind } = properties;
    const point = kind === "station" || kind === "place";
    const points = point ? [geometry.coordinates] : geometry.coordinates;
    const [west, south, east, north] = region.bbox;
    if (!kinds.includes(kind) || !text(properties.class, 80) ||
        ["name", "nameJa", "nameEn", "ref"].some(key => Object.hasOwn(properties, key) && !text(properties[key], 250)) ||
        geometry.type !== (point ? "Point" : "LineString") || !Array.isArray(points) ||
        !integer(points.length, point ? 1 : 2, 50000) ||
        points.some(p => !coordinates(p) || p[0] < west || p[0] > east || p[1] < south || p[1] > north))
      throw Error("Regional map feature coordinates or properties are invalid.");
    vertices += points.length;
    if (vertices > 500000) throw Error("Regional map coordinate limit was exceeded.");
    counts[kind]++;
  }
  if (kinds.some(kind => counts[kind] !== (region.counts[kind] ?? 0)))
    throw Error("Regional map feature totals did not match.");
  return data;
}

export function newerRegionalPack(installed, current) {
  return !!installed && !!current && installed.id === current.id && installed.sha256 !== current.sha256;
}

function store() {
  let opened;
  const db = () => opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(revision, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("regions", { keyPath: "region.id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { opened = undefined; throw error; });
  async function transaction(mode, run) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction("regions", mode);
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure || tx.error || Error("Regional map storage was interrupted."));
      run(tx.objectStore("regions"), value => { result = value; }, error => { failure = error; tx.abort(); });
    });
  }
  return {
    list: () => transaction("readonly", (objectStore, result) => {
      const request = objectStore.getAll();
      request.onsuccess = () => result(request.result);
    }),
    put: record => transaction("readwrite", (objectStore, _result, fail) => {
      const request = objectStore.getAll();
      request.onsuccess = () => {
        const used = request.result.filter(item => item.region?.id !== record.region.id)
          .reduce((sum, item) => sum + (integer(item.size, 1, regionalMapBudget) ? item.size : regionalMapBudget), 0);
        if (used + record.size > regionalMapBudget) {
          fail(Error("Regional maps exceed the 6 MiB budget. Remove one to make room."));
        } else {
          objectStore.put(record);
        }
      };
    }),
    delete: id => transaction("readwrite", objectStore => objectStore.delete(id)),
  };
}

const styles = {
  water: { color: "#3285ab", weight: 2, opacity: 0.88 },
  road: { color: "#9e7b43", weight: 1.6, opacity: 0.8 },
  rail: { color: "#835a6e", weight: 2, opacity: 0.9, dashArray: "5 3" },
  station: { radius: 4, color: "#633e65", fillColor: "#f2e8f4", fillOpacity: 1, weight: 1.5 },
  place: { radius: 3, color: "#2b6059", fillColor: "#eef5e4", fillOpacity: 1, weight: 1.5 },
};

export function createOfflineRegions({ esc, render, base, fit, expectedManifestHash = null }) {
  const storage = store();
  const saved = new Map();
  const links = new Map();
  let manifest, activeId, map, initialView, overlay, renderer, labels, overlayAttribution, overlayHash, loading, busy, open;
  let status = "";
  try { activeId = localStorage.getItem(selectionKey); }
  catch {}
  const update = () => { if (document.getElementById("offline-regions")) render(); };
  const regionList = () => new Map([
    ...Array.from(saved.values(), item => [item.region.id, item.region]),
    ...(manifest?.regions || []).map(region => [region.id, region]),
  ]);
  const selection = id => {
    activeId = id;
    try { id ? localStorage.setItem(selectionKey, id) : localStorage.removeItem(selectionKey); }
    catch {}
  };
  function removeOverlay() {
    if (!map) return;
    if (overlayAttribution) map.attributionControl?.removeAttribution(overlayAttribution);
    if (overlay) map.removeLayer(overlay);
    if (renderer) map.removeLayer(renderer);
    if (labels) map.removeLayer(labels);
    map.off("moveend", showLabels);
    overlay = renderer = labels = overlayAttribution = overlayHash = null;
    map.getContainer().classList.remove("regional-map-active");
  }
  let pointLabels = [];
  function showLabels() {
    labels.clearLayers();
    if (map.getZoom() < 12) return;
    const view = map.getBounds();
    let count = 0;
    for (const { latLng, label } of pointLabels) {
      if (!view.contains(latLng)) continue;
      const tag = document.createElement("span");
      tag.textContent = label;
      tag.style.cssText = "white-space:nowrap;padding:1px 3px;color:#16342d;background:#fffdf3e8;font-weight:600;";
      L.marker(latLng, {
        pane: "regional-map-labels", icon: L.divIcon({ html: tag, className: "regional-map-label", iconSize: [0, 0] }),
        interactive: false, keyboard: false,
      }).addTo(labels);
      if (++count === 48) break;
    }
  }
  function fitRegion(region) {
    const [west, south, east, north] = region.bbox;
    const box = [[south, west], [north, east]];
    if (fit) fit(box);
    else map.fitBounds(box, { padding: [24, 24] });
  }
  const currentView = () => JSON.stringify([map?.getZoom(), map?.getCenter()]);
  async function show(record, fitMap, decoded = null) {
    const shouldFit = () => typeof fitMap === "function" ? fitMap() : fitMap;
    if (overlay && activeId === record.region.id && overlayHash === record.region.sha256) {
      if (shouldFit()) fitRegion(record.region);
      return;
    }
    const data = decoded ?? await decodeRegionPack(record.region, record.bytes);
    if (!map) throw Error("Open the map to show the downloaded region.");
    removeOverlay();
    const pane = map.getPane("regional-map") ?? map.createPane("regional-map");
    const labelPane = map.getPane("regional-map-labels") ?? map.createPane("regional-map-labels");
    pane.style.zIndex = 360;
    labelPane.style.zIndex = 375;
    pane.style.pointerEvents = labelPane.style.pointerEvents = "none";
    renderer = L.canvas({ pane: "regional-map" });
    const options = { pane: "regional-map", renderer, interactive: false };
    overlay = L.geoJSON(data, {
      ...options,
      style: feature => styles[feature.properties.kind],
      pointToLayer: (feature, point) => L.circleMarker(point, { ...options, ...styles[feature.properties.kind] }),
    }).addTo(map);
    labels = L.layerGroup().addTo(map);
    pointLabels = data.features.filter(feature => feature.geometry.type === "Point")
      .map(({ properties, geometry }) => ({
        label: properties.nameJa || properties.name || properties.nameEn,
        latLng: [geometry.coordinates[1], geometry.coordinates[0]],
      })).filter(point => point.label);
    map.on("moveend", showLabels);
    showLabels();
    map.getContainer().classList.add("regional-map-active");
    overlayAttribution = 'Regional map · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">' +
      esc(record.attribution) + "</a> · " + esc(record.license) + " · " + esc(record.sourceDataAsOf);
    map.attributionControl?.addAttribution(overlayAttribution);
    overlayHash = record.region.sha256;
    selection(record.region.id);
    if (shouldFit()) fitRegion(record.region);
  }

  function savedLinks(record) {
    let entries = links.get(record.region.id);
    if (!entries) {
      entries = [
        URL.createObjectURL(new Blob([record.bytes], { type: "application/geo+json" })),
        URL.createObjectURL(new Blob([record.docs[0]], { type: "text/plain;charset=utf-8" })),
        URL.createObjectURL(new Blob([record.docs[1]], { type: "text/plain;charset=utf-8" })),
      ];
      links.set(record.region.id, entries);
    }
    const files = [record.region.id + ".geojson", ...assetNames];
    return entries.map((href, index) => `<a href="${esc(href)}" download="${esc(files[index])}">${["Saved GeoJSON", "Source notes", "License"][index]}</a>`).join(" · ");
  }
  async function action(task) {
    if (busy) return;
    busy = true;
    status = "Working on regional maps…";
    update();
    try { status = await task(); }
    catch (error) { status = error.message || "Regional map operation failed."; }
    finally { busy = false; update(); }
  }
  function install(id, replacing) {
    return action(async () => {
      const region = manifest?.regions.find(item => item.id === id);
      if (!region) throw Error("This region is unavailable in the current manifest.");
      if (replacing && !newerRegionalPack(saved.get(id)?.region, region))
        throw Error("This region already has the current map.");
      const bytes = await readRegionFile(
        await fetch(new URL(region.path, base), { cache: "no-store" }), packLimit, region.bytes,
      );
      const data = await decodeRegionPack(region, bytes);
      const docs = await Promise.all(assetNames.map(async name => {
        const data = await readRegionFile(await fetch(new URL(name, base)), docLimit);
        parseText(data, docLimit);
        return data;
      }));
      const { attribution, license, sourceDataAsOf } = manifest;
      const record = { region, bytes, docs, attribution, license, sourceDataAsOf,
        size: bytes.byteLength + docs.reduce((sum, doc) => sum + doc.byteLength, 0) };
      await storage.put(record);
      links.get(id)?.forEach(href => URL.revokeObjectURL(href));
      links.delete(id);
      saved.set(id, record);
      if (activeId === id) await show(record, false, data);
      return region.name + (replacing ? " was updated and is ready offline." : " is ready offline.");
    });
  }
  const actions = {
    "download-region": id => install(id, false),
    "update-region": id => install(id, true),
    "show-region": id => action(async () => {
      const record = saved.get(id);
      if (!record) throw Error("Download this region before showing it.");
      await show(record, true);
      return record.region.name + " is on the map.";
    }),
    "hide-region": () => action(() => {
      selection(null);
      removeOverlay();
      return "Regional map hidden.";
    }),
    "remove-region": id => action(async () => {
      await storage.delete(id);
      saved.delete(id);
      links.get(id)?.forEach(href => URL.revokeObjectURL(href));
      links.delete(id);
      if (activeId === id) {
        selection(null);
        removeOverlay();
      }
      return "Regional map removed from this browser.";
    }),
  };

  return {
    actions,
    settingsHTML() {
      open = document.getElementById("offline-regions")?.open ?? open;
      const metadata = manifest || saved.values().next().value;
      const used = Array.from(saved.values()).reduce((sum, item) => sum + item.size, 0);
      const regions = regionList();
      const button = (action, id, label) =>
        `<button data-action="${action}" data-id="${esc(id)}" ${busy ? "disabled" : ""}>${label}</button>`;
      return `<details id="offline-regions" ${open ? "open" : ""}><summary>Regional offline maps</summary>
        <p>Download a regional map to use with saved trips offline. It shows selected roads, railway, water and places. Check route access separately.</p>
        <p>${(used / MiB).toFixed(1)} MiB saved · 6 MiB regional map budget</p>
        ${metadata ? `<p>${esc(metadata.attribution)} · ${esc(metadata.license)} · Source as of ${esc(metadata.sourceDataAsOf)}<br>
          <a href="${esc(new URL("SOURCE.md", base).href)}" target="_blank" rel="noopener noreferrer">Published source notes</a> ·
          <a href="${esc(new URL("LICENSE.txt", base).href)}" target="_blank" rel="noopener noreferrer">Published license</a></p>` : ""}
        ${Array.from(regions.values(), region => {
          const record = saved.get(region.id);
          const installed = record?.region;
          const updateAvailable = newerRegionalPack(installed, region);
          const shown = installed || region;
          const [west, south, east, north] = shown.bbox.map(value => value.toFixed(3));
          const description = (item, date) => (item.bytes / MiB).toFixed(2) + " MiB (" +
            item.bytes.toLocaleString() + " bytes) · source as of " + esc(date) +
            '<br><small style="overflow-wrap:anywhere">SHA-256 ' + esc(item.sha256.replace(/^sha256:/, "")) + '</small>';
          return `<section data-region="${esc(region.id)}"><h3>${esc(region.name)}</h3>
            <p><strong>${record ? "Downloaded" : "Available to download"}</strong><br>
            ${description(shown, record?.sourceDataAsOf || manifest.sourceDataAsOf)}<br>
            Coverage ${south}–${north}° N · ${west}–${east}° E</p>
            ${updateAvailable ? `<p><strong>Published update available</strong><br>${description(region, manifest.sourceDataAsOf)}</p>` : ""}
            <div class="actions">${record
              ? button("show-region", region.id, activeId === region.id ? "Fit region" : "Show on map") +
                (activeId === region.id ? button("hide-region", region.id, "Hide overlay") : "") +
                (updateAvailable ? button("update-region", region.id, "Update map") : "") +
                button("remove-region", region.id, "Remove downloaded map")
              : button("download-region", region.id, "Download map")}</div>
            <p>${record ? savedLinks(record) : `<a href="${esc(new URL(region.path, base).href)}" target="_blank" rel="noopener noreferrer">Published GeoJSON</a>`}</p></section>`;
        }).join("")}
        <p id="regional-map-status" role="status">${esc(status || (loading ? "Checking regional map availability…" :
          (!regions.size ? "Regional maps are unavailable on this connection." : "")))}</p></details>`;
    },
    attachMap(instance) {
      if (map === instance) return;
      removeOverlay();
      map = instance;
      initialView = currentView();
    },
    async load() {
      loading = true;
      await Promise.allSettled([
        storage.list().then(async records => {
          for (const item of records) {
            if (validRegion(item.region) && item.bytes instanceof Uint8Array &&
                item.bytes.byteLength === item.region.bytes && integer(item.size, item.region.bytes, regionalMapBudget) &&
                Array.isArray(item.docs) && item.docs.length === assetNames.length &&
                item.docs.every(doc => doc instanceof Uint8Array && doc.byteLength <= docLimit) &&
                text(item.attribution, 240) && text(item.license, 120) && sourceDate(item.sourceDataAsOf))
              saved.set(item.region.id, item);
          }
          if (saved.has(activeId)) {
            try { await show(saved.get(activeId), () => currentView() === initialView); }
            catch (error) { selection(null); status = error.message; }
          } else if (activeId) selection(null);
          update();
        }),
        fetch(new URL("manifest.json", base), { cache: "no-cache" })
          .then(response => readRegionFile(response, manifestLimit))
          .then(bytes => parseRegionManifest(bytes, expectedManifestHash))
          .then(data => { manifest = data; update(); })
          .catch(error => { if (navigator.onLine && !saved.size) status = error.message; }),
      ]);
      loading = false;
      update();
    },
  };
}
