import { routeEndpoints, visitDestination } from "./model.js";
import { fold } from "./place-search.js";

export const yenLimit = 999999999;

export function parseYen(value) {
  if (!value) return null;
  if (!/^\d{1,9}$/.test(value))
    throw Error("Enter a whole yen amount between 0 and 999,999,999.");
  return Number(value);
}

export function parseSearchAliases(value) {
  const names = value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  if (names.length > 12 || names.some((name) => name.length > 80))
    throw Error("Enter up to 12 alternate names, each at most 80 characters.");
  return [...new Map(names.map((name) => [fold(name), name])).values()];
}

export function parseSaunaSets(value) {
  const rows = value.trim() ? value.trim().split(/\r?\n/).filter((line) => line.trim()) : [];
  if (rows.length > 32) throw Error("Enter up to 32 sets.");
  return rows.map((row, index) => {
    if (!/^\s*\d{1,4}\s*,\s*\d{1,4}\s*,\s*\d{1,4}\s*$/.test(row))
      throw Error("Set " + (index + 1) + " needs three whole minutes separated by commas, such as 8, 1, 5.");
    const [sauna, cold, rest] = row.split(",").map(Number);
    if (sauna > 1440 || cold > 1440 || rest > 1440 || !(sauna || cold || rest))
      throw Error("Set " + (index + 1) + " needs at least one positive phase. Each phase can be up to 1,440 minutes.");
    return { sauna, cold, rest };
  });
}

export function saunaTotals(visits) {
  const totals = { visits: 0, sets: 0, sauna: 0, cold: 0, rest: 0, total: 0 };
  for (const visit of visits) {
    if (!visit.saunaSets?.length) continue;
    totals.visits++;
    for (const { sauna, cold, rest } of visit.saunaSets) {
      totals.sets++;
      totals.sauna += sauna;
      totals.cold += cold;
      totals.rest += rest;
    }
  }
  totals.total = totals.sauna + totals.cold + totals.rest;
  return totals;
}

export function railEndpoints(from, to) {
  return from && to ? routeEndpoints(visitDestination(from), visitDestination(to)) : null;
}

export function currentRailFare(segment, day, endpoints) {
  const fare = segment.railFare;
  return segment.mode === "train" && fare && endpoints !== null &&
    fare.travelDate === day.date && fare.endpoints === endpoints ? fare : null;
}

const passKey = (label) => label?.normalize("NFKC").trim().toLowerCase() || "";
const wholeYen = (value) => Number.isInteger(value) && value >= 0 && value <= yenLimit;

export function checkedRailSummary(state, trip) {
  const stops = new Map(state.stops.map((stop) => [stop.id, stop]));
  const railToStop = new Map(state.segments
    .filter((segment) => segment.tripId === trip.id && segment.mode === "train")
    .map((segment) => [segment.toStopId, segment]));
  const days = new Map(state.days.filter((day) => day.tripId === trip.id).map((day) => [day.id, day]));
  const pass = trip.checkedPass;
  const legs = [];
  for (const dayId of trip.dayIds) {
    const day = days.get(dayId);
    if (!day) continue;
    for (let index = 1; index < day.stopIds.length; index++) {
      const segment = railToStop.get(day.stopIds[index]);
      if (!segment || segment.fromStopId !== day.stopIds[index - 1]) continue;
      const from = stops.get(segment.fromStopId);
      const to = stops.get(segment.toStopId);
      if (!from || !to) continue;
      const fare = currentRailFare(segment, day, railEndpoints(from, to));
      const coverage = pass && passKey(fare?.passLabel) === passKey(pass.label)
        ? fare?.coverage || "unknown" : "unknown";
      legs.push({ from, to, date: day.date, fare, coverage });
    }
  }
  const priced = legs.filter(({ fare }) => wholeYen(fare?.yen));
  const covered = legs.filter(({ coverage }) => coverage === "covered");
  const uncovered = legs.filter(({ coverage }) => coverage === "uncovered");
  const ticketSubtotal = priced.reduce((sum, { fare }) => sum + fare.yen, 0);
  const allFaresChecked = !!legs.length && priced.length === legs.length;
  const allCoverageChecked = !!legs.length && covered.length + uncovered.length === legs.length;
  const passTotal = allFaresChecked && allCoverageChecked && wholeYen(pass?.yen)
    ? uncovered.reduce((sum, { fare }) => sum + fare.yen, pass.yen) : null;
  return { legs, priced: priced.length, covered: covered.length, uncovered, ticketSubtotal,
    allFaresChecked, allCoverageChecked, passTotal,
    difference: passTotal === null ? null : ticketSubtotal - passTotal };
}
