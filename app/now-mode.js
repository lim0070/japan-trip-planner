import { canonical } from "./core/contracts.js";
import * as M from "./core/model.js";
import { completedPrefixLength, remainingDaySnapshot } from "./core/remaining-day.js";
import { japanClock } from "./day-tools.js";

const placeOf = (state, row) => state.places.find(place => place.id === row.stop.placeId);
const name = stop => M.name(M.visitPlace(stop));

export function nowVisits(state, day) {
  const finished = new Set(day.finishedStopIds);
  return M.schedule(state, day).slice(completedPrefixLength(day))
    .filter(({ stop }) => !finished.has(stop.id)).slice(0, 2);
}

export function finishNowVisit(state, day, stopId) {
  if (nowVisits(state, day)[0]?.stop.id !== stopId)
    throw Error("This visit has changed. Reopen Now to see the current stop.");
  day.finishedStopIds = [...(day.finishedStopIds ?? []), stopId];
}

export function rainChoices(state, day) {
  const outdoor = nowVisits(state, day).find(row => placeOf(state, row)?.setting === "outdoor" &&
    !row.stop.planLocked && row.stop.fixedStartMinute === undefined);
  if (!outdoor) return { candidates: [] };
  const destination = M.visitDestination(outdoor.stop);
  if (!M.located(destination)) return { outdoor, candidates: [] };
  const favorites = new Set(state.flags.filter(flag => flag.favourite).map(flag => flag.placeKey));
  const scheduled = new Set(day.stopIds);
  const plannedPlaces = new Set(state.stops.filter(stop => scheduled.has(stop.id))
    .map(stop => stop.placeSnapshot.key));
  const candidates = state.places
    .filter(place => place.setting === "indoor" && favorites.has(place.snapshot.key) &&
      !plannedPlaces.has(place.snapshot.key))
    .map(local => ({ local, place: M.effective(local) }))
    .filter(({ place }) => M.located(place) && !["closed", "relocated"].includes(place.operatingStatus.value))
    .map(item => ({ ...item, km: M.distance(destination.location, item.place.location) }))
    .filter(item => item.km <= 5)
    .sort((a, b) => a.km - b.km);
  return { outdoor, candidates };
}

export function proposeRainSwap(state, day, outdoorId, indoorId) {
  const { outdoor, candidates } = rainChoices(state, day);
  const choice = candidates.find(({ local }) => local.id === indoorId);
  if (!choice || outdoor?.stop.id !== outdoorId)
    throw Error("The indoor suggestion changed. Review the current visits.");
  const next = M.clone(state);
  const changedDay = next.days.find(item => item.id === day.id);
  const index = day.stopIds.indexOf(outdoorId);
  const replacement = M.addStop(next, changedDay, choice.place, choice.local.sourceRef?.datasetVersion);
  replacement.durationMinutes = outdoor.stop.durationMinutes;
  M.moveStop(next, outdoorId, null);
  M.moveStop(next, replacement.id, day.id, index);
  const rows = M.schedule(next, changedDay);
  const newRow = rows.find(row => row.stop.id === replacement.id);
  if (newRow.timingConflict)
    throw Error("The indoor visit does not fit the recorded hours or remaining schedule.");
  if (rows.slice(index + 1).some(row => row.stop.fixedStartMinute !== undefined &&
      (row.arrival === null || row.timingConflict || row.arrival > row.stop.fixedStartMinute)))
    throw Error("This swap could miss a later booking. Review travel and choose a different place.");
  return { next, row: newRow };
}

export function createNowMode({
  getState, getDay, selectDay, commit, modal, footer, setupForm, close, esc, phonePlan, showRainObservation,
}) {
  let session = 0;
  const today = () => {
    const current = getDay();
    const { date } = japanClock();
    return getState().days.find(day => day.tripId === current?.tripId && day.date === date);
  };
  const controls = () => today()
    ? '<button type="button" data-action="now-mode">Now</button>' : "";

  function editSetting(id, afterSave = close, cancelLabel = null) {
    const local = getState().places.find(place => place.id === id);
    if (!local) return;
    modal("Indoor or outdoor", `<form>
      <p>${esc(M.name(M.effective(local)))}</p>
      <label>Setting<select name="setting">
        ${[["", "Unknown"], ["indoor", "Indoor"], ["outdoor", "Outdoor"]].map(([value, label]) =>
          `<option value="${value}"${(local.setting ?? "") === value ? " selected" : ""}>${label}</option>`).join("")}
      </select></label>
      ${footer("Save setting")}</form>`, () => {
      setupForm(async values => {
        if (await commit(state => {
          const place = state.places.find(item => item.id === id);
          if (!place) throw Error("This place is no longer saved.");
          const setting = values.get("setting");
          if (setting) place.setting = setting;
          else delete place.setting;
          place.updatedAt = M.now();
        })) afterSave();
      });
      if (cancelLabel) {
        const cancel = document.querySelector("#dialog-body [data-cancel]");
        cancel.textContent = cancelLabel;
        cancel.addEventListener("click", event => {
          event.stopImmediatePropagation();
          afterSave();
        }, { capture: true });
      }
    });
  }

  function open() {
    const chosen = today();
    if (!chosen) return;
    if (getDay()?.id !== chosen.id) selectDay(chosen.id);
    const activeSession = ++session;
    const dialog = document.getElementById("dialog");
    let position = null;
    let locationMessage = "";
    let checkingLocation = false;
    let rain = false;
    function clear() {
      position = null;
      rain = false;
      dialog.removeEventListener("close", clear);
      if (session === activeSession) session++;
    }
    dialog.addEventListener("close", clear);
    const getChosen = state => state.days.find(day => day.id === chosen.id && day.date === japanClock().date);
    const on = (id, fn) => {
      const element = document.getElementById(id);
      if (element) element.onclick = fn;
    };

    function draw() {
      const state = getState(), day = getChosen(state);
      if (!day) {
        modal("Now", '<p>The itinerary day has changed.</p>');
        return;
      }
      const [current, next] = nowVisits(state, day);
      const visit = (label, row) => {
        const local = row && placeOf(state, row);
        const walk = row && position ? M.estimate(position, M.visitDestination(row.stop), "walk") : null;
        if (!row) return `<section><h3>${label}</h3><p>No visit scheduled.</p></section>`;
        const hours = M.visitHoursNotice(M.visitPlace(row.stop), day.date, row);
        return `<section><h3>${label}</h3>
          <p><strong>${esc(name(row.stop))}</strong></p>
          <p>${row.timingConflict ? "Timing needs review · " : ""}${esc(M.timeLabel(day.date, row.visitStart))}
          ${row.stop.fixedStartMinute === undefined ? "" : " · Booking"}${row.stop.planLocked ? " · Position locked" : ""}</p>
          ${hours ? `<p>${esc(hours === "Check hours" ? "Hours not checked" : hours)}</p>` : ""}
          ${walk === null ? "" : `<p>From your location · about ${walk} min walk (rough estimate)</p>`}
          <p>${{ indoor: "Indoor", outdoor: "Outdoor" }[local?.setting] ?? "Setting unknown"}</p>
          ${local ? `<button type="button" data-now-setting="${esc(local.id)}">Edit setting</button>` : ""}
        </section>`;
      };
      const { outdoor, candidates } = rain ? rainChoices(state, day) : {};
      const rainHTML = candidates?.length
        ? `<p>Indoor suggestions for ${esc(name(outdoor.stop))} · within 5 km straight-line</p>
           <ul>${candidates.slice(0, 5).map(({ local, place }) => `<li><button type="button"
             data-rain-choice="${esc(local.id)}">${esc(M.name(place))}</button></li>`).join("")}</ul>`
        : '<p>No eligible saved indoor place nearby.</p>';
      const walkBetween = position && current && next
        ? M.estimate(M.visitDestination(current.stop), M.visitDestination(next.stop), "walk") : null;
      modal("Now", `<div class="plan-dialog" id="now-controls">
        <p>${esc(day.date)} · Japan time</p>
        <div class="plan-comparison">${visit("Current", current)}${visit("Next", next)}</div>
        ${walkBetween == null ? "" : `<p>Current to next · about ${walkBetween} min walk (rough estimate)</p>`}
        <div class="dialog-footer">
          ${current ? '<button type="button" class="primary" id="now-finish">Finish current visit</button>' : ""}
          ${current ? '<button type="button" id="now-late">Running late</button>' : ""}
          ${current ? `<button type="button" id="now-location"${checkingLocation ? " disabled" : ""}>${
            position ? "Clear location" : "Use location once"}</button>` : ""}
        </div>
        ${current ? '<p class="muted">Use your location for walk estimates in this sheet. Your position stays on this device and is cleared when the sheet closes.</p>' : ""}
        <p role="status">${esc(locationMessage)}</p>
        ${current && showRainObservation ? '<button type="button" id="now-weather">Check JMA rain observations</button>' : ""}
        ${current ? `<button type="button" id="now-rain" aria-pressed="${rain}">${rain ? "Clear rain observation" : "I see rain nearby · show indoor ideas"}</button>` : ""}
        ${rain ? `<p class="muted">Based on your rain observation.</p>${rainHTML}` : ""}
      </div>`, () => {
        on("now-finish", async () => {
          if (await commit(next => {
            const target = getChosen(next);
            if (!target) throw Error("The itinerary day has changed.");
            finishNowVisit(next, target, current.stop.id);
          }) && activeSession === session) draw();
        });
        on("now-late", () => {
          clear();
          phonePlan.open();
        });
        on("now-location", () => {
          if (position) {
            position = null;
            draw();
            return;
          }
          if (!navigator.geolocation) {
            locationMessage = "This browser cannot provide a location.";
            draw();
            return;
          }
          checkingLocation = true;
          locationMessage = "Checking your location…";
          draw();
          const locationReady = message => {
            checkingLocation = false;
            locationMessage = message;
            if (document.getElementById("now-controls")) draw();
          };
          navigator.geolocation.getCurrentPosition(({ coords }) => {
            if (activeSession !== session || !dialog.open) return;
            const { latitude: lat, longitude: lng } = coords;
            if (Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180)
              position = { location: { lat, lng } };
            locationReady(position ? "" : "Your location is unavailable.");
          }, () => {
            if (activeSession === session && dialog.open)
              locationReady("Your location is unavailable or permission was declined.");
          }, { timeout: 8000, maximumAge: 0 });
        });
        on("now-rain", () => {
          rain = !rain;
          draw();
        });
        on("now-weather", () => {
          showRainObservation({ onBack: draw, day, place: M.visitDestination(current.stop) });
        });
        for (const el of document.querySelectorAll("#dialog-body [data-now-setting]")) {
          el.onclick = () => editSetting(el.dataset.nowSetting, draw, "Back to Now");
        }
        for (const el of document.querySelectorAll("#dialog-body [data-rain-choice]")) {
          el.onclick = () => review(outdoor.stop.id, el.dataset.rainChoice);
        }
      });
    }

    function review(outdoorId, indoorId) {
      const state = getState(), day = getChosen(state);
      if (!day) return draw();
      const snapshot = canonical(remainingDaySnapshot(state, day));
      const outdoor = state.stops.find(stop => stop.id === outdoorId);
      const indoor = state.places.find(place => place.id === indoorId);
      let row;
      try {
        ({ row } = proposeRainSwap(state, day, outdoorId, indoorId));
      } catch (error) {
        modal("Rain swap suggestion", `<div class="plan-dialog"><p role="alert">${esc(error.message)}</p>
          <button type="button" id="now-back">Back to Now</button></div>`, () => on("now-back", draw));
        return;
      }
      modal("Rain swap suggestion", `<form class="plan-dialog">
        <p>Replace ${esc(name(outdoor))} with <strong>${esc(name(row.stop))}</strong>.</p>
        <p>Original visit and its notes go to Unassigned. Check the indoor venue's hours and route before leaving.</p>
        <p>Proposed start · ${esc(M.timeLabel(day.date, row.visitStart))}</p>
        ${footer("Apply rain swap")}</form>`, () => {
        setupForm(async () => {
          const saved = await commit(next => {
            const target = getChosen(next);
            if (!target || canonical(remainingDaySnapshot(next, target)) !== snapshot)
              throw Error("The itinerary changed. Review a new suggestion.");
            const currentIndoor = next.places.find(place => place.id === indoorId);
            if (!currentIndoor || canonical(currentIndoor) !== canonical(indoor))
              throw Error("The indoor suggestion changed. Review the current visits.");
            Object.assign(next, proposeRainSwap(next, target, outdoorId, indoorId).next);
          });
          if (saved && activeSession === session) draw();
        });
      });
    }
    draw();
  }

  return { controls, open, editSetting };
}
