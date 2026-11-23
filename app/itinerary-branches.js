import { name } from "./core/model.js";
import { branchOrigins, itineraryBranches, suggestedBrands } from "./core/itinerary-branches.js";
import { googleMapSearch } from "./core/map-lookup.js";

export function createBranchFinder({ getState, getTrip, getDay, getCatalogue, getAliases, getReady, modal, esc, showPlace, fit }) {
  return function open({ title, body, selected }) {
    const state = getState();
    if (!state.trips.length) {
      modal("Find branches near itinerary", "<p>Create a trip and add places to search near its itinerary.</p>");
      return;
    }
    const suggestions = suggestedBrands(title + "\n" + body);
    modal("Find branches near itinerary", `<form id="branch-finder">
      <label>Shop or chain<input name="chain" maxlength="96" required autocomplete="off"></label>
      ${suggestions.length ? `<div class="actions">${suggestions.map(brand => `<button type="button" data-branch-term="${esc(brand)}">${esc(brand)}</button>`).join("")}</div>` : ""}
      <div class="grid2"><label>Trip<select name="trip">${state.trips.map(trip => `<option value="${esc(trip.id)}" ${trip.id===getTrip()?.id?"selected":""}>${esc(trip.name)}</option>`).join("")}</select></label>
      <label>Day<select name="day" aria-label="Day"></select></label>
      <label>Search radius<select name="radius"><option value="3">3 km</option><option selected value="5">5 km</option><option value="10">10 km</option><option value="25">25 km</option></select></label></div>
      <button type="submit" class="primary">Find nearby branches</button>
      <p id="branch-finder-status" role="status"></p><div id="branch-finder-results"></div></form>`, () => {
      const form = document.getElementById("branch-finder"), fields = form.elements;
      const status = document.getElementById("branch-finder-status"), output = document.getElementById("branch-finder-results");
      const options = new Map();
      const refreshDays = () => {
        fields.day.innerHTML = '<option value="">Whole trip</option>' + getState().days.filter(d => d.tripId===fields.trip.value).map(d =>
          `<option value="${esc(d.id)}">${esc(d.date + (d.label ? " · " + d.label : ""))}</option>`).join("");
      };
      refreshDays();
      if (fields.trip.value === getTrip()?.id && getDay()?.id) fields.day.value = getDay().id;
      const seed = selected?.trim();
      fields.chain.value = seed && seed.length <= 96 && !/\n/u.test(seed) ? seed : suggestions.length === 1 ? suggestions[0] : "";
      const stale = () => { status.textContent = ""; output.replaceChildren(); };
      form.oninput = stale;
      fields.trip.onchange = () => { refreshDays(); stale(); };
      for (const button of form.querySelectorAll("[data-branch-term]")) button.onclick = () => {
        fields.chain.value = button.dataset.branchTerm;
        form.requestSubmit();
      };
      form.onsubmit = event => {
        event.preventDefault();
        const query = fields.chain.value.trim();
        if (!query) return;
        const origins = branchOrigins(getState(), fields.trip.value, fields.day.value), scope = Number(fields.radius.value);
        const { total, ranked, addressOnly, originCount } = itineraryBranches(getCatalogue(), origins, query, scope, getAliases());
        status.textContent = ranked.length ? `${ranked.length} pinned ${ranked.length === 1 ? "branch" : "branches"} within ${scope} km straight-line.` :
          !originCount ? "This itinerary has no mapped points for a distance comparison." : total ? `No matching pins within ${scope} km.` :
            getReady() ? "No matching branches in the Planner Shopping catalogue." : "Shopping data is unavailable or still loading. Try again after it loads.";
        const result = ({place,nearest}, i) => {
          options.set(String(i), {place, nearest});
          const address = place.address.ja || place.address.en || [place.address.prefecture,place.address.city].filter(Boolean).join(" ");
          return `<li><strong>${esc(name(place))}</strong>${place.names.branchJa ? ` · ${esc(place.names.branchJa)}` : ""}
            <small>${esc(address || "Address unavailable")}</small>
            ${nearest ? `<small>${nearest.km.toFixed(1)} km from ${esc(name(nearest.place))} · ${esc(nearest.day.date)}</small>` : '<small>Address only · location unverified</small>'}
            <div class="actions">${nearest ? `<button type="button" data-branch-map="${i}">Show pin</button>` : ""}
            <button type="button" data-branch-fit="${i}">Can I fit this stop?</button></div></li>`;
        };
        options.clear();
        const locations = [...new Set(origins.map(({place}) => [place.address.prefecture,place.address.city].filter(Boolean).join(" ")).filter(Boolean))];
        output.innerHTML = (ranked.length ? `<ol class="branch-results">${ranked.slice(0,12).map(result).join("")}</ol>` : "") +
          (addressOnly.length ? `<details><summary>${addressOnly.length} address-only listings in itinerary areas</summary><ul class="branch-results">${addressOnly.slice(0,8).map((row,i) => result(row,i+12)).join("")}</ul></details>` : "") +
          `<details ${ranked.length ? "" : "open"}><summary>Search Google Maps for other branches</summary>
            <p>Open Google Maps to search for the entered shop and area. Verify the branch and journey there.</p>
            <label>City or station<input id="branch-area" maxlength="96" list="branch-areas" autocomplete="off" value="${esc(locations[0]||"")}"></label>
            <datalist id="branch-areas">${locations.map(area => `<option value="${esc(area)}"></option>`).join("")}</datalist>
            <a class="button" id="branch-google" target="_blank" rel="noopener noreferrer">Search Google Maps</a></details>`;
        const area = output.querySelector("#branch-area"), google = output.querySelector("#branch-google");
        const external = () => google.href = googleMapSearch([query, area.value.trim()].filter(Boolean).join(" "));
        // Changing the handoff area only updates the address in this link.
        area.oninput = event => { event.stopPropagation(); external(); };
        external();
      };
      output.onclick = event => {
        const map = event.target.closest("[data-branch-map]"), button = event.target.closest("[data-branch-fit]");
        if (map) showPlace(options.get(map.dataset.branchMap).place);
        if (button) {
          const {place,nearest} = options.get(button.dataset.branchFit);
          fit(place, nearest?.day.id ?? fields.day.value);
        }
      };
    });
  };
}
