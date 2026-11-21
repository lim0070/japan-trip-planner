import {
  budgetTotals, calendarDay, duplicateDayVisits, favoriteGroups, findTripVisits, parseReceipts, readOnlyDayHTML,
  redactedSharedDay, shareLinkRows, startCityDay,
} from "./core/local-planning.js";
import { name, safeURL } from "./core/model.js";
import { encodeSharedDay } from "./core/shared-day.js";
import { encodeQr } from "./vendor/qr-encoder.js";

const budgetLimit = 999999999;
const todayInJapan = date => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" })
  .format(date);
const yen = value => value === null || value === undefined ? "—" : "¥" + value.toLocaleString("ja-JP");
const clock = minute => minute === null || minute === undefined ? "" :
  String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");

const resource = {
  holiday: ["Japan Cabinet Office holidays", "https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html"],
  tax: ["Japan Tourism Agency tax-free shopping", "https://www.mlit.go.jp/kankocho/tax-free/page01_000001_00028.html"],
  taxFAQ: ["Tax-free shopping FAQ", "https://www.mlit.go.jp/kankocho/tax-free/page01_000001_00027.html"],
  passPrices: ["Japan Rail Pass prices", "https://japanrailpass.net/en/purchase/price/index.html"],
  passCoverage: ["Japan Rail Pass coverage", "https://japanrailpass.net/en/about_jrp/route/"],
  weather: ["Japan Meteorological Agency forecast", "https://www.data.jma.go.jp/multi/yoho/index.html?forecast=&lang=en"],
  transit: ["Tokyo Metro and Toei first/last trains", "https://www.tokyometro.jp/lang_en/transit/index.php"],
  jrEast: ["JR East", "https://www.jreast.co.jp/e/"],
  luggageJR: ["JR Central oversized baggage", "https://global.jr-central.co.jp/en/info/oversized-baggage/"],
  luggageDelivery: ["Yamato airport delivery", "https://www.kuronekoyamato.co.jp/ytc/en/send/services/airport/"],
};
const refundLabels = { unknown: "Not checked", pending: "Pending", received: "Received" };

function downloadFile(content, mime, filename) {
  const element = document.createElement("a");
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  element.href = url;
  element.download = filename;
  element.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function showShareQr(container, url) {
  const matrix = encodeQr(url);
  const border = 4;
  const size = matrix.length + 2 * border;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", "320");
  svg.setAttribute("height", "320");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code for the read-only link above");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  const background = document.createElementNS(svgNS, "rect");
  background.setAttribute("width", String(size));
  background.setAttribute("height", String(size));
  background.setAttribute("fill", "white");
  const pixels = document.createElementNS(svgNS, "path");
  const cells = [];
  matrix.forEach((row, y) => row.forEach((on, x) => {
    if (on) cells.push(`M${x + border} ${y + border}h1v1h-1z`);
  }));
  pixels.setAttribute("d", cells.join(""));
  pixels.setAttribute("fill", "black");
  svg.append(background, pixels);
  container.replaceChildren(svg);
}

export function createLocalPlanning({
  getState, getTrip, getDay, openDay, commit, modal, close, setupForm, footer, esc, val, toast,
  findPlace, openSavedSearch,
}) {
  const button = (action, title, id = "") =>
    `<button type="button" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}>${esc(title)}</button>`;
  const external = (label, url) =>
    `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  const links = keys => `<p>${keys.map(key => external(...resource[key])).join(" · ")}</p>`;
  const noteField = (key, label, value = "", limit = 500) =>
    `<label>${label}<textarea name="${key}" maxlength="${limit}" rows="2">${esc(value)}</textarea></label>`;
  const sourceField = (value = "") =>
    `<label>Source URL (optional)<input name="sourceUrl" type="url" maxlength="2048" value="${esc(value)}"></label>`;
  const notes = entries => entries.filter(([, value]) => value).map(([label, value]) =>
    `<p><strong>${label}</strong> · ${esc(value)}</p>`).join("");

  const openForm = (title, content, label, handler) =>
    modal(title, `<form>${content}${footer(label)}</form>`, () => setupForm(handler));
  const saveEntity = async (group, id, field, value) => {
    const saved = await commit(state => {
      const entity = state[group].find(item => item.id === id);
      if (!entity) throw Error("This item is no longer available.");
      entity[field] = value;
    });
    if (saved) close();
    return saved;
  };
  const boundedNote = (f, key, max = 500) => {
    const value = val(f, key);
    if (value.length > max) throw Error(`Use up to ${max} characters per note.`);
    return value;
  };
  const sourceFrom = form => {
    const value = val(form, "sourceUrl");
    if (value && (value.length > 2048 || !safeURL(value))) throw Error("Enter a valid HTTP(S) source link.");
    return value || null;
  };

  function tripButtons(trip) {
    return button("local-trip-plan", "Budget & travel checks", trip.id)
      + button("local-find-visits", "Find visits", trip.id);
  }
  function daySection(day) {
    const d = day.travelNotes;
    return `<details><summary>Travel notes and exports</summary>
      ${d ? notes([
        ["Weather", d.weather], ["Transit", d.transit],
        ["Last train (Japan time)", clock(d.lastTrainMinute) || "Not checked"], ["Private journal", d.journal],
      ]) + `<p class="muted">Notes saved ${esc(d.checkedAt)}${d.sourceUrl ? " · " + external("Source", d.sourceUrl) : ""}</p>` : ""}
      <div class="actions">${button("local-day-notes", "Travel notes & journal", day.id)}
      ${day.stopIds.length ? button("local-duplicate-day", "Duplicate visits", day.id)
        : button("local-city-starter", "Use a city starter", day.id)}
      ${button("local-share-day", "Share a read-only day", day.id)}
      ${button("local-calendar", "Export calendar", day.id)}</div></details>`;
  }
  function visitSection(stop) {
    const d = stop.visitDetails;
    return `${d ? `<details><summary>Local travel details</summary>${notes([
      ["Exit", d.exit], ["Luggage", d.luggage], ["Sauna", d.sauna], ["Reservation", d.reservation],
    ])}<p class="muted">Notes saved ${esc(d.checkedAt)}${d.sourceUrl ? " · " + external("Source", d.sourceUrl) : ""}</p></details>` : ""}
      <div class="actions">${button("local-visit-details", "Visit details", stop.id)}</div>`;
  }
  function spotsButtons() {
    return findPlace && openSavedSearch ? button("local-favorites", "Group favourites") : "";
  }

  function tripPlan(trip) {
    const p = trip.localPlan || {};
    const amountField = (key, label, value) =>
      `<label>${label}<input name="${key}" type="number" inputmode="numeric" min="0" max="${budgetLimit}" step="1" value="${esc(value ?? "")}"></label>`;
    const amount = (f, key) => {
      const raw = val(f, key);
      if (!raw) return null;
      if (!/^\d{1,9}$/.test(raw)) throw Error("Enter a whole yen amount from 0 to 999,999,999.");
      return Number(raw);
    };
    const read = f => {
      const refundStatus = val(f, "refundStatus");
      if (!Object.hasOwn(refundLabels, refundStatus)) throw Error("Choose a refund status.");
      return {
        budgetYen: amount(f, "budgetYen"), spentYen: amount(f, "spentYen"),
        refundYen: amount(f, "refundYen"), refundStatus,
        receipts: parseReceipts(val(f, "receipts")),
        railCosts: {
          passPriceYen: amount(f, "passPriceYen"),
          coveredTicketsYen: amount(f, "coveredTicketsYen"),
          uncoveredFaresYen: amount(f, "uncoveredFaresYen"),
        },
        budgetNote: boundedNote(f, "budgetNote"), tax: boundedNote(f, "tax"),
        pass: boundedNote(f, "pass"), seasonal: boundedNote(f, "seasonal"),
      };
    };
    const receiptText = (p.receipts || []).map(({ yen, label }) => `${yen}${label ? " " + label : ""}`).join("\n");
    const rail = p.railCosts || {};
    modal("Budget & travel checks", `<form aria-label="Budget and travel checks">
      <p><strong>${esc(trip.name)}</strong></p>
      <div class="grid2">${amountField("budgetYen", "Planned (JPY)", p.budgetYen)}
      ${amountField("spentYen", "Spent outside listed receipts (JPY)", p.spentYen)}</div>
      ${noteField("receipts", "Receipts, one per line (JPY amount then optional label)", receiptText, 26300)}
      <p id="local-budget-total" role="status"></p>
      ${noteField("budgetNote", "Budget notes", p.budgetNote)}
      <details open><summary>Tax-free shopping notes</summary>
      <div class="grid2">${amountField("refundYen", "Refund (JPY)", p.refundYen)}
      <label>Refund status<select name="refundStatus">${Object.entries(refundLabels)
        .map(([key, label]) => `<option value="${key}" ${(p.refundStatus || "unknown") === key ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>
      <p class="muted">Only received refunds count toward net spending.</p>
      ${noteField("tax", "Eligibility, retailer and departure checks", p.tax)}${links(["tax", "taxFAQ"])}</details>
      <details><summary>Rail pass comparison</summary>
      ${amountField("passPriceYen", "Pass quote (JPY)", rail.passPriceYen)}
      ${amountField("coveredTicketsYen", "Individual fares for covered legs (JPY)", rail.coveredTicketsYen)}
      ${amountField("uncoveredFaresYen", "Uncovered fares (JPY)", rail.uncoveredFaresYen)}
      <p id="local-rail-total" role="status"></p>
      ${noteField("pass", "Pass price, covered trips and uncovered legs", p.pass)}
      ${links(["passPrices", "passCoverage"])}<p class="muted">Check coverage and any separate fares with each operator. Enter 0 only when there are no uncovered fares.</p></details>
      <details><summary>Seasonal checks</summary>${noteField("seasonal", "Holidays, seasonal access and hours to check", p.seasonal)}
      ${links(["holiday", "weather"])}</details>${footer("Save checks")}</form>`, () => {
      const form = document.querySelector('form[aria-label="Budget and travel checks"]');
      const update = () => {
        const budget = document.getElementById("local-budget-total");
        const comparison = document.getElementById("local-rail-total");
        try {
          const totals = budgetTotals(read(new FormData(form)));
          budget.textContent = `Receipts ${yen(totals.receiptTotal)} · Gross spending ${yen(totals.gross)} · Net spending ${yen(totals.net)} · Remaining ${yen(totals.remaining)}`;
          comparison.textContent = `With pass ${yen(totals.pass)} · Individual tickets ${yen(totals.tickets)}` +
            (totals.difference === null ? " · Comparison unknown until all fares are entered."
              : totals.difference === 0 ? " · Equal cost"
                : ` · ${totals.difference > 0 ? "Pass" : "Individual tickets"} costs ${yen(Math.abs(totals.difference))} less.`);
        } catch (error) {
          budget.textContent = error.message;
          comparison.textContent = "Comparison unavailable until amounts are valid.";
        }
      };
      form.oninput = update;
      form.onchange = update;
      update();
      setupForm(f => saveEntity("trips", trip.id, "localPlan", read(f)));
    });
  }

  function dayNotes(day) {
    const d = day.travelNotes || {};
    openForm("Travel notes & journal", `<p>${esc(day.date)} · Japan time</p>
      ${noteField("weather", "Weather check and backup plan", d.weather)}
      ${noteField("transit", "Transit line, direction and changes to check", d.transit)}
      <label>Last train (optional, Japan time)<input type="time" name="lastTrain" value="${clock(d.lastTrainMinute)}"></label>
      ${sourceField(d.sourceUrl)}${links(["weather", "transit", "jrEast"])}
      <p class="muted">Leave the time empty until checked. Confirm the service date, direction and boarding station with the relevant operator. Record after-midnight departures with their date in transit notes.</p>
      ${noteField("journal", "Private day journal", d.journal, 5000)}`, "Save day notes", async f => {
      const time = val(f, "lastTrain");
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error("Enter a valid time from 00:00 to 23:59.");
      const [hour, minute] = time.split(":").map(Number);
      await saveEntity("days", day.id, "travelNotes", {
        weather: boundedNote(f, "weather"), transit: boundedNote(f, "transit"),
        lastTrainMinute: time ? 60 * hour + minute : null, sourceUrl: sourceFrom(f),
        journal: boundedNote(f, "journal", 5000), checkedAt: todayInJapan(new Date()),
      });
    });
  }

  function visitDetails(stop) {
    const d = stop.visitDetails || {};
    openForm("Visit details", `<p><strong>${esc(name({ ...stop.placeSnapshot, ...stop.placeOverrides }))}</strong></p>
      ${noteField("exit", "Station exit, gate or access notes", d.exit)}
      ${noteField("luggage", "Luggage, lockers or delivery desk", d.luggage)}
      ${noteField("sauna", "Sauna facilities or visit notes", d.sauna)}
      ${noteField("reservation", "Reservation reference or booking notes", d.reservation)}
      ${sourceField(d.sourceUrl)}${links(["luggageJR", "luggageDelivery"])}
      <p class="muted">Check the luggage operator, counter and opening hours before relying on a note.</p>`, "Save visit details", async f => {
      await saveEntity("stops", stop.id, "visitDetails", {
        exit: boundedNote(f, "exit"), luggage: boundedNote(f, "luggage"),
        sauna: boundedNote(f, "sauna"), reservation: boundedNote(f, "reservation"),
        sourceUrl: sourceFrom(f), checkedAt: todayInJapan(new Date()),
      });
    });
  }

  function duplicate(day) {
    const choices = getState().days.filter(d => d.tripId === day.tripId && d.id !== day.id && !d.stopIds.length);
    if (!day.stopIds.length || !choices.length) {
      modal("Duplicate visits", "<p>Choose a day with visits and add an empty day in the same trip for the copy.</p>");
      return;
    }
    openForm("Duplicate visits", `<p>Copy places, durations and the day start from ${esc(day.date)}.
      The original keeps its bookings, personal notes and visit checks.</p><label>Empty destination day
      <select name="destination" required>${choices.map(d => `<option value="${esc(d.id)}">${esc(d.date)}</option>`).join("")}</select></label>`,
      "Copy visits", async f => {
        const id = val(f, "destination");
        if (await commit(state => duplicateDayVisits(state, day.id, id))) {
          close();
          openDay(id);
        }
      });
  }

  function cityStarter(day) {
    openForm("City starter", `<p>Add editable morning, lunch and afternoon placeholders to the empty day on ${esc(day.date)}.</p>
      <label>City<input name="city" maxlength="50" required placeholder="Kyoto"></label>`, "Add starter", async f => {
      if (await commit(state => startCityDay(state, day.id, val(f, "city")))) close();
    });
  }

  function searchVisits(trip) {
    openForm("Find visits", `<p>${esc(trip.name)}</p>
      <label>Name, stored romaji or address<input name="query" type="search" maxlength="100" required></label>
      <label class="check"><input name="typos" type="checkbox">Suggest close matches for Latin names</label>
      <div id="local-visit-results" aria-live="polite"></div>`, "Search", f => {
      const rows = findTripVisits(getState(), trip, val(f, "query"), f.has("typos"));
      const box = document.getElementById("local-visit-results");
      box.innerHTML = rows.length ? `<ol>${rows.map(({ stop, day, place, suggested }) =>
        `<li><button type="button" data-local-stop="${esc(stop.id)}" data-local-day="${esc(day.id)}">${esc(name(place))} · ${esc(day.date)}</button>${suggested ? " · Possible typo match" : ""}</li>`).join("")}</ol>` :
        "<p>No scheduled visits match.</p>";
      box.querySelectorAll("[data-local-stop]").forEach(control => {
        control.onclick = () => {
          close();
          openDay(control.dataset.localDay, control.dataset.localStop);
        };
      });
    });
  }

  function share(day) {
    const rows = shareLinkRows(getState(), day);
    const choices = rows.map(({ label }, i) =>
      `<label class="check"><input type="checkbox" name="local-share-name" value="${i}"${label ? "" : " disabled"}>Include name for visit ${i + 1}${label ? " · " + esc(label) : ""}</label>`).join("");
    modal("Share a read-only day", `<form aria-label="Share a read-only day">
      <p>${esc(day.date)} · Japan time</p>
      <p>Anyone with the file or link can read what you include. The preview shows what goes with it.</p>
      <p>Recognized accommodation entries are skipped. Visit names start hidden. Review any name you include.</p>
      ${choices ? "<details><summary>Choose visit names to include</summary>" + choices + "</details>" : ""}
      <div id="local-share-preview"></div>
      <div class="actions"><button type="button" id="local-prepare-link">Prepare read-only link</button></div>
      <p id="local-share-status" role="status" aria-live="polite"></p>
      <div id="local-share-link-box" hidden>
        <label>Read-only link<input id="local-share-link" type="url" readonly></label>
        <button type="button" id="local-copy-link">Copy link</button>
        <a class="button" id="local-open-link" target="_blank" rel="noopener noreferrer">Open on this device</a>
        <button type="button" id="local-show-qr" hidden>Show QR code</button>
        <div id="local-share-qr"></div>
        <p><a href="./vendor/QR-LICENSE.txt" target="_blank" rel="noopener noreferrer">QR licence</a></p>
      </div>${footer("Download read-only day")}</form>`, () => {
      const form = document.querySelector('form[aria-label="Share a read-only day"]');
      const status = document.getElementById("local-share-status");
      const box = document.getElementById("local-share-link-box");
      const linkField = document.getElementById("local-share-link");
      const openLink = document.getElementById("local-open-link");
      const qr = document.getElementById("local-share-qr");
      const qrButton = document.getElementById("local-show-qr");
      const preview = () => {
        const names = new Set(new FormData(form).getAll("local-share-name").map(index => rows[Number(index)]?.stopId));
        return redactedSharedDay(day, rows, names);
      };
      const renderPreview = () => {
        box.hidden = true;
        linkField.value = "";
        openLink.removeAttribute("href");
        qr.replaceChildren();
        qrButton.hidden = true;
        status.textContent = "";
        const visits = preview().visits;
        document.getElementById("local-share-preview").innerHTML = visits.length
          ? `<h3>Preview</h3><ol>${visits.map(({ name, time }) => `<li>${esc(name)} · ${esc(time)}</li>`).join("")}</ol>`
          : "<p>No visits are included.</p>";
      };
      form.onchange = renderPreview;
      document.getElementById("local-prepare-link").onclick = () => {
        try {
          const fragment = encodeSharedDay(preview());
          const shareURL = new URL("../shared-day.html", import.meta.url);
          const deviceURL = new URL("./shared-day.html", import.meta.url);
          shareURL.hash = deviceURL.hash = fragment;
          linkField.value = shareURL.href;
          openLink.href = deviceURL.href;
          box.hidden = false;
          qrButton.hidden = shareURL.href.length > 400;
          status.textContent = qrButton.hidden
            ? "Link ready. Use the link or file for a day this long."
            : "Link ready. Share it only with your intended readers.";
        } catch (error) {
          box.hidden = true;
          status.textContent = error.message;
        }
      };
      qrButton.onclick = () => {
        showShareQr(qr, linkField.value);
        status.textContent = "Scan the code to open the same read-only link.";
      };
      document.getElementById("local-copy-link").onclick = async () => {
        try {
          await navigator.clipboard.writeText(linkField.value);
          status.textContent = "Link copied.";
        } catch {
          linkField.select();
          status.textContent = "Link selected. Copy it from the field.";
        }
      };
      renderPreview();
      setupForm(() => {
        downloadFile(readOnlyDayHTML(preview()), "text/html;charset=utf-8", `japan-day-${day.date}.html`);
        close();
      });
    });
  }

  function calendar(day) {
    const ics = calendarDay(getState(), day);
    if (!ics.count) {
      modal("Export calendar", "<p>Add a visit with a known time and a positive duration before exporting.</p>");
      return;
    }
    openForm("Export calendar", `<p>${ics.count} timed visits on ${esc(day.date)}.
      ${ics.omitted ? `${ics.omitted} visits with unknown timing or zero duration are omitted.` : ""}
      This file contains visit names and times from the itinerary.</p>`, "Download calendar (.ics)", () => {
      downloadFile(ics.content, "text/calendar;charset=utf-8", `japan-day-${day.date}.ics`);
      close();
    });
  }

  function favorites() {
    const groups = favoriteGroups(getState(), findPlace);
    modal("Favourites by category", groups.length ? groups.map(([category, items]) => `<details>
      <summary>${esc(category)} · ${items.length}</summary><ul>${items.map(({ place, flag }) => place ?
        `<li><button type="button" data-local-favourite="${esc(name(place))}">${esc(name(place))}</button></li>`
        : `<li>${esc(flag.placeKey)}</li>`).join("")}</ul></details>`).join("") : "<p>No favourites saved yet.</p>", () => {
      document.querySelectorAll("[data-local-favourite]").forEach(control => {
        control.onclick = () => {
          close();
          openSavedSearch(control.dataset.localFavourite);
        };
      });
    });
  }

  function handle(action, id) {
    if (!action.startsWith("local-")) return false;
    if (action === "local-favorites" && findPlace && openSavedSearch) {
      favorites();
      return true;
    }
    const state = getState();
    const trip = state.trips.find(item => item.id === id) || getTrip();
    const day = state.days.find(item => item.id === id) || getDay();
    switch (action) {
      case "local-trip-plan": if (trip) tripPlan(trip); break;
      case "local-find-visits": if (trip) searchVisits(trip); break;
      case "local-day-notes": if (day) dayNotes(day); break;
      case "local-duplicate-day": if (day) duplicate(day); break;
      case "local-city-starter": if (day) cityStarter(day); break;
      case "local-share-day": if (day) share(day); break;
      case "local-calendar": if (day) calendar(day); break;
      case "local-visit-details": {
        const stop = state.stops.find(item => item.id === id);
        if (stop) visitDetails(stop);
        else toast("This visit is no longer available.");
        break;
      }
      default: return false;
    }
    return true;
  }

  return { handle, tripButtons, daySection, visitSection, spotsButtons };
}
