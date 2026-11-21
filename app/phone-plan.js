import { canonical } from "./core/contracts.js";
import {
  applyRemainingDay, completedPrefixLength, remainingDaySnapshot,
  skippableRemainingStops, suggestRemainingDay, undoRemainingDay,
} from "./core/remaining-day.js";
import * as M from "./core/model.js";

const japanClock = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const minuteValue = value => {
  if (!/^\d{2}:\d{2}$/.test(value)) return NaN;
  const [hour, minute] = value.split(":").map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : NaN;
};

export function createPhonePlan({ getState, getDay, commit, modal, footer, setupForm, close, esc, render, toast }) {
  const previous = new Map();
  const canUndo = day => {
    const saved = previous.get(day.id);
    return saved && canonical(remainingDaySnapshot(getState(), day, saved.skippedId)) === saved.applied;
  };

  function controls(day) {
    if (!day?.stopIds.length) return "";
    return `<button type="button" data-action="replan-remaining">Re-plan remaining day</button>${
      canUndo(day) ? '<button type="button" data-action="undo-remaining">Undo re-plan</button>' : ""
    }`;
  }

  function open() {
    const state = getState();
    const day = getDay();
    if (!day?.stopIds.length) return;
    const rows = M.schedule(state, day);
    const minimumCompleted = completedPrefixLength(day);
    const trip = state.trips.find(item => item.id === day.tripId);
    const clock = Object.fromEntries(japanClock.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const today = `${clock.year}-${clock.month}-${clock.day}`;
    const now = today === day.date ? minuteValue(clock.hour + ":" + clock.minute) : 0;
    const time = minutes => M.timeLabel(day.date, minutes);
    const name = stop => esc(M.name(M.visitPlace(stop)));
    const resume = day.planDepartures?.[day.stopIds[minimumCompleted - 1]];
    const defaultFloor = completed => Math.max(now, day.startMinute, rows[completed - 1]?.departure ?? 0);
    const preferences = {
      completed: minimumCompleted,
      start: time(Math.min(1439, Math.max(defaultFloor(minimumCompleted), resume?.departMinute ?? 0))),
      finish: time(resume?.finishBy ?? day.planEndMinute ??
        Math.max(day.startMinute, Math.min(trip.thresholds.lateFinishMinute, day.startMinute + trip.thresholds.dayMinutes))),
      estimates: day.planStartAnchor?.allowEstimates ?? day.planEndAnchor?.allowEstimates ?? true,
      skipId: "",
    };
    const skipOptions = () => '<option value="">Keep all remaining visits</option>' +
      skippableRemainingStops(state, day, preferences.completed).map(stop =>
        `<option value="${esc(stop.id)}"${stop.id === preferences.skipId ? " selected" : ""}>${name(stop)}</option>`
      ).join("");
    function form() {
      modal("Re-plan remaining day", `<form class="plan-dialog">
        <p>${esc(day.date)} · Japan time</p>
        <label>Completed through<select name="completed">
          ${minimumCompleted === 0 ? '<option value="0">No completed visits</option>' : ""}
          ${rows.slice(0, -1).map(({ stop }, i) => i + 1 < minimumCompleted ? "" :
            `<option value="${i + 1}"${i + 1 === preferences.completed ? " selected" : ""}>${i + 1}. ${name(stop)}</option>`
          ).join("")}
        </select></label>
        <div class="plan-options">
          <label>Depart at<input type="time" name="start" value="${esc(preferences.start)}" required></label>
          <label>${day.planEndAnchor ? "Return by" : "Finish by"}<input type="time" name="finish" value="${esc(preferences.finish)}" required></label>
        </div>
        <label class="check"><input type="checkbox" name="estimates"${preferences.estimates ? " checked" : ""}>Allow rough travel estimates</label>
        <label>Set a visit aside<select name="skip">${skipOptions()}</select></label>
        <p class="muted">Completed visits keep their schedule. Bookings and position locks still apply. A visit set aside goes to Unassigned.</p>
        ${footer("Compare remaining visits")}</form>`, () => {
        const fields = document.querySelector("#dialog-body form").elements;
        fields.completed.onchange = () => {
          preferences.completed = Number(fields.completed.value);
          preferences.skipId = "";
          fields.skip.innerHTML = skipOptions();
          const floor = defaultFloor(preferences.completed);
          if (floor < 1440 && minuteValue(fields.start.value) < floor) fields.start.value = time(floor);
        };
        setupForm(values => {
          Object.assign(preferences, {
            completed: Number(values.get("completed")), start: String(values.get("start")),
            finish: String(values.get("finish")), estimates: values.has("estimates"),
            skipId: String(values.get("skip") ?? ""),
          });
          const current = getState(), savedDay = getDay();
          if (savedDay?.id !== day.id ||
              canonical(remainingDaySnapshot(current, savedDay)) !== canonical(remainingDaySnapshot(state, day)))
            throw Error("The itinerary changed. Open a new re-planning preview.");
          preview(suggestRemainingDay(current, savedDay, {
            completed: preferences.completed, departMinute: minuteValue(preferences.start),
            finishBy: minuteValue(preferences.finish), skipId: preferences.skipId || null,
            allowEstimates: preferences.estimates,
          }));
        });
      });
    }
    function preview(proposal) {
      const { prefix, skipId, plan, current } = proposal;
      const scheduleHTML = (list, timing) => `<ol start="${prefix.length + 1}">${list.map(row =>
        `<li><strong>${name(row.stop)}</strong><br>${timing(row)}${row.stop.fixedStartMinute === undefined ? "" :
          ` · Booking ${time(row.stop.fixedStartMinute)}`}</li>`).join("")}</ol>`;
      modal("Compare remaining visits", `<div class="plan-dialog">
        ${prefix.length ? `<p>${prefix.length} completed ${prefix.length === 1 ? "visit stays" : "visits stay"} in place.</p>` : ""}
        <div class="plan-comparison">
          <section><h3>Current</h3>${scheduleHTML(current, ({ visitStart, departure }) =>
            visitStart === null ? "Time unknown" : `${time(visitStart)}–${time(departure)}`)}</section>
          <section><h3>Suggested</h3>
            <p>Depart ${time(plan.startMinute)} · ${plan.endLeg ? "Return" : "Finish"} ${time(plan.departure)}</p>
            ${scheduleHTML(plan.rows, ({ start, departure }) => `${time(start)}–${time(departure)}`)}
          </section>
        </div>
        ${skipId ? `<p>${name(proposal.original.skipped)} will move to Unassigned.</p>` : ""}
        ${plan.estimates ? `<p class="muted">Rough travel estimates on ${plan.estimates} ${plan.estimates === 1 ? "leg" : "legs"}.</p>` : ""}
        <div class="dialog-footer"><button type="button" id="remaining-back">Back</button>
          <button type="button" class="primary" id="remaining-apply">Apply remaining schedule</button></div>
      </div>`, () => {
        document.getElementById("remaining-back").onclick = form;
        document.getElementById("remaining-apply").onclick = async () => {
          if (await commit(next => applyRemainingDay(next, proposal), { redraw: false })) {
            const savedDay = getState().days.find(item => item.id === day.id);
            previous.set(day.id, {
              original: proposal.original, skippedId: skipId,
              applied: canonical(remainingDaySnapshot(getState(), savedDay, skipId)),
            });
            close();
            render();
            toast("Remaining schedule applied.");
          }
        };
      });
    }
    form();
  }

  async function undo() {
    const day = getDay();
    if (!day || !canUndo(day)) return;
    const { original, applied, skippedId } = previous.get(day.id);
    if (await commit(next => undoRemainingDay(next, original, applied, skippedId), { redraw: false })) {
      previous.delete(day.id);
      render();
      toast("Original schedule restored.");
    }
  }

  return { controls, open, undo };
}
