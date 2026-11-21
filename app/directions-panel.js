import {
  directionStations, findDirectionStation, googleDirectionLink, japanDateTime, jorudanDirections,
  jorudanHome, localTrainResults, stationChoices, trainWhen,
} from "./core/direction-search.js";

const modes = [["train", "Train"], ["walk", "Walk"], ["drive", "Drive"]];
const timeOptions = [["now", "Leave now"], ["depart", "Depart at"], ["arrive", "Arrive by"]];
const samePoint = (from, to) => from.normalize("NFKC").toLowerCase() === to.normalize("NFKC").toLowerCase();

export function createDirectionsPanel(esc) {
  const draft = { mode: "train", when: "now", ...japanDateTime(), from: "", to: "" };
  let points = { from: null, to: null };
  let result = null;
  const segments = (name, label, options, value) => `<fieldset class="directions-segments">
    <legend>${label}</legend><div class="directions-segment-row">${options.map(([id, text]) => `
      <label><input type="radio" id="directions-${name}-${id}" name="${name}" value="${id}" ${id === value ? "checked" : ""}>
      <span>${text}</span></label>`).join("")}</div></fieldset>`;
  const external = (url, label, primary = false) => url
    ? `<a class="button${primary ? " primary" : ""}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "";

  function prefill({ mode = "train", from = null, to = null, timing = null }) {
    points = { from, to };
    draft.mode = mode;
    for (const side of ["from", "to"]) {
      const point = points[side];
      const station = findDirectionStation(point?.label);
      draft[side] = mode === "train" ? station?.name || "" : point?.query || "";
    }
    Object.assign(draft, timing ? { ...timing, when: "depart" } : { ...japanDateTime(), when: "now" });
    result = null;
  }

  function doorToDoorLink() {
    if (draft.mode !== "train" || (!points.from && !points.to)) return "";
    const google = googleDirectionLink(points.from?.query || draft.from, points.to?.query || draft.to, "train");
    return external(google, "Open place-to-place transit in Google Maps");
  }

  function endpointHint(side) {
    const point = points[side];
    if (draft.mode !== "train" || !point) return "";
    const matchingStation = findDirectionStation(point.label);
    return esc(point.label) + (matchingStation ? "" : " · choose a station to search by train");
  }

  function renderResult() {
    if (!result) return "";
    if (result.error) return `<p class="danger">${esc(result.error)}</p>`;
    const { from, to, mode, timing, local, english, japanese, google } = result;
    const first = findDirectionStation(from), last = findDirectionStation(to);
    const stationName = (station, raw) => station ? station.name + " · " + station.ja : raw;
    if (mode !== "train") return `<h2>${esc(from)} → ${esc(to)}</h2><div class="actions">${external(google, "Open Google Maps " + (mode === "walk" ? "walking" : "driving") + " directions")}</div>`;
    const timeLabel = {now:"Leave now",depart:"Depart at",arrive:"Arrive by"}[timing.when];
    const resultHeading = `<h2>${esc(stationName(first, from))} → ${esc(stationName(last, to))}</h2>
      <p>${timeLabel} · ${esc(timing.date)} ${esc(timing.time)} Japan time</p>`;
    let timetable = '<p>Local scheduled results cover the Flower Nagai Line. Use a provider for other routes.</p>';
    if (local) {
      const bounds = `${esc(local.coverage.startInclusive)} to ${esc(local.coverage.endInclusive)}`;
      let notice = "";
      if (!local.covered) notice = `<p>Timetable coverage is ${bounds}. Check the operator for your date.</p>`;
      else if (!local.trains.length)
        notice = `<p>No scheduled direct trains ${timing.when === "arrive" ? "arrive by" : "depart at or after"} ${esc(timing.time)} on this date.</p>`;
      timetable = `<section aria-label="Scheduled direct trains">
        <h3>Scheduled direct trains</h3>${notice}
        ${local.trains.length ? `<ul class="direction-alternatives">${local.trains.map(train => `<li>
          <strong>${esc(train.depart)} → ${esc(train.arrive)}</strong>
          <span>${train.duration} min · ${local.fareJPY === null ? "Fare unverified" : "¥" + local.fareJPY.toLocaleString("en-US")} one way</span>
          <small>${esc(local.line)} · toward ${esc(train.toward)}</small>
        </li>`).join("")}</ul>` : ""}
        <p class="muted">${esc(local.operator)} schedule (adapted from GTFS) · ${bounds}. Live disruptions unverified.</p>
        <div class="actions">${external(local.source.timetableUrl, "Operator timetable")}${external(local.source.catalog, "GTFS source")}${external(local.source.licenseUrl, "CC BY 4.0")}</div></section>`;
    }
    const jrEast = first?.id === "sendai" && last?.id === "tokyo"
      ? external("https://timetables.jreast.co.jp/en/timetable/list0913.html", "JR East Sendai timetable") : "";
    return `${resultHeading}${timetable}${local?.trains.length ? "<h3>Open with a provider</h3>" : ""}
      <div class="actions directions-provider-links">${external(english, "Open Jorudan (English)", !local?.trains.length)}
      ${external(japanese, "Open Jorudan results (Japanese)")}${external(google, "Open Google Maps transit")}${jrEast}</div>
      <p class="muted">Jorudan may ask you to confirm the station. Set your travel time in Google Maps.
      <a href="${jorudanHome}" target="_blank" rel="noopener noreferrer">Jorudan search home</a>.</p>`;
  }

  function search() {
    const from = draft.from.trim(), to = draft.to.trim();
    try {
      if (!from || !to) throw Error(draft.mode === "train" ? "Enter both station names." : "Enter both places or addresses.");
      if (samePoint(from, to) || (findDirectionStation(from) && findDirectionStation(from) === findDirectionStation(to)))
        throw Error("Choose different starting and arrival points.");
      const mode = draft.mode;
      if (mode === "train" && (stationChoices(from).length || stationChoices(to).length))
        throw Error("Choose the matching station above.");
      const mapPoint = raw => {
        const station = findDirectionStation(raw);
        return mode === "train" && station ? station.ja + "駅, Japan" : raw;
      };
      const google = googleDirectionLink(mapPoint(from), mapPoint(to), mode);
      if (mode !== "train") {
        result = { from, to, mode, google };
        return;
      }
      const timing = trainWhen(draft.when, draft.date, draft.time);
      result = { from, to, mode, timing, google, local: localTrainResults(from, to, timing),
        english: jorudanDirections(from, to, timing),
        japanese: jorudanDirections(from, to, timing, { japanese: true }) };
    } catch (error) {
      result = {error: error.message};
    }
  }

  function html() {
    const stationList = directionStations.map(({name,ja}) =>
      `<option value="${esc(name)}" label="${esc(ja)}"></option>`).join("");
    return `<section class="directions-panel" id="discover-directions" aria-labelledby="discover-directions-tab">
      <form id="directions-form">
        ${segments("mode", "Travel mode", modes, draft.mode)}
        <div class="directions-endpoints">
          <div class="directions-endpoint"><label for="directions-from" id="directions-from-label"></label>
            <input id="directions-from" name="from" value="${esc(draft.from)}" maxlength="180" autocomplete="off" aria-describedby="directions-from-hint">
            <small id="directions-from-hint" class="muted"></small><div id="directions-from-choices" class="directions-station-choices"></div></div>
          <button type="button" id="directions-swap" aria-label="Swap endpoints" title="Swap endpoints">↕</button>
          <div class="directions-endpoint"><label for="directions-to" id="directions-to-label"></label>
            <input id="directions-to" name="to" value="${esc(draft.to)}" maxlength="180" autocomplete="off" aria-describedby="directions-to-hint">
            <small id="directions-to-hint" class="muted"></small><div id="directions-to-choices" class="directions-station-choices"></div></div>
        </div>
        <datalist id="directions-stations">${stationList}</datalist>
        <div id="directions-when">
          ${segments("when", "Japan time", timeOptions, draft.when)}
          <div class="grid2 directions-datetime" id="directions-datetime">
            <label>Date<input id="directions-date" type="date" name="date" value="${esc(draft.date)}"></label>
            <label>Time<input id="directions-clock" type="time" name="time" value="${esc(draft.time)}"></label>
          </div>
        </div>
        <div class="actions"><button class="primary" type="submit" id="directions-search"></button></div>
        <div id="directions-google-place">${doorToDoorLink()}</div>
      </form>
      <div id="directions-result" tabindex="-1" aria-live="polite">${renderResult()}</div></section>`;
  }

  function wire(root) {
    const form = root.querySelector("#directions-form");
    const { from, to, mode, when, date, time } = form.elements;
    const outcome = root.querySelector("#directions-result");
    function syncAppearance() {
      const train = draft.mode === "train";
      for (const [side, element] of [["from", from], ["to", to]]) {
        root.querySelector("#directions-" + side + "-label").textContent =
          (side === "from" ? "From" : "To") + (train ? " station" : " place or address");
        root.querySelector("#directions-" + side + "-hint").innerHTML = endpointHint(side);
        const candidates = root.querySelector("#directions-" + side + "-choices");
        candidates.replaceChildren();
        if (train) for (const station of stationChoices(draft[side])) {
          const choice = document.createElement("button");
          choice.type = "button";
          choice.textContent = station;
          choice.onclick = () => {
            element.value = draft[side] = station;
            clearResult();
            syncAppearance();
            element.focus();
          };
          candidates.append(choice);
        }
        if (train) element.setAttribute("list","directions-stations");
        else element.removeAttribute("list");
        element.placeholder = train ? (side === "from" ? "e.g. Sendai (Miyagi)" : "e.g. Tokyo") : "";
      }
      root.querySelector("#directions-when").hidden = !train;
      root.querySelector("#directions-datetime").hidden = draft.when === "now";
      date.disabled = time.disabled = !train || draft.when === "now";
      root.querySelector("#directions-search").textContent = train ? "Search train options" : "Find directions";
      root.querySelector("#directions-google-place").innerHTML = doorToDoorLink();
    }
    syncAppearance();
    function read() {
      Object.assign(draft, {from:from.value,to:to.value,mode:mode.value,when:when.value,date:date.value,time:time.value});
    }
    function clearResult() {
      result = null;
      outcome.replaceChildren();
    }
    form.oninput = (event) => {
      read();
      if (event.target.name === "mode" && draft.mode !== "train") {
        if (!draft.from && points.from) from.value = draft.from = points.from.query;
        if (!draft.to && points.to) to.value = draft.to = points.to.query;
      }
      if (draft.mode !== "train" && event.target === from) points.from = null;
      if (draft.mode !== "train" && event.target === to) points.to = null;
      clearResult();
      syncAppearance();
    };
    root.querySelector("#directions-swap").onclick = () => {
      [from.value, to.value] = [to.value, from.value];
      [points.from, points.to] = [points.to, points.from];
      read();
      clearResult();
      syncAppearance();
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      read();
      search();
      outcome.innerHTML = renderResult();
      outcome.focus({ preventScroll: true });
      outcome.scrollIntoView({ block: "nearest" });
    };
  }

  return { prefill, html, wire };
}
