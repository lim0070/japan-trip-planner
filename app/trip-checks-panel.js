import { collectTripChecks, checkDayHash } from "./core/trip-checks.js";

export function openTripChecks(state, trip, { modal, close, esc, follow }) {
  const groups = collectTripChecks(state,trip), total = groups.reduce((sum, group) => sum + group.checks.length, 0);
  modal("Still to check", `<p><strong>${esc(trip.name)}</strong></p>
    <p>${total ? `${total} ${total===1?"check":"checks"} across ${groups.length} ${groups.length===1?"day":"days"}.` : "No timing, route, hours or location checks flagged for this trip."}</p>
    ${groups.map(({day,checks}) => `<section class="trip-check-day">
      <h3>${esc(day.date+(day.label?" · "+day.label:""))}</h3>
      <ul>${checks.map(({kind,message,stopId,target,rail}) => `<li><small>${esc(kind)}</small>
        <a data-check-day href="${esc(checkDayHash(day.id,stopId,target))}">${esc(message)}</a>
        ${rail ? `<small><a href="${esc(rail.url)}" target="_blank" rel="noopener noreferrer">${rail.needsStations ? "Dated Jorudan check · choose stations" : "Dated Jorudan check"}</a>
          · ${rail.source ? `<a href="${esc(rail.source)}" target="_blank" rel="noopener noreferrer">${esc(rail.label)}</a>` : "Operator source unknown"}</small>` : ""}</li>`).join("")}</ul></section>`).join("")}`, () => {
    for (const link of document.querySelectorAll("[data-check-day]")) link.onclick = event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      close();
      follow(link.hash);
    };
  });
}
