import * as M from "./core/model.js";
import { daySnapshot, START_ANCHOR, END_ANCHOR } from "./core/day-plan.js";
import { fitStop } from "./core/fit-stop.js";
import { directionStations, stationChoices, jorudanHome } from "./core/direction-search.js";
import { mapStations } from "./core/map-stations.js";
import { placeMatcher } from "./core/place-search.js";

const routeNames = {
  timetable: "Published timetable", manual: "Entered minutes", estimate: "Estimated walk",
  jorudan: "Traveler-checked Jorudan", google: "Traveler-checked Google Maps",
  same: "Same location", gap: "Travel time unknown", start: "Day start", manualTransit: "Entered transit duration · service unverified",
};
const verdicts = {
  fits: "Fits before the train under these assumptions",
  tight: "Tight connection under these assumptions",
  missed: "This proposal misses a deadline or fixed visit",
  unknown: "There is not enough timing evidence to tell",
};
const clock = n => n === null || n < 0 ? "Unknown" : `${String(Math.floor(n / 60) % 24).padStart(2,"0")}:${String(n % 60).padStart(2,"0")}${n >= 1440 ? " +1 day" : ""}`;
const address = place => place.address.ja || place.address.en ||
  [place.address.prefecture, place.address.city].filter(Boolean).join(" ");

function stationPlace(name) {
  if (stationChoices(name).length) throw Error("Choose a qualified station name from the suggestions.");
  const [match, ...others] = mapStations(name);
  if (others.length) throw Error("Choose a qualified station name from the suggestions.");
  const value = M.manualPlace({ names: { ja:null, en:match?.label || name, romaji:null, branchJa:null } });
  if (match) value.location = { ...value.location, lat:match.lat, lng:match.lng, availability:"located", confidence:"low" };
  return value;
}

export function createFitStopPanel({ getState, getDay, getPlaces, getRouter, modal, esc, timeMinute, jorudan }) {
  const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;

  function choosePlace() {
    modal("Can I fit this stop?", `<label for="fit-find">Candidate place</label>
      <input id="fit-find" type="search" maxlength="160" placeholder="Search saved places or the map catalogue" autocomplete="off">
      <div id="fit-pick-results" class="fit-pick"></div><button type="button" id="fit-manual">Use this name with entered travel times</button>`, () => {
      const input = document.getElementById("fit-find"), output = document.getElementById("fit-pick-results");
      const options = new Map();
      const update = () => {
        const query = input.value.trim();
        options.clear();
        const matches = new Map(getState().places.map(local => [local.snapshot.key, M.effective(local)]));
        if (query) for (const place of getPlaces()) if (!matches.has(place.key)) matches.set(place.key, place);
        const match = placeMatcher(query);
        const found = [...matches.values()].map(place => [place, query ? match?.(place) ?? -1 : 0])
          .filter(([,rank]) => rank >= 0).sort(([a,x],[b,y]) => x-y ||
            (a.names.branchJa || address(a)).localeCompare(b.names.branchJa || address(b), "ja") ||
            a.key.localeCompare(b.key)).slice(0,10);
        output.innerHTML = found.map(([place], i) => {
          options.set(String(i), place);
          return `<button type="button" data-fit-choice="${i}">${esc(M.name(place))}<small>${esc(place.names.branchJa || address(place))}</small></button>`;
        }).join("") || '<p class="muted">Enter a place name to look for a match.</p>';
        document.getElementById("fit-manual").disabled = !query;
      };
      input.oninput = update;
      output.onclick = event => {
        const button = event.target.closest("[data-fit-choice]");
        if (button) open(options.get(button.dataset.fitChoice));
      };
      document.getElementById("fit-manual").onclick = () => open(M.manualPlace({
        names:{ ja:null, en:input.value.trim(), romaji:null, branchJa:null },
      }));
      update();
    });
  }

  function open(place, dayId = null) {
    const state = getState(), current = state.days.find(day => day.id === dayId) ?? getDay();
    if (!state.days.length) {
      modal("Can I fit this stop?", '<p>Create a trip and choose a day to compare the visit against a train deadline.</p>');
      return;
    }
    const minutes = (name, label) => `<label>${label}<input name="${name}" type="number" min="0" max="720" step="1" inputmode="numeric"></label>`;
    const mode = (name,label) => `<label>${label}<select name="${name}"><option value="walk">Walk</option><option value="train">Published transit</option></select></label>`;
    modal("Can I fit this stop?", `<form id="fit-stop-form" class="fit-stop-form">
      <p><strong>${esc(M.name(place))}</strong>${address(place) ? `<br><span class="muted">${esc(address(place))}</span>` : ""}</p>
      <div class="grid2"><label>Trip day<select name="day">${state.trips.map(trip => `<optgroup label="${esc(trip.name)}">${state.days.filter(d => d.tripId===trip.id).map(d =>
        `<option value="${esc(d.id)}" ${d.id===current?.id ? "selected" : ""}>${esc(d.date + (d.label ? " · " + d.label : ""))}</option>`).join("")}</optgroup>`).join("")}</select></label>
        <label>Insert after<select name="after"></select></label></div>
      <div class="grid2"><label>Time at the stop (minutes)<input name="dwell" type="number" min="0" max="720" step="1" value="30" required></label>
        ${mode("inMode","Travel to the stop")}${minutes("inMinutes","Entered minutes to the stop (optional)")}</div>
      <fieldset><legend>Train deadline in Japan time</legend>
        <label>Boarding station<input name="station" list="fit-stations" maxlength="160" autocomplete="off" required></label>
        <datalist id="fit-stations">${directionStations.map(s => `<option value="${esc(s.name)}">${esc(s.ja)}</option>`).join("")}</datalist>
        <div class="grid2"><label>Firm train departure<input name="departure" type="time" required></label>
        <label>Station margin (minutes)<input name="margin" type="number" min="0" max="180" step="1" value="15" required></label>
        ${mode("stationMode","From the new stop to the station")}${minutes("stationMinutes","Entered minutes to the station (optional)")}</div>
      </fieldset>
      <details><summary>Original route and onward travel</summary><div class="grid2">
        ${mode("beforeMode","Original route to the station")}${minutes("beforeMinutes","Entered original route minutes (optional)")}
        ${mode("afterMode","Travel to the following visit")}${minutes("afterMinutes","Entered onward minutes (optional)")}</div></details>
      <details><summary>Use some of the previous visit’s time</summary>
        ${minutes("reclaim","Minutes to give up from the previous flexible visit")}
        <p class="muted">Planner also shows the result with that visit’s original duration. The station margin stays fixed.</p>
      </details>
      <label class="check"><input name="walkEstimates" type="checkbox">Use estimated walks when minutes are blank</label>
      <p class="muted">Use a train time you checked. Include the time you need for the entrance, platform and boarding in the station margin.</p>
      <div class="actions"><button class="primary" type="submit">Compare day</button></div>
      <p class="form-error" role="alert" id="fit-error"></p><div id="fit-stop-result"></div></form>`, () => {
      const form = document.getElementById("fit-stop-form"), fields = form.elements;
      const output = document.getElementById("fit-stop-result"), error = document.getElementById("fit-error");
      const changeDay = () => {
        const selectedDay = getState().days.find(item => item.id === fields.day.value);
        fields.after.innerHTML = `<option value="${START_ANCHOR}">${selectedDay.planStartAnchor ? "Day start anchor" : "Start the day at the new stop"}</option>` + selectedDay.stopIds.map(id =>
          `<option value="${esc(id)}">${esc(M.name(M.visitPlace(getState().stops.find(stop => stop.id === id))))}</option>`).join("");
        fields.after.selectedIndex = fields.after.options.length - 1;
      };
      changeDay();
      form.oninput = event => {
        if (event.target === fields.day) changeDay();
        output.replaceChildren();
        error.textContent = "";
      };
      fields.day.onchange = changeDay;
      form.onsubmit = event => {
        event.preventDefault();
        try {
          const latest = getState(), day = latest.days.find(item => item.id === fields.day.value);
          if (!day) throw Error("Choose a saved trip day.");
          const name = fields.station.value.trim();
          if (!name) throw Error("Enter the station where you will board the train.");
          const station = stationPlace(name);
          const route = (modeName, minutesName) => ({
            mode: fields[modeName].value,
            minutes: fields[minutesName].value === "" ? null : Number(fields[minutesName].value),
          });
          const snapshot = daySnapshot(latest, day), router = getRouter(), options = {
            after:fields.after.value, dwell:Number(fields.dwell.value), departure:timeMinute(fields.departure.value),
            margin:Number(fields.margin.value), station, walkEstimates:fields.walkEstimates.checked,
            toShop:route("inMode","inMinutes"), afterShop:route("afterMode","afterMinutes"),
            toStation:route("stationMode","stationMinutes"), beforeStation:route("beforeMode","beforeMinutes"),
          };
          const result = fitStop(snapshot, place, options, router, latest.settings.defaultMode);
          const reclaim = Number(fields.reclaim.value || 0);
          const alternative = reclaim ? fitStop(snapshot, place, { ...options, reducePreviousBy:reclaim }, router, latest.settings.defaultMode) : null;
          output.innerHTML = report(result, day.date, station, alternative ? "Keep the previous visit intact" : "") +
            (alternative ? report(alternative, day.date, station, `Spend ${reclaim} minutes from the previous visit`) : "");
          output.querySelector("h3").focus();
        } catch (err) { error.textContent = err.message; }
      };
    });
  }

  function details(row, date) {
    if (!row.from) return routeNames.start;
    if (row.protectedRide && !row.protectedRide.caught) return row.protectedRide.missed
      ? "Saved train missed" : "Saved train catchability unknown";
    const kind = row.checked?.provider || row.entered?.kind || (row.usesRough ? "estimate" : row.arrival === null ? "gap" : "same");
    const check = row.checked ?? row.entered?.check;
    const timing = row.protectedRide?.caught ? " · saved train retained after station return" :
      row.conflict ? " · timing conflict" : row.arrival === null && row.start !== null ? " · resumes from saved time" : "";
    const line = check?.legs?.map(leg => `${leg.service || leg.line} ${clock(leg.depart)}–${clock(leg.arrive)}`).join(" · ");
    const source = check?.legs?.[0]?.source?.url;
    const label = kind === "manual" ? row.mode === "walk" ? "Entered walk" : "Entered duration · service unverified" : routeNames[kind];
    return esc(label + timing) + (line ? `<small>${esc(line)}</small>` : "") +
      (source && M.safeURL(source) ? `<small>${link(source,"Route source")}</small>` : "") +
      ((row.arrival === null || kind === "manual") && row.mode === "train" ? `<small>${link(jorudan(row.from.place,row.to.place,date,row.ready),"Check in Jorudan")}</small>` : "");
  }

  function report(result, date, station, alternativeLabel) {
    const { row, original, proposed, oldStation, newStation, verdict, margin, cutoff, slack, hours, earlierGap, additional } = result;
    function dayRows(plan, emphasized) {
      return plan.rows.map(item => `<li${item === emphasized ? ' class="fit-new-stop"' : ""}>
        <strong>${esc(item.to.id===END_ANCHOR ? "Return anchor" : M.name(item.to.place))}</strong>
        <span>${clock(item.start)}${item.to.id===END_ANCHOR ? "" : "–" + clock(item.departure)}</span>
        <small>${details(item,date)}</small></li>`).join("") || '<li class="muted">No visits in the saved day.</li>';
    }
    const evidence = newStation.journey?.legs || [];
    const sources = evidence.map(leg => leg.source).filter(source => source && M.safeURL(source.url));
    return `<section class="fit-stop-report">${alternativeLabel ? `<p><strong>${esc(alternativeLabel)}</strong></p>` : ""}<h3 tabindex="-1">${esc(verdicts[verdict])}</h3>
      <p>Reach <strong>${esc(M.name(station))}</strong> by <strong>${clock(cutoff)}</strong>. The entered train leaves at ${clock(cutoff+margin)} with a ${margin}-minute station margin.</p>
      <dl class="fit-times"><div><dt>Latest departure from the stop</dt><dd>${clock(newStation.latest)}${
        newStation.kind==="manualTransit" ? " · hypothetical, check a service" : newStation.kind==="estimate" ? " · estimated walk" : ""
      }</dd></div>
      <div><dt>Proposed departure</dt><dd>${clock(row.departure)}</dd></div>
      <div><dt>Station arrival with the stop</dt><dd>${clock(newStation.arrival)} · ${routeNames[newStation.kind]}</dd></div>
      <div><dt>Original route to the station</dt><dd>${clock(oldStation.arrival)} · ${routeNames[oldStation.kind]}</dd></div>
      <div><dt>Additional travel to the station (excludes time at the stop)</dt><dd>${additional===null ? "Unknown · missing route time" : `${additional>=0?"+":""}${additional} min`}</dd></div></dl>
      ${slack!==null ? `<p>${slack<0 ? `${-slack} minutes short` : `${slack} minutes to spare`} after the station margin${newStation.kind==="manualTransit" ? " if the entered duration is achievable" : ""}.</p>` : ""}
      ${evidence.length ? `<p>${esc(evidence.map(leg => `${leg.service || leg.line} ${clock(leg.depart)}–${clock(leg.arrive)}`).join(" · "))}</p>` : ""}
      ${sources.length ? `<p>${[...new Map(sources.map(source => [source.url,source])).values()].map(source => link(source.url,source.publisher)).join(" · ")}</p>` : ""}
      ${["gap","manualTransit"].includes(newStation.kind) ? `<p>${link(jorudan(row.to.place,station,date,null,cutoff) || jorudanHome,"Check the station approach in Jorudan")}</p>` : ""}
      ${hours ? `<p class="notice">${esc(hours)}</p>` : ""}
      ${earlierGap ? '<p class="notice">An earlier travel gap still needs checking.</p>' : ""}
      ${proposed.rows.slice(proposed.rows.indexOf(row)+1).some(item => item.conflict || item.arrival===null) ? '<p class="notice">Review the following visits and travel before using this proposal.</p>' : ""}
      <div class="fit-comparison"><section><h4>Original day</h4><ol>${dayRows(original)}</ol></section>
      <section><h4>With this stop</h4><ol>${dayRows(proposed,row)}</ol></section></div></section>`;
  }

  return { open, choosePlace };
}
