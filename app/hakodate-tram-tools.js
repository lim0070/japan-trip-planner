import { compileTramPack, tramPackLimit, tramPlace, tramStopMatches } from "./core/hakodate-tram.js";
import { parseJSON } from "./core/contracts.js";
import { plannerRouter, publicTram } from "./core/planner-timetable.js";
import { readTramTimetable, writeTramTimetable } from "./storage/db.js";

export function createTramTools({ esc, modal, footer, setupForm, render, toast }) {
  let local = null, router = plannerRouter(), storageProblem = "", busy = false, settingsOpen = false;
  const active = () => local ?? publicTram;
  const update = next => { local = next; router = plannerRouter(next); };
  const label = stop => esc(stop.code + " · " + stop.en + " · " + stop.ja);
  const dates = timetable => esc(timetable.coverage.start + " to " + timetable.coverage.end);
  const sources = timetable =>
    `<a href="${esc(timetable.source.url)}" target="_blank" rel="noopener">${esc(timetable.source.publisher)}</a>
    · <a href="${esc(timetable.source.licenseUrl)}" target="_blank" rel="noopener">${esc(timetable.source.license)}</a>
    ${timetable.locationSource !== timetable.source ? ` · Stop reference points
    <a href="${esc(timetable.locationSource.url)}" target="_blank" rel="noopener">MLIT N02-25</a> ·
    <a href="${esc(timetable.locationSource.licenseUrl)}" target="_blank" rel="noopener">${esc(timetable.locationSource.license)}</a>` : ""}`;

  async function load() {
    try {
      const saved = await readTramTimetable();
      if (saved) update(compileTramPack(saved, { imported: true }));
    } catch {
      storageProblem = "The device timetable could not be loaded. You can import it again.";
    }
  }

  function settingsHTML() {
    return `<details id="tram-settings" ${settingsOpen ? "open" : ""}><summary>Hakodate tram timetables</summary>
      ${publicTram ? `<p>City timetable · ${publicTram.choices.length} stops · ${dates(publicTram)}. Some special-service dates are excluded. ${sources(publicTram)}</p>` : ""}
      ${local ? `<p>Device timetable · ${local.choices.length} stops · ${dates(local)}. Used for dates within this file. ${sources(local)}</p>` : ""}
      <p>Import a Hakodate timetable JSON for your own use. The file stays in this browser and works offline. Keep the JSON separately from your trip backup.</p>
      <form id="tram-file"><label>Device timetable JSON<input required type="file" name="pack" accept=".json,application/json"></label>
      <div class="actions"><button type="submit">${local ? "Replace device timetable" : "Import device timetable"}</button>
      ${local ? '<button type="button" id="tram-remove">Remove device timetable</button>' : ""}</div>
      <p id="tram-file-status" class="form-error" role="status">${esc(storageProblem)}</p></form></details>`;
  }

  function wireSettings() {
    const pane = document.getElementById("tram-settings");
    if (!pane) return;
    const form = pane.querySelector("form"), status = pane.querySelector("#tram-file-status");
    const buttons = [...form.querySelectorAll("button")];
    pane.addEventListener("toggle", () => { if (pane.isConnected) settingsOpen = pane.open; });
    const change = async file => {
      if (busy) return;
      busy = true;
      buttons.forEach(button => { button.disabled = true; });
      status.textContent = "";
      try {
        if (file && (file.size === 0 || file.size > tramPackLimit))
          throw Error("Choose a timetable JSON file smaller than 512 KB.");
        const pack = file ? parseJSON(await file.text()) : null;
        const next = file ? compileTramPack(pack, { imported: true }) : null;
        await writeTramTimetable(pack);
        update(next);
        storageProblem = "";
        settingsOpen = true;
        render();
        toast(file ? "Device timetable ready offline." : "Device timetable removed.");
      } catch (error) {
        status.textContent = error instanceof SyntaxError ? "The file is not valid JSON." : error.message;
      } finally {
        busy = false;
        buttons.forEach(button => { button.disabled = false; });
      }
    };
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (form.elements.pack.files[0]) void change(form.elements.pack.files[0]);
    });
    pane.querySelector("#tram-remove")?.addEventListener("click", () => { void change(null); });
  }

  function chooseVisit(addVisit, hasPrevious) {
    const timetable = active();
    if (!timetable) return;
    modal("Add a Hakodate tram stop", `<form class="plan-dialog">
      <label>Find a tram stop<input id="tram-search" type="search" maxlength="80" autocomplete="off" placeholder="Name, kana or stop code"></label>
      <label><span id="tram-stop-label">Tram stop</span><select name="stop" aria-labelledby="tram-stop-label" required></select></label>
      <small id="tram-results" role="status"></small>
      <p>A tram stop starts as a zero-minute visit. Set your day’s start time before opening Auto-plan.</p>
      ${hasPrevious ? '<label class="check"><input type="checkbox" name="transit" checked>Use transit from the previous visit</label>' : ""}
      <small>${sources(timetable)}</small>${footer("Add tram stop")}</form>`, () => {
      const search = document.getElementById("tram-search");
      const form = search.form, select = form.elements.stop;
      const refresh = () => {
        const found = tramStopMatches(timetable.choices, search.value);
        const previous = select.value;
        select.innerHTML = found.map(stop => `<option value="${esc(stop.code)}">${label(stop)}</option>`).join("");
        if (found.some(stop => stop.code === previous)) select.value = previous;
        select.disabled = !found.length;
        form.querySelector('button[type="submit"]').disabled = !found.length;
        document.getElementById("tram-results").textContent = found.length + " matching tram stops";
      };
      search.addEventListener("input", refresh);
      refresh();
      setupForm(values => {
        const stop = timetable.choices.find(item => item.code === values.get("stop"));
        if (stop) return addVisit(tramPlace(stop, timetable.source, timetable.locationSource), values.has("transit"));
      });
    });
  }

  return {
    load, settingsHTML, wireSettings, chooseVisit,
    available: () => !!active(),
    isStop(place) {
      const timetable = active();
      return !!timetable && Object.values(place.names).some(name => tramStopMatches(timetable.choices, name, true).length);
    },
    router: () => router,
    anchorOptions() {
      const timetable = active();
      return timetable ? `<optgroup label="Hakodate tram stops">${timetable.choices.map(stop =>
        `<option value="tram:${esc(stop.code)}">${label(stop)}</option>`).join("")}</optgroup>` : "";
    },
    anchorPlace(code) {
      const timetable = active(), stop = timetable?.choices.find(item => item.code === code);
      if (!stop) throw Error("Choose a tram stop from the list.");
      return tramPlace(stop, timetable.source, timetable.locationSource);
    },
  };
}
