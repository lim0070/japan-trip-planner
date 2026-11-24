import * as M from "./core/model.js";
import { validateSpendingBackups } from "./core/spending-contract.js";
import { canonical, parseJSON, validateBackup, validateNotes, validateState } from "./core/contracts.js";
import { mergeImport, previewImport } from "./core/merge.js";
import { transitStatus } from "./transit-tools.js";
import { saunaTotals } from "./core/japan-depth.js";
import { completedPrefixLength } from "./core/remaining-day.js";

const backupBytes = 20 * 1024 * 1024;
const exportKey = "japan-trip-last-backup-prepared";
const restoreKey = "japan-trip-last-restore-check";

export function japanClock(at = new Date()) {
  const date = new Date(at.getTime() + 9 * 3600000);
  return {
    date: date.toISOString().slice(0, 10),
    minute: date.getUTCHours() * 60 + date.getUTCMinutes(),
  };
}

export function todayDay(days, preferredTripId, date) {
  const matching = days.filter(day => day.date === date);
  return matching.find(day => day.tripId === preferredTripId) ?? matching[0] ?? null;
}

export function todayVisits(state, day, minute) {
  const rows = M.schedule(state, day).slice(completedPrefixLength(day));
  const current = rows.find(row => row.timingConflict || row.departure === null || row.departure > minute);
  const nextBooking = rows.filter(row => row.stop.fixedStartMinute >= minute)
    .sort((a, b) => a.stop.fixedStartMinute - b.stop.fixedStartMinute)[0];
  return { current, nextBooking, remaining: current ? rows.slice(rows.indexOf(current)) : [] };
}

function clock(minutes) {
  const time = M.timeLabel("2000-01-01", minutes % 1440);
  return minutes >= 1440 ? time + "+1" : time;
}
function recordedHours(check, date) {
  if (!check) return "";
  if (check.date !== date) return "Hours checked for " + check.date;
  const intervals = check.intervals;
  const hours = intervals === null ? "Hours unknown" : intervals.length === 0 ? "Closed" :
    intervals.map(({ startMinute, endMinute }) => clock(startMinute) + "–" + clock(endMinute)).join(", ");
  return hours + " · checked " + check.checkedAt;
}

export function addressCard(place, entrance) {
  const name = M.name(place);
  const translations = [...new Set([place.names.en, place.names.romaji, place.address.en]
    .filter(text => text && text !== name && text !== place.address.ja))];
  const coordinates = entrance ? entrance.lat + ", " + entrance.lng : null;
  const address = place.address.ja || null;
  return {
    name,
    japaneseName: place.names.ja,
    address,
    translations,
    entrance,
    coordinates,
    text: [
      name, address, ...translations,
      coordinates && "Confirmed entrance · " + coordinates, entrance?.note,
    ].filter(Boolean).join("\n"),
  };
}

export function printableDay(state, trip, day, includePrivateNotes = false, includeSaunatime = false) {
  const rows = M.schedule(state, day);
  const travel = M.dayTravel(day, rows);
  const leg = (row) => {
    if (!row.segment && !row.outbound) return null;
    if (row.travel === null) return "Travel time unknown";
    const mode = row.segment?.mode || day.planStartAnchor?.mode;
    return row.travel + " min " + (mode || "travel") +
      (row.routeWait > 0 ? " · " + row.routeWait + " min wait" : "") +
      (row.missed || row.outbound?.stale ? " · route check needs review" : "");
  };
  return {
    trip: trip.name,
    date: day.date,
    label: day.label,
    weekday: new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).format(new Date(day.date)),
    backupTrain: day.backupTrain?.travelDate === day.date ? day.backupTrain : null,
    warnings: M.warnings(state, day, trip),
    tripNote: includePrivateNotes ? trip.notes : "",
    returnLeg: travel.inbound && {
      name: M.name(day.planEndAnchor.place),
      arrival: M.timeLabel(day.date, travel.inbound.arrival),
      warning: travel.inbound.stale ? "Route check needs review" : "",
    },
    visits: rows.map(row => {
      const stop = row.stop;
      const place = M.visitPlace(stop);
      const transit = transitStatus(row, day, state);
      const alerts = transit?.stale ? ["Train check needs review"] : [
        transit?.evidence.status === "suspended" ? "Train suspension recorded" : "",
        transit?.missesLast ? "Planned departure is after the recorded last train" : "",
      ].filter(Boolean);
      const sauna = includeSaunatime && stop.saunaSets?.length ? saunaTotals([stop]) : null;
      return {
        ...addressCard(place, stop.entrance),
        start: M.timeLabel(day.date, row.visitStart),
        end: M.timeLabel(day.date, row.departure),
        duration: stop.durationMinutes,
        booking: stop.fixedStartMinute === undefined ? null : M.timeLabel(day.date, stop.fixedStartMinute),
        locked: !!stop.planLocked,
        travel: leg(row),
        warning: M.visitHoursNotice(place, day.date, row),
        status: ["closed", "relocated"].includes(place.operatingStatus.value)
          ? "Recorded " + place.operatingStatus.value : "",
        checked: recordedHours(stop.hoursCheck, day.date),
        alerts, sauna,
        note: includePrivateNotes ? stop.notes : "",
      };
    }),
  };
}

const restoredCollections = {
  trips: item => item.id,
  days: item => item.id,
  stops: item => item.id,
  segments: item => M.segmentKey(item),
  places: item => item.id,
  flags: item => item.placeKey,
};
function restoreContents(state) {
  const collections = Object.fromEntries(Object.entries(restoredCollections).map(([name, key]) =>
    [name, [...state[name]].sort((a, b) => key(a).localeCompare(key(b)))],
  ));
  return { ...collections, sourceVersions: state.sourceVersions, dataLicenses: state.dataLicenses ?? {} };
}

function openScratch(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("restore");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function scratchTransaction(db, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("restore", mode);
    const request = run(transaction.objectStore("restore"));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error || Error("The storage write was interrupted."));
  });
}
async function reopenScratch(value) {
  const name = "japan-trip-restore-check-" + crypto.randomUUID();
  let database;
  try {
    database = await openScratch(name);
    await scratchTransaction(database, "readwrite", store => store.put(value, "trip"));
    database.close();
    database = await openScratch(name);
    return await scratchTransaction(database, "readonly", store => store.get("trip"));
  } finally {
    database?.close();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error("Close the temporary restore check and try again."));
    });
  }
}

export async function verifyBackupRestore(data, readBack = reopenScratch) {
  validateBackup(data);
  const restored = M.blank();
  mergeImport(restored, data, await previewImport(restored, data));
  const { notes = [], spending = [], ...reread } = await readBack({
    ...restored, ...(data.notes ? {notes:M.clone(data.notes)} : {}),
    ...(data.spending ? {spending:M.clone(data.spending)} : {}),
  });
  validateState(reread);
  validateNotes(notes);
  if (canonical(restoreContents(reread)) !== canonical(restoreContents(data)))
    throw Error("The restored trip records differed from the file.");
  if (canonical(notes) !== canonical(data.notes ?? []))
    throw Error("The restored personal notes differed from the file.");
  if (canonical(validateSpendingBackups(spending,reread.trips)) !== canonical(data.spending ?? []))
    throw Error("The restored spending differed from the file.");
  return { trips: reread.trips.length, visits: reread.stops.length,
    ...(notes.length ? { notes: notes.length } : {}),
    ...(spending.length ? { spending: spending.length } : {}) };
}

const noteCount = result => result.notes ? ` and ${result.notes} personal ${result.notes === 1 ? "note" : "notes"}` : "";

function storedStatus(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}
function saveStatus(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch {}
}
function stamp(at) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
}

export function createDayTools({
  state, day, trip, selectDay, addStop, commit, modal, close, setupForm, footer, esc, copy, toast, render, spendingToday,
}) {
  let storageStatus = "Use the button below to check whether this browser grants persistent storage.";
  const storage = navigator.storage;
  const addressHTML = (card, showName = true, printing = false) => `
    <div class="address-card">
      ${showName ? `<p lang="${card.japaneseName ? "ja" : "en"}"><strong>${esc(card.name)}</strong></p>` : ""}
      <p class="japanese-address" lang="${card.address ? "ja" : "en"}">${esc(card.address || (printing ? "Address not stored" : "Japanese address unavailable"))}</p>
      ${card.translations.length ? `<p class="muted">${card.translations.map(esc).join("<br>")}</p>` : ""}
      ${card.entrance ? `<p><strong>Confirmed entrance</strong><br>${esc(card.coordinates)}${card.entrance.note ? `<br>${esc(card.entrance.note)}` : ""}${card.entrance.checkedAt ? `<br>Checked ${esc(card.entrance.checkedAt)}` : ""}</p>` : ""}
    </div>`;

  function showAddress(id) {
    const stop = state().stops.find(item => item.id === id);
    if (!stop) return;
    const card = addressCard(M.visitPlace(stop), stop.entrance);
    modal("Japanese address card", `${addressHTML(card)}<button id="copy-address-card">Copy address card</button>`,
      () => { document.getElementById("copy-address-card").onclick = () => copy(card.text); });
  }

  function editDayLabel() {
    const current = day();
    if (!current) return;
    modal("Label this day", `<form><p>${esc(current.date)} · Japan time</p>
      <label>Day label (optional)<input name="label" maxlength="80" value="${esc(current.label || "")}" placeholder="Kyoto, arrival day"></label>
      ${footer("Save label")}</form>`, () => setupForm(async form => {
      const label = String(form.get("label") || "").trim();
      const saved = await commit(next => {
        const target = next.days.find(item => item.id === current.id);
        if (!target) throw Error("This day is no longer available.");
        if (label) target.label = label;
        else delete target.label;
      });
      if (saved) close();
    }));
  }

  function guideFirstStop() {
    const current = day();
    if (!current) return;
    const existing = state();
    const dates = new Map(existing.days.map(item => [item.id, item]));
    const options = existing.trips.map(item => `<optgroup label="${esc(item.name)}">${item.dayIds.map(id => {
      const target = dates.get(id);
      return `<option value="${esc(id)}" ${id === current.id ? "selected" : ""}>${esc(target.date)}${target.label ? " · " + esc(target.label) : ""}</option>`;
    }).join("")}</optgroup>`).join("");
    modal("Add your first stop", `<form><label>Target day<select name="target" required>${options}</select></label>
      <p>Choose a day, then pick a place from the map or Saved Spots, enter one by hand, or drop a pin.</p>
      ${footer("Continue to place options")}</form>`, () => setupForm(form => {
      const target = String(form.get("target"));
      if (!state().days.some(item => item.id === target)) throw Error("That day is no longer available.");
      close();
      selectDay(target);
      addStop();
    }));
  }

  function openToday() {
    const now = japanClock();
    const existing = state();
    const target = todayDay(existing.days, trip()?.id, now.date);
    if (!target) {
      modal("Today in Japan", `<p>${esc(now.date)} · ${esc(M.timeLabel(now.date, now.minute))} Japan time</p><p>There is no itinerary for this date.</p>`);
      return;
    }
    selectDay(target.id);
    const { current, nextBooking, remaining } = todayVisits(existing, target, now.minute);
    const header = `<p>${esc(now.date)} · ${esc(M.timeLabel(now.date, now.minute))} Japan time${target.label ? " · " + esc(target.label) : ""}</p>`;
    const booking = nextBooking ? `<p><strong>Next booking</strong><br>${esc(M.timeLabel(target.date, nextBooking.stop.fixedStartMinute))} · ${esc(M.name(M.visitPlace(nextBooking.stop)))}</p>` : "";
    const checks = remaining.map(row => {
      const place = M.visitPlace(row.stop);
      const warning = M.visitHoursNotice(place, target.date, row);
      if (warning || !row.stop.entrance || ["closed", "relocated"].includes(place.operatingStatus.value))
        return `<li>${esc(M.name(place))} · ${[
          ["closed", "relocated"].includes(place.operatingStatus.value) && "Recorded " + place.operatingStatus.value,
          warning,
          !row.stop.entrance && "Entrance unconfirmed",
        ].filter(Boolean).map(esc).join(" · ")}</li>`;
      return "";
    }).join("");
    const place = current && M.visitPlace(current.stop);
    const progress = current ? `<h3>${current.visitStart !== null && current.visitStart <= now.minute ? "Current stop" : "Next stop"}</h3>
      <p>${esc(M.timeLabel(target.date, current.visitStart))} · ${esc(M.name(place))}</p>
      ${current.stop.entrance?.note ? `<p>Entrance · ${esc(current.stop.entrance.note)}</p>` : ""}
      <div class="actions"><button id="today-address">Address card</button><button id="today-visit">Show visit</button></div>`
      : `<p>${target.stopIds.length ? "The scheduled visits have ended." : "There are no visits scheduled for today."}</p>`;
    modal("Today in Japan", header + '<div id="today-spending"></div>' + progress + booking + (checks ? `<h3>Checks to review</h3><ul>${checks}</ul>` : ""), () => {
      const spot = document.getElementById("today-spending");
      const owner = existing.trips.find(item=>item.id===target.tripId);
      if (owner && spendingToday) void spendingToday(owner,now.date).then(result=>{
        if (spot.isConnected) spot.innerHTML=result;
      }).catch(()=>{if(spot.isConnected) spot.textContent="Daily allowance could not be loaded.";});
      if (!current) return;
      document.getElementById("today-address").onclick = () => showAddress(current.stop.id);
      document.getElementById("today-visit").onclick = () => {
        close();
        selectDay(target.id);
        requestAnimationFrame(() => {
          const visit = document.querySelector(`[data-stop="${CSS.escape(current.stop.id)}"]`);
          visit?.scrollIntoView({ block: "center" });
          visit?.querySelector(".name-button")?.focus({ preventScroll: true });
        });
      };
    });
  }

  function renderPrint(data) {
    const text = value => esc(value ?? "");
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${text(data.trip)} · ${text(data.date)}</title><style>
      @page { size:A4 portrait; margin:15mm 15mm 16mm; }
      * { box-sizing:border-box; } body{ color:#18241d; background:white; max-width:52rem; margin:2rem auto; padding:0 1.25rem; font:15px/1.5 system-ui,sans-serif; }
      h1,h2,h3,p{ margin:0 0 .45rem; overflow-wrap:anywhere; } ol,ul{ padding-left:1.25rem; }
      li{ padding:.2rem 0; } .visit{ border-bottom:1px solid #ccc; padding:.7rem 0; }
      .visit-core,.travel-backup{ break-inside:avoid; } h2,h3{ break-after:avoid; } p{ orphans:3; widows:3; }
      .japanese-address[lang=ja]{ font:1.3em/1.35 "Hiragino Mincho ProN","Noto Serif CJK JP",serif; } .memo{ white-space:pre-wrap; }
      button{ padding:.6rem .85rem; } button:focus-visible{ outline:3px solid #185d43; outline-offset:2px; } .subheading{margin-bottom:1rem;}
      @media print { #print-now{display:none;} body{padding:0; margin:0; max-width:none; color:black; font-size:10pt;} a{color:inherit;} }
      </style><body><button id="print-now">Print or save as PDF</button>
      <h1>${text(data.trip)}</h1><p class="subheading">${text(data.weekday)} · ${text(data.date)} · Japan time${data.label ? " · " + text(data.label) : ""}</p>
      <section class="travel-backup"><h2>Backup train &amp; emergency</h2>
      ${data.backupTrain ? `<p class="memo">${text(data.backupTrain.text)}</p><p>Traveler checked ${text(data.backupTrain.checkedAt)}${M.safeURL(data.backupTrain.sourceUrl) ? ` · <a href="${text(data.backupTrain.sourceUrl)}">Route source</a>` : ""}</p>` : "<p>No backup train recorded.</p>"}
      <p>Police <strong>110</strong> · Fire or ambulance <strong>119</strong> · <a href="https://www.japan.travel/en/plan/hotline/">JNTO emergency information</a></p></section>
      ${data.tripNote ? `<p class="memo">${text(data.tripNote)}</p>` : ""}
      ${data.warnings.length ? `<h2>Day warnings</h2><ul>${data.warnings.map(value => `<li>${text(value)}</li>`).join("")}</ul>` : ""}
      ${data.visits.length ? `<h2>Itinerary</h2><ol>${data.visits.map(visit =>
        `<li class="visit"><div class="visit-core"><h3 lang="${visit.japaneseName ? "ja" : "en"}">${text(visit.name)}</h3>
        <p>${text(visit.start)} – ${text(visit.end)} · ${text(visit.duration)} min${visit.booking ? " · Booking " + text(visit.booking) : ""}${visit.locked ? " · Position locked" : ""}</p>
        ${addressHTML(visit, false, true)}
        ${[visit.travel, visit.status, visit.warning, visit.checked, ...visit.alerts].filter(Boolean).map(value => `<p>${text(value)}</p>`).join("")}</div>
        ${visit.sauna ? `<p>Saunatime · ${visit.sauna.sets} sets · Sauna ${visit.sauna.sauna} min · Cold ${visit.sauna.cold} min · Rest ${visit.sauna.rest} min</p>` : ""}
        ${visit.note ? `<p class="memo">${text(visit.note)}</p>` : ""}</li>`).join("")}</ol>` : "<p>No visits planned.</p>"}
      ${data.returnLeg ? `<p>Return to ${text(data.returnLeg.name)} · ${text(data.returnLeg.arrival)}${data.returnLeg.warning ? " · " + text(data.returnLeg.warning) : ""}</p>` : ""}
      </body></html>`;
  }

  function printDay() {
    const current = day(), active = trip();
    if (!current || !active) return;
    modal("Print this day", `<p>${esc(current.date)} · ${esc(active.name)}</p>
      <p>The print view includes the schedule, addresses, entrances, bookings, warnings, backup train and emergency numbers.</p>
      <label class="check"><input type="checkbox" id="print-notes">Include private trip and visit notes</label>
      <label class="check"><input type="checkbox" id="print-sauna">Include Saunatime logs</label>
      <button id="open-print-day">Open print view (new tab)</button>`, () => {
      document.getElementById("open-print-day").onclick = () => {
        const data = printableDay(state(), active, current, document.getElementById("print-notes").checked,
          document.getElementById("print-sauna").checked);
        const view = window.open("", "_blank");
        if (!view) {
          toast("Allow a new tab to open the print view.");
          return;
        }
        view.opener = null;
        view.document.open();
        view.document.write(renderPrint(data));
        view.document.close();
        view.document.getElementById("print-now").onclick = () => view.print();
      };
    });
  }

  function recoveryHTML() {
    const exported = storedStatus(exportKey);
    const restored = storedStatus(restoreKey);
    const prepared = exported ? stamp(exported.at) + " · " + exported.filename : "No backup prepared in this browser.";
    const proof = restored ? stamp(restored.at) + " · " + restored.trips + " trips, " + restored.visits + " visits" + noteCount(restored)
      : "No restore check in this browser.";
    return `<details class="backup-recovery"><summary>Backup and recovery</summary>
      <p><strong>Last backup prepared</strong><br><span id="last-planner-backup">${esc(prepared)}</span></p><p class="muted">Confirm the file finished downloading and keep a copy outside this browser.</p>
      <p><strong>Last successful restore check</strong><br>${esc(proof)}</p>
      <p class="muted">A restore check imports and reopens the selected JSON in temporary browser storage. Your open trips are untouched.</p>
      <div class="actions"><button data-action="verify-restore">Verify a downloaded JSON backup</button><button data-action="persist-planner">Request persistent storage</button></div>
      <p id="persistent-storage-status" role="status">${esc(storageStatus)}</p>
    </details>`;
  }

  function openRestoreCheck() {
    modal("Verify a downloaded JSON backup", `<form>
      <p>Read back this file as an isolated restore in this browser.</p><label>Planner backup JSON<input name="backup" type="file" accept="application/json,.json" required></label>
      ${footer("Run restore check")}</form>`, () => setupForm(async form => {
      const file = form.get("backup");
      if (!file?.size || file.size > backupBytes) throw Error("Choose a Planner JSON backup up to 20 MiB.");
      const submit = document.querySelector("#dialog-body [type=submit]");
      submit.disabled = true;
      let result;
      try { result = await verifyBackupRestore(parseJSON(await file.text())); }
      finally { submit.disabled = false; }
      saveStatus(restoreKey, { at: M.now(), ...result });
      render();
      modal("Restore check passed", `<p>Imported and reopened ${result.trips} trips, ${result.visits} visits${noteCount(result)} from temporary storage.</p>
        ${result.spending ? `<p>Verified spending for ${result.spending} ${result.spending===1?"trip":"trips"}.</p>` : ""}
        <p>Repeat the check on the device you plan to use.</p><button id="done-restore-check">Done</button>`,
        () => { document.getElementById("done-restore-check").onclick = close; });
    }));
  }

  async function persistStorage() {
    try {
      if (!storage?.persist) storageStatus = "Persistent storage requests are unavailable in this browser.";
      else if (await storage.persist()) storageStatus = "Persistent storage was granted for this site. Keep a separate backup.";
      else storageStatus = "Persistent storage was not granted. Keep a separate backup.";
    } catch {
      storageStatus = "The browser could not check persistent storage. Keep a separate backup.";
    }
    const status = document.getElementById("persistent-storage-status");
    if (status) status.textContent = storageStatus;
  }

  return {
    actions: {
      "japanese-address": showAddress,
      "edit-day-label": editDayLabel,
      "guide-first-stop": guideFirstStop,
      "open-today": openToday,
      "print-day": printDay,
      "verify-restore": openRestoreCheck,
      "persist-planner": persistStorage,
    },
    recoveryHTML,
    recordExport(value, filename) {
      if (!value?.exportId || !["full", "trip"].includes(value.kind)) return;
      const at = M.now();
      saveStatus(exportKey, { at, filename });
      const status = document.getElementById("last-planner-backup");
      if (status) status.textContent = stamp(at) + " · " + filename;
    },
  };
}
