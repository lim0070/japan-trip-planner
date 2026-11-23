import { canonical } from "./core/contracts.js";
import { name, visitPlace } from "./core/model.js";

const pageSize = 25;
const clock = minute => String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
const visitName = stop => name(visitPlace(stop));
const fieldNames = new Map(Object.entries({
  name:"Name", notes:"Notes", startMinute:"Starts at", durationMinutes:"Visit length", fixedStartMinute:"Booking time",
  planEndMinute:"Finish by", planDepartures:"Departure checkpoints", planVisitStarts:"Planned visit starts",
  planStartAnchor:"Departure place", planEndAnchor:"End place", planLocked:"Position locked", manualMinutes:"Checked minutes",
  routeCheck:"Checked route", placeSnapshot:"Place details", placeId:"Saved place", sourceDatasetVersion:"Source version",
  placeOverrides:"Place field edits", hoursCheck:"Checked hours", visitDetails:"Visit details", travelNotes:"Day notes",
  backupTrain:"Backup train", finishedStopIds:"Finished visits", transitEvidence:"Transit evidence",
}));
const clockFields = new Set(["startMinute", "fixedStartMinute", "planEndMinute"]);
const shownFields = (value, other) => [...new Set([...Object.keys(value), ...Object.keys(other)])]
  .filter(key => key !== "overrideFingerprint" && canonical(value[key]) !== canonical(other[key]));

function fieldValue(key, value) {
  if (value === undefined || value === null || value === "") return "Empty";
  if (clockFields.has(key)) return clock(value);
  if (key === "durationMinutes" || key === "manualMinutes") return value + " min";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

export function showTripUpdate(plan, { modal, esc, apply, exportBefore, back }) {
  const selected = new Set(plan.changes.filter(row => row.choice === "file").map(row => row.index));
  let page = 0, saving = false;
  const current = new Map(plan.local.stops.map(stop => [stop.id, visitName(stop)]));
  const incoming = new Map(plan.incoming.stops.map(stop => [stop.id, visitName(stop)]));

  function itinerary(closure, other, names) {
    const byDate = new Map(other.days.map(day => [day.date, day]));
    const changed = closure.days.filter(day => {
      const pair = byDate.get(day.date);
      return !pair || canonical(day.stopIds) !== canonical(pair.stopIds);
    });
    return `<p>${esc(closure.trip.startDate)} through ${esc(closure.trip.endDate)} · ${closure.days.length} days</p>
      <details><summary>Dates and visit order</summary>
      <ol>${changed.map(day => `<li><strong>${esc(day.date)}${day.label ? " · " + esc(day.label) : ""}</strong>
        <small> · starts ${clock(day.startMinute)}</small>${day.stopIds.length ? `<ol>${day.stopIds.map(id =>
          "<li>" + esc(names.get(id)) + "</li>").join("")}</ol>` : " · no visits"}
        ${!byDate.has(day.date) && day.travelNotes ? `<pre>${esc(JSON.stringify(day.travelNotes, null, 2))}</pre>` : ""}</li>`).join("")}
      </ol><p>${closure.trip.unassignedStopIds.length} unassigned visits</p></details>`;
  }

  function values(row, side) {
    const value = row[side];
    if (row.kind === "calendar") return side === "browser"
      ? itinerary(plan.local, plan.incoming, current)
      : itinerary(plan.incoming, plan.local, incoming);
    if (row.kind === "unassign-visit") return side === "file"
      ? "<p>Move to Unassigned. The visit and any photos stay in the trip.</p>"
      : `<p>${esc(row.group)} · Keep in its day when possible</p>`;
    if (row.kind === "new-visit") return side === "browser"
      ? "<p>Visit absent</p>"
      : `<p>${esc(row.group)} · ${value.durationMinutes} min${value.fixedStartMinute === undefined ? "" : " · Booking " + clock(value.fixedStartMinute)}</p>
        ${value.notes ? `<p class="trip-update-text">${esc(value.notes)}</p>` : ""}`;
    if (row.kind === "new-segment") return side === "browser"
      ? "<p>Leg absent</p>"
      : `<p>${esc(value.mode)} · ${value.manualMinutes === null ? "No checked time" : value.manualMinutes + " min"}</p>
        ${value.routeCheck ? `<p>${esc(value.routeCheck.provider)} · ${esc(value.routeCheck.date)} ${clock(value.routeCheck.departMinute)}</p>` : ""}`;
    const paired = row[side === "browser" ? "file" : "browser"];
    return shownFields(value, paired).map(key => {
      const text = fieldValue(key, value[key]);
      if (typeof value[key] === "object" && value[key] !== null)
        return `<details><summary>${esc(fieldNames.get(key) ?? row.label)} · ${key === "placeSnapshot" ? esc(name(value[key])) : "view details"}</summary><pre>${esc(text)}</pre></details>`;
      return `<p class="trip-update-text">${row.keys.length > 1 ? `<strong>${esc(fieldNames.get(key) ?? key)}</strong> ` : ""}${esc(text)}</p>`;
    }).join("");
  }

  function listed(row) {
    return `<li class="trip-update-row"><h3 id="trip-change-${row.index}">${esc(row.label)}</h3>
      <p class="muted">${esc(row.group)} · ${esc(row.status)}</p>
      <div class="trip-update-values"><div><h4>Browser</h4>${values(row,"browser")}</div>
      <div><h4>File</h4>${values(row,"file")}</div></div>
      <label class="check"><input type="checkbox" data-trip-change="${row.index}" aria-describedby="trip-change-${row.index}" ${selected.has(row.index) ? "checked" : ""}>
      ${row.kind === "unassign-visit" ? "Move to Unassigned" : "Use the file value"}</label></li>`;
  }

  modal("Review changes to this trip", `<div class="plan-dialog trip-update">
    <p><strong>Saved trip</strong> ${esc(plan.local.trip.name)} · ${esc(plan.local.trip.startDate)} through ${esc(plan.local.trip.endDate)}</p>
    ${plan.linkedCopy ? '<p class="notice">This update targets the linked copy. The original trip stays separate.</p>' : ""}
    ${plan.protectedVisits.size ? `<p class="notice">${plan.protectedVisits.size} repeat visits could not be matched reliably. They keep their browser edits and order on any date you keep. Review these visits separately in the itinerary.</p>` : ""}
    <p><strong>File trip</strong> ${esc(plan.incoming.trip.name)} · ${esc(plan.incoming.trip.startDate)} through ${esc(plan.incoming.trip.endDate)}</p>
    <p>${plan.older ? "This file is older than the last accepted version. Choose any values you want to bring back." :
      plan.baseline ? "Changes from the file are preselected when the browser value matches the last accepted file. Conflicts keep the browser value until you choose." :
      "There’s no earlier imported version to compare. Choose which file values to use. Browser values are selected by default."}</p>
    ${plan.removedDays.length ? `<p class="notice">The file calendar leaves out ${plan.removedDays.length} saved ${plan.removedDays.length === 1 ? "day" : "days"} (${plan.removedDays.map(day => esc(day.date)).join(", ")}). If you choose this calendar, visits for dates that no longer exist move to Unassigned. Day-only notes and travel between visits that are no longer adjacent are available in the current trip export.</p>` : ""}
    ${plan.changes.some(row => row.kind === "calendar") ? '<p class="muted">Date changes and a new visit order can invalidate departure checkpoints. Review the resulting timetable.</p>' : ""}
    ${plan.changes.length ? `<div class="actions"><button type="button" id="trip-update-file">Select file values</button><button type="button" id="trip-update-browser">Keep browser values</button></div>
      <p class="muted">Choose “Move to Unassigned” separately for any browser-only visit you want to take off the itinerary.</p>
      <ol class="trip-update-list"></ol><div id="trip-update-pages" class="actions"></div>` : "<p>This file has the same trip details and schedule.</p>"}
    <p id="trip-update-count" role="status"></p>
    <p id="trip-update-problem" class="form-error" role="alert"></p>
    <div class="dialog-footer"><button id="trip-update-back" type="button">Back to import</button>
      <button id="trip-update-export" type="button">Export current trip</button>
      <button id="trip-update-apply" type="button" class="primary">Update this trip</button></div></div>`, () => {
    const body = document.querySelector(".trip-update");
    const list = body.querySelector(".trip-update-list"), pages = body.querySelector("#trip-update-pages");
    const count = body.querySelector("#trip-update-count"), update = body.querySelector("#trip-update-apply");
    const problem = body.querySelector("#trip-update-problem");
    function refreshCount() {
      count.textContent = selected.size + " of " + plan.changes.length + " changes selected";
      update.disabled = saving || !selected.size;
    }
    function paint() {
      if (list) {
        const start = page * pageSize;
        list.innerHTML = plan.changes.slice(start, start + pageSize).map(listed).join("");
        const pageCount = Math.ceil(plan.changes.length / pageSize);
        pages.innerHTML = pageCount > 1
          ? `<button type="button" data-trip-page="-1" ${page ? "" : "disabled"}>Previous changes</button><span>Page ${page + 1} of ${pageCount}</span><button type="button" data-trip-page="1" ${page + 1 < pageCount ? "" : "disabled"}>Next changes</button>` : "";
      }
      refreshCount();
    }
    list?.addEventListener("change", event => {
      const row = event.target.closest("input[data-trip-change]");
      if (!row) return;
      const i = Number(row.dataset.tripChange);
      if (row.checked) selected.add(i);
      else selected.delete(i);
      refreshCount();
    });
    pages?.addEventListener("click", event => {
      if (!event.target.matches("[data-trip-page]")) return;
      page += Number(event.target.dataset.tripPage);
      paint();
      list.querySelector("input")?.focus();
    });
    body.querySelector("#trip-update-file")?.addEventListener("click", () => {
      for (const row of plan.changes)
        if (row.kind !== "unassign-visit") selected.add(row.index);
      paint();
    });
    body.querySelector("#trip-update-browser")?.addEventListener("click", () => { selected.clear(); paint(); });
    body.querySelector("#trip-update-back").onclick = back;
    body.querySelector("#trip-update-export").onclick = exportBefore;
    update.onclick = async () => {
      if (!selected.size || saving) return;
      saving = true;
      refreshCount();
      problem.textContent = "";
      try {
        if (!await apply(new Set(selected)))
          problem.textContent = "The update was not saved. Close this review to see the save error and recovery options.";
      } catch (error) {
        problem.textContent = error.message;
      } finally {
        saving = false;
        refreshCount();
      }
    };
    paint();
  });
}
