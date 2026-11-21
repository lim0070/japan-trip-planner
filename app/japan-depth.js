import * as M from "./core/model.js";
import { checkedRailSummary, currentRailFare, parseSaunaSets, parseSearchAliases,
  parseYen, railEndpoints, saunaTotals } from "./core/japan-depth.js";

const diningFields = [
  ["cashOnly", "Cash only", "Other payment reported"],
  ["taxFree", "Tax-free", "No tax-free service"],
  ["ticketMachine", "Ticket machine", "No ticket machine"],
];
const ingredients = [
  ["Egg", "卵"], ["Milk", "乳"], ["Wheat", "小麦"], ["Buckwheat", "そば"],
  ["Peanut", "落花生（ピーナッツ）"], ["Shrimp", "えび"], ["Crab", "かに"],
  ["Walnut", "くるみ"], ["Soy", "大豆"], ["Sesame", "ごま"],
];
const allergyJapanese = "食物アレルギーがあります。以下の食材が入っているか、調理中にこれらの食材が混入する可能性があるか、確認していただけますか。";
const allergyEnglish = "I have a food allergy. Could you check whether this dish contains any of these ingredients or may come into contact with them during preparation?";
const tokyoCard = "https://www.hokeniryo1.metro.tokyo.lg.jp/shokuhin/allergy/leaflet.html";
const nationalPassPrices = "https://japanrailpass.net/en/purchase/price/index.html";
const nationalPassCoverage = "https://japanrailpass.net/en/about_jrp/route/";
const eastPassPrices = "https://www.jreast.co.jp/e/press/pdf/0128_pass_en.pdf";
const yen = (value) => "¥" + new Intl.NumberFormat("en-US").format(value);
const japanDate = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
const diningPlace = (place) => place.key.startsWith("tabelog:") ||
  /restaurant|café|cafe|dining|food|飲食|食堂|カフェ/.test(place.category?.toLowerCase() || "");
const saunaPlace = (place) => place.key.startsWith("saunachelin:") ||
  /sauna|サウナ/i.test([place.category, ...Object.values(place.names)].join(" "));

export function createJapanDepth({ getState, getTrip, getDay, commit, modal, close, setupForm, footer,
  esc, val, toast, findPlace, sourceVersion }) {
  const local = (key) => getState().places.find((item) => item.snapshot.key === key);
  const button = (action, label, id = null) =>
    `<button type="button" data-action="${action}"${id === null ? "" : ` data-id="${esc(id)}"`}>${esc(label)}</button>`;
  let allergyCleanupInstalled = false;
  let focusedPass = null;
  function clearAllergyOnClose() {
    if (allergyCleanupInstalled) return;
    const dialog = document.getElementById("dialog");
    dialog.addEventListener("close", () => {
      if (!dialog.open) dialog.querySelector("[data-japan-allergy-private]")?.remove();
    });
    allergyCleanupInstalled = true;
  }
  const sourceField = (source = "") =>
    `<label>Source link (optional)<input name="source" type="url" maxlength="2048" value="${esc(source || "")}"></label>`;
  const dateField = (date) =>
    `<label>Checked on<input name="checkedAt" type="date" required value="${esc(date || japanDate())}"></label>`;
  const yenField = (label, amount) =>
    `<label>${label}<input name="yen" inputmode="numeric" pattern="[0-9]{1,9}" maxlength="9" value="${esc(amount ?? "")}"></label>`;
  const notesField = (note) =>
    `<label>Check notes (optional)<textarea name="note" maxlength="500" rows="2">${esc(note || "")}</textarea></label>`;
  const externalLink = (url, label) => {
    const href = M.safeURL(url);
    return href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "";
  };
  function evidence(form) {
    const checkedAt = val(form, "checkedAt");
    const date = new Date(checkedAt);
    if (!/^\d{4}-\d\d-\d\d$/.test(checkedAt) || Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== checkedAt)
      throw Error("Enter a valid check date.");
    const typedUrl = val(form, "source");
    const sourceUrl = typedUrl ? M.safeURL(typedUrl) : null;
    if (typedUrl && !sourceUrl) throw Error("Enter a valid http or https source link.");
    return { checkedAt, sourceUrl };
  }
  function noteValue(form) {
    const note = val(form, "note");
    if (note.length > 500) throw Error("Check notes can be up to 500 characters.");
    return note;
  }

  async function save(message, mutate) {
    if (await commit(mutate)) {
      close();
      toast(message);
    }
  }

  function placeSection(place, { compact = false } = {}) {
    if (!place) return "";
    const saved = local(place.key);
    const checks = saved?.dining;
    const labels = checks ? diningFields.flatMap(([field, yes, no]) =>
      checks[field] === "yes" ? [yes] : checks[field] === "no" ? [no] : [],
    ) : [];
    const dining = checks || diningPlace(place);
    return `<div class="japan-place-details">
      ${labels.length ? `<p class="muted">${labels.map((label) => `<span class="badge">${esc(label)}</span>`).join(" ")}
        <small>Manual check · ${esc(checks.checkedAt)} ${compact ? "" : externalLink(checks.sourceUrl, "Source")}</small></p>` : ""}
      ${!compact && saved?.searchAliases?.length
        ? `<p class="muted">Alternate names · ${esc(saved.searchAliases.join(" · "))}</p>` : ""}
      ${!compact && checks?.note ? `<p class="muted">${esc(checks.note)}</p>` : ""}
      <div class="actions">
        ${button("japan-search-names", "Search names", place.key)}
        ${dining ? button("japan-dining", "Dining checks", place.key) + button("japan-allergy", "Allergy card") : ""}
      </div></div>`;
  }

  function visitSection(stop, place) {
    if (!stop || !place) return "";
    const showDining = diningPlace(place) || !!local(place.key)?.dining;
    const showSauna = saunaPlace(place) || !!stop.saunaSets?.length;
    const totals = saunaTotals([stop]);
    if (!showDining && !showSauna) return "";
    return `<div class="japan-visit-details">
      ${showDining ? placeSection(place, { compact: true }) : ""}
      ${totals.sets ? `<p class="muted">Saunatime · ${esc(saunaText(totals))}</p>` : ""}
      ${showSauna ? `<div class="actions">${button("japan-sauna", totals.sets ? "Edit sauna session" : "Log completed sauna session", stop.id)}</div>` : ""}
    </div>`;
  }

  function legSection(segment, day) {
    if (!segment || !day || segment.mode !== "train") return "";
    const state = getState();
    const from = state.stops.find((stop) => stop.id === segment.fromStopId);
    const to = state.stops.find((stop) => stop.id === segment.toStopId);
    const fare = currentRailFare(segment, day, railEndpoints(from, to));
    let amount = "Fare unverified";
    if (fare && fare.yen !== null) amount = yen(fare.yen) + " checked " + fare.checkedAt;
    return `<div class="actions"><span class="badge">${esc(amount)}</span>
      ${button("japan-rail-fare", fare ? "Edit fare and coverage" : "Check fare and coverage", segment.toStopId)}</div>`;
  }

  function searchNames(key) {
    const place = findPlace(key);
    if (!place) return;
    const names = local(key)?.searchAliases || [];
    modal("Search names", `<form><p>${esc(M.name(place))}</p>
      <label>Alternate names, one per line<textarea name="names" rows="5" aria-describedby="alternate-search-help">${esc(names.join("\n"))}</textarea></label>
      <p id="alternate-search-help" class="muted">Add up to 12 spellings you know for this place. Kanji, kana and romaji work in Discover and Saved Spots.</p>
      ${footer("Save names")}</form>`, () => setupForm(async (form) => {
      const searchAliases = parseSearchAliases(val(form, "names"));
      await save("Search names saved.", (state) => {
        const saved = M.ensurePlace(state, place, sourceVersion(place));
        if (searchAliases.length) saved.searchAliases = searchAliases;
        else delete saved.searchAliases;
        saved.updatedAt = M.now();
      });
    }));
  }

  function dining(key) {
    const place = findPlace(key);
    if (!place) return;
    const checks = local(key)?.dining;
    modal("Dining checks", `<form><p>${esc(M.name(place))}</p>
      ${diningFields.map(([name, label]) =>
        `<label>${label}<select name="${name}">${[
          ["unknown", "Unknown"], ["yes", "Yes"], ["no", "No"],
        ].map(([value, display]) => `<option value="${value}" ${checks?.[name] === value ? "selected" : ""}>${display}</option>`).join("")}</select></label>`,
      ).join("")}
      ${dateField(checks?.checkedAt)}${sourceField(checks?.sourceUrl)}${notesField(checks?.note)}
      ${footer("Save dining checks")}</form>`, () => setupForm(async (form) => {
      const record = evidence(form);
      record.note = noteValue(form);
      for (const [field] of diningFields) {
        const value = val(form, field);
        if (!["unknown", "yes", "no"].includes(value)) throw Error("Choose a dining check.");
        record[field] = value;
      }
      await save("Dining checks saved.", (state) => {
        const saved = M.ensurePlace(state, place, sourceVersion(place));
        saved.dining = record;
        saved.updatedAt = M.now();
      });
    }));
  }

  function allergyCard() {
    modal("Allergy card", `<form data-japan-allergy-private autocomplete="off"><p>Choose what you want to show restaurant staff. Ask them to check the dish and shared equipment.</p>
      <fieldset><legend>Ingredients</legend><div class="actions">${ingredients.map(([english, japanese], index) =>
        `<label class="check"><input type="checkbox" name="ingredients" value="${index}">${english} · <span lang="ja">${japanese}</span></label>`,
      ).join("")}</div></fieldset>
      <label>Other ingredients (optional)<input name="other" maxlength="160" autocomplete="off" aria-describedby="other-allergy-help"></label>
      <p class="muted" id="other-allergy-help">Use names the staff can read. Other ingredients are shown exactly as typed. This dialog clears the card when you leave it.</p>
      <label class="check"><input type="checkbox" name="confirm" required>I want to display the ingredients I selected and ask staff to check.</label>
      <p>${externalLink(tokyoCard, "Tokyo Metropolitan Government multilingual allergy sheet")}</p>
      ${footer("Show card")}</form>`, () => {
      clearAllergyOnClose();
      setupForm((form) => {
        const selected = form.getAll("ingredients").map((index) => ingredients[Number(index)]).filter(Boolean);
        const other = val(form, "other");
        if (!selected.length && !other) throw Error("Select or enter an ingredient.");
        if (other.length > 160 || form.get("confirm") !== "on") throw Error("Confirm the details you want to display.");
        const japanese = [...selected.map(([, label]) => label), other].filter(Boolean).join("、");
        const english = [...selected.map(([label]) => label), other].filter(Boolean).join(", ");
        modal("Show to restaurant staff", `<div class="allergy-card" data-japan-allergy-private>
          <p lang="ja" style="font-size:1.35rem">${allergyJapanese}</p>
          <p lang="ja" style="font-size:1.7rem"><strong>${esc(japanese)}</strong></p>
          <p>${allergyEnglish}</p><p><strong>${esc(english)}</strong></p>
          <p class="muted">Confirm the answer with staff before ordering. Treat an uncertain answer as unknown.</p>
          <div class="dialog-footer"><button type="button" id="japan-close-allergy">Done</button></div>
        </div>`, () => {
          const done = document.getElementById("japan-close-allergy");
          done.onclick = close;
          done.focus();
        });
      });
    });
  }

  function saunaText(totals) {
    return `${totals.sets} ${totals.sets === 1 ? "set" : "sets"} · ${totals.total} min total (${totals.sauna} sauna, ${totals.cold} cold bath, ${totals.rest} rest)`;
  }

  function logSauna(stopId) {
    const stop = getState().stops.find((item) => item.id === stopId);
    if (!stop) return;
    const existing = stop.saunaSets?.map(({ sauna, cold, rest }) => `${sauna}, ${cold}, ${rest}`).join("\n") || "";
    modal("Saunatime", `<form><p>${esc(M.name(M.visitPlace(stop)))}</p>
      <label>Completed sets<textarea name="sets" rows="5" placeholder="8, 1, 5" aria-describedby="sauna-help">${esc(existing)}</textarea></label>
      <p class="muted" id="sauna-help">One set per line. Enter minutes in this order: sauna, cold bath (水風呂), rest. Use 0 for a skipped phase. Clear the field to remove the log.</p>
      ${footer("Save session")}</form>`, () => setupForm(async (form) => {
      const saunaSets = parseSaunaSets(val(form, "sets"));
      await save(saunaSets.length ? "Sauna session saved." : "Sauna session cleared.", (state) => {
        const current = state.stops.find((item) => item.id === stopId);
        if (!current) throw Error("This visit is no longer in the itinerary.");
        if (saunaSets.length) current.saunaSets = saunaSets;
        else delete current.saunaSets;
      });
    }));
  }

  function getRailLeg(state, dayId, toId) {
    const day = state.days.find((item) => item.id === dayId);
    const index = day?.stopIds.indexOf(toId) ?? -1;
    if (index < 1) return null;
    const fromId = day.stopIds[index - 1];
    const segment = state.segments.find((item) => item.tripId === day.tripId && item.mode === "train" &&
      item.fromStopId === fromId && item.toStopId === toId);
    if (!segment) return null;
    const from = state.stops.find((stop) => stop.id === fromId);
    const to = state.stops.find((stop) => stop.id === toId);
    if (!from || !to) return null;
    return { segment, day, from, to, endpoints: railEndpoints(from, to) };
  }

  function checkFare(toId) {
    const dayId = getDay()?.id;
    const state = getState();
    const leg = getRailLeg(state, dayId, toId);
    if (!leg) return;
    const { segment, day, from, to, endpoints } = leg;
    const fare = currentRailFare(segment, day, endpoints);
    const pass = state.trips.find((item) => item.id === day.tripId)?.checkedPass;
    modal("Checked rail fare", `<form><p>${esc(M.name(M.visitPlace(from)))} → ${esc(M.name(M.visitPlace(to)))} · ${esc(day.date)}</p>
      ${segment.railFare && !fare ? '<p class="notice">The date or route changed. Recheck the fare and coverage for this leg.</p>' : ""}
      ${yenField("Ordinary ticket fare (yen, optional)", fare?.yen)}
      <label>Pass name<input name="passLabel" maxlength="80" value="${esc(fare?.passLabel || pass?.label || "")}"></label>
      <label>Coverage for this leg<select name="coverage">${[
        ["unknown", "Unverified"], ["covered", "Fully covered"], ["uncovered", "Full fare outside coverage"],
      ].map(([value, label]) => `<option value="${value}" ${fare?.coverage === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <p class="muted">Use the same traveller basis as the pass quote. Leave partial coverage and supplements unverified and record the details in the notes.</p>
      ${dateField(fare?.checkedAt)}${sourceField(fare?.sourceUrl)}${notesField(fare?.note)}
      ${footer("Save check")}</form>`, () => setupForm(async (form) => {
      const amount = parseYen(val(form, "yen"));
      const passLabel = val(form, "passLabel");
      const coverage = val(form, "coverage");
      if (passLabel.length > 80 || !["unknown", "covered", "uncovered"].includes(coverage))
        throw Error("Choose a coverage status and use a pass name up to 80 characters.");
      if (coverage !== "unknown" && !passLabel) throw Error("Enter the name of the pass you checked.");
      const record = { ...evidence(form), note: noteValue(form), yen: amount, passLabel, coverage,
        travelDate: day.date, endpoints };
      await save("Rail fare check saved.", (next) => {
        const current = getRailLeg(next, dayId, toId);
        if (!current || current.day.date !== day.date || current.endpoints !== endpoints)
          throw Error("The leg changed. Open the current leg and check again.");
        current.segment.railFare = record;
      });
    }));
  }

  function passForm(tripId) {
    const trip = getState().trips.find((item) => item.id === tripId);
    if (!trip) return;
    const pass = trip.checkedPass;
    focusedPass = tripId;
    modal("Checked rail pass", `<form><p>${esc(trip.name)}</p>
      <label>Pass name<input name="label" maxlength="80" value="${esc(pass?.label || "")}"></label>
      ${yenField("Checked purchase price (yen, optional)", pass?.yen)}
      <p class="muted">Include the exact pass variant and validity in its name. Use that same name on each checked leg. Clear the name and price to remove the quote.</p>
      ${dateField(pass?.checkedAt)}${sourceField(pass?.sourceUrl)}
      ${footer("Save pass")}</form>`, () => setupForm(async (form) => {
      const label = val(form, "label");
      const amount = parseYen(val(form, "yen"));
      if (label.length > 80 || (!label && amount !== null))
        throw Error("Enter a pass name up to 80 characters.");
      const record = label ? { ...evidence(form), label, yen: amount } : null;
      await save(record ? "Rail pass saved." : "Rail pass cleared.", (state) => {
        const current = state.trips.find((item) => item.id === tripId);
        if (!current) throw Error("This trip no longer exists.");
        if (record) current.checkedPass = record;
        else delete current.checkedPass;
      });
    }));
  }

  function passSummary(state, trip, open) {
    const pass = trip.checkedPass;
    const summary = checkedRailSummary(state, trip);
    const { legs, priced, covered, uncovered, ticketSubtotal, allFaresChecked, allCoverageChecked,
      passTotal, difference } = summary;
    const verdict = difference === null
      ? (!legs.length ? "No in-itinerary train legs." :
        !allFaresChecked ? "Unverified fares. Finish checking the legs to compare." :
        !pass ? "Add a checked pass quote to compare." :
        !allCoverageChecked ? "Unverified pass coverage. Check the named pass for each leg." :
        "Unverified pass price. Add the checked price to compare.")
      : difference > 0 ? `This pass costs ${yen(difference)} less for the checked legs.`
        : difference < 0 ? `Individual tickets cost ${yen(-difference)} less for the checked legs.`
          : "The checked totals are equal.";
    return `<details${open ? " open" : ""}><summary>${esc(trip.name)}</summary>
      <p class="muted">${priced} of ${legs.length} ticket fares checked · ${covered} fully covered · ${uncovered.length} outside coverage · ${legs.length - covered - uncovered.length} coverage unverified</p>
      ${priced ? `<p>${allFaresChecked ? "Individual tickets" : "Checked ticket subtotal"} · ${yen(ticketSubtotal)}</p>` : ""}
      ${pass ? `<p>${esc(pass.label)} · ${pass.yen === null ? "Price unverified" : yen(pass.yen)} · checked ${esc(pass.checkedAt)} ${externalLink(pass.sourceUrl, "Source")}</p>` : ""}
      ${passTotal === null ? "" : `<p>Pass and uncovered leg fares · ${yen(passTotal)}</p>`}
      <p>${esc(verdict)}</p>
      ${uncovered.length ? `<p>Outside this pass’s coverage</p><ul>${uncovered.map(({ from, to, date, fare }) =>
        `<li>${esc(M.name(M.visitPlace(from)))} → ${esc(M.name(M.visitPlace(to)))} · ${esc(date)} · ${fare.yen === null ? "Fare unverified" : yen(fare.yen)} ${externalLink(fare.sourceUrl, "Source")}</li>`,
      ).join("")}</ul>` : ""}
      ${button("japan-pass", pass ? "Edit checked pass" : "Add checked pass", trip.id)}
    </details>`;
  }

  function settingsSection() {
    const state = getState();
    const active = getTrip();
    const trips = active ? [active, ...state.trips.filter((trip) => trip.id !== active.id)] : state.trips;
    const openPassId = trips.some((trip) => trip.id === focusedPass) ? focusedPass : trips[0]?.id;
    const logged = state.stops.filter((stop) => stop.saunaSets?.length);
    const logs = new Map(logged.map((stop) => [stop.id, stop]));
    const byYear = new Map();
    for (const day of state.days) {
      for (const stopId of day.stopIds) {
        const entry = logs.get(stopId);
        if (!entry) continue;
        const year = day.date.slice(0, 4);
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year).push(entry);
      }
    }
    return `<section class="card"><h2>Checked rail passes</h2>
      <p class="muted">Compare one pass per trip using the train legs between itinerary visits. Add checked fares and coverage on each leg. The total covers these legs only.</p>
      ${trips.length ? trips.map((trip) => passSummary(state, trip, trip.id === openPassId)).join("") : "<p>Create a trip to compare fares.</p>"}
      <details><summary>Official adult price references</summary>
        <p class="muted">Checked November 2026. Verify your purchase channel, travel dates, eligibility and train before entering a quote.</p>
        <ul>
          <li>JAPAN RAIL PASS Ordinary for 7, 14 or 21 days. Online ¥50,000 / ¥80,000 / ¥100,000. Designated overseas agents ¥53,000 / ¥84,000 / ¥105,000 for purchases from 1 October 2026. ${externalLink(nationalPassPrices, "Official prices")}</li>
          <li>NOZOMI and MIZUHO require a separate ticket with the national pass. ${externalLink(nationalPassCoverage, "Official coverage")}</li>
          <li>JR EAST PASS is ¥35,000 for 5 days or ¥50,000 for 10 days. JR TOKYO Wide Pass is ¥16,000 for 3 days. Prices apply from 14 March 2026. ${externalLink(eastPassPrices, "Official regional prices and coverage")}</li>
        </ul>
      </details>
    </section>${logged.length ? `<section class="card"><h2>Saunatime totals</h2>
      <ul>${trips.flatMap((trip) => {
        const totals = saunaTotals(logged.filter((stop) => stop.tripId === trip.id));
        return totals.sets ? [`<li><strong>${esc(trip.name)}</strong> · ${esc(saunaText(totals))}</li>`] : [];
      }).join("")}</ul>
      <h3>By year</h3><ul>${[...byYear].sort(([a], [b]) => b.localeCompare(a)).map(([year, visits]) =>
        `<li><strong>${esc(year)}</strong> · ${esc(saunaText(saunaTotals(visits)))}</li>`,
      ).join("")}</ul>
    </section>` : ""}
    <section class="card"><h2>Allergy card</h2>${button("japan-allergy", "Prepare allergy card")}</section>`;
  }

  const actions = { "japan-search-names": searchNames, "japan-dining": dining, "japan-allergy": allergyCard,
    "japan-sauna": logSauna, "japan-rail-fare": checkFare, "japan-pass": passForm };
  async function handle(action, id) {
    if (!Object.hasOwn(actions, action)) return false;
    await actions[action](id);
    return true;
  }

  return { handle, placeSection, visitSection, legSection, settingsSection };
}
