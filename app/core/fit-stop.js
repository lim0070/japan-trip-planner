import * as M from "./model.js";
import { START_ANCHOR, END_ANCHOR } from "./day-plan.js";
import { timetableDay } from "./timetable-plan.js";
import { findDirectionStation } from "./direction-search.js";
import { fold } from "./place-search.js";

const candidateId = "@fit-stop";
const stationName = value => fold(value.split(" · ")[0]).replace(/^(?:jr\s+)/u, "")
  .replace(/\s+station$|駅$/u, "").trim();
const names = place => Object.values(place?.names ?? {}).filter(Boolean);

function sameStation(a, b) {
  const x = stationName(a), y = stationName(b);
  const left = findDirectionStation(x), right = findDirectionStation(y);
  return left && right ? left.id === right.id : x === y;
}

function ongoingTrain(snapshot, after, successor, station, departure) {
  const segment = snapshot.segments.find(item => item.fromStopId === after && item.toStopId === successor);
  const from = snapshot.stops.find(item => item.id === after);
  const to = snapshot.stops.find(item => item.id === successor);
  const check = segment?.routeCheck;
  if (!from || !to || segment.mode !== "train" || !["jorudan","timetable"].includes(check?.provider) ||
      !M.checkedRouteApplies(check, snapshot.day.date, check.departMinute,
        M.routeEndpoints(M.visitDestination(from), M.visitDestination(to)))) return null;
  const firstRide = check.legs?.[0];
  const board = firstRide?.depart ?? check.departMinute + check.access;
  const boardingNames = firstRide ? [firstRide.from] : names(M.visitDestination(from));
  if (board !== departure || !names(station).some(a => boardingNames.some(b => sameStation(a,b)))) return null;
  return { check, board, margin:firstRide?.margin ?? 0,
    arrival:check.departMinute + check.access + check.minutes + check.egress };
}

export function stationApproach(from, to, date, ready, cutoff, route, router, estimates) {
  if (!from || !to) return { arrival: null, latest: null, kind: "gap" };
  const same = M.sameRoutingPlace(from, to);
  const minutes = route.minutes ?? (same ? 0 : route.mode === "walk" && estimates ? M.estimate(from, to, "walk") : null);
  if (minutes !== null) return {
    arrival: ready === null ? null : ready + minutes,
    latest: cutoff - minutes,
    minutes,
    kind: route.minutes !== null ? route.mode === "train" ? "manualTransit" : "manual" : same ? "same" : "estimate",
  };
  if (route.mode !== "train") return { arrival: null, latest: null, kind: "gap" };
  const connection = (when, by) => router(from, to, date, when, by).journey;
  const actual = ready !== null && ready <= 1439 ? connection(ready, 1439) : null;
  const any = connection(0, cutoff);
  if (!any) {
    return { latest: null, arrival: actual?.arrival ?? null, journey: actual || null,
      kind: actual ? "timetable" : "gap" };
  }
  let lo = 0, hi = cutoff;
  while (lo < hi) {
    const middle = Math.ceil((lo + hi) / 2);
    if (connection(middle, cutoff)) lo = middle;
    else hi = middle - 1;
  }
  return { latest: lo, arrival: actual?.arrival ?? null, journey: actual || connection(lo, cutoff), kind: "timetable" };
}

export function fitStop(snapshot, place, options, router, defaultMode) {
  const { day, stops } = snapshot;
  const { after, dwell, departure, margin, station, toShop, afterShop, toStation, beforeStation,
    walkEstimates, reducePreviousBy = 0 } = options;
  if (!Number.isInteger(dwell) || dwell < 0 || dwell > 720 || !Number.isInteger(margin) ||
      margin < 0 || !Number.isInteger(departure) || departure < margin || departure > 1439 ||
      (after !== START_ANCHOR && !day.stopIds.includes(after)) ||
      [toShop, afterShop, toStation, beforeStation].some(({ mode, minutes }) =>
        !["walk", "train"].includes(mode) || (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 720))))
    throw Error("Enter a valid dwell, train time, station margin and insertion point.");
  const index = after === START_ANCHOR ? 0 : day.stopIds.indexOf(after) + 1;
  const successor = day.stopIds[index] ?? END_ANCHOR;
  const train = ongoingTrain(snapshot, after, successor, station, departure);
  const gateMargin = Math.max(margin, train?.margin ?? 0);
  const cutoff = departure - gateMargin;
  const inserted = {
    id: candidateId, tripId: day.tripId, placeSnapshot: place, placeOverrides: {},
    durationMinutes: dwell,
  };
  const settings = {
    startMinute: day.startMinute, finishBy: day.planEndMinute ?? 2879,
    startAnchor: day.planStartAnchor, endAnchor: day.planEndAnchor,
    constraints: Object.fromEntries(stops.map(stop => [stop.id, stop])),
    replaceManual: false, allowEstimates: false, walkEstimates,
  };
  const original = timetableDay(snapshot, settings, router, defaultMode);
  const travelOverrides = new Map([[after + "|" + candidateId, toShop], [candidateId + "|" + successor, afterShop]]);
  const order = [...day.stopIds.slice(0, index), candidateId, ...day.stopIds.slice(index)];
  const previousStop = stops.find(stop => stop.id === after);
  if (!Number.isInteger(reducePreviousBy) || reducePreviousBy < 0 ||
      (reducePreviousBy && (!previousStop || previousStop.planLocked || previousStop.fixedStartMinute !== undefined ||
        day.planVisitStarts?.[after] !== undefined || reducePreviousBy > previousStop.durationMinutes)))
    throw Error("Only a flexible previous visit can give up time, up to its saved duration.");
  const proposedStops = reducePreviousBy ? stops.map(stop => stop.id !== after ? stop :
    { ...stop, durationMinutes: stop.durationMinutes - reducePreviousBy }) : stops;
  const compare = () => timetableDay({ ...snapshot, day: { ...day, stopIds: order }, stops: [...proposedStops, inserted] },
    { ...settings, travelOverrides }, router, defaultMode);
  let proposed = compare();
  let row = proposed.rows[index];
  const previous = original.rows[index - 1];
  const baselinePlace = previous?.to.place ?? day.planStartAnchor?.place;
  const floor = day.planDepartures?.[after]?.departMinute ?? 0;
  const baselineReady = previous ? previous.departure === null ? null : Math.max(previous.departure, floor) : day.startMinute;
  const oldStation = stationApproach(baselinePlace, station, day.date, baselineReady, cutoff, beforeStation, router, walkEstimates);
  const newStation = stationApproach(place, station, day.date, row.departure, cutoff, toStation, router, walkEstimates);
  const slack = row.departure === null || newStation.latest === null ? null : newStation.latest - row.departure;
  const broken = proposed.rows.slice(0, index + 1).some(result => result.conflict);
  const earlierGap = proposed.rows.slice(0, index + 1).some(result => result.arrival === null);
  const unproven = !station || ["gap","manualTransit"].includes(newStation.kind) || earlierGap || slack === null;
  const missed = slack !== null && slack < 0 || newStation.arrival !== null && newStation.arrival > cutoff;
  const verdict = broken || missed ? "missed" : unproven ? "unknown" : slack <= 10 ? "tight" : "fits";
  if (train) {
    travelOverrides.set(candidateId + "|" + successor, {mode:"train",
      protectedRide:{ ...train, missed:verdict==="missed",
        caught:!unproven && !broken && !missed && newStation.arrival!==null && newStation.arrival<=cutoff }});
    proposed = compare();
    row = proposed.rows[index];
  }
  const additional = [oldStation.arrival, baselineReady, row.ready, row.arrival, newStation.arrival, row.departure]
    .every(Number.isInteger) ? (row.arrival - row.ready) + (newStation.arrival - row.departure) -
      (oldStation.arrival - baselineReady) : null;
  return { original, proposed, row, oldStation, newStation, cutoff, margin:gateMargin, slack, verdict,
    earlierGap, additional, hours: M.visitHoursNotice(place, day.date, { stop: inserted, arrival: row.arrival,
      visitStart: row.start, departure: row.departure }) };
}
