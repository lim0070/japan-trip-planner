import stationDownloads from "./station-downloads.js";
import delivery from "./station-delivery.js";
import { manualPlace, safeURL } from "./core/model.js";
import { readBounded } from "./core/shopping-bundle.js";

const packBase = new URL("../data/stations/2026-11-01/", import.meta.url);
const packURL = new URL(stationDownloads.packs[0].file, packBase);
const noticeURL = new URL("STATION-SOURCES.md", packBase);
const downloadsURL = new URL("STATION-DOWNLOADS.md", packBase);
const cacheName = "japan-trip-planner-station-pack-20261101";
const specs = new Map(stationDownloads.packs.map(spec => [spec.id, { ...spec, url: new URL(spec.file, packBase).href }]));
const snapshot = stationDownloads.snapshot;
const osm = "https://www.openstreetmap.org/";
const license = "https://opendatacommons.org/licenses/odbl/1-0/";
const kindNames = {
  locker: "Coin locker",
  storage: "Luggage storage",
  forwarding: "Luggage forwarding",
  entrance: "Mapped entrance",
};
const kindSymbols = { locker: "L", storage: "S", forwarding: "F", entrance: "E" };
function label(feature) {
  const names = feature.tags;
  const name = names["name:en"] || names.name || names.ref;
  return kindNames[feature.kind] + (name ? " · " + name : "");
}
const featureKey = (feature) => feature.id.replace("/", ":");

function parsePack(text, spec) {
  const pack = JSON.parse(text);
  if (pack.schemaVersion !== 1 || pack.source?.dataAsOf !== snapshot || !Array.isArray(pack.stations) ||
      (spec.id !== "all" && (pack.stations.length !== 1 || pack.stations[0].id !== spec.id)))
    throw new Error("Unknown station pack format.");
  return pack;
}

export function createStationTools({ esc, modal, toast, render, addPlace }) {
  const packs = new Map();
  let map;
  let overlay;
  let operation = null;
  let loading = true;
  let active = false;
  let showEntrances = false;
  let stationId = "tokyo";
  const stations = () => packs.get("all")?.stations ||
    [...specs.keys()].flatMap(id => packs.get(id)?.stations || []);
  const station = () => {
    const available = stations();
    return available.find(item => item.id === stationId) || available[0];
  };
  const attribution = 'Station data © <a href="' + osm + 'copyright">OpenStreetMap contributors</a> · <a href="' + license + '">ODbL</a>';
  const sources = '<a href="' + osm + 'copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="' +
    license + '" target="_blank" rel="noopener">ODbL</a> · <a href="' + noticeURL.href + '" target="_blank" rel="noopener">Source and download notice</a>';

  async function loadCached() {
    const result = await Promise.allSettled([...specs.values()].map(async spec => {
      const cached = await caches.match(spec.url, { cacheName });
      if (!cached) return;
      const file = await readBounded(spec.url, spec.bytes, spec, () => cached);
      packs.set(spec.id, parsePack(file.text, spec));
    }));
    loading = false;
    if (result.some(item => item.status === "rejected"))
      toast("A saved station download could not be opened. Download it again in Settings.");
    if (packs.size) render();
    else document.querySelectorAll('[data-action="station-download"]').forEach(button => { button.disabled = false; });
  }

  async function changeDownload(id = "all", remove = false) {
    const spec = specs.get(id);
    if (loading || operation || !spec || packs.has(id) !== remove) return;
    operation = id;
    render();
    try {
      const cache = await caches.open(cacheName);
      if (remove) {
        await cache.delete(spec.url);
        packs.delete(id);
        active = active && packs.size > 0;
        toast(spec.name + " download removed.");
      } else {
        const file = await readBounded(spec.url, spec.bytes, spec);
        const pack = parsePack(file.text, spec);
        await cache.put(spec.url, new Response(file.text, { headers: { "Content-Type": "application/json" } }));
        packs.set(id, pack);
        toast(id === "all" ? "Station luggage and exits are ready offline." : spec.name + " is ready offline.");
      }
      if (active) stationId = station()?.id || "tokyo";
      syncMap();
    } catch (error) {
      toast("Station pack unavailable. " + error.message);
    } finally {
      operation = null;
      render();
    }
  }

  function openFeature(feature, selected) {
    const source = osm + feature.id;
    const tags = feature.tags;
    const sizes = ["small", "medium", "large"].flatMap(size => tags["capacity:" + size]
      ? [tags["capacity:" + size] + " " + size] : []);
    const size = sizes.length ? sizes.join(", ") : tags["locker:size"] ||
      (tags["maxheight"] && tags["maxwidth"] ? tags["maxheight"] + " × " + tags["maxwidth"] : null);
    const fee = tags.charge || (tags.fee === "yes" ? "Fee applies · amount unknown" :
      tags.fee === "no" ? "No fee" : null);
    const luggage = feature.kind !== "entrance";
    const noted = (value, fallback) => value ? esc(value) + " (mapped)" : fallback;
    modal(label(feature), `<p>Near ${esc(selected.name)} · ${feature.distanceM} m straight-line from the station reference point.</p>
      <p>Snapshot ${esc(snapshot.slice(0, 10))}. Confirm the entrance and access in person or with the operator.</p>
      ${luggage ? `<dl><dt>Hours</dt><dd>${noted(tags.opening_hours, "Unknown")}</dd>
      <dt>Fee</dt><dd>${noted(fee, "Unknown")}</dd>
      <dt>Size</dt><dd>${noted(size, "Unknown")}</dd><dt>Live availability</dt><dd>Unknown</dd></dl>` :
      `<p>Exit suitability for your route is unverified. Wheelchair access: ${noted(tags.wheelchair, "Unknown")}.</p>`}
      <p><a href="${source}" target="_blank" rel="noopener">OpenStreetMap feature</a> · ${sources}</p>
      <button id="add-station-point" type="button">Add to day</button>`, () => {
      document.getElementById("add-station-point").onclick = () => {
        const id = "station-" + featureKey(feature);
        const proof = {
          field: "location", sourceKind: "OpenStreetMap snapshot", url: source,
          observedAt: snapshot, note: "Station-nearby point. Entrance, operating status and walking route are unverified.",
        };
        return addPlace(manualPlace({
          key: "manual:" + id, sourceId: id,
          names: { ja: tags["name:ja"] || null, en: label(feature) + " near " + selected.name, romaji: null, branchJa: null },
          category: kindNames[feature.kind],
          location: { lat: feature.lat, lng: feature.lon, availability: "located", confidence: "low",
            method: "osm-station-snapshot", provenance: [proof], verifiedAt: null },
          links: [{ kind: "source", label: "OpenStreetMap feature", url: source },
            { kind: "source", label: "Station source and license", url: noticeURL.href }],
          provenance: [proof],
        }));
      };
    });
  }

  function syncMap(fit = false) {
    if (!map) return;
    if (overlay) {
      map.removeLayer(overlay);
      map.attributionControl.removeAttribution(attribution);
      overlay = null;
    }
    const selected = station();
    if (!active || !selected) return;
    overlay = L.layerGroup().addTo(map);
    map.attributionControl.addAttribution(attribution);
    for (const feature of selected.features) {
      if (!showEntrances && feature.kind === "entrance") continue;
      const title = label(feature);
      const icon = L.divIcon({
        className: "station-marker",
        html: '<span aria-hidden="true">' + kindSymbols[feature.kind] + "</span>",
        iconSize: [27, 27], iconAnchor: [13, 13],
      });
      const marker = L.marker([feature.lat, feature.lon], { icon, title, alt: title, keyboard: true });
      marker.on("click", () => openFeature(feature, selected));
      marker.addTo(overlay);
      marker.getElement()?.setAttribute("aria-label", title);
    }
    if (fit) map.setView([selected.lat, selected.lon], 16);
  }

  function deliveryReference(selected) {
    const reference = delivery.stations.find(item => item.stationId === selected.id);
    if (!reference) return "<p>No operator luggage delivery reference recorded for this area.</p>";
    return `<details><summary>Luggage delivery from this station</summary>
      <p><strong>${esc(reference.name)}</strong> · ${esc(reference.type)}</p>
      <p>${esc(reference.where)} ${esc(reference.service)}</p>
      <p>${esc(delivery.scope)} Checked ${esc(delivery.checkedOn)}.</p>
      ${[["sourceUrl", "Operator information"], ["locationSourceUrl", "Location reference"],
        ["bookingUrl", "Operator booking"], ["serviceNoticeUrl", "Service notice"]].flatMap(([key, text]) =>
        safeURL(reference[key]) ? [`<a href="${esc(reference[key])}" target="_blank" rel="noopener noreferrer">${text}</a>`] : []).join(" · ")}</details>`;
  }

  function layerSection() {
    const selected = station();
    const open = document.getElementById("station-layer-controls")?.open ?? active;
    return `<details id="station-layer-controls" ${open ? "open" : ""}><summary>Luggage &amp; station exits</summary>
      ${selected ? `<button type="button" data-action="station-layer" aria-pressed="${active}">${active ? "Hide station layer" : "Show station layer"}</button>` :
        `<button type="button" data-action="station-download" ${loading || operation ? "disabled" : ""}>${operation === "all" ? "Downloading station pack…" : "Download station pack"}</button>
        <p><a href="#settings">Choose an individual station in Settings</a></p>`}
      ${active && selected ? `<label>Station area<select id="station-picker">${stations().map(item =>
        `<option value="${esc(item.id)}"${selected.id === item.id ? " selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
        <p class="muted">${esc(selected.name)} · Nearby map points as of ${esc(snapshot.slice(0,10))}. Availability and the correct exit are unverified.</p>
        <div class="actions"><button type="button" data-action="station-entrances" aria-pressed="${showEntrances}">Mapped exits and entrances</button>
        <button type="button" data-action="station-list">Show points as a list</button></div>${deliveryReference(selected)}` : ""}
      <small>${sources}</small></details>`;
  }

  function settingsSection() {
    const open = document.getElementById("station-pack-settings")?.open;
    const full = packs.has("all");
    const buttons = stationDownloads.packs.slice(1).map(spec => {
      const saved = packs.has(spec.id);
      const size = (spec.bytes / 1024).toFixed(1) + " KiB";
      const title = (saved ? "Remove " : "Download ") + spec.name + " station pack";
      return `<li><strong>${esc(spec.name)}</strong> · ${size}${saved ? " · downloaded" : full ? " · included in the full pack" : ""}
        <button type="button" data-action="station-${saved ? "remove" : "download"}" data-id="${spec.id}"
          ${loading || operation ? "disabled" : ""}>${operation === spec.id ? "Working…" : esc(title)}</button></li>`;
    }).join("");
    return `<details id="station-pack-settings" ${open ? "open" : ""}><summary>Offline station luggage &amp; exits</summary>
      <p>${packs.size ? stations().length + " station areas available offline." : "Download luggage and entrance points for the stations you need."}
      Snapshot ${snapshot.slice(0, 10)}. Prices, hours and availability may be unknown.</p>
      <ul class="station-point-list">${buttons}</ul>
      <p>Full pack · 22 station areas · 200 KiB${full ? " · downloaded" : ""}</p>
      <button type="button" data-action="station-${full ? "remove" : "download"}" ${loading || operation ? "disabled" : ""}>
        ${operation === "all" ? "Working…" : full ? "Remove station pack" : "Download station pack"}</button>
      <p>${sources} · <a href="${downloadsURL.href}">Individual derivatives</a> · <a href="${packURL.href}">Complete station derivative (JSON)</a></p></details>`;
  }

  function list() {
    const selected = station();
    if (!selected) return;
    const features = selected.features.filter(feature => showEntrances || feature.kind !== "entrance");
    modal(selected.name + " station points", `<p>Sorted by straight-line distance from the station reference point.</p>
      ${features.length ? `<ul class="station-point-list">${features.map((feature, index) =>
        `<li><button type="button" data-point="${index}">${esc(label(feature))} · ${feature.distanceM} m</button></li>`).join("")}</ul>` :
        "<p>No points of the selected kinds were mapped in this snapshot.</p>"}<p>${sources}</p>`, () => {
      document.querySelectorAll("#dialog-body [data-point]").forEach(button => {
        button.onclick = () => openFeature(features[Number(button.dataset.point)], selected);
      });
    });
  }

  function referenceChoices() {
    const seen = new Set();
    return stations().map(item => ({
      name: item.name,
      options: item.features.filter(feature => {
        if (feature.kind !== "entrance" || seen.has(feature.id)) return false;
        seen.add(feature.id);
        return true;
      })
        .map(feature => ({ key: featureKey(feature), label: label(feature) + " · " + feature.distanceM + " m from station reference" })),
    })).filter(group => group.options.length);
  }

  function referenceLink(key) {
    if (!/^(node|way|relation):\d+$/.test(key || "")) return null;
    return safeURL(osm + key.replace(":", "/"));
  }

  function select(id) { stationId = id; syncMap(true); render(); }

  return { loadCached, select, attachMap(value) { map = value; syncMap(); }, layerSection, settingsSection, referenceChoices, referenceLink, actions: {
    "station-download": (id) => changeDownload(id),
    "station-remove": (id) => changeDownload(id, true),
    "station-layer": () => { active = !active && packs.size > 0; if (active) stationId = station().id; syncMap(active); render(); },
    "station-entrances": () => { showEntrances = !showEntrances; syncMap(); render(); },
    "station-list": list,
  } };
}
