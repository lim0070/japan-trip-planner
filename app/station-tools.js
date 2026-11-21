import delivery from "./station-delivery.js";
import { manualPlace, safeURL } from "./core/model.js";
import { readBounded } from "./core/shopping-bundle.js";

const packURL = new URL("../data/stations/2026-11-01/station-pack-20261101.json", import.meta.url);
const noticeURL = new URL("STATION-SOURCES.md", packURL);
const cacheName = "japan-trip-planner-station-pack-20261101";
const packHash = "59f392cea0eb324e877cd92c6d31e303598635aecef9b424a8c83f8be91eda1d";
const maxBytes = 350_000;
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

async function decode(bytes) {
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== packHash) throw new Error("Station pack checksum does not match.");
  const pack = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (pack.schemaVersion !== 1 || !Array.isArray(pack.stations)) throw new Error("Unknown station pack format.");
  return pack;
}

export function createStationTools({ esc, modal, toast, render, addPlace }) {
  let pack = null;
  let map;
  let overlay;
  let operation = false;
  let active = false;
  let showEntrances = false;
  let stationId = "tokyo";
  const station = () => pack?.stations.find(item => item.id === stationId);
  const attribution = 'Station data © <a href="' + osm + 'copyright">OpenStreetMap contributors</a> · <a href="' + license + '">ODbL</a>';
  const sources = '<a href="' + osm + 'copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="' +
    license + '" target="_blank" rel="noopener">ODbL</a> · <a href="' + noticeURL.href + '" target="_blank" rel="noopener">Source and download notice</a>';

  async function loadCached() {
    try {
      const cached = await caches.match(packURL.href, { cacheName });
      if (!cached) return;
      pack = await decode(await cached.arrayBuffer());
      render();
    } catch {
      toast("The saved station pack could not be opened. Download it again in Settings.");
    }
  }

  async function download() {
    if (operation || pack) return;
    operation = true;
    render();
    try {
      const file = await readBounded(packURL, maxBytes);
      if (file.sha256 !== packHash) throw new Error("Station pack checksum does not match.");
      const next = JSON.parse(file.text);
      const cache = await caches.open(cacheName);
      await cache.put(packURL.href, new Response(file.text, { headers: { "Content-Type": "application/json" } }));
      pack = next;
      toast("Station luggage and exits are ready offline.");
    } catch (error) {
      toast("Station pack unavailable. " + error.message);
    } finally {
      operation = false;
      render();
    }
  }

  async function remove() {
    if (operation) return;
    operation = true;
    try {
      await caches.delete(cacheName);
      pack = null;
      active = false;
      syncMap();
      render();
      toast("Station pack removed from this browser.");
    } finally {
      operation = false;
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
      <p>Snapshot ${esc(pack.source.dataAsOf.slice(0, 10))}. Confirm the entrance and access in person or with the operator.</p>
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
          observedAt: pack.source.dataAsOf, note: "Station-nearby point. Entrance, operating status and walking route are unverified.",
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
        `<button type="button" data-action="station-download" ${operation ? "disabled" : ""}>${operation ? "Downloading station pack…" : "Download station pack"}</button>`}
      ${active && selected ? `<label>Station area<select id="station-picker">${pack.stations.map(item =>
        `<option value="${esc(item.id)}"${stationId === item.id ? " selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label>
        <p class="muted">${esc(selected.name)} · Nearby map points as of ${esc(pack.source.dataAsOf.slice(0,10))}. Availability and the correct exit are unverified.</p>
        <div class="actions"><button type="button" data-action="station-entrances" aria-pressed="${showEntrances}">Mapped exits and entrances</button>
        <button type="button" data-action="station-list">Show points as a list</button></div>${deliveryReference(selected)}` : ""}
      <small>${sources}</small></details>`;
  }

  function settingsSection() {
    const open = document.getElementById("station-pack-settings")?.open;
    return `<details id="station-pack-settings" ${open ? "open" : ""}><summary>Offline station luggage &amp; exits</summary>
      <p>${pack ? pack.stations.length + " station areas downloaded." : "Optional download of station-nearby OpenStreetMap luggage and entrance points."} Individual points can be checked on the map or in a list. Prices, hours and availability may be unknown.</p>
      <button type="button" data-action="station-${pack ? "remove" : "download"}" ${operation ? "disabled" : ""}>${operation ? "Working…" : pack ? "Remove station pack" : "Download station pack"}</button>
      <p>${sources} · <a href="${packURL.href}">Complete station derivative (JSON)</a></p></details>`;
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
    return (pack?.stations || []).map(item => ({
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
    "station-download": download,
    "station-remove": remove,
    "station-layer": () => { active = !active && !!pack; syncMap(active); render(); },
    "station-entrances": () => { showEntrances = !showEntrances; syncMap(); render(); },
    "station-list": list,
  } };
}
