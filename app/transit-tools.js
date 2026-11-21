import { routeEndpoints, safeURL, schedule, timeLabel, visitDestination } from "./core/model.js";
import { yamagataRailCheck } from "./core/yamagata-rail.js";

const jrEast = "https://traininfo.jreast.co.jp/train_info/e/tohoku.aspx";
const metro = "https://www.tokyometro.jp/lang_en/station/shibuya/timetable/index.html";
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const nowDate = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());

function departureMinute(value) {
  if (!value) return null;
  const match = /^([0-4]?[0-9]):([0-5][0-9])$/.exec(value);
  if (!match || +match[1] > 47) throw new Error("Enter a time from 00:00 to 47:59, or leave it blank.");
  return +match[1] * 60 + +match[2];
}

function endpoints(state, { fromStopId, toStopId }) {
  const from = state.stops.find(stop => stop.id === fromStopId);
  const to = state.stops.find(stop => stop.id === toStopId);
  return from && to ? routeEndpoints(visitDestination(from), visitDestination(to)) : null;
}

export function transitStatus(row, day, state) {
  const evidence = row.segment?.transitEvidence;
  if (row.segment?.mode !== "train" || !evidence) return null;
  const stale = evidence.travelDate !== day.date || evidence.endpoints !== endpoints(state, row.segment);
  const missesLast = !stale && evidence.lastDeparture !== null && row.routeDeparture !== null &&
    row.routeDeparture > evidence.lastDeparture;
  return { evidence, stale, missesLast };
}

export function createTransitTools({ getState, getDay, commit, modal, close, setupForm, footer, esc, val, stationTools }) {
  function link(url, text) {
    return safeURL(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}</a>` : "";
  }

  function legSection(row, day) {
    if (row.segment.mode !== "train") return "";
    const state = getState();
    const report = transitStatus(row, day, state);
    const published = yamagataRailCheck(state, day, row);
    const journey = train => esc(train.depart + " → " + train.arrive);
    const scheduled = !published ? "" : `<div class="transit-evidence">
      <p><strong>${esc(published.line)} · published timetable</strong><br>
      ${esc(published.fromJa + " (" + published.from + ") → " + published.toJa + " (" + published.to + ")")}<br>
      Last scheduled direct train · ${journey(published.last)}</p>
      ${published.missedLast
        ? `<p class="danger">終電 · The itinerary departure at ${clock(published.depart)} is after the last scheduled direct train.</p>`
        : published.next ? `<p>Next scheduled at or after ${clock(published.depart)} · ${journey(published.next)}</p>`
          : '<p>Next train unknown · itinerary departure time is missing.</p>'}
      ${published.earlier ? `<p>Leave earlier · ${journey(published.earlier)}</p>` : ""}
      <p>Published one-way fare · ¥${published.fareJPY} · ${link("https://flower-liner.jp/fare/", "Operator fares")}</p>
      <p class="muted">Japan time. Allow time to board and check for service changes. Live service unverified.</p>
      <p>${link(published.source.timetableUrl, "Operator timetable")} · ${link(published.source.statusUrl, "Operator updates")}</p>
      <details><summary>Timetable source and coverage</summary>
        <p>${esc(published.operator)}. Two-station selection from the operator GTFS. Daily schedule from
        ${esc(published.coverage.startInclusive)} through ${esc(published.coverage.endInclusive)}.</p>
        <p>${link(published.source.catalog, "Source catalog")} · ${link(published.source.licenseUrl, published.source.license)}</p>
      </details>
    </div>`;
    const edit = `<button type="button" data-action="transit-evidence" data-id="${esc(row.segment.toStopId)}">${report ? "Review train & exit check" : "Check train & exit"}</button>`;
    if (!report || report.stale) return `${scheduled}<div class="actions"><span class="muted">${report?.stale
      ? "Route or day changed. Recheck train service and exit." : published
        ? "Exit unverified." : "Service, last train and exit unverified."}</span>${edit}</div>`;
    const { evidence, missesLast } = report;
    const status = evidence.status === "suspended" ? "Suspension recorded" :
      evidence.status === "operating" ? "Service marked operating" : "Service unverified";
    const exit = evidence.exit ? "Exit (出口) " + evidence.exit : "Exit unverified";
    const last = evidence.lastDeparture === null ? "Last train unverified" : "Last departure " + timeLabel(day.date, evidence.lastDeparture);
    return `${scheduled}<div class="transit-evidence"><p>${esc(status)} · ${esc(last)} · ${esc(exit)}${evidence.accessMetres === null ? "" : " · " + evidence.accessMetres + " m walking (entered)"}<br>
      Traveler checked ${esc(evidence.checkedAt)}${safeURL(evidence.sourceUrl) ? " · " + link(evidence.sourceUrl, "Traveler's source") : ""}
      ${evidence.stationFeature ? " · " + link(stationTools.referenceLink(evidence.stationFeature), "Mapped exit reference") : ""}</p>
      ${missesLast ? '<p class="danger">The planned departure is after the recorded last train.</p>' : ""}
      ${evidence.alternative ? `<p>Alternative · ${esc(evidence.alternative)}</p>` : ""}${edit}</div>`;
  }

  function editEvidence(id) {
    const day = getDay();
    const row = day && schedule(getState(), day).find(item => item.stop.id === id);
    if (!row?.segment || row.segment.mode !== "train") return;
    const recorded = row.segment.transitEvidence;
    const choices = stationTools.referenceChoices();
    const hasReference = choices.some(group => group.options.some(option => option.key === recorded?.stationFeature));
    modal("Train and exit check", `<form>
      <p>Record an operator or traveler check for ${esc(day.date)}. Service may change. A nearby mapped entrance does not verify the exit for this route.</p>
      <p>${link(jrEast, "JR East service status")} · ${link(metro, "Tokyo Metro timetable example")}</p>
      <label>Service on travel date<select name="status">${[["unchecked", "Unverified"], ["operating", "Operating when checked"], ["suspended", "Suspended when checked"]]
        .map(([value, label]) => `<option value="${value}" ${recorded?.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label>Last departure in Japan time<input name="last" placeholder="23:45 or 24:15 after midnight" maxlength="5" value="${recorded?.lastDeparture != null ? clock(recorded.lastDeparture) : ""}"></label>
      <label>Verified exit (出口)<input name="exit" maxlength="120" value="${esc(recorded?.exit || "")}"></label>
      <label>Verified walking distance from the exit (metres)<input name="access" type="number" min="0" max="50000" step="1" value="${recorded?.accessMetres ?? ""}"></label>
      <label>Mapped entrance reference (optional)<select name="feature"><option value="">None</option>
      ${recorded?.stationFeature && !hasReference ? `<option selected value="${esc(recorded.stationFeature)}">Previously saved reference</option>` : ""}
      ${choices.map(group => `<optgroup label="${esc(group.name)}">${group.options.map(option =>
        `<option value="${esc(option.key)}" ${recorded?.stationFeature === option.key ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</optgroup>`).join("")}</select></label>
      <label>Earlier train or backup route<textarea name="alternative" maxlength="500">${esc(recorded?.alternative || "")}</textarea></label>
      <label>Source link (optional)<input type="url" name="source" value="${esc(recorded?.sourceUrl || "")}"></label>
      <label>Checked date in Japan<input type="date" name="checked" required value="${nowDate()}"></label>${footer("Save train check")}
      ${recorded ? '<button type="button" id="remove-transit-check">Clear train check</button>' : ""}</form>`, () => {
      const save = async (evidence) => {
        if (await commit(state => {
          const editDay = state.days.find(item => item.id === day.id);
          const target = editDay && schedule(state, editDay).find(item => item.stop.id === id)?.segment;
          if (!target || target.mode !== "train" || target.fromStopId !== row.segment.fromStopId)
            throw new Error("The itinerary leg has changed.");
          if (evidence) target.transitEvidence = { ...evidence, travelDate: editDay.date, endpoints: endpoints(state, target) };
          else delete target.transitEvidence;
        })) close();
      };
      document.getElementById("remove-transit-check")?.addEventListener("click", () => save(null));
      setupForm(async form => {
        const source = val(form, "source");
        if (source && !safeURL(source)) throw new Error("Use an HTTP or HTTPS source link without credentials.");
        const access = val(form, "access");
        await save({ status: val(form, "status"), lastDeparture: departureMinute(val(form, "last")),
          exit: val(form, "exit"), accessMetres: access ? Number(access) : null,
          stationFeature: val(form, "feature") || null, alternative: val(form, "alternative"),
          checkedAt: val(form, "checked"), sourceUrl: source || null });
      });
    });
  }

  function backupSection(day) {
    return `<div class="actions"><button type="button" data-action="backup-train">${day.backupTrain ? "Review backup train" : "Add backup train"}</button>
      ${day.backupTrain ? `<span class="muted">${day.backupTrain.travelDate === day.date ?
        "Backup train recorded · checked " + esc(day.backupTrain.checkedAt) :
        "Previous backup train was for " + esc(day.backupTrain.travelDate) + " · recheck for this day"}</span>` : ""}</div>`;
  }

  function editBackup() {
    const day = getDay();
    if (!day) return;
    const backup = day.backupTrain;
    modal("Backup train for " + day.date, `<form><p>This route note appears on the printable day. Confirm it with the operator before traveling.</p>
      <label>Backup departure, stations and service<textarea name="backup" maxlength="500" required>${esc(backup?.text || "")}</textarea></label>
      <label>Checked date in Japan<input type="date" name="checked" required value="${nowDate()}"></label>
      <label>Source link (optional)<input type="url" name="source" value="${esc(backup?.sourceUrl || "")}"></label>
      ${footer("Save backup train")}${backup ? '<button type="button" id="remove-backup-train">Clear backup train</button>' : ""}</form>`, () => {
      const save = async (evidence) => {
        if (await commit(state => {
          const target = state.days.find(item => item.id === day.id);
          if (!target) throw new Error("This day no longer exists.");
          if (evidence) target.backupTrain = evidence;
          else delete target.backupTrain;
        })) close();
      };
      document.getElementById("remove-backup-train")?.addEventListener("click", () => save(null));
      setupForm(form => {
        const source = val(form, "source"), text = val(form, "backup");
        if (!text) throw new Error("Enter the backup route.");
        if (source && !safeURL(source)) throw new Error("Use an HTTP or HTTPS source link without credentials.");
        return save({ text, travelDate: day.date, checkedAt: val(form, "checked"), sourceUrl: source || null });
      });
    });
  }

  return { legSection, backupSection, actions: { "transit-evidence": editEvidence, "backup-train": editBackup } };
}
