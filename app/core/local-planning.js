import * as M from "./model.js";
import { placeMatcher, terms } from "./place-search.js";

const escapeMarkup = value => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function duplicateDayVisits(state, sourceId, destinationId) {
  const source = state.days.find(day => day.id === sourceId);
  const destination = state.days.find(day => day.id === destinationId);
  if (!source || !destination || source.tripId !== destination.tripId || !source.stopIds.length)
    throw Error("Choose a day with visits and an empty date in the same trip.");
  if (source.id === destination.id || destination.stopIds.length)
    throw Error("Choose an empty destination day.");
  const stops = new Map(state.stops.map(stop => [stop.id, stop]));
  for (const id of source.stopIds) {
    const { placeId, placeSnapshot, placeOverrides, durationMinutes, sourceDatasetVersion } = stops.get(id);
    // Copy the place and duration. Keep date-specific visit records with the original.
    const copy = {
      schemaVersion: 1, id: M.id(), tripId: destination.tripId, placeId,
      placeSnapshot: M.clone(placeSnapshot), placeOverrides: M.clone(placeOverrides),
      notes: "", durationMinutes,
    };
    if (sourceDatasetVersion !== undefined) copy.sourceDatasetVersion = sourceDatasetVersion;
    state.stops.push(copy);
    destination.stopIds.push(copy.id);
  }
  destination.startMinute = source.startMinute;
  M.reconcile(state);
  return destination;
}

export function startCityDay(state, dayId, city) {
  const day = state.days.find(item => item.id === dayId);
  const label = String(city || "").trim();
  if (!day || day.stopIds.length) throw Error("Choose an empty day for the starter.");
  if (!label || label.length > 50) throw Error("Enter a city name of 1–50 characters.");
  for (const [slot, durationMinutes] of [["Morning neighbourhood", 90], ["Lunch", 60], ["Afternoon stop", 90]]) {
    const place = M.manualPlace();
    place.names.en = label + " · " + slot;
    const visit = M.addStop(state, day, place);
    visit.durationMinutes = durationMinutes;
    visit.notes = "Starter placeholder. Choose a place and check its hours and access.";
  }
  return day;
}

function latinName(value) {
  const text = terms(value).join("");
  return /^[\p{Script=Latin}\d-]+$/u.test(text) ? [...text.replace(/-/g, "")] : [];
}

// A single typo in a stored complete Latin name can be suggested explicitly.
// Japanese queries continue to use the existing exact/prefix/substring rules.
function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  const first = a.findIndex((char, i) => char !== b[i]);
  if (first === -1) return b.length === a.length + 1;
  if (a.length === b.length) {
    return a.slice(first + 1).join("") === b.slice(first + 1).join("") ||
      (a[first] === b[first + 1] && a[first + 1] === b[first] &&
       a.slice(first + 2).join("") === b.slice(first + 2).join(""));
  }
  return a.length < b.length
    ? a.slice(first).join("") === b.slice(first + 1).join("")
    : a.slice(first + 1).join("") === b.slice(first).join("");
}

export function findTripVisits(state, trip, query, allowSuggestions = false) {
  const match = placeMatcher(query);
  if (!match) return [];
  const needle = allowSuggestions ? latinName(query) : [];
  const days = new Map(state.days.filter(day => day.tripId === trip.id).map(day => [day.id, day]));
  const stops = new Map(state.stops.filter(stop => stop.tripId === trip.id).map(stop => [stop.id, stop]));
  const results = [];
  for (const id of trip.dayIds) {
    const day = days.get(id);
    for (const stopId of day.stopIds) {
      const stop = stops.get(stopId);
      const place = M.visitPlace(stop);
      const rank = match(place);
      const suggested = rank < 0 && needle.length >= 4 && needle.length <= 80 &&
        Object.values(place.names).some(name => {
          const candidate = latinName(name);
          return candidate.length >= 3 && oneEdit(needle, candidate);
        });
      if (rank >= 0 || suggested) results.push({ day, stop, place, suggested, rank });
    }
  }
  return results.sort((a, b) => Number(a.suggested) - Number(b.suggested) || a.rank - b.rank)
    .slice(0, 50);
}

const accommodation = /\b(?:hotel|hostel|inn|lodging|accommodation|resort|guest\s*house|ryokan|lodge)\b|ホテル|ホステル|旅館|宿泊|民宿|民泊/iu;

export function shareLinkRows(state, day) {
  return M.schedule(state, day).flatMap(({ stop, visitStart, departure }) => {
    const place = M.visitPlace(stop);
    const names = Object.values(place.names).filter(Boolean);
    if ([...names, place.category].some(value => accommodation.test(value || ""))) return [];
    const label = (names[0] || "").replace(/\s+/gu, " ").replace(/[\u0000-\u001f\u007f]/gu, "").trim();
    return [{
      stopId: stop.id,
      label: [...label].slice(0, 60).join(""),
      time: visitStart === null ? "Time unknown" :
        M.timeLabel(day.date, visitStart) + "–" + M.timeLabel(day.date, departure),
    }];
  });
}

export function redactedSharedDay(day, rows, names = new Set()) {
  return {
    v: 1,
    date: day.date,
    visits: rows.map(({ stopId, label, time }, index) => ({
      name: names.has(stopId) && label ? label : "Visit " + (index + 1),
      time,
    })),
  };
}

export function parseReceipts(text) {
  if (text.length > 26300) throw Error("Use up to 200 receipts with short labels.");
  const rows = text.split(/\r?\n/u).map(row => row.trim()).filter(Boolean);
  if (rows.length > 200) throw Error("Use up to 200 receipts per trip.");
  return rows.map((row, index) => {
    const match = row.match(/^(\d{1,9})(?:[ \t]+(.{1,120}))?$/u);
    if (!match || (match[2] || "").length > 120)
      throw Error(`Receipt ${index + 1} needs a whole yen amount, followed by an optional label.`);
    return { yen: Number(match[1]), label: match[2] || "" };
  });
}

export function budgetTotals(plan) {
  const receipts = plan.receipts || [];
  const receiptTotal = receipts.length ? receipts.reduce((sum, row) => sum + row.yen, 0) : null;
  const spent = plan.spentYen ?? null;
  const gross = receiptTotal === null && spent === null ? null : (receiptTotal ?? 0) + (spent ?? 0);
  const refund = plan.refundStatus === "received" ? plan.refundYen ?? null : 0;
  const net = gross === null || refund === null ? null : gross - refund;
  const remaining = plan.budgetYen == null || net === null ? null : plan.budgetYen - net;
  const { passPriceYen, coveredTicketsYen, uncoveredFaresYen } = plan.railCosts || {};
  const pass = passPriceYen == null || uncoveredFaresYen == null ? null : passPriceYen + uncoveredFaresYen;
  const tickets = coveredTicketsYen == null || uncoveredFaresYen == null ? null : coveredTicketsYen + uncoveredFaresYen;
  return { receiptTotal, gross, net, remaining, pass, tickets,
    difference: pass === null || tickets === null ? null : tickets - pass };
}

export function readOnlyDayHTML(view) {
  const visits = view.visits.map(({ name, time }) =>
    `<li><strong>${escapeMarkup(name)}</strong><br>${escapeMarkup(time)}</li>`).join("");
  const date = escapeMarkup(view.date);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Japan itinerary · ${date}</title>
<style>body{font:1rem/1.5 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem}li{margin:1rem 0;overflow-wrap:anywhere}@media print{body{margin:0}li{break-inside:avoid}}</style>
</head><body><h1>Japan itinerary</h1><p>${date} · Japan time</p>${visits ? "<ol>" + visits + "</ol>" : "<p>No visits planned.</p>"}</body></html>`;
}

const calendarEscape = text => String(text).replace(/\\/g, "\\\\").replace(/\r\n|[\r\n]/g, "\\n")
  .replace(/[,;]/g, char => "\\" + char);
const calendarStamp = date => date.toISOString().replace(/[-:]|\.\d{3}/g, "");
function foldCalendarLine(line) {
  let bytes = 0;
  let result = "";
  const encoder = new TextEncoder();
  for (const char of line) {
    const width = encoder.encode(char).length;
    if (bytes + width > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += char;
    bytes += width;
  }
  return result;
}

export function calendarDay(state, day, exportedAt = new Date()) {
  const midnight = Date.parse(day.date + "T00:00:00+09:00");
  const rows = M.schedule(state, day);
  const timed = rows.filter(row => row.visitStart !== null && row.departure > row.visitStart);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Japan Trip Planner//Day Export//EN",
    "CALSCALE:GREGORIAN", ...timed.flatMap(row => [
      "BEGIN:VEVENT",
      `UID:${row.stop.id}@japan-trip-planner`,
      `DTSTAMP:${calendarStamp(exportedAt)}`,
      `DTSTART:${calendarStamp(new Date(midnight + row.visitStart * 60000))}`,
      `DTEND:${calendarStamp(new Date(midnight + row.departure * 60000))}`,
      `SUMMARY:${calendarEscape(M.name(M.visitPlace(row.stop)))}`,
      "END:VEVENT",
    ]), "END:VCALENDAR"];
  return { content: lines.map(foldCalendarLine).join("\r\n") + "\r\n", count: timed.length, omitted: rows.length - timed.length };
}

export function favoriteGroups(state, findPlace) {
  const groups = new Map();
  for (const flag of state.flags) {
    if (!flag.favourite) continue;
    const place = findPlace(flag.placeKey);
    const category = !place ? "Awaiting source match" : place.category || "Uncategorized";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ flag, place });
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ja"));
}
