import { canonical } from "./core/contracts.js";
import {
  applyRemainingDay, completedPrefixLength, remainingDaySnapshot,
  skippableRemainingStops, suggestRemainingDay, undoRemainingDay,
} from "./core/remaining-day.js";
import * as M from "./core/model.js";
import { japanClock } from "./day-tools.js";

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
    return `${completedPrefixLength(day) < day.stopIds.length
      ? '<button type="button" data-action="replan-remaining">Re-plan remaining day</button>' : ""}${
      canUndo(day) ? '<button type="button" data-action="undo-remaining">Undo re-plan</button>' : ""
    }`;
  }

  function open() {
    const state = getState();
    const day = getDay();
    if (!day?.stopIds.length || completedPrefixLength(day) === day.stopIds.length) return;
    const rows = M.schedule(state, day);
    const minimumCompleted = completedPrefixLength(day);
    const trip = state.trips.find(item => item.id === day.tripId);
    const clock = japanClock();
    const now = clock.date === day.date ? clock.minute : 0;
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
    const retained = {
      keepPositions: new Set(),
      keepStarts: new Set(),
      keepNotices: new Set(),
    };
    let keepSkipped = false;
    function compare() {
      const current = getState(), savedDay = getDay();
      if (savedDay?.id !== day.id ||
          canonical(remainingDaySnapshot(current, savedDay)) !== canonical(remainingDaySnapshot(state, day)))
        throw Error("The itinerary changed. Open a new re-planning preview.");
      return suggestRemainingDay(current, savedDay, {
        completed: preferences.completed, departMinute: minuteValue(preferences.start),
        finishBy: minuteValue(preferences.finish), skipId: keepSkipped ? null : preferences.skipId || null,
        allowEstimates: preferences.estimates,
        ...Object.fromEntries(Object.entries(retained).map(([key, ids]) => [key, [...ids]])),
      });
    }
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
          for (const ids of Object.values(retained)) ids.clear();
          keepSkipped = false;
          preview(compare());
        });
      });
    }
    const warning = (row, visitStart) => {
      const result = M.visitHoursNotice(M.visitPlace(row.stop), day.date, { ...row, visitStart });
      return result === "Check hours" ? "Hours not checked" : result;
    };
    function preview(proposal, error = "", focused = "") {
      const { prefix, skipId, plan, current } = proposal;
      const reformatted = plan.rows.map(row => ({ ...row, visitStart: row.start }));
      const nextById = new Map(reformatted.map((row, i) => [row.stop.id, { row, i }]));
      const sourceStops = new Map(proposal.original.stops.map(stop => [stop.id, stop]));
      const scheduleHTML = list => `<ol start="${prefix.length + 1}">${list.map(row => {
        const booking = sourceStops.get(row.stop.id).fixedStartMinute;
        const hours = warning(row, row.visitStart);
        const unchecked = row.route?.kind === "estimate" || row.missed || row.outbound?.stale ||
          (row.segment?.mode === "train" && !row.segment.routeCheck) ||
          (row.route?.mode === "train" && !row.route.check);
        const timing = row.visitStart === null ? "Time unknown" : `${time(row.visitStart)}–${time(row.departure)}`;
        return `<li><strong>${name(row.stop)}</strong><br>${timing}${booking === undefined ? "" :
          ` · Booking ${time(booking)}`}${hours ? `<br>${esc(hours)}` : ""}${unchecked ? "<br>Unverified times" : ""}</li>`;
      }).join("")}</ol>`;
      const button = (kind, id, label, selected) =>
        `<button type="button"${selected ? ' class="primary"' : ""} data-keep="${esc(kind)}" data-visit="${esc(id)}" aria-pressed="${selected}">${esc(label)}</button>`;
      const differences = current.map((row, position) => {
        const { stop, visitStart } = row;
        const id = stop.id;
        const suggested = nextById.get(id);
        if (!suggested) return "";
        const shown = suggested.row;
        const change = [];
        if (retained.keepPositions.has(id) || position !== suggested.i) {
          const label = retained.keepPositions.has(id) ? "Original position kept" :
            `Position ${position + prefix.length + 1} → ${suggested.i + prefix.length + 1}`;
          change.push(button("keepPositions", id, label, retained.keepPositions.has(id)));
        }
        if (retained.keepStarts.has(id) || (Number.isInteger(visitStart) && visitStart < 1440 &&
            visitStart !== shown.visitStart && stop.fixedStartMinute === undefined)) {
          const label = retained.keepStarts.has(id) ? "Original start kept" :
            `Start ${time(visitStart)} → ${time(shown.visitStart)}`;
          change.push(button("keepStarts", id, label, retained.keepStarts.has(id)));
        }
        const originalWarning = warning(row, visitStart);
        const newWarning = warning(shown, shown.visitStart);
        if (retained.keepNotices.has(id) || originalWarning !== newWarning) {
          const label = retained.keepNotices.has(id) ? "Original hours notice kept" :
            `Hours notice · ${originalWarning ?? "None"} → ${newWarning ?? "None"}`;
          change.push(button("keepNotices", id, label, retained.keepNotices.has(id)));
        }
        return change.length ? `<li><strong>${name(stop)}</strong><div class="dialog-footer">${change.join("")}</div></li>` : "";
      }).filter(Boolean);
      if (preferences.skipId) {
        const { stop } = current.find(row => row.stop.id === preferences.skipId);
        differences.push(`<li><strong>${name(stop)}</strong><div class="dialog-footer">${button(
          "keepSkipped", preferences.skipId, keepSkipped ? "Visit kept in itinerary" : "Move to Unassigned", keepSkipped,
        )}</div></li>`);
      }
      modal("Compare remaining visits", `<div class="plan-dialog">
        ${prefix.length ? `<p>${prefix.length} completed ${prefix.length === 1 ? "visit stays" : "visits stay"} in place.</p>` : ""}
        <div class="plan-comparison">
          <section><h3>Current</h3>${scheduleHTML(current)}</section>
          <section><h3>Suggested</h3>
            <p>Depart ${time(plan.startMinute)} · ${plan.endLeg ? "Return" : "Finish"} ${time(plan.departure)}</p>
            ${scheduleHTML(reformatted)}
          </section>
        </div>
        ${skipId ? `<p>${name(proposal.original.skipped)} will move to Unassigned.</p>` : ""}
        ${plan.estimates ? `<p class="muted">Rough travel estimates on ${plan.estimates} ${plan.estimates === 1 ? "leg" : "legs"}.</p>` : ""}
        ${differences.length ? `<section><h3>Differences</h3>
          <p class="muted">Tap a change to keep its original value. Tap it again to reconsider.</p>
          <ul>${differences.join("")}</ul></section>` : ""}
        ${error ? `<p class="form-error" role="alert">${esc(error)} The last feasible schedule is still shown above.</p>` : ""}
        <div class="dialog-footer"><button type="button" id="remaining-back">Back</button>
          <button type="button" class="primary" id="remaining-apply"${error ? " disabled" : ""}>Apply remaining schedule</button></div>
      </div>`, () => {
        for (const control of document.querySelectorAll("#dialog-body [data-keep]")) {
          const { keep, visit } = control.dataset;
          const key = keep + "|" + visit;
          if (key === focused) requestAnimationFrame(() => control.focus());
          control.onclick = () => {
            if (keep === "keepSkipped") keepSkipped = !keepSkipped;
            else if (retained[keep].has(visit)) retained[keep].delete(visit);
            else retained[keep].add(visit);
            try {
              preview(compare(), "", key);
            } catch (reason) {
              preview(proposal, reason.message, key);
            }
          };
        }
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
