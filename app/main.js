import {
  shoppingPreferences,
  preserveSourceVersions,
  isOSM,
} from "./core/shopping-sources.js";
import {
  preflightFiles,
  completeOSMFiles,
  completeBackupFiles,
  selectionGroups,
  visitVersion,
} from "./core/source-exports.js";
import {
  aliasIndex,
  effectiveFlag,
  setBranchFlag,
} from "./core/shopping-aliases.js";
import { zipFiles } from "./core/zip.js";
import {
  combineLayers,
  brands,
  formats,
  badge,
  layerId,
  shoppingCategories,
  categoryFor,
  layerPreferences,
} from "./core/layers.js";
import * as M from "./core/model.js";
import {
  validateState,
  parseJSON,
  validHours,
  canonical,
} from "./core/contracts.js";
import {
  backup as makeBackup,
  previewImport,
  mergeImport,
} from "./core/merge.js";
import * as DB from "./storage/db.js";
const $ = (id) => document.getElementById(id),
  esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
let state = M.blank(),
  feeds = {},
  config = {},
  activeTrip = null,
  activeDay = null,
  screen = "trips",
  map = null,
  markers = new Map(),
  mapMode = false,
  selected = null,
  busy = false,
  pending = null,
  ready = false,
  dropAction = null,
  searchLast = 0;
let discover = {
  source: "saunachelin",
  q: "",
  years: [],
  categories: [],
  region: "",
  prefecture: "",
  listId: "",
  radius: 10,
  first: false,
  hof: false,
  multi: false,
  special: true,
  saved: false,
  visited: false,
  includeScheduled: false,
  originMode: "day",
  origin: null,
  originLabel: "",
  open: false,
};
let controlsOpen = false;
const sourceLoad = {
  "shopping:osm": "loading",
  saunachelin: "loading",
  tabelog: "loading",
  shopping: "loading",
};
let shoppingPackages = shoppingPreferences(),
  sourceMatchCounts = {};
try {
  shoppingPackages = shoppingPreferences(
    JSON.parse(localStorage.getItem("japan-shopping-sources") || "{}"),
  );
} catch {}
const sourcePackageNotices = {},
  sourcePackageRoots = {};
let sourceLicenseTexts = {},
  shoppingAliases = new Map();
function backup(s, tripId = null) {
  const data = {
    ...makeBackup(s, tripId, shoppingAliases),
    dataLicenses: { ...(s.dataLicenses || {}), ...sourceLicenseTexts },
  };
  parseJSON(JSON.stringify(data)); // Keep exports within the unchanged reimport guard.
  return data;
}

const sourceFilters = {},
  selectedExport = new Map(),
  selectedOrigins = new Map();
let visibleLayers = layerPreferences();
try {
  visibleLayers = layerPreferences(
    JSON.parse(localStorage.getItem("japan-trip-layers") || "{}"),
  );
} catch {}
function saveLayers() {
  try {
    localStorage.setItem("japan-trip-layers", JSON.stringify(visibleLayers));
  } catch {}
}
function filterFor(ns) {
  return (
    sourceFilters[ns] || {
      ...discover,
      source: ns,
      years: [],
      categories: [],
      region: "",
      prefecture: "",
      listId: "",
      hof: false,
      multi: false,
      first: false,
      includeClosed: false,
      brands: [],
      shopCategories: [],
      formats: [],
    }
  );
}
function switchSource(ns) {
  sourceFilters[discover.source] = { ...discover };
  discover = { ...filterFor(ns), source: ns, open: discover.open };
}
const trip = () => state.trips.find((t) => t.id === activeTrip),
  day = () => state.days.find((d) => d.id === activeDay),
  allPlaces = () => Object.values(feeds).flatMap((f) => f.places);
const sourceVersion = (p) =>
  Object.values(feeds).find((f) => f.places.some((x) => x.key === p.key))
    ?.datasetVersion;
function toast(message) {
  $("toast").textContent = message;
  $("toast").style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => ($("toast").style.display = "none"), 5500);
}
function error(message) {
  $("error").hidden = false;
  $("error").replaceChildren(document.createTextNode(message + " "));
  if (pending) {
    const b = document.createElement("button");
    b.textContent = "Export unsaved recovery";
    b.onclick = () => download(backup(pending), "japan-unsaved-recovery.json");
    $("error").append(b);
  }
  const reload = document.createElement("button");
  reload.textContent = "Reload saved state";
  reload.onclick = () => location.reload();
  $("error").append(reload);
}
function theme() {
  document.body.dataset.theme =
    state.settings.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : state.settings.theme;
  document.documentElement.dataset.theme = document.body.dataset.theme;
}
async function commit(fn, { redraw = true } = {}) {
  if (busy) {
    toast("Please wait for the current save.");
    return false;
  }
  busy = true;
  const next = M.clone(state);
  try {
    await fn(next);
    next.dataLicenses = { ...(next.dataLicenses || {}), ...sourceLicenseTexts };
    next.sourceVersions = preserveSourceVersions(next.sourceVersions, feeds);
    M.reconcile(next);
    validateState(next);
    pending = next;
    await DB.save(next);
    state = next;
    pending = null;
    $("error").hidden = true;
    theme();
    if (redraw) render();
    return true;
  } catch (e) {
    error("Changes were not saved. " + e.message);
    return false;
  } finally {
    busy = false;
  }
}
function originFor(p, stop = null) {
  const packageId = isOSM(p)
    ? "osm"
    : p.key.startsWith("shopping:")
      ? "overture"
      : "other";
  const local = state.places.find((x) => x.snapshot.key === p.key);
  return {
    packageId,
    feedDatasetVersion: stop
      ? visitVersion(state, stop)
      : local?.sourceRef?.datasetVersion || sourceVersion(p) || null,
  };
}
function saveZip(files, name) {
  preflightFiles(files);
  const url = URL.createObjectURL(zipFiles(files));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function exportBackupZip(tripId = null) {
  try {
    const data = backup(state, tripId);
    const files = await completeBackupFiles(data, DB.osmVersion);
    saveZip(files, "japan-backup-with-sources.zip");
  } catch (e) {
    toast(e.message);
  }
}
async function exportOSMSource(exactVersion = null) {
  try {
    const version = exactVersion || feeds["shopping:osm"]?.datasetVersion;
    if (!version)
      throw Error("OpenStreetMap source is not loaded; reload online.");
    saveZip(
      await completeOSMFiles([version], DB.osmVersion),
      "japan-osm-source-and-notices.zip",
    );
  } catch (e) {
    toast(e.message);
  }
}
function download(value, filename) {
  const blob = new Blob([JSON.stringify(value)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  try {
    localStorage.setItem("japan-trip-last-export", M.now());
  } catch {}
  toast("Export prepared. Save the file somewhere safe.");
}
function modal(title, body, setup) {
  $("dialog-body").innerHTML =
    `<div class="dialog-head"><h2>${esc(title)}</h2><button type="button" data-close aria-label="Close dialog">×</button></div>${body}`;
  $("dialog-body").querySelector("[data-close]").onclick = () => close();
  if (!$("dialog").open) $("dialog").showModal();
  setup?.();
}
function close() {
  $("dialog").close();
  dropAction = null;
}
function formError(e) {
  const target = $("form-error");
  if (target) target.textContent = e.message || e;
  else toast(e.message || e);
}
const footer = (label) =>
  `<p id="form-error" class="form-error" role="alert"></p><div class="dialog-footer"><button type="button" data-cancel>Cancel</button><button class="primary" type="submit">${label}</button></div>`;
function setupForm(handler) {
  $("dialog-body")
    .querySelector("[data-cancel]")
    ?.addEventListener("click", close);
  $("dialog-body")
    .querySelector("form")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await handler(new FormData(e.target));
      } catch (err) {
        formError(err);
      }
    });
}
const val = (f, k) => String(f.get(k) || "").trim();
function int(f, k, min = 0, max = 10080) {
  const raw = val(f, k),
    n = Number(raw);
  if (raw === "" || !Number.isInteger(n) || n < min || n > max)
    throw Error(`${k} must be a whole number between ${min} and ${max}.`);
  return n;
}
function timeMinute(s) {
  if (!/^\d\d:\d\d$/.test(s)) throw Error("Enter time as HH:mm.");
  const [h, m] = s.split(":").map(Number);
  if (h > 23 || m > 59) throw Error("Time must be between 00:00 and 23:59.");
  return h * 60 + m;
}
const hhmm = (n) =>
  String(Math.floor(n / 60)).padStart(2, "0") +
  ":" +
  String(n % 60).padStart(2, "0");
function pickContext() {
  if (!trip()) {
    activeTrip = state.trips[0]?.id || null;
  }
  if (!day() || day().tripId !== activeTrip)
    activeDay = trip()?.dayIds[0] || null;
}
function navigate(next) {
  screen = next;
  location.hash = next;
  render();
}
function render() {
  if (!ready) return;
  if ($("discover-controls")) controlsOpen = $("discover-controls").open;
  if ($("filters")) discover.open = $("filters").open;
  pickContext();
  screen = ["trips", "day", "discover", "spots", "settings"].includes(
    location.hash.slice(1),
  )
    ? location.hash.slice(1)
    : "trips";
  if (map) {
    map.stop();
    map.remove();
    map = null;
  }
  markers.clear();
  for (const a of document.querySelectorAll("[data-tab]"))
    a.setAttribute("aria-current", a.dataset.tab === screen ? "page" : "false");
  ({
    trips: renderTrips,
    day: renderDay,
    discover: renderDiscover,
    spots: renderSpots,
    settings: renderSettings,
  })[screen]();
}
function renderTrips() {
  $("content").innerHTML =
    `<section class="narrow"><div class="toolbar"><div><h1>Your Japan trips</h1><p class="muted">A notebook for the places along the way.</p></div><button class="primary" data-action="new-trip">New trip</button></div><section class="map-entry" aria-label="Sauna, food and shopping map"><h2>Sauna, food & shopping</h2><p>Show all three layers together. Find places, save them or add them to a trip.</p><div class="actions"><button class="primary" data-action="discover-source" data-id="saunachelin">Browse saunas</button><button class="primary" data-action="discover-source" data-id="tabelog">Browse food</button><button data-action="discover-source" data-id="shopping">Browse shopping</button></div>${originalApps()}</section>${state.trips.map((t) => `<article class="trip-row"><div><h2>${esc(t.name)}</h2><p class="muted">${esc(t.startDate)} – ${esc(t.endDate)} · Japan time</p><small>${t.dayIds.length} days · ${state.stops.filter((s) => s.tripId === t.id).length} visits${t.unassignedStopIds.length ? " · " + t.unassignedStopIds.length + " unassigned" : ""}</small></div><div class="actions"><button class="primary" data-action="open-trip" data-id="${t.id}">Open trip</button><button data-action="edit-trip" data-id="${t.id}">Edit dates</button></div></article>`).join("") || '<div class="empty"><h2>Where will you go?</h2><p>Create a trip with your dates, then add places from Discover or your own notes.</p></div>'}<div class="section-divider"><h3>Try a sample week</h3><p class="muted">January 11–17, 2027: Tokyo, Sendai, Yamagata and Matsushima. These are list-only destination placeholders, not a verified route or winter travel advice. Hakodate is a later extension.</p><button data-action="sample">Create sample week</button></div><p class="attribution">Trips stay in this browser. Export a backup before travelling or clearing browser storage.</p></section>`;
}
function editTrip(existing) {
  $("dialog").dataset.trip = existing?.id || "";
  modal(
    existing ? "Edit trip" : "New trip",
    `<form><label>Trip name<input name="name" required maxlength="2000" value="${esc(existing?.name || "")}"></label><div class="grid2"><label>First day<input type="date" name="start" required value="${existing?.startDate || "2027-01-11"}"></label><label>Last day (inclusive)<input type="date" name="end" required value="${existing?.endDate || "2027-01-17"}"></label></div><label>Trip notes<textarea name="notes" maxlength="20000">${esc(existing?.notes || "")}</textarea></label>${existing ? '<label class="check"><input type="checkbox" name="shift">Shift existing days to the new dates in order</label><p class="muted">By default, visits keep their calendar dates. Visits on removed dates go to Unassigned. Nothing is silently deleted.</p>' : ""}${existing ? '<button type="button" id="delete-trip" class="danger">Delete trip</button>' : ""}${footer(existing ? "Preview changes" : "Create trip")}</form>`,
    () =>
      setupForm(async (f) => {
        const label = val(f, "name"),
          start = val(f, "start"),
          end = val(f, "end");
        if (
          !label ||
          start > end ||
          !Number.isFinite(Date.parse(start)) ||
          Date.parse(end) - Date.parse(start) > 365 * 86400000
        )
          throw Error(
            "Enter a name and an inclusive date range of 1–366 days.",
          );
        if (!existing) {
          const ok = await commit((s) => {
            const t = M.makeTrip(s, {
              name: label,
              startDate: start,
              endDate: end,
              notes: val(f, "notes"),
            });
            activeTrip = t.id;
            activeDay = t.dayIds[0];
          });
          if (ok) {
            close();
            navigate("day");
          }
        } else {
          const shift = f.has("shift"),
            next = M.clone(state),
            t = next.trips.find((t) => t.id === existing.id);
          M.changeDates(next, t, start, end, shift);
          t.name = label;
          t.notes = val(f, "notes");
          const removed = state.days.filter(
            (d) => d.tripId === t.id && !t.dayIds.includes(d.id),
          );
          modal(
            "Confirm date changes",
            `<p>${shift ? "Shift days in their current order." : "Preserve calendar dates."} ${t.unassignedStopIds.length} visits will be in Unassigned.</p>${removed.map((d) => `<p>${d.date}: ${d.stopIds.length} visits moved to Unassigned.</p>`).join("")}<div class="actions"><button id="apply-dates" class="primary">Apply changes</button><button id="cancel-dates">Cancel</button></div>`,
            () => {
              $("cancel-dates").onclick = close;
              $("apply-dates").onclick = async () => {
                if (await commit((s) => Object.assign(s, next))) close();
              };
            },
          );
        }
      }),
  );
}
async function sample() {
  const ok = await commit((s) => {
    const t = M.makeTrip(s, {
      name: "Sample · January in Japan",
      startDate: "2027-01-11",
      endDate: "2027-01-17",
      notes:
        "Illustrative sample only. Check actual transport, operating hours and winter conditions. Hakodate is not included.",
    });
    const cities = [
      "Tokyo",
      "Tokyo",
      "Sendai",
      "Sendai",
      "Yamagata city",
      "Yamagata city",
      "Matsushima",
    ];
    for (let i = 0; i < 7; i++) {
      const p = M.manualPlace({
        names: {
          ja: null,
          en: cities[i] + " — sample destination",
          romaji: null,
          branchJa: null,
        },
        reviewNotes: [
          "List-only sample placeholder; no venue or route verification.",
        ],
      });
      M.addStop(
        s,
        s.days.find((d) => d.id === t.dayIds[i]),
        p,
      );
    }
    activeTrip = t.id;
    activeDay = t.dayIds[0];
  });
  if (ok) navigate("day");
}
const context = () =>
  `<label class="inline-field">Trip<select id="trip-select">${state.trips.map((t) => `<option value="${t.id}" ${t.id === activeTrip ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>`;
function renderDay() {
  const t = trip(),
    d = day();
  if (!t || !d) {
    $("content").innerHTML =
      '<section class="narrow empty"><h1>Start with a trip</h1><p>Choose your dates, then build one day at a time.</p><button class="primary" data-action="new-trip">New trip</button></section>';
    return;
  }
  const rows = M.schedule(state, d),
    warnings = M.warnings(state, d, t);
  $("content").innerHTML =
    `<div class="toolbar"><div><h1>${esc(t.name)}</h1><small>All planning times are in Japan (Asia/Tokyo).</small></div><div class="actions">${context()}<button data-action="edit-trip" data-id="${t.id}">Trip details</button><button data-action="export-trip">Export trip</button><button data-action="export-trip-zip">Trip + offline source ZIP</button><button data-action="handoff-day">Day in Google Maps</button></div></div><div class="date-strip" aria-label="Trip days">${t.dayIds
      .map((id, i) => {
        const date = state.days.find((d) => d.id === id);
        return `<button data-action="select-day" data-id="${id}" class="${id === activeDay ? "selected" : ""}">Day ${i + 1}<small>${date.date.slice(5)}</small></button>`;
      })
      .join(
        "",
      )}</div><div class="toolbar"><label class="inline-field">Day starts<input id="day-start" type="time" value="${hhmm(d.startMinute)}"></label><div class="actions"><button class="map-toggle" data-action="map-toggle">${mapMode ? "Show list" : "Show map"}</button><button class="primary" data-action="add">Add stop</button></div></div>${warnings.length ? `<ul class="warning-list">${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}<div class="workspace ${mapMode ? "show-map" : ""}"><section class="list-pane" aria-label="Day itinerary">${rows.map((row, i) => travelHTML(row, d) + visitHTML(row, d, i)).join("") || '<div class="empty"><h2>A day to make your own</h2><p>Add a place from the award maps, a saved spot or your own notes.</p><button data-action="add">Add the first stop</button></div>'}${
      t.unassignedStopIds.length
        ? `<div class="section-divider"><h2>Unassigned visits</h2><p>These visits were preserved when dates changed.</p>${t.unassignedStopIds
            .map((id) => {
              const st = state.stops.find((x) => x.id === id);
              return `<p>${esc(M.name(M.visitPlace(st)))} <button data-action="move" data-id="${id}">Move to day</button></p>`;
            })
            .join("")}</div>`
        : ""
    }<details><summary>Planning assumptions and warnings</summary><p>Times are rough estimates, not timetables or road routes. Walk: 4 km/h × 1.25 detour. Drive: 35 km/h × 1.35 + 10 minutes. Train: 45 km/h × 1.3 + 20 minutes. Estimates round up to whole minutes. Verify intercity travel and access.</p><button data-action="thresholds">Edit this trip’s warning thresholds</button><p>Unknown travel makes downstream times unknown. An award does not prove a venue is operating.</p></details></section><aside class="map-wrap"><div id="map" class="map" aria-label="Day itinerary map"></div><p class="map-note">Itinerary sketch · straight lines, not routes. Gaps remain at unknown locations. Tap overlapping numbers to choose a visit.</p></aside></div>`;
  wireContext();
  $("day-start").onchange = async (e) => {
    try {
      const n = timeMinute(e.target.value);
      await commit((s) => (s.days.find((x) => x.id === d.id).startMinute = n));
    } catch (err) {
      toast(err.message);
    }
  };
  initMap(
    "day",
    rows.map((r) => ({ p: M.visitPlace(r.stop), id: r.stop.id })),
  );
  wireDrag();
}
function travelHTML(row, d) {
  const seg = row.segment;
  if (!seg) return "";
  const stale =
    seg.manualMinutes !== null &&
    seg.overrideFingerprint !== seg.coordinateFingerprint;
  return `<div class="travel"><div class="actions"><select aria-label="Travel mode" data-mode="${seg.toStopId}">${["walk", "train", "drive"].map((m) => `<option ${m === seg.mode ? "selected" : ""}>${m}</option>`).join("")}</select><strong>${row.travel === null ? "Travel time unknown" : row.travel + " min"}</strong><span>${seg.manualMinutes !== null ? "Manual" : "Planning estimate"}</span></div>${stale ? '<p class="danger">Location changed — review this manual time.</p>' : ""}<div class="actions"><button data-action="travel" data-id="${seg.toStopId}">Set minutes</button>${seg.manualMinutes !== null ? `<button data-action="reset-travel" data-id="${seg.toStopId}">Reset to estimate</button>` : ""}<button data-action="directions" data-id="${seg.toStopId}">Directions</button></div></div>`;
}
function sourceAccessHTML(p, version) {
  if (!isOSM(p)) return "";
  const offer = version
    ? { ...state.dataLicenses, ...sourceLicenseTexts }[
        "shopping:osm-" + version + "-SOURCE-DOWNLOAD.txt"
      ]
    : null;
  const url = offer?.match(
    /Complete selected derivative: (https?:\/\/\S+)/,
  )?.[1];
  return `<p class="source-access attribution" data-source-version="${esc(version || "unknown")}">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a>${url && M.safeURL(url) ? ` · <a class="source-offer" href="${esc(url)}" target="_blank" rel="noopener">This version’s complete derivative</a>` : " · Exact historical source offer is unavailable; original snapshot retained."}${version ? ` <button data-action="export-osm-version" data-id="${esc(version)}">Source & notices for this version</button>` : ""}</p>`;
}
function visitHTML(row, d, i) {
  const st = row.stop,
    p = M.visitPlace(st),
    current = allPlaces().find((x) => x.key === p.key),
    missing = !p.key.startsWith("manual:") && !current;
  return `<article class="visit ${selected === st.id ? "selected" : ""}" data-stop="${st.id}"><div class="visit-head"><span class="visit-number">${i + 1}</span><div class="visit-title"><h3><button class="name-button" data-action="edit-stop" data-id="${st.id}" lang="ja">${esc(M.name(p))}</button></h3><div class="time">${row.arrival === null ? "Time unknown" : M.timeLabel(d.date, row.arrival) + " – " + M.timeLabel(d.date, row.departure)}</div><small>${st.durationMinutes} min visit</small></div><button class="drag-handle" aria-label="Drag visit ${i + 1} to reorder" data-drag="${st.id}">⠿</button></div><p>${isOSM(p) ? "Address reference (may be partial): " : ""}${esc(p.address.ja || "Japanese address not supplied")}</p><div><span class="badge ${M.located(p) && p.location.confidence === "high" ? "" : "warn"}">${M.located(p) ? p.location.confidence + " confidence pin" : "Location unknown · list only"}</span><span class="badge">${esc(p.operatingStatus.value === "unknown" ? "Operating status unverified" : p.operatingStatus.value)}</span>${missing ? '<span class="badge warn">Not in current source</span>' : ""}</div>${p.operatingStatus.note ? `<p class="notice">${esc(p.operatingStatus.note)}</p>` : ""}<p>${esc(M.hoursResult(p.hours, d.date, row.arrival, row.departure))}</p>${st.notes ? `<p>${esc(st.notes)}</p>` : ""}${sourceAccessHTML(p, visitVersion(state, st))}<div class="actions"><button data-action="up" data-id="${st.id}" ${i === 0 ? "disabled" : ""}>Move up</button><button data-action="down" data-id="${st.id}" ${i === d.stopIds.length - 1 ? "disabled" : ""}>Move down</button><button data-action="move" data-id="${st.id}">Move to day</button><button data-action="save-visit" data-id="${st.id}">Save to Spots</button><button data-action="show-stop" data-id="${st.id}">Show pin</button><button data-action="remove-stop" data-id="${st.id}">Remove</button></div></article>`;
}
function wireContext() {
  $("trip-select")?.addEventListener("change", (e) => {
    activeTrip = e.target.value;
    activeDay = trip().dayIds[0];
    render();
  });
  document.querySelectorAll("[data-mode]").forEach(
    (el) =>
      (el.onchange = () =>
        commit((s) =>
          M.setMode(
            s,
            s.segments.find((x) => x.toStopId === el.dataset.mode),
            el.value,
          ),
        )),
  );
}
function wireDrag() {
  let drag = null;
  document.querySelectorAll("[data-drag]").forEach((el) => {
    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      drag = { id: el.dataset.drag, pointer: e.pointerId, target: null };
      el.setPointerCapture(e.pointerId);
      el.closest(".visit").classList.add("dragging");
    };
    el.onpointermove = (e) => {
      if (!drag) return;
      document
        .querySelectorAll(".drop-target")
        .forEach((x) => x.classList.remove("drop-target"));
      const target = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-stop]");
      if (target) {
        drag.target = target.dataset.stop;
        target.classList.add("drop-target");
      }
      if (e.clientY > innerHeight - 100) window.scrollBy(0, 12);
      if (e.clientY < 100) window.scrollBy(0, -12);
    };
    el.onpointerup = async () => {
      if (!drag) return;
      const info = drag;
      drag = null;
      document
        .querySelectorAll(".dragging,.drop-target")
        .forEach((x) => x.classList.remove("dragging", "drop-target"));
      if (info.target && info.target !== info.id) {
        const index = day().stopIds.indexOf(info.target);
        if (await commit((s) => M.moveStop(s, info.id, activeDay, index)))
          toast("Visit moved to position " + (index + 1));
      }
    };
    el.onpointercancel = () => {
      drag = null;
      document
        .querySelectorAll(".dragging,.drop-target")
        .forEach((x) => x.classList.remove("dragging", "drop-target"));
    };
  });
}
function moveDialog(stopId) {
  const st = state.stops.find((x) => x.id === stopId),
    t = state.trips.find((t) => t.id === st.tripId);
  modal(
    "Move visit",
    `<form><label>Destination day<select name="day">${t.dayIds.map((id) => `<option value="${id}">${state.days.find((d) => d.id === id).date}</option>`).join("")}<option value="">Unassigned</option></select></label><p>Moves this visit to the end of the selected day. Notes and duration stay with it.</p>${footer("Move visit")}</form>`,
    () =>
      setupForm(async (f) => {
        const id = val(f, "day");
        if (
          await commit((s) =>
            M.moveStop(
              s,
              stopId,
              id,
              s.days.find((d) => d.id === id)?.stopIds.length || 0,
            ),
          )
        )
          close();
      }),
  );
}
function travelDialog(toId) {
  const seg = state.segments.find((x) => x.toStopId === toId);
  modal(
    "Travel time",
    `<form><p>Enter your checked planning time. This overrides the estimate only for this pair of visits and mode.</p><label>Minutes<input type="number" name="minutes" min="0" max="10080" step="1" required value="${seg.manualMinutes ?? seg.estimatedMinutes ?? ""}"></label><p class="muted">Estimate: ${seg.estimatedMinutes === null ? "unknown" : seg.estimatedMinutes + " minutes"}. Zero means an explicit zero-minute journey.</p>${footer("Save travel time")}</form>`,
    () =>
      setupForm(async (f) => {
        const n = int(f, "minutes");
        if (
          await commit((s) => {
            const x = s.segments.find((x) => x.toStopId === toId);
            x.manualMinutes = n;
            x.overrideFingerprint = x.coordinateFingerprint;
          })
        )
          close();
      }),
  );
}
function navigationDialog(toId) {
  const seg = state.segments.find((x) => x.toStopId === toId),
    from = state.stops.find((x) => x.id === seg.fromStopId),
    to = state.stops.find((x) => x.id === toId),
    d = state.days.find((d) => d.stopIds.includes(toId)),
    row = M.schedule(state, d).find((x) => x.stop.id === from.id),
    url = M.directions(M.visitPlace(from), M.visitPlace(to), seg.mode),
    time = M.timeLabel(d.date, row.departure);
  modal(
    "Check the journey",
    `<p>Google Maps opens ${seg.mode === "train" ? "transit (which may include buses)" : esc(seg.mode)} directions. Confirm the actual route and date there.</p><p>Planned departure: <strong>${d.date} ${esc(time)} Japan time</strong></p><div class="actions"><a class="button primary" href="${esc(url)}" target="_blank" rel="noopener">Open Google Maps</a><button id="copy-time">Copy Japan date/time</button></div><p class="muted">The link does not prefill a departure time. Estimates do not establish winter feasibility or train availability.</p>`,
    () => {
      $("copy-time").onclick = () => copy(`${d.date} ${time} Asia/Tokyo`);
    },
  );
}
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    modal(
      "Copy this text",
      `<textarea readonly id="copy-text">${esc(text)}</textarea>`,
      () => {
        $("copy-text").select();
      },
    );
  }
}
function addDialog() {
  if (!day()) {
    toast("Create or choose a trip first.");
    navigate("trips");
    return;
  }
  modal(
    "Add a stop",
    `<div class="actions"><button id="add-discover" class="primary">From Discover</button><button id="add-saved">From Saved Spots</button><button id="add-manual">Manual entry / link</button><button id="add-search">Search for a place</button><button id="add-pin">Drop a map pin</button></div><p class="muted">Manual entries and saved places work offline. Unknown locations can be scheduled as list-only stops.</p>`,
    () => {
      $("add-discover").onclick = () => {
        close();
        navigate("discover");
      };
      $("add-saved").onclick = () => {
        close();
        navigate("spots");
      };
      $("add-manual").onclick = () => editor();
      $("add-search").onclick = () => searchDialog("stop");
      $("add-pin").onclick = () => {
        close();
        mapMode = true;
        render();
        dropAction = "stop";
        toast("Tap a location on the map.");
      };
    },
  );
}
async function addPlace(p) {
  if (!state.trips.length) {
    toast("Create a trip before adding a visit.");
    navigate("trips");
    return;
  }
  modal(
    "Add to day",
    `<form><p lang="ja">${esc(M.name(p))}</p><label>Trip and day<select name="destination">${state.trips.map((t) => `<optgroup label="${esc(t.name)}">${t.dayIds.map((id) => `<option value="${id}" ${id === activeDay ? "selected" : ""}>${state.days.find((d) => d.id === id).date}</option>`).join("")}</optgroup>`).join("")}</select></label><p>A new visit has its own notes and duration, even if you already scheduled this place.</p>${footer("Add visit")}</form>`,
    () =>
      setupForm(async (f) => {
        const target = val(f, "destination");
        if (
          await commit((s) => {
            const d = s.days.find((d) => d.id === target);
            M.addStop(s, d, p, sourceVersion(p));
            activeTrip = d.tripId;
            activeDay = d.id;
          })
        ) {
          close();
          toast("Added to " + day().date);
        }
      }),
  );
}
function hoursFields(hours) {
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const fmt = (v) =>
    v === null
      ? "unknown"
      : v.length
        ? v
            .map(
              (r) =>
                hhmm(r.startMinute) +
                "-" +
                hhmm(r.endMinute % 1440) +
                (r.endMinute >= 1440 ? "+1" : ""),
            )
            .join(", ")
        : "closed";
  return `<details><summary>Structured opening hours (optional)</summary><p>Enter intervals such as 11:00-14:00, 18:00-02:00+1. Use “closed” or “unknown”. This checks the full visit, not free-text hours.</p><label class="check"><input type="checkbox" name="useHours" ${hours ? "checked" : ""}>Use structured hours</label>${days.map((k) => `<div class="hours-row"><label for="hours-${k}">${k[0].toUpperCase() + k.slice(1)}</label><input id="hours-${k}" name="hours-${k}" value="${esc(fmt(hours?.weekly[k] ?? null))}"></div>`).join("")}<label>Date exceptions<textarea name="exceptions" placeholder="2027-01-12 = closed">${esc(
    Object.entries(hours?.exceptions || {})
      .map(([date, v]) => date + " = " + fmt(v))
      .join("\n"),
  )}</textarea></label><p class="muted">One date per line. An explicit closed date also closes overnight hours carried into that date.</p><label>Checked date (optional)<input type="date" name="hoursChecked" value="${hours?.checkedAt || ""}"></label><label>Hours source URL (optional)<input name="hoursSource" type="url" value="${esc(hours?.sourceUrl || "")}"></label></details>`;
}
function parseIntervals(text) {
  text = text.trim().toLowerCase();
  if (!text || text === "unknown") return null;
  if (text === "closed") return [];
  return text
    .split(",")
    .map((s) => {
      const m = s.trim().match(/^(\d\d:\d\d)-(\d\d:\d\d)(\+1)?$/);
      if (!m)
        throw Error("Use opening intervals like 11:00-14:00 or 18:00-02:00+1.");
      return {
        startMinute: timeMinute(m[1]),
        endMinute: timeMinute(m[2]) + (m[3] ? 1440 : 0),
      };
    })
    .sort((a, b) => a.startMinute - b.startMinute);
}
function readHours(f) {
  if (!f.has("useHours")) return null;
  const weekly = Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((k) => [
        k,
        parseIntervals(val(f, "hours-" + k)),
      ]),
    ),
    exceptions = {};
  for (const line of val(f, "exceptions")
    .split("\n")
    .filter((x) => x.trim())) {
    const m = line.match(/^\s*(\d{4}-\d\d-\d\d)\s*=\s*(.+)$/);
    if (!m)
      throw Error("Date exceptions use YYYY-MM-DD = closed (or intervals).");
    if (Object.hasOwn(exceptions, m[1]))
      throw Error("Duplicate exception date.");
    exceptions[m[1]] = parseIntervals(m[2]);
  }
  const h = {
    schemaVersion: 1,
    timeZone: "Asia/Tokyo",
    weekly,
    exceptions,
    checkedAt: val(f, "hoursChecked") || null,
    sourceUrl: val(f, "hoursSource") || null,
  };
  if (!validHours(h))
    throw Error(
      "Check hours: valid dates, non-overlapping intervals and end later than start are required.",
    );
  return h;
}
function editor({
  stopId = null,
  placeId = null,
  initial = null,
  resetPlace = false,
} = {}) {
  const st = state.stops.find((x) => x.id === stopId),
    lp = state.places.find((x) => x.id === placeId),
    p = st
      ? resetPlace
        ? st.placeSnapshot
        : M.visitPlace(st)
      : lp
        ? resetPlace
          ? lp.snapshot
          : M.effective(lp)
        : initial || M.manualPlace();
  modal(
    st ? "Edit this visit" : lp ? "Edit saved place" : "New manual place",
    `<form><p class="muted">${st ? "Edits apply only to this visit." : lp ? "Scheduled visits keep their own snapshots." : "No location is required. Names and translations remain as you enter them."}</p><label>Japanese name<input name="ja" value="${esc(p.names.ja)}"></label><div class="grid2"><label>English name (optional)<input name="en" value="${esc(p.names.en)}"></label><label>Romaji (optional)<input name="romaji" value="${esc(p.names.romaji)}"></label></div><label>Japanese address<textarea name="address">${esc(p.address.ja)}</textarea></label><label>Category<input name="category" value="${esc(p.category)}"></label><div class="grid2"><label>Latitude<input name="lat" type="number" step="any" min="-90" max="90" value="${p.location.lat ?? ""}"></label><label>Longitude<input name="lng" type="number" step="any" min="-180" max="180" value="${p.location.lng ?? ""}"></label></div><label>Paste coordinates or Google Maps link<input id="paste-location" placeholder="35.68,139.76 or full Google Maps URL"></label><button type="button" id="parse-location">Preview pasted location</button><p id="parse-result" class="muted"></p><label>Extra link (optional)<input type="url" name="extraLink" id="extra-link" placeholder="https://…"></label><label>Opening-hours text<textarea name="hoursText">${esc(p.hoursText)}</textarea></label>${hoursFields(p.hours)}${st || !lp ? `<div class="grid2"><label>Visit duration (minutes)<input type="number" min="0" max="10080" step="1" name="duration" value="${st?.durationMinutes ?? 60}"></label><label>Operating status<select name="status">${["unknown", "active", "closed", "relocated", "renamed"].map((v) => `<option ${p.operatingStatus.value === v ? "selected" : ""}>${v}</option>`).join("")}</select></label></div><label>Visit notes<textarea name="notes">${esc(st?.notes || "")}</textarea></label>` : `<label>Operating status<select name="status">${["unknown", "active", "closed", "relocated", "renamed"].map((v) => `<option ${p.operatingStatus.value === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>`}${st || lp ? '<button type="button" id="reset-fields">Reset place fields to saved snapshot</button>' : ""}<details><summary>Source and location notes</summary><p>${esc(p.reviewNotes.join(" · ") || "No additional source notes.")}</p>${p.provenance.map((e) => `<p>${esc(e.field)}: ${esc(e.note || e.sourceKind)}</p>`).join("")}<p>Coordinate confidence does not verify an entrance or operating status.</p></details>${footer(st || lp ? "Save changes" : "Add to selected day")}</form>`,
    () => {
      let reset = false;
      $("reset-fields")?.addEventListener("click", () => {
        editor({ stopId, placeId, resetPlace: true });
        toast("Snapshot fields restored in the editor. Save to apply.");
      });
      $("parse-location").onclick = () => {
        const raw = $("paste-location").value,
          point = M.parseCoordinates(raw) || M.parseMapURL(raw);
        if (point) {
          $("parse-result").innerHTML =
            `Coordinates: ${point.lat}, ${point.lng}. <button type="button" id="accept-point">Use these coordinates</button>`;
          $("accept-point").onclick = () => {
            const form = $("dialog-body").querySelector("form");
            form.elements.lat.value = point.lat;
            form.elements.lng.value = point.lng;
            $("parse-result").textContent =
              "Coordinates added. Confirm this is the intended place.";
          };
        } else if (M.safeURL(raw)) {
          $("extra-link").value = raw;
          $("parse-result").textContent =
            "Link retained. This format does not identify unambiguous place coordinates. Enter the address or pin manually.";
        } else
          $("parse-result").textContent =
            "Enter a valid coordinate pair or HTTP(S) link.";
      };
      setupForm(async (f) => {
        const lat = val(f, "lat"),
          lng = val(f, "lng");
        if (!!lat !== !!lng)
          throw Error("Enter both coordinates or leave both blank.");
        if (
          lat &&
          (!Number.isFinite(+lat) ||
            !Number.isFinite(+lng) ||
            Math.abs(+lat) > 90 ||
            Math.abs(+lng) > 180)
        )
          throw Error("Coordinates are out of range.");
        const updated = M.clone(p);
        updated.names = {
          ...p.names,
          ja: val(f, "ja") || null,
          en: val(f, "en") || null,
          romaji: val(f, "romaji") || null,
        };
        updated.address = { ...p.address, ja: val(f, "address") || null };
        updated.category = val(f, "category") || null;
        const changed =
          (lat === "" ? null : +lat) !== p.location.lat ||
          (lng === "" ? null : +lng) !== p.location.lng;
        if (changed)
          updated.location = {
            lat: lat === "" ? null : +lat,
            lng: lng === "" ? null : +lng,
            availability: lat ? "located" : "unknown",
            confidence: "unknown",
            method: "manual",
            provenance: [],
            verifiedAt: null,
          };
        updated.hoursText = val(f, "hoursText") || null;
        updated.hours = readHours(f);
        updated.operatingStatus = {
          ...p.operatingStatus,
          value: val(f, "status"),
        };
        const extra = val(f, "extraLink");
        if (extra) {
          if (!M.safeURL(extra))
            throw Error(
              "Use a safe HTTP(S) link without embedded credentials.",
            );
          updated.links.push({
            kind: "other",
            label: "Saved link",
            url: extra,
          });
        }
        const duration = lp ? null : int(f, "duration");
        const baseline = st?.placeSnapshot || lp?.snapshot || p;
        const overrides = Object.fromEntries(
          [
            "names",
            "address",
            "category",
            "location",
            "operatingStatus",
            "hoursText",
            "hours",
            "links",
            "reviewNotes",
          ]
            .filter(
              (k) => JSON.stringify(updated[k]) !== JSON.stringify(baseline[k]),
            )
            .map((k) => [k, updated[k]]),
        );
        if (
          await commit((s) => {
            if (st) {
              const target = s.stops.find((x) => x.id === st.id);
              target.placeOverrides = overrides;
              target.durationMinutes = duration;
              target.notes = val(f, "notes");
            } else if (lp) {
              const target = s.places.find((x) => x.id === lp.id);
              target.overrides = overrides;
              target.updatedAt = M.now();
            } else {
              const target = s.days.find((d) => d.id === activeDay);
              if (!target)
                throw Error("Choose a day before adding this place.");
              const added = M.addStop(s, target, updated);
              added.durationMinutes = duration;
              added.notes = val(f, "notes");
            }
          })
        )
          close();
      });
    },
  );
}
function origins() {
  if (discover.originMode === "custom")
    return discover.origin ? [discover.origin] : [];
  const ids =
    discover.originMode === "trip"
      ? state.days
          .filter((d) => d.tripId === activeTrip)
          .flatMap((d) => d.stopIds)
      : day()?.stopIds || [];
  return ids
    .map((id) => M.visitPlace(state.stops.find((x) => x.id === id)))
    .filter(M.located)
    .map((p) => p.location);
}
function renderDiscover() {
  const feed = feeds[discover.source] || {
    source: {
      namespace: discover.source,
      attribution: "Shopping feed not loaded yet",
    },
    places: [],
    lists: [],
    generatedAt: "not loaded",
  };
  if (!feed) {
    $("content").innerHTML =
      "<h1>Source unavailable</h1><p>Your itinerary and manual entries still work. Reload online to try the bundled source again.</p>";
    return;
  }
  const scheduled = new Set(
      state.stops
        .filter((s) => s.tripId === activeTrip)
        .map((s) => s.placeSnapshot.key),
    ),
    result = M.filterPlaces(feed, discover, origins(), scheduled, state.flags),
    years = [
      ...new Set(
        feed.source.namespace === "saunachelin"
          ? feed.places
              .flatMap((p) => p.awards.map((a) => String(a.year)))
              .filter((y) => y !== "null")
          : feed.lists.map((l) => String(l.year)),
      ),
    ]
      .sort()
      .reverse(),
    categories = [...new Set(feed.lists.map((l) => l.category))],
    prefs = [
      ...new Set(feed.places.map((p) => p.address.prefecture).filter(Boolean)),
    ].sort(),
    regions =
      discover.source === "tabelog"
        ? [...new Set(feed.lists.map((l) => l.region))]
        : Object.keys(M.regions);
  sourceFilters[discover.source] = { ...discover };
  const combined = combineLayers(
    feeds,
    visibleLayers,
    Object.fromEntries(
      Object.keys(feeds).map((ns) => [
        ns,
        {
          ...filterFor(feeds[ns].source.namespace),
          packageVisibility: shoppingPackages,
          includeClosed: filterFor("shopping").includeClosed ?? false,
          radius: discover.radius,
          originMode: discover.originMode,
          includeScheduled: discover.includeScheduled,
        },
      ]),
    ),
    origins(),
    scheduled,
    state.flags,
    shoppingAliases,
  );
  sourceMatchCounts = combined.sourceCounts;
  result.rows = combined.rows;
  result.unknown = combined.unknown;
  $("content").innerHTML =
    `<div class="toolbar"><div><h1>Maps & shopping</h1><button class="map-toggle" data-action="map-toggle">${mapMode ? "Expand list" : "Show map"}</button><p class="muted">${day() ? "Adding to " + day().date + " · " + esc(trip().name) : "Choose a trip and day when you add a place."}</p></div>${state.trips.length ? context() : ""}</div>${layersHTML(combined.counts)}<details id="discover-controls" ${controlsOpen ? "open" : ""}><summary>Search & filters · ${esc(discover.source === "shopping" ? "Shopping" : discover.source === "tabelog" ? "Food" : "Saunas")}</summary><p>Choose which filters to edit. Use the checkboxes above to show multiple layers together.</p><div class="toolbar"><div class="source-tabs" role="group" aria-label="Choose filters to edit"><button data-action="source" data-id="saunachelin" aria-pressed="${discover.source === "saunachelin"}">Saunas</button><button data-action="source" data-id="tabelog" aria-pressed="${discover.source === "tabelog"}">Food awards</button><button data-action="source" data-id="shopping" aria-pressed="${discover.source === "shopping"}">Shopping</button></div><button class="map-toggle" data-action="map-toggle">${mapMode ? "Show list" : "Show map"}</button></div>${originalApps()}<details id="filters" ${discover.open ? "open" : ""}><summary>Filters for ${esc(discover.source === "shopping" ? "Shopping" : discover.source === "tabelog" ? "Food" : "Saunas")}</summary>${discover.source === "shopping" ? shoppingFiltersHTML() : ""}<label>Search this dataset<input id="local-search" type="search" value="${esc(discover.q)}" placeholder="Name, city or Japanese address"></label><div class="grid2"><label>Distance from<select id="origin-mode"><option value="day" ${discover.originMode === "day" ? "selected" : ""}>Selected day’s stops</option><option value="trip" ${discover.originMode === "trip" ? "selected" : ""}>Whole trip’s stops</option><option value="custom" ${discover.originMode === "custom" ? "selected" : ""}>Chosen origin</option></select></label><label>Radius<select id="radius">${[1, 3, 5, 10, 20, 50, 100, 0].map((n) => `<option value="${n}" ${discover.radius === n ? "selected" : ""}>${n ? n + " km" : "All distances"}</option>`).join("")}</select></label></div><div class="actions"><button data-action="gps">Near me</button><button data-action="origin">Choose origin</button></div><p class="muted">${discover.originMode === "custom" ? esc(discover.originLabel || "No origin selected") : origins().length + " located scheduled stops"}. Approximate straight-line distance, not access or travel time.</p>${discover.source === "shopping" ? "" : "<p>Award years</p>" + chips("years", years, discover.years)}${categories.length ? "<p>Food categories</p>" + chips("categories", categories, discover.categories) : ""}<div class="grid2"><label>Region<select id="region"><option value="">All</option>${regions.map((x) => `<option ${discover.region === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label><label>Prefecture<select id="prefecture"><option value="">All</option>${prefs.map((x) => `<option ${discover.prefecture === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label></div>${discover.source === "tabelog" ? `<label>Award list<select id="list-filter"><option value="">All imported lists</option>${feed.lists.map((l) => `<option value="${esc(l.listId)}" ${discover.listId === l.listId ? "selected" : ""}>${esc(l.titleJa)}</option>`).join("")}</select></label>` : ""}<div class="grid2">${(discover.source ===
    "saunachelin"
      ? [
          ["hof", "Hall of Fame"],
          ["multi", "Multiple award years"],
          ["special", "Include special awards"],
        ]
      : discover.source === "tabelog"
        ? [["first", "First-time picks"]]
        : []
    )
      .concat([
        ["saved", "Saved only"],
        ["visited", "Visited only"],
        ["includeScheduled", "Include already scheduled"],
      ])
      .map(
        ([key, label]) =>
          `<label class="check"><input type="checkbox" data-filter="${key}" ${discover[key] ? "checked" : ""}>${label}</label>`,
      )
      .join(
        "",
      )}</div><div class="actions"><button data-action="reset-filters">Reset filters</button></div></details></details>${!origins().length && discover.radius ? '<div class="notice">No located stops to measure from yet. Choose an origin, add a pin, or set All distances. Unknown locations stay in their own list.</div>' : ""}<p class="muted">${discover.source === "shopping" ? "Shopping source records may overlap and are not verified unique active stores. Hours references are unverified; structured hours remain unknown." : discover.source === "tabelog" ? "Food coverage follows imported lists. Hyakumeiten is unranked." : "Historical sauna awards do not establish current operation."}</p><div class="workspace discovery-workspace ${mapMode ? "show-map" : ""}"><section class="list-pane"><p class="muted">Shopping matches are source records that may overlap; no unique-store census is claimed.</p>${feeds["shopping:osm"] && shoppingPackages.osm && visibleLayers.shopping ? `<p class="attribution">Shopping data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a> · <button data-action="export-osm-source">Complete source & notices</button></p>` : ""}<p class="muted">Showing up to 100 rows per section. All matching located pins appear on the map.</p><h2>${result.rows.length} ${discover.radius ? "nearby located matches" : "located matches"}</h2>${
      result.rows
        .slice(0, 100)
        .map(({ p, km }) => card(p, km))
        .join("") ||
      '<div class="empty"><h3>No matching places</h3><p>Try another origin, widen the radius or reset filters. The current source may not cover this destination.</p><button data-action="reset-filters">Reset filters</button></div>'
    }${
      result.unknown.length
        ? `<div class="section-divider"><h2>Location unknown (${result.unknown.length})</h2><p>These match the other filters. Their distance cannot be checked; they are not counted nearby.</p>${result.unknown
            .slice(0, 100)
            .map(({ p }) => card(p, null))
            .join("")}</div>`
        : ""
    }<p class="attribution">${Object.values(feeds)
      .filter((f) => visibleLayers[layerId(f.source.namespace)])
      .map((f) => esc(f.source.title + ": " + f.source.attribution) + "<br>")
      .join(
        "",
      )} Snapshot generated ${esc(feed.generatedAt)}. This is not a venue verification date. Shopping coverage may be incomplete; missing hours remain unknown.</p></section><aside class="map-wrap"><div id="map" class="map" aria-label="Discover map"></div><p class="map-note">Approximate pins · check the address and entrance. © OpenStreetMap contributors.</p></aside></div>`;
  wireContext();
  $("discover-controls").querySelector("summary").onclick = (e) => {
    controlsOpen = !e.currentTarget.parentElement.open;
  };
  document.querySelectorAll("[data-layer]").forEach(
    (el) =>
      (el.onchange = () => {
        visibleLayers[el.dataset.layer] = el.checked;
        saveLayers();
        render();
      }),
  );
  document.querySelectorAll("[data-shopping-package]").forEach(
    (el) =>
      (el.onchange = () => {
        shoppingPackages[el.dataset.shoppingPackage] = el.checked;
        try {
          localStorage.setItem(
            "japan-shopping-sources",
            JSON.stringify(shoppingPackages),
          );
        } catch {}
        render();
      }),
  );
  if (document.querySelector("[data-shop-closed]"))
    document.querySelector("[data-shop-closed]").onchange = (e) => {
      discover.includeClosed = e.target.checked;
      render();
    };
  document.querySelectorAll("[data-shop-filter]").forEach(
    (el) =>
      (el.onchange = () => {
        const k = el.dataset.shopFilter;
        discover[k] = el.checked
          ? [...(discover[k] || []), el.value]
          : (discover[k] || []).filter((v) => v !== el.value);
        render();
      }),
  );
  $("filters").ontoggle = (e) => {
    if (e.target.isConnected) discover.open = e.target.open;
  };
  $("local-search").oninput = (e) => {
    discover.q = e.target.value;
    clearTimeout(renderDiscover.timer);
    renderDiscover.timer = setTimeout(() => {
      const pos = e.target.selectionStart;
      render();
      $("local-search").focus();
      $("local-search").setSelectionRange(pos, pos);
    }, 220);
  };
  for (const [el, key] of [
    ["origin-mode", "originMode"],
    ["region", "region"],
    ["prefecture", "prefecture"],
    ["list-filter", "listId"],
  ])
    $(el)?.addEventListener("change", (e) => {
      discover[key] = e.target.value;
      render();
    });
  $("radius").onchange = (e) => {
    discover.radius = +e.target.value;
    render();
  };
  document.querySelectorAll("[data-filter]").forEach(
    (el) =>
      (el.onchange = () => {
        discover[el.dataset.filter] = el.checked;
        render();
      }),
  );
  document.querySelectorAll("[data-chip]").forEach(
    (el) =>
      (el.onclick = () => {
        const k = el.dataset.chip,
          v = el.dataset.value;
        discover[k] =
          v === ""
            ? []
            : discover[k].includes(v)
              ? discover[k].filter((x) => x !== v)
              : [...discover[k], v];
        render();
      }),
  );
  initMap(
    "discover",
    result.rows.map(({ p }) => ({ p, id: p.key })),
  );
}
function chips(key, values, selected) {
  return `<div class="filter-chips"><button data-chip="${key}" data-value="" aria-pressed="${!selected.length}">All</button>${values.map((v) => `<button data-chip="${key}" data-value="${esc(v)}" aria-pressed="${selected.includes(v)}">${esc(v)}</button>`).join("")}</div>`;
}
function card(p, km = null, local = null) {
  const f = effectiveFlag(state.flags, p.key, shoppingAliases),
    feed = Object.values(feeds).find((f) =>
      f.places.some((x) => x.key === p.key),
    ),
    lm = new Map((feed?.lists || []).map((l) => [l.listId, l]));
  return `<article class="place-card ${selected === p.key ? "selected" : ""}" data-place="${esc(p.key)}"><div class="place-meta"><h3 lang="ja"><span class="brand-symbol">${esc(badge(p))}</span> ${esc(M.name(p))}</h3>${km !== null ? `<span class="muted">${km.toFixed(1)} km</span>` : ""}</div>${p.names.en && p.names.en !== p.names.ja ? `<p class="muted">${esc(p.names.en)}</p>` : ""}<div>${p.awards.map((a) => `<span class="badge">${a.year ?? "Year unknown"} ${a.type === "ranked" ? "No. " + a.rank : esc(a.title || a.type)}</span>`).join("")}${p.memberships
    .map((m) => {
      const l = lm.get(m.listId);
      return `<span class="badge">${esc(l ? l.category + " " + l.region + " " + l.year : m.listId)}${m.firstTimePick ? " · 初選出" : ""}</span>`;
    })
    .join(
      "",
    )}</div>${p.operatingStatus.note ? `<p class="notice">${esc(p.operatingStatus.note)}</p>` : ""}${p.operatingStatus.value === "closed" ? '<p class="notice">Recorded closed — check the source notice before planning a visit.</p>' : ""}<p>${isOSM(p) ? "Address reference (may be partial): " : ""}${esc(p.address.ja || p.address.city || "Japanese address not supplied")}</p>${p.shopping ? `<span class="badge">${isOSM(p) ? "OpenStreetMap · ODbL source" : p.key.startsWith("shopping:alltheplaces:") ? "AllThePlaces source" : "Overture source"}</span>` : ""}${sourceAccessHTML(p, local ? local.sourceRef?.datasetVersion : feed?.datasetVersion)}<span class="badge warn">${M.located(p) ? p.location.confidence + " confidence pin · check entrance" : "Location unknown"}</span><span class="badge">${esc(p.operatingStatus.value === "unknown" ? "Operating status unverified" : p.operatingStatus.value)}</span>${p.hoursText ? `<p>Hours reference: ${esc(p.hoursText)}</p>` : ""}<p class="muted">${p.hours ? "Structured hours available; checked against scheduled visits." : "Hours not checked."}</p>${p.reviewNotes.length ? `<details><summary>Location and source notes</summary><p>${esc(p.reviewNotes.join(" · "))}</p></details>` : ""}<label class="check"><input type="checkbox" data-export-key="${esc(p.key)}" ${selectedExport.has(p.key) ? "checked" : ""}>Select for Google Maps</label><p class="muted">${p.shopping ? esc(shoppingCategories[categoryFor(p.shopping.brandId)] + " · " + (Object.hasOwn(brands, p.shopping.brandId) ? brands[p.shopping.brandId] : p.shopping.brandId) + " · " + (Object.hasOwn(formats, p.shopping.formatId) ? formats[p.shopping.formatId] : p.shopping.formatId)) : p.key.startsWith("saunachelin:") ? "Sauna layer" : "Food layer"}</p>${shoppingAliases.has(p.key) ? '<p class="muted">Saved and visited flags apply to this confirmed branch group; your separate visits stay unchanged.</p>' : ""}<div class="actions"><button class="primary" data-action="add-place" data-id="${esc(p.key)}">Add to day</button><button data-action="save-place" data-id="${esc(p.key)}" aria-pressed="${!!f?.favourite}">${f?.favourite ? "★ Saved" : "☆ Save to Spots"}</button><button data-action="visited" data-id="${esc(p.key)}" aria-pressed="${!!f?.visited}">${f?.visited ? "✓ Visited" : "Visited"}</button>${M.located(p) ? `<button data-action="show-place" data-id="${esc(p.key)}">Show pin</button>` : ""}${local ? `<button data-action="edit-place" data-id="${local.id}">Edit saved place</button><button data-action="apply-saved" data-id="${local.id}">Apply to visits</button>` : ""}</div><details><summary>Source and navigation links</summary><div class="actions">${p.links.map((l) => (M.safeURL(l.url) ? `<a class="button" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>` : "")).join("")}<a class="button" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(M.name(p) + " " + (p.address.ja || p.address.city || ""))}" target="_blank" rel="noopener">Google Maps search</a></div><p>Standalone links open the source map; they do not select this place automatically.</p></details></article>`;
}
function findPlace(key) {
  const local = state.places.find((x) => x.snapshot.key === key);
  return local ? M.effective(local) : allPlaces().find((x) => x.key === key);
}
function renderSpots() {
  const query = pref("japan-spots-query") || "",
    visited = pref("japan-spots-visited") === "true",
    flags = state.flags.filter((f) => (visited ? f.visited : f.favourite)),
    rows = flags
      .map((f) => ({
        flag: f,
        p: findPlace(f.placeKey),
        local: state.places.find((p) => p.snapshot.key === f.placeKey),
      }))
      .filter(
        (x) =>
          !query ||
          M.name(x.p || { names: {}, address: {} })
            .normalize("NFKC")
            .toLowerCase()
            .includes(query.normalize("NFKC").toLowerCase()),
      );
  $("content").innerHTML =
    `<section class="narrow"><div class="toolbar"><div><h1>Saved Spots</h1><p class="muted">Your places, independent of any trip.</p></div><button data-action="import">Import saved flags</button></div><label>Search saved places<input id="spots-search" type="search" value="${esc(query)}"></label><label class="check"><input id="spots-visited" type="checkbox" ${visited ? "checked" : ""}>Show visited instead of favourites</label>${rows.map(({ flag, p, local }) => (p ? card(p, null, local) : `<article class="place-card"><h3>Waiting for source match</h3><p>${esc(flag.placeKey)}</p><p class="muted">Flags retained. This ID is not in the current source snapshots.</p></article>`)).join("") || '<div class="empty"><h2>No saved places yet</h2><p>Use Save to Spots in Discover, or import saved flags from a standalone map.</p><button data-action="discover">Open Discover</button></div>'}</section>`;
  $("spots-search").oninput = (e) => {
    pref("japan-spots-query", e.target.value);
    clearTimeout(renderSpots.timer);
    renderSpots.timer = setTimeout(() => {
      render();
      $("spots-search").focus();
    }, 250);
  };
  $("spots-visited").onchange = (e) => {
    pref("japan-spots-visited", String(e.target.checked));
    render();
  };
}
function originDialog() {
  modal(
    "Choose a distance origin",
    `<div class="actions">${Object.keys(M.presets)
      .map((k) => `<button data-city="${k}">${k}</button>`)
      .join(
        "",
      )}</div><div class="section-divider actions"><button id="origin-search">Search for a place</button><button id="origin-pin">Drop a pin</button></div><form><label>Raw coordinates<input name="coordinates" placeholder="35.6812,139.7671"></label>${footer("Use coordinates")}</form>`,
    () => {
      document.querySelectorAll("[data-city]").forEach(
        (b) =>
          (b.onclick = () => {
            const [lat, lng] = M.presets[b.dataset.city];
            setOrigin({ lat, lng }, b.dataset.city);
            close();
          }),
      );
      $("origin-search").onclick = () => searchDialog("origin");
      $("origin-pin").onclick = () => {
        close();
        mapMode = true;
        render();
        dropAction = "origin";
        toast("Tap the map to set a distance origin.");
      };
      setupForm((f) => {
        const point = M.parseCoordinates(val(f, "coordinates"));
        if (!point) throw Error("Enter latitude,longitude.");
        setOrigin(point, "Chosen coordinates");
        close();
      });
    },
  );
}
function setOrigin(point, label) {
  discover.origin = point;
  discover.originMode = "custom";
  discover.originLabel = label;
  render();
}
function gps() {
  if (!navigator.geolocation) {
    toast("Location unavailable. Choose an origin instead.");
    return;
  }
  toast("Locating…");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      setOrigin(
        { lat: p.coords.latitude, lng: p.coords.longitude },
        "Your location",
      );
      toast("Origin set. Location stays in this browser.");
    },
    () => {
      toast("Location denied or unavailable. Choose a city or coordinates.");
      originDialog();
    },
    { timeout: 12000, maximumAge: 60000 },
  );
}
function searchDialog(purpose) {
  modal(
    "Find a place",
    `<form><label>Place name or public address<input name="query" minlength="3" required placeholder="Japanese station or place name"></label><p class="muted">Explicit search using Nominatim. Do not submit confidential addresses. Use only one actively searching device. No autocomplete.</p><div class="actions"><button class="primary" type="submit">Search</button><button type="button" data-cancel>Cancel</button></div><p id="form-error" role="alert" class="form-error"></p><div id="search-results" class="search-results"></div><p class="attribution">© OpenStreetMap contributors · <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noopener">Nominatim usage policy</a></p></form>`,
    () =>
      setupForm(async (f) => {
        const query = val(f, "query");
        if (query.length < 3) throw Error("Enter at least three characters.");
        const key =
          "japan-trip-search:" + query.normalize("NFKC").toLowerCase();
        let rows;
        try {
          rows = JSON.parse(localStorage.getItem(key) || "null");
        } catch {}
        if (!rows) {
          if (!navigator.onLine)
            throw Error(
              "Search needs a connection. Use manual entry or cached results.",
            );
          const c = await fetch("config.json", { cache: "no-store" });
          if (!c.ok)
            throw Error(
              "Cannot check current search configuration. Use manual entry.",
            );
          const cfg = await c.json();
          if (
            !cfg.personalSingleDevice ||
            !cfg.nominatimUrl ||
            !M.safeURL(cfg.nominatimUrl)
          )
            throw Error("Remote search is disabled. Use manual entry.");
          if (!navigator.locks)
            throw Error(
              "This browser cannot coordinate search tabs. Use manual entry.",
            );
          rows = await navigator.locks.request(
            "japan-trip-search",
            async () => {
              const last = Number(
                  localStorage.getItem("japan-trip-search-last") || 0,
                ),
                wait = Math.max(0, 1100 - (Date.now() - last));
              if (wait) await new Promise((r) => setTimeout(r, wait));
              localStorage.setItem(
                "japan-trip-search-last",
                String(Date.now()),
              );
              const u = new URL(cfg.nominatimUrl);
              u.search = new URLSearchParams({
                q: query,
                format: "jsonv2",
                countrycodes: "jp",
                limit: "5",
              });
              const r = await fetch(u, {
                referrerPolicy: "strict-origin-when-cross-origin",
              });
              if (!r.ok) throw Error("Search unavailable. Use manual entry.");
              const data = await r.json();
              if (!Array.isArray(data)) throw Error("Invalid search result.");
              return data
                .filter((x) => M.parseCoordinates(x.lat + "," + x.lon))
                .map((x) => ({
                  label: String(x.display_name).slice(0, 2000),
                  lat: +x.lat,
                  lng: +x.lon,
                }));
            },
          );
          try {
            localStorage.setItem(key, JSON.stringify(rows));
          } catch {}
        }
        const target = $("search-results");
        target.replaceChildren();
        if (!rows.length)
          target.textContent =
            "No results. Try a Japanese name or add the place manually.";
        for (const row of rows) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = row.label;
          b.onclick = () => {
            if (purpose === "origin") {
              setOrigin({ lat: row.lat, lng: row.lng }, query);
              close();
            } else
              editor({
                initial: M.manualPlace({
                  names: { ja: null, en: null, romaji: null, branchJa: null },
                  address: {
                    ja: null,
                    en: null,
                    prefecture: null,
                    city: null,
                    postalCode: null,
                  },
                  location: {
                    lat: row.lat,
                    lng: row.lng,
                    availability: "located",
                    confidence: "low",
                    method: "nominatim-user-search",
                    provenance: [
                      {
                        field: "coordinates",
                        sourceKind: "nominatim",
                        url: "https://nominatim.openstreetmap.org/",
                        observedAt: M.now(),
                        note: row.label,
                      },
                    ],
                    verifiedAt: null,
                  },
                  reviewNotes: [
                    row.label,
                    "Search result; confirm the name, address and entrance.",
                  ],
                }),
              });
          };
          target.append(b);
        }
      }),
  );
}
function initMap(kind, items) {
  if (!$("map") || !window.L) return;
  map = L.map("map", {
    maxZoom: 19,
    zoomControl: true,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
  }).setView([37.5, 138], 5);
  if (config.tilesUrl && (!matchMedia("(max-width:760px)").matches || mapMode))
    L.tileLayer(config.tilesUrl, {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      keepBuffer: 0,
    }).addTo(map);
  const osmOnMap =
    items.some((x) => isOSM(x.p)) ||
    (kind === "discover" &&
      (day()?.stopIds || []).some((id) => {
        const st = state.stops.find((x) => x.id === id);
        return st && isOSM(M.visitPlace(st));
      }));
  if (osmOnMap)
    map.attributionControl.addAttribution(
      'Shopping data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a>',
    );
  map.on("click", (e) => {
    if (!dropAction) return;
    const purpose = dropAction;
    dropAction = null;
    const point = {
      lat: +e.latlng.lat.toFixed(6),
      lng: +e.latlng.lng.toFixed(6),
    };
    if (purpose === "origin") setOrigin(point, "Dropped pin");
    else
      editor({
        initial: M.manualPlace({
          location: {
            ...point,
            availability: "located",
            confidence: "unknown",
            method: "user-pin",
            provenance: [],
            verifiedAt: null,
          },
        }),
      });
  });
  const bounds = [];
  if (kind === "day") {
    const groups = new Map();
    items.forEach(({ p, id }, i) => {
      if (!M.located(p)) return;
      const key = p.location.lat + "," + p.location.lng;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ p, id, n: i + 1 });
    });
    for (const group of groups.values()) {
      const point = [group[0].p.location.lat, group[0].p.location.lng];
      bounds.push(point);
      const marker = L.marker(point, {
        icon: L.divIcon({
          className: "",
          html: `<div class="pin-number">${group.map((x) => x.n).join(", ")}</div>`,
          iconSize: [Math.max(44, group.length * 24), 44],
        }),
      }).addTo(map);
      group.forEach((x) => markers.set(x.id, marker));
      marker.on("click", () => {
        if (group.length === 1) selectVisit(group[0].id);
        else
          modal(
            "Choose a visit",
            `<div class="map-choice">${group.map((x) => `<button data-choose="${x.id}">${x.n}. ${esc(M.name(x.p))}</button>`).join("")}</div>`,
            () =>
              document.querySelectorAll("[data-choose]").forEach(
                (b) =>
                  (b.onclick = () => {
                    close();
                    selectVisit(b.dataset.choose);
                  }),
              ),
          );
      });
    }
    for (let i = 1; i < items.length; i++) {
      const a = items[i - 1].p,
        b = items[i].p;
      if (M.located(a) && M.located(b))
        L.polyline(
          [
            [a.location.lat, a.location.lng],
            [b.location.lat, b.location.lng],
          ],
          { color: "#246b72", weight: 2, dashArray: "5 7", interactive: false },
        ).addTo(map);
    }
  } else {
    const cluster = L.markerClusterGroup({
      animate: false,
      maxClusterRadius: 45,
      showCoverageOnHover: false,
    });
    for (const { p, id } of items) {
      if (!M.located(p)) continue;
      const point = [p.location.lat, p.location.lng];
      bounds.push(point);
      const marker = L.marker(point, {
        icon: L.divIcon({
          className: "",
          html: `<div class="layer-pin layer-${layerId(p.key.split(":")[0])}">${esc(badge(p))}</div>`,
          iconSize: [44, 44],
        }),
      });
      markers.set(id, marker);
      const pop = document.createElement("div");
      pop.textContent = M.name(p);
      marker.bindPopup(pop);
      marker.on("click", () => {
        selected = id;
        document
          .querySelectorAll("[data-place]")
          .forEach((el) =>
            el.classList.toggle("selected", el.dataset.place === id),
          );
        toast(M.name(p));
      });
      cluster.addLayer(marker);
    }
    cluster.addTo(map);
    map.cluster = cluster;
    const visits = (day()?.stopIds || []).map((id) =>
      state.stops.find((st) => st.id === id),
    );
    visits.forEach((st, i) => {
      const p = M.visitPlace(st);
      if (!M.located(p)) return;
      const point = [p.location.lat, p.location.lng];
      bounds.push(point);
      const pin = L.marker(point, {
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: "",
          html: `<div class="pin-number">${i + 1}</div>`,
          iconSize: [44, 44],
        }),
      }).addTo(map);
      const label = document.createElement("span");
      label.textContent = `Scheduled ${i + 1}: ${M.name(p)}`;
      pin.bindPopup(label);
    });
    for (let i = 1; i < visits.length; i++) {
      const a = M.visitPlace(visits[i - 1]),
        b = M.visitPlace(visits[i]);
      if (M.located(a) && M.located(b))
        L.polyline(
          [
            [a.location.lat, a.location.lng],
            [b.location.lat, b.location.lng],
          ],
          { color: "#246b72", dashArray: "5 7", interactive: false },
        ).addTo(map);
    }
  }
  if (bounds.length)
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13, animate: false });
  else if (discover.origin) {
    map.setView([discover.origin.lat, discover.origin.lng], 11);
  }
  requestAnimationFrame(() => map?.invalidateSize());
}
function selectVisit(id) {
  selected = id;
  mapMode = false;
  render();
  document
    .querySelector(`[data-stop="${id}"]`)
    ?.scrollIntoView({ block: "center", behavior: "auto" });
}
function showPin(id) {
  const marker = markers.get(id);
  if (!marker) {
    if (screen === "spots") {
      const p = findPlace(id);
      if (p) {
        modal(
          "Place location",
          `<p>${esc(M.name(p))}</p><p>${p.location.lat}, ${p.location.lng}</p><a class="button" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(M.name(p) + " " + (p.address.ja || ""))}" target="_blank" rel="noopener">Open Google Maps</a>`,
        );
        return;
      }
    }
    toast("This place has no pin in the current map.");
    return;
  }
  if (!mapMode && matchMedia("(max-width:760px)").matches) {
    mapMode = true;
    render();
  }
  const m = markers.get(id);
  if (!m) return;
  if (map.cluster) map.cluster.zoomToShowLayer(m, () => m.openPopup());
  else map.setView(m.getLatLng(), 14);
  selected = id;
  document
    .querySelectorAll("[data-place],[data-stop]")
    .forEach((el) =>
      el.classList.toggle(
        "selected",
        (el.dataset.place || el.dataset.stop) === id,
      ),
    );
}
function renderSettings() {
  let last = "No backup exported from this browser yet";
  try {
    last = localStorage.getItem("japan-trip-last-export") || last;
  } catch {}
  $("content").innerHTML =
    `<section class="narrow"><h1>Your notebook, backed up</h1><p>Local storage is not a backup. Export your trips and saved places before travelling, changing devices or clearing browser storage.</p><div class="actions"><button class="primary" data-action="export-all">Export full backup</button><button data-action="export-backup-zip">Backup + offline source ZIP</button><button data-action="import">Import / restore</button></div><p class="backup-date">Last export prepared: ${esc(last)}. Confirm that you saved the downloaded file.</p><details open><summary>Preferences</summary><label>Colour theme<select id="setting-theme">${["system", "light", "dark"].map((v) => `<option ${state.settings.theme === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Default travel mode for new segments<select id="setting-mode">${["walk", "train", "drive"].map((v) => `<option ${state.settings.defaultMode === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><p>Change day-length, late-finish and long-walk warnings from a trip’s Planning assumptions panel.</p></details><details><summary>Sources and updates</summary>${Object.values(
      feeds,
    )
      .map(
        (f) =>
          `<p><strong>${esc(f.source.title)}</strong><br>${f.places.length} entries · exported ${esc(f.generatedAt)}<br><small>${esc(f.datasetVersion)}</small></p>`,
      )
      .join(
        "",
      )}<p>Snapshots are generated from the existing source pipelines. This planner never scrapes. Export time is not venue verification time. A changed feed never silently replaces your saved or scheduled place snapshots.</p><button data-action="refresh-preview">Review saved source changes</button></details><details><summary>Offline use and installation</summary><p>Open once online, then in iPhone Safari choose Share → Add to Home Screen. The previously loaded app, bundled Discover data, trips and saved places work offline. The map may be blank. No map-area download or tile prefetch is offered.</p><p>Browser storage can be evicted. Keep a JSON backup outside this browser. Physical iPhone installation and real GPS still need device verification.</p></details><details><summary>Search services and privacy</summary><p>Nominatim searches occur only when you submit. Cached results and manual entry remain available. Use the public search endpoint on only one actively searching device. Browser throttling cannot enforce the application-wide one-request-per-second limit across phones.</p><p>Do not submit confidential addresses. GPS is used locally. External direction links open a third-party map. No accounts or automatic device sync.</p><a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noopener">Nominatim policy</a><p><a href="https://operations.osmfoundation.org/policies/tiles/" target="_blank" rel="noopener">OpenStreetMap tile policy</a></p></details><details><summary>Saved flags from the standalone maps</summary><p>Open each standalone map on the browser where you saved places, choose Export saved / visited, then import that JSON here. Default merge keeps any true flag. Differing values are previewed; unknown IDs remain for later matching. There is no automatic cross-origin sync.</p><div class="actions"><a class="button" href="https://saunachelin-field-guide.wittycob1.chatgpt.site/app/" target="_blank" rel="noopener">Sauna map</a><a class="button" href="https://japan-food-award-map-lm.wittycob1.chatgpt.site/" target="_blank" rel="noopener">Food map</a></div></details><p class="attribution">旅のしおり · Japan Trip Planner 2.4.2<br>Leaflet and MarkerCluster are bundled locally. © OpenStreetMap contributors. Award facts retain their original source links. No booking, prices, budgets or paid APIs.</p></section>`;
  $("setting-theme").onchange = (e) =>
    commit((s) => (s.settings.theme = e.target.value));
  $("setting-mode").onchange = (e) =>
    commit((s) => (s.settings.defaultMode = e.target.value));
}
function thresholds() {
  const t = trip();
  if (!t) return;
  const labels = {
    dayMinutes: "Excessive day length (minutes)",
    lateFinishMinute: "Late finish (Japan time)",
    longWalkMinutes: "Long walk (minutes)",
    longWalkKm: "Long walk (straight-line km)",
    longTrainKm: "Long train reminder (straight-line km)",
  };
  modal(
    "Trip warning thresholds",
    `<form>${Object.entries(labels)
      .map(
        ([k, label]) =>
          `<label>${label}<input name="${k}" type="${k === "lateFinishMinute" ? "time" : "number"}" ${k === "lateFinishMinute" ? "" : 'min="0.01" step="' + (k.endsWith("Km") ? "0.1" : "1") + '"'} value="${k === "lateFinishMinute" ? hhmm(t.thresholds[k]) : t.thresholds[k]}"></label>`,
      )
      .join(
        "",
      )}<p>These are planning hints, not promises of feasibility.</p>${footer("Save thresholds")}</form>`,
    () =>
      setupForm(async (f) => {
        const result = Object.fromEntries(
          Object.keys(labels).map((k) => [
            k,
            k === "lateFinishMinute" ? timeMinute(val(f, k)) : +val(f, k),
          ]),
        );
        if (
          await commit(
            (s) => (s.trips.find((x) => x.id === t.id).thresholds = result),
          )
        )
          close();
      }),
  );
}
function importDialog() {
  modal(
    "Import a backup or saved flags",
    `<p>Choose a versioned JSON file. You will see a preview before anything changes. Existing trips are never silently overwritten.</p><label>JSON file<input id="import-file" type="file" accept=".json,application/json"></label><p id="form-error" role="alert" class="form-error"></p><div id="import-preview"></div>`,
    () => {
      $("import-file").onchange = async (e) => {
        try {
          const file = e.target.files[0];
          if (!file) return;
          if (file.size > 20 * 1024 * 1024) throw Error("File exceeds 20 MiB.");
          const data = parseJSON(await file.text()),
            preview = await previewImport(state, data);
          $("import-preview").innerHTML =
            `<div class="notice">${esc(preview.message)}</div>${preview.already ? "<p>This exact file was already imported. Repeating it will not change your edits.</p>" : ""}${preview.legacy ? '<label>For differing flags<select id="flag-policy"><option value="merge">Keep any true flag (recommended)</option value="local">Keep current values</option value="incoming">Use incoming values</option></select></label>' : ""}<button id="confirm-import" class="primary">${preview.already ? "Close" : "Confirm import"}</button>`;
          $("confirm-import").onclick = async () => {
            if (preview.already) {
              close();
              return;
            }
            const policy = $("flag-policy")?.value || "merge";
            if (await commit((s) => mergeImport(s, data, preview, policy))) {
              close();
              toast("Import saved. Existing edits preserved.");
            }
          };
        } catch (err) {
          formError(err);
          $("import-preview").replaceChildren();
        }
      };
    },
  );
}
function refreshPreview() {
  const changes = state.places
    .map((local) => ({
      local,
      current: allPlaces().find((p) => p.key === local.snapshot.key),
    }))
    .filter(
      (x) => x.current && canonical(x.current) !== canonical(x.local.snapshot),
    );
  modal(
    "Review source changes",
    `<p>${changes.length} saved place snapshots differ from the current feeds. Local field overrides and scheduled visits stay unchanged unless explicitly selected.</p>${
      changes
        .map(
          ({ local, current }) =>
            `<details><summary>${esc(M.name(current))}</summary><p>Changed fields: ${Object.keys(
              current,
            )
              .filter(
                (k) => canonical(current[k]) !== canonical(local.snapshot[k]),
              )
              .map(esc)
              .join(
                ", ",
              )}</p><label class="check"><input type="checkbox" data-refresh-place="${local.id}">Refresh saved snapshot (keep overrides)</label>${state.stops
              .filter((st) => st.placeId === local.id)
              .map(
                (st) =>
                  `<label class="check"><input type="checkbox" data-refresh-stop="${st.id}">Refresh visit: ${esc(state.days.find((d) => d.stopIds.includes(st.id))?.date || "Unassigned")} — ${esc(M.name(M.visitPlace(st)))}</label>`,
              )
              .join(
                "",
              )}<p>Coordinates: ${local.snapshot.location.lat ?? "unknown"}, ${local.snapshot.location.lng ?? "unknown"} → ${current.location.lat ?? "unknown"}, ${current.location.lng ?? "unknown"}</p><details><summary>Field differences</summary><pre>${esc(JSON.stringify({ before: local.snapshot, after: current }, null, 2))}</pre></details></details>`,
        )
        .join("") ||
      "<p>No saved source changes to apply. Missing source IDs remain preserved.</p>"
    }<button id="apply-refresh" class="primary" ${changes.length ? "" : "disabled"}>Apply selected changes</button>`,
    () => {
      $("apply-refresh").onclick = async () => {
        const places = [
            ...document.querySelectorAll("[data-refresh-place]:checked"),
          ].map((x) => x.dataset.refreshPlace),
          stops = [
            ...document.querySelectorAll("[data-refresh-stop]:checked"),
          ].map((x) => x.dataset.refreshStop);
        if (
          await commit((s) => {
            for (const { local, current } of changes) {
              if (places.includes(local.id)) {
                const l = s.places.find((x) => x.id === local.id);
                for (const st of s.stops.filter((st) => st.placeId === l.id)) {
                  if (
                    !Object.hasOwn(st, "sourceDatasetVersion") &&
                    canonical(st.placeSnapshot) === canonical(M.effective(l))
                  )
                    st.sourceDatasetVersion =
                      l.sourceRef?.datasetVersion || null;
                }
                l.snapshot = M.clone(current);
                l.sourceRef = {
                  key: current.key,
                  sourceId: current.sourceId,
                  datasetVersion: sourceVersion(current),
                };
                l.updatedAt = M.now();
              }
              for (const st of s.stops.filter(
                (x) => x.placeId === local.id && stops.includes(x.id),
              )) {
                st.placeSnapshot = M.clone(current);
                st.sourceDatasetVersion = sourceVersion(current);
              }
            }
          })
        ) {
          close();
          toast(
            "Selected snapshots updated. Check any stale travel overrides.",
          );
        }
      };
    },
  );
}
$("content").addEventListener("click", async (e) => {
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    switch (action) {
      case "new-trip":
        editTrip();
        break;
      case "edit-trip":
        editTrip(state.trips.find((t) => t.id === id));
        break;
      case "open-trip":
        activeTrip = id;
        activeDay = trip().dayIds[0];
        navigate("day");
        break;
      case "sample":
        await sample();
        break;
      case "select-day":
        activeDay = id;
        selected = null;
        render();
        break;
      case "add":
        addDialog();
        break;
      case "edit-stop":
        editor({ stopId: id });
        break;
      case "edit-place":
        editor({ placeId: id });
        break;
      case "apply-saved":
        applySavedDialog(id);
        break;
      case "save-visit": {
        const st = state.stops.find((x) => x.id === id),
          p = M.visitPlace(st);
        await commit((s) => {
          M.ensurePlace(s, p, sourceVersion(p));
          M.flag(s, p.key, "favourite", true);
        });
        toast("Place saved. Visit-specific edits remain on this visit.");
        break;
      }
      case "move":
        moveDialog(id);
        break;
      case "up":
      case "down": {
        const index = day().stopIds.indexOf(id) + (action === "up" ? -1 : 1);
        await commit((s) => M.moveStop(s, id, activeDay, index));
        break;
      }
      case "remove-stop":
        modal(
          "Remove this visit?",
          `<p>The saved place and other visits remain. This visit’s notes and duration will be removed.</p><button id="confirm-remove" class="danger">Remove visit</button>`,
          () => {
            $("confirm-remove").onclick = async () => {
              if (await commit((s) => M.removeStop(s, id))) close();
            };
          },
        );
        break;
      case "travel":
        travelDialog(id);
        break;
      case "reset-travel":
        await commit((s) => {
          const seg = s.segments.find((x) => x.toStopId === id);
          seg.manualMinutes = null;
          seg.overrideFingerprint = null;
        });
        break;
      case "directions":
        navigationDialog(id);
        break;
      case "show-all-layers":
        visibleLayers = layerPreferences();
        saveLayers();
        render();
        break;
      case "map-toggle":
        mapMode = !mapMode;
        render();
        break;
      case "show-stop":
      case "show-place":
        showPin(id);
        break;
      case "handoff-day":
        selectedExport.clear();
        selectedOrigins.clear();
        for (const id of day()?.stopIds || []) {
          const st = state.stops.find((s) => s.id === id);
          selectedExport.set(id, M.visitPlace(st));
          selectedOrigins.set(id, originFor(M.visitPlace(st), st));
        }
        handoffDialog();
        break;
      case "export-selected":
        handoffDialog();
        break;
      case "export-osm-version":
        await exportOSMSource(id);
        break;
      case "export-osm-source":
        await exportOSMSource();
        break;
      case "export-backup-zip":
        await exportBackupZip();
        break;
      case "export-trip-zip":
        await exportBackupZip(activeTrip);
        break;
      case "export-trip":
        download(backup(state, activeTrip), "japan-trip.json");
        break;
      case "export-all":
        download(backup(state), "japan-trips-backup.json");
        break;
      case "import":
        importDialog();
        break;
      case "discover-source":
      case "source":
        switchSource(id);
        if (action === "discover-source") {
          visibleLayers[layerId(id)] = true;
          saveLayers();
          if (!origins().length) discover.radius = 0;
          mapMode = true;
          navigate("discover");
        } else render();
        break;
      case "reset-filters":
        discover = {
          ...discover,
          brands: [],
          formats: [],
          shopCategories: [],
          q: "",
          years: [],
          categories: [],
          region: "",
          prefecture: "",
          listId: "",
          radius: 0,
          first: false,
          hof: false,
          multi: false,
          special: true,
          saved: false,
          visited: false,
          includeScheduled: false,
        };
        render();
        break;
      case "origin":
        originDialog();
        break;
      case "gps":
        gps();
        break;
      case "add-place":
        await addPlace(findPlace(id));
        break;
      case "save-place":
      case "visited": {
        const p = findPlace(id),
          field = action === "visited" ? "visited" : "favourite",
          value = !effectiveFlag(state.flags, id, shoppingAliases)[field];
        await commit((s) => {
          M.ensurePlace(s, p, sourceVersion(p));
          setBranchFlag(s, id, field, value, shoppingAliases);
        });
        toast(
          value ? "Saved in this browser" : "Flag removed; trip visits kept.",
        );
        break;
      }
      case "discover":
        navigate("discover");
        break;
      case "thresholds":
        thresholds();
        break;
      case "refresh-preview":
        refreshPreview();
        break;
    }
  } catch (err) {
    toast(err.message);
  }
});
$("theme").onclick = () =>
  commit(
    (s) => (s.settings.theme = s.settings.theme === "dark" ? "light" : "dark"),
  );
window.addEventListener("hashchange", render);
window.addEventListener("online", connection);
window.addEventListener("offline", connection);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", theme);
function connection() {
  $("connection").textContent = navigator.onLine ? "" : "Offline";
}
connection();
window.addEventListener("beforeunload", (e) => {
  if (busy || pending) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function serviceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    let requestedUpdate = false;
    const show = () => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        $("update").hidden = false;
        $("update-now").onclick = () => {
          if (busy || pending) {
            toast("Finish saving or export recovery before updating.");
            return;
          }
          requestedUpdate = true;
          reg.waiting.postMessage({ type: "ACTIVATE" });
        };
      }
    };
    show();
    reg.addEventListener("updatefound", () =>
      reg.installing?.addEventListener("statechange", show),
    );
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (requestedUpdate && !reloading) {
        reloading = true;
        location.reload();
      }
    });
  } catch (e) {
    toast("Offline shell setup failed. Local trips still save; retry online.");
  }
}
try {
  await DB.open();
  state = await DB.load();
  theme();
  const responses = await Promise.allSettled([
    DB.feed("saunachelin", "../data/saunas.v1.json"),
    DB.feed("tabelog", "../data/food.v1.json"),
    fetch("config.json").then((r) => {
      if (!r.ok) throw Error("Configuration unavailable");
      return r.json();
    }),
  ]);
  responses.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (i === 2) config = r.value;
      else {
        feeds[r.value.value.source.namespace] = r.value.value;
        sourceLoad[r.value.value.source.namespace] = r.value.error
          ? "cached"
          : "ready";
        if (r.value.error)
          toast("Using previous source snapshot: " + r.value.error);
      }
    } else {
      if (i < 2)
        sourceLoad[i === 0 ? "saunachelin" : "tabelog"] = "unavailable";
      error(
        "Some source data is unavailable. Manual trip editing still works. " +
          r.reason.message,
      );
    }
  });
  ready = true;
  render();
  DB.shoppingSources((id, result) => {
    const key = id === "osm" ? "shopping:osm" : "shopping";
    if (result) {
      sourcePackageNotices[id] = result.notices;
      sourcePackageRoots[id] = result.offerRoot || null;
      sourceLicenseTexts = Object.assign(
        {},
        ...Object.values(sourcePackageNotices),
      );
      feeds[key] = result.feed;
      if (id === "overture") shoppingAliases = aliasIndex(result.aliases);
      sourceLoad[key] = result.error ? "cached" : "ready";
    } else sourceLoad[key] = "unavailable";
    if (screen === "discover" || screen === "settings") render();
  }).catch(() => {
    sourceLoad["shopping:osm"] = "unavailable";
    if (screen === "discover" || screen === "settings") render();
  });
  await serviceWorker();
} catch (e) {
  ready = true;
  $("content").innerHTML =
    '<section class="narrow"><h1>Storage could not open</h1><p>No existing data was overwritten. Reload, check browser storage permissions, or restore a backup in another browser.</p></section>';
  error(e.message);
}
function pref(key, value) {
  try {
    if (value !== undefined) sessionStorage.setItem(key, value);
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
$("dialog").addEventListener("click", (e) => {
  if (e.target.id !== "delete-trip") return;
  const id = $("dialog").dataset.trip;
  modal(
    "Delete this trip?",
    `<p>This removes its days, visits and travel overrides. Saved Spots stay. Export a backup first if you may need the trip later.</p><div class="actions"><button id="delete-export">Export trip</button><button id="delete-confirm" class="danger">Delete trip permanently</button></div>`,
    () => {
      $("delete-export").onclick = () =>
        download(backup(state, id), "japan-trip-before-delete.json");
      $("delete-confirm").onclick = async () => {
        if (await commit((s) => M.removeTrip(s, id))) {
          close();
          navigate("trips");
        }
      };
    },
  );
});
function applySavedDialog(placeId) {
  const p = state.places.find((x) => x.id === placeId),
    visits = state.stops.filter((st) => st.placeId === placeId);
  modal(
    "Apply saved place to visits",
    `<p>Refresh the selected visit snapshots from <strong>${esc(M.name(M.effective(p)))}</strong>. Each visit keeps its own field overrides, notes and duration. Changed coordinates can make manual travel times stale.</p>${visits.map((st) => `<label class="check"><input type="checkbox" data-apply-visit="${st.id}">${esc(state.days.find((d) => d.stopIds.includes(st.id))?.date || "Unassigned")} · ${esc(M.name(M.visitPlace(st)))}</label>`).join("") || "<p>No visits use this saved place.</p>"}<button id="apply-saved" class="primary" ${visits.length ? "" : "disabled"}>Apply to selected visits</button>`,
    () => {
      $("apply-saved").onclick = async () => {
        const selected = [
          ...document.querySelectorAll("[data-apply-visit]:checked"),
        ].map((x) => x.dataset.applyVisit);
        if (
          await commit((s) => {
            for (const st of s.stops.filter((x) => selected.includes(x.id))) {
              st.placeSnapshot = M.effective(p);
              st.sourceDatasetVersion = p.sourceRef?.datasetVersion || null;
            }
          })
        ) {
          close();
          toast("Selected visits refreshed. Notes and overrides preserved.");
        }
      };
    },
  );
}

function originalApps() {
  return `<div class="original-apps" aria-label="Original standalone apps"><a href="https://saunachelin-field-guide.wittycob1.chatgpt.site/app/" target="_blank" rel="noopener">Open original sauna app</a><a href="https://japan-food-award-map-lm.wittycob1.chatgpt.site/app/" target="_blank" rel="noopener">Open original food app</a></div>`;
}

function layersHTML(counts) {
  const layers = [
    ["sauna", "saunachelin", "Saunas"],
    ["food", "tabelog", "Food"],
    ["shopping", "shopping", "Shopping"],
  ];
  return `<section class="layer-controls" aria-label="Visible map layers"><div class="toolbar"><h2>Map layers</h2><button data-action="show-all-layers">Show all three</button></div><p id="layer-help">Select any combination. Checked layers appear together on the map and in the list.</p><div class="layer-options">${layers
    .map(([id, ns, label]) => {
      const status = sourceLoad[ns],
        feed =
          id === "shopping"
            ? shoppingPlaces().length
              ? { places: shoppingPlaces() }
              : feeds.shopping
            : feeds[ns];
      const detail = !feed
        ? status === "loading"
          ? "Loading…"
          : "Unavailable — reload online"
        : !visibleLayers[id]
          ? `Off · ${feed.places.length.toLocaleString("en-US")} loaded`
          : `${counts[id]?.located || 0} map matches${counts[id]?.unknown ? ` · ${counts[id].unknown} without pins` : ""}${id === "shopping" ? " · source records may overlap" : ""}${status === "cached" ? " · cached data" : ""}`;
      return `<label class="layer-option"><span class="check"><input type="checkbox" data-layer="${id}" aria-describedby="layer-help layer-status-${id}" ${visibleLayers[id] ? "checked" : ""}>${label}</span><small id="layer-status-${id}" role="status">${esc(detail)}</small></label>`;
    })
    .join(
      "",
    )}</div><p class="muted">Numbered itinerary stops stay visible even when these layers are off.</p><button data-action="export-selected">Google Maps · ${selectedExport.size} selected</button></section>`;
}
function shoppingPlaces() {
  return Object.entries(feeds)
    .filter(
      ([key, f]) =>
        f.source.namespace === "shopping" &&
        shoppingPackages[key === "shopping:osm" ? "osm" : "overture"],
    )
    .flatMap(([, f]) => f.places);
}
function shoppingSourcesHTML() {
  return `<div class="shopping-source-controls"><h3>Shopping sources</h3><p class="notice">Source records can describe the same shop. Counts are not unique or verified active stores.</p>${[
    ["overture", "shopping", "Main shopping data"],
    ["osm", "shopping:osm", "OpenStreetMap · ODbL"],
  ]
    .map(
      ([id, key, label]) =>
        `<label class="check"><input type="checkbox" data-shopping-package="${id}" ${shoppingPackages[id] ? "checked" : ""}>${label} · ${feeds[key]?.places.length || 0} records</label><small>${sourceLoad[key] === "loading" ? "Loading…" : sourceLoad[key] === "unavailable" ? "Unavailable — reload online" : `${sourceMatchCounts[key]?.located || 0} matching pins${sourceLoad[key] === "cached" ? " · cached data" : ""}`}</small>`,
    )
    .join(
      "",
    )}<label class="check"><input type="checkbox" data-shop-closed ${discover.includeClosed ? "checked" : ""}>Include source-recorded closed places</label><p class="muted">Unknown operation stays included. Hours are unverified references; partial addresses and approximate centres need checking.</p>${feeds["shopping:osm"] ? '<button data-action="export-osm-source">Download complete OSM source & notices</button>' : ""}</div>`;
}
function shoppingFiltersHTML() {
  const ps = shoppingPlaces();
  const categoryPlaces = ps.filter(
    (p) =>
      !discover.shopCategories?.length ||
      discover.shopCategories.includes(categoryFor(p.shopping.brandId)),
  );
  const formatPlaces = categoryPlaces.filter(
    (p) =>
      !discover.brands?.length || discover.brands.includes(p.shopping.brandId),
  );
  return `${shoppingSourcesHTML()}<h3>Shopping categories</h3><div class="grid2">${Object.entries(
    shoppingCategories,
  )
    .filter(
      ([id]) =>
        id !== "other-shopping" ||
        ps.some((p) => categoryFor(p.shopping.brandId) === id),
    )
    .map(
      ([id, label]) =>
        `<label class="check"><input type="checkbox" data-shop-filter="shopCategories" value="${id}" ${(discover.shopCategories || []).includes(id) ? "checked" : ""}>${esc(label)} (${ps.filter((p) => categoryFor(p.shopping.brandId) === id).length})</label>`,
    )
    .join(
      "",
    )}</div><h3>Brands and formats</h3>${shoppingCoverageHTML(ps)}<p>None selected means all. Formats use both symbols and labels.</p><div class="grid2">${[
    ...new Set([
      ...categoryPlaces.map((p) => p.shopping.brandId),
      ...(discover.brands || []),
    ]),
  ]
    .sort()
    .map(
      (v) =>
        `<label class="check"><input type="checkbox" data-shop-filter="brands" value="${esc(v)}" ${(discover.brands || []).includes(v) ? "checked" : ""}>${esc(Object.hasOwn(brands, v) ? brands[v] : v)} (${ps.filter((p) => p.shopping.brandId === v).length})</label>`,
    )
    .join("")}</div><div class="grid2">${[
    ...new Set([
      ...formatPlaces.map((p) => p.shopping.formatId),
      ...(discover.formats || []),
    ]),
  ]
    .sort()
    .map(
      (v) =>
        `<label class="check"><input type="checkbox" data-shop-filter="formats" value="${esc(v)}" ${(discover.formats || []).includes(v) ? "checked" : ""}>${esc(Object.hasOwn(formats, v) ? formats[v] : v)}</label>`,
    )
    .join(
      "",
    )}</div>${ps.length ? "" : "<p>Shopping data is being prepared. No nationwide completeness is claimed.</p>"}`;
}
document.addEventListener("change", (e) => {
  const key = e.target.dataset.exportKey;
  if (!key) return;
  if (e.target.checked) {
    const p = findPlace(key);
    selectedExport.set(key, p);
    selectedOrigins.set(key, originFor(p));
  } else {
    selectedExport.delete(key);
    selectedOrigins.delete(key);
  }
  render();
});

async function handoffDialog() {
  const places = [...selectedExport].map(([key, p], i) => ({
    selectionId: key,
    placeKey: p.key,
    name: M.name(p),
    address: p.address.ja,
    location: {
      lat: p.location.lat,
      lng: p.location.lng,
      confidence: p.location.confidence,
    },
    googlePlaceId: null,
  }));
  if (!places.length) {
    toast("Select places from the results first.");
    return;
  }
  modal(
    "Selected places for Google Maps",
    `<p>${places.length} places, in selection order. No automatic day planning or timetable calculation.</p><ol>${places.map((p) => `<li>${esc(p.name)}</li>`).join("")}</ol><label>Travel mode<select id="handoff-mode"><option value="walk">Walk</option><option value="train">Train / transit</option><option value="drive">Drive</option></select></label><div id="handoff-links"></div><div id="handoff-files"></div><p>To save a Google Maps list, open each place and choose Save in Google Maps. CSV is for manual My Maps import on a computer; it does not create a route or insert into a saved list.</p><div class="actions"><button id="selection-json">Export all as JSON</button><button id="selection-copy">Copy all places</button><button id="selection-clear">Clear selection</button></div>`,
    () => {
      $("selection-json").onclick = () =>
        download(
          {
            schemaVersion: 1,
            mode: $("handoff-mode").value,
            places,
            sourcePackages: places.map((p) => ({
              selectionId: p.selectionId,
              ...selectedOrigins.get(p.selectionId),
            })),
            dataLicenses: {
              ...(state.dataLicenses || {}),
              ...sourceLicenseTexts,
            },
          },
          "japan-selected-places.json",
        );
      $("selection-copy").onclick = () =>
        copy(
          places
            .map((p, i) => `${i + 1}. ${p.name} ${p.address || ""}`)
            .join("\n"),
        );
      $("selection-clear").onclick = () => {
        selectedExport.clear();
        selectedOrigins.clear();
        close();
        render();
      };
      const update = async () => {
        try {
          const module = await import("./core/handoff.js");
          if (!$("handoff-mode") || !$("handoff-files")) return;
          const input = {
            schemaVersion: 1,
            mode: $("handoff-mode").value,
            places,
          };
          const files = module.buildSelectionFiles(input);
          $("handoff-files").replaceChildren();
          for (const warning of files.warnings) {
            const text = document.createElement("p");
            text.className = "notice";
            text.textContent = warning;
            $("handoff-files").append(text);
          }
          const button = document.createElement("button");
          button.textContent = "Download CSV + JSON + licences (ZIP)";
          button.onclick = async () => {
            try {
              const bundleFiles = [],
                groups = selectionGroups(input),
                allNotices = { ...state.dataLicenses, ...sourceLicenseTexts };
              for (const [id, rows] of Object.entries(groups)) {
                if (!rows.length) continue;
                const component = module.buildSelectionFiles({
                  ...input,
                  places: rows,
                });
                const notices = Object.fromEntries(
                  Object.entries(allNotices).filter(([key]) =>
                    id === "osm"
                      ? key.startsWith("shopping:osm-")
                      : id === "overture"
                        ? !key.startsWith("shopping:osm-")
                        : false,
                  ),
                );
                for (const f of component.files)
                  bundleFiles.push({
                    name: "selections/" + id + "/" + f.name,
                    content: f.name.endsWith(".json")
                      ? JSON.stringify({
                          ...JSON.parse(f.content),
                          dataLicenses: notices,
                          sourcePackages: rows.map((p) => ({
                            selectionId: p.selectionId,
                            ...selectedOrigins.get(p.selectionId),
                          })),
                        })
                      : f.content,
                  });
              }
              bundleFiles.push({
                name: "ordered-selections.json",
                content: JSON.stringify({
                  ...input,
                  sourcePackages: places.map((p) => ({
                    selectionId: p.selectionId,
                    ...selectedOrigins.get(p.selectionId),
                  })),
                }),
              });
              bundleFiles.push({
                name: "README.txt",
                content:
                  "Independent source-labelled selection components; user selection order is in ordered-selections.json. OSM data component remains under ODbL1.0; main shopping data uses its supplied component notices. User itinerary/notes are separate. Complete source resources in this ZIP cover OSM only; no AllThePlaces raw-input archive is included. Source records may overlap and are not a unique-store census.",
              });
              for (const [name, content] of Object.entries(allNotices))
                bundleFiles.push({
                  name: "licenses/" + name.replace(/[^a-zA-Z0-9_.-]/g, "_"),
                  content,
                });
              const versions = places
                .filter((p) => p.placeKey.startsWith("shopping:osm:"))
                .map(
                  (p) => selectedOrigins.get(p.selectionId)?.feedDatasetVersion,
                );
              if (versions.some((v) => !v))
                throw Error(
                  "Exact historical OSM source version is unknown; JSON preserves original records and offers.",
                );
              bundleFiles.push(
                ...(await completeOSMFiles(versions, DB.osmVersion)),
              );
              saveZip(bundleFiles, "japan-selected-places.zip");
            } catch (e) {
              toast(e.message);
            }
          };
          $("handoff-files").append(button);
          for (const file of files.files)
            for (const warning of file.warnings) {
              const p = document.createElement("p");
              p.className = "muted";
              p.textContent = warning;
              $("handoff-files").append(p);
            }
          const result = module.buildHandoff({
            schemaVersion: 1,
            mode: $("handoff-mode").value,
            places,
          });
          $("handoff-links").innerHTML =
            `${result.warnings.map((w) => `<p class="notice">${esc(w)}</p>`).join("")}${result.links.map((l) => (M.safeURL(l.url) ? `<p><a class="button" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a><small> ${l.selectionIds.length} selections covered</small>${l.warnings.map((w) => `<p class="notice">${esc(w)}</p>`).join("")}</p>` : "")).join("")}${result.unhandledSelectionIds.length ? `<p class="notice">${result.unhandledSelectionIds.length} selections need manual review; JSON and copy retain all places.</p>` : ""}`;
        } catch {
          $("handoff-links").textContent =
            "Maps links could not be prepared. JSON and copy retain every selection; check the selected place details.";
        }
      };
      $("handoff-mode").onchange = update;
      update();
    },
  );
}

function shoppingCoverageHTML(ps) {
  return `<details><summary>Shopping coverage and source quality</summary><p>These are sourced snapshot records, not a complete national store directory. Zero means no records in this snapshot, not no shops in Japan. Hours text is reference information, not a current opening guarantee. This staged feed has unresolved nearby duplicate and provider-ID candidates; records are not verified unique active branches.</p><div class="actions"><a class="button" href="help/shopping-coverage.md" target="_blank" rel="noopener">Coverage and data quality</a><a class="button" href="${esc(sourcePackageRoots.overture ? new URL("licenses/README.txt", sourcePackageRoots.overture).href : "../data/shopping-LICENSES/README.txt")}" target="_blank" rel="noopener">Main shopping data notices</a>${sourcePackageRoots.osm ? `<a class="button" href="${esc(new URL("ODbL-1.0.txt", sourcePackageRoots.osm).href)}" target="_blank" rel="noopener">OpenStreetMap licence</a><button data-action="export-osm-source">Complete OSM source</button>` : ""}</div><table class="coverage-table"><thead><tr><th>Brand</th><th>Records</th><th>Pins</th><th>Hours text</th></tr></thead><tbody>${Object.entries(
    brands,
  )
    .map(([id, label]) => {
      const rows = ps.filter((p) => p.shopping.brandId === id);
      return `<tr><th>${esc(label)}</th><td>${rows.length}</td><td>${rows.filter(M.located).length}</td><td>${rows.filter((p) => p.hoursText).length}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table><p>${esc(feeds.shopping?.source.attribution || "Shopping source validation pending.")}</p></details>`;
}
