import * as M from "./model.js";
import { START_ANCHOR, END_ANCHOR } from "./day-plan.js";
import { timetableCheck, travelVisit } from "./timetable.js";
import { tramLine } from "./hakodate-tram.js";

function enteredRoute(segment, anchor, matchId, from, to, date, ready) {
  const endpoints = M.routeEndpoints(from.place, to.place);
  const check = segment?.routeCheck ?? (anchor?.stopId === matchId ? anchor?.routeCheck : null);
  if (check && M.checkedRouteApplies(check, date, ready, endpoints)) {
    return { kind: check.provider, check, arrival: check.departMinute + check.minutes + check.access + check.egress };
  }
  if (segment && !segment.routeCheck && segment.manualMinutes !== null &&
      segment.coordinateFingerprint === segment.overrideFingerprint)
    return { kind: "manual", arrival: ready + segment.manualMinutes };
  return null;
}

function notBefore(minute, entered) {
  return entered === undefined ? minute : Math.max(minute ?? 0, entered);
}

// Compare official services against existing itinerary anchors in their original order.
// Unknown travel remains unknown. The next explicit time can resume planning.
export function timetableDay(snapshot, settings, router, defaultMode) {
  const { day, stops, segments } = snapshot;
  const stopsById = new Map(stops.map(stop => [stop.id, stop]));
  const segmentsByPair = new Map(segments.map(segment => [segment.fromStopId + "|" + segment.toStopId, segment]));
  const rows = [];
  let from = settings.startAnchor && { id: START_ANCHOR, place: settings.startAnchor.place };
  let earliest = settings.startMinute, atStopSince = null, incoming = null;
  let limit = settings.finishBy;
  const positions = [...day.stopIds, ...(settings.endAnchor ? [END_ANCHOR] : [])];
  for (const id of positions) {
    const isEnd = id === END_ANCHOR;
    const stop = stopsById.get(id);
    const to = { id, place: isEnd ? settings.endAnchor.place : M.visitDestination(stop) };
    const checkpoint = day.planDepartures?.[from?.id];
    if (checkpoint) {
      earliest = notBefore(earliest, checkpoint.departMinute);
      limit = Math.min(settings.finishBy, checkpoint.finishBy);
    }
    const booking = settings.constraints[id]?.fixedStartMinute ?? day.planVisitStarts?.[id];
    const segment = segmentsByPair.get(from?.id + "|" + id);
    const anchor = isEnd ? settings.endAnchor : from?.id === START_ANCHOR ? settings.startAnchor : null;
    const mode = segment?.mode ?? anchor?.mode ?? defaultMode;
    const accessLimit = Math.min(limit - (stop?.durationMinutes ?? 0), booking ?? Infinity);
    const ready = earliest;
    const entered = from && ready !== null && enteredRoute(segment, anchor, isEnd ? from.id === START_ANCHOR ? undefined : from.id : id, from, to, day.date, ready);
    const onboard = from && (travelVisit(from.place) || travelVisit(to.place));
    // A recorded ride is already part of the day. Never add another
    // station-to-station journey on either side of it automatically.
    const evidence = from && !onboard && mode !== "walk"
      ? router(from.place, to.place, day.date, ready, accessLimit, { atStopSince, incoming, busOnly: mode === "drive" })
      : null;
    const useTransit = Boolean(evidence && evidence.reason !== "mode");
    const alternatives = [];
    if (evidence?.reason === "no-service" && ready !== null) {
      const options = { atStopSince, incoming, busOnly: mode === "drive" };
      const next = router(from.place, to.place, day.date, ready, 1439, options).journey;
      if (next && next.arrival > accessLimit) alternatives.push({ journey: next, reason: "late" });
      const seekBefore = Math.max(0, ready - 25);
      const earlier = router(from.place, to.place, day.date, seekBefore, accessLimit,
        { busOnly: mode === "drive" }).journey;
      if (earlier && seekBefore < ready) {
        const latest = earlier.legs[0].depart - earlier.access - earlier.legs[0].margin;
        if (latest < ready || incoming) alternatives.push({ journey: earlier, reason: "earlier", latest });
      }
    }
    const match = evidence?.journey;
    const laterTrams = [];
    if (match?.legs[0].line === tramLine && evidence?.tramSchedule) {
      let boardAfter = match.legs[0].depart + 1;
      for (let i = 0; i < 2; i++) {
        const { journey } = router(from.place, to.place, day.date, ready, accessLimit,
          { atStopSince, incoming, boardAfter });
        if (!journey || journey.legs[0].line !== tramLine) break;
        laterTrams.push(journey);
        boardAfter = journey.legs[0].depart + 1;
      }
    }
    const rough = from && ready !== null && settings.allowEstimates
      ? M.estimate(from.place, to.place, mode) : null;
    const same = anchor && M.sameRoutingPlace(from.place, to.place);
    const mayReplace = !entered || (settings.replaceManual && entered.kind === "manual");
    const checked = match && mayReplace ? timetableCheck(match, M.routeEndpoints(from.place, to.place)) : null;

    const arrival = !from ? ready : ready === null ? null : checked ? match.arrival :
      entered ? entered.arrival : same ? ready : rough === null ? null : ready + rough;
    const usesRough = Boolean(from && !checked && !entered && !same && rough !== null);
    const effective = stop && { ...stop, fixedStartMinute: booking };
    const fitted = arrival === null ? booking ?? null : isEnd ? arrival :
      M.planningStart(effective, M.visitPlace(stop), day.date, arrival, limit);
    const conflict = arrival !== null && (fitted === null || fitted > limit);
    const start = fitted ?? arrival;
    const departure = start === null ? null : start + (stop?.durationMinutes ?? 0);
    // Propagate a late arrival rather than pretending the next checkpoint can move it earlier.
    earliest = departure;
    atStopSince = conflict ? null : start;
    const inboundCheck = checked ?? entered?.check;
    const lastRide = inboundCheck?.legs?.at(-1);
    incoming = !conflict && lastRide && !inboundCheck.egress
      ? { to: lastRide.to, line: lastRide.line, at: lastRide.arrive,
          platform: checked ? match?.platform : undefined } : null;
    rows.push({
      from, to, stop, mode, ready, arrival, start, departure, booking, limit,
      checked: conflict ? null : checked, entered, evidence, alternatives, laterTrams, onboard, useTransit, usesRough,
      conflict, knownInTimeline: !usesRough && arrival !== null,
    });
    from = to;
  }
  return {
    constraints: settings.constraints, initialFinishBy: settings.initialFinishBy,
    rows, updates: rows.filter(row => row.checked),
    date: day.date, startMinute: settings.startMinute, finishBy: settings.finishBy,
    startAnchor: settings.startAnchor, endAnchor: settings.endAnchor, allowEstimates: settings.allowEstimates,
  };
}

export function applyTimetableDay(state, day, plan) {
  day.startMinute = plan.startMinute;
  if (day.planEndMinute !== undefined || plan.finishBy !== plan.initialFinishBy)
    day.planEndMinute = plan.finishBy;
  for (const stop of state.stops.filter(stop => day.stopIds.includes(stop.id))) {
    const proposed = plan.constraints[stop.id];
    if (!proposed) continue;
    if (proposed.planLocked) stop.planLocked = true;
    else if (stop.planLocked) delete stop.planLocked;
    if (proposed.fixedStartMinute !== undefined) stop.fixedStartMinute = proposed.fixedStartMinute;
    else if (stop.fixedStartMinute !== undefined) delete stop.fixedStartMinute;
  }
  const startRow = plan.rows.find(row => row.from?.id === START_ANCHOR && row.to.id !== END_ANCHOR);
  const endRow = plan.rows.find(row => row.to.id === END_ANCHOR);
  for (const [field, anchor, row, stopId] of [
    ["planStartAnchor", plan.startAnchor, startRow, startRow?.to.id],
    ["planEndAnchor", plan.endAnchor, endRow, endRow?.from?.id === START_ANCHOR ? undefined : endRow?.from?.id],
  ]) {
    if (anchor) {
      day[field] = { ...anchor, mode: row?.checked ? "train" : row?.mode ?? anchor.mode ?? state.settings.defaultMode, allowEstimates: plan.allowEstimates };
      if (row?.checked) {
        day[field].routeCheck = row.checked;
        if (stopId !== undefined) day[field].stopId = stopId;
        else delete day[field].stopId;
      }
    } else delete day[field];
  }
  for (const row of plan.updates) {
    if (row.from.id === START_ANCHOR || row.to.id === END_ANCHOR) continue;
    const segment = state.segments.find(item => item.fromStopId === row.from.id && item.toStopId === row.to.id);
    segment.mode = "train";
    segment.routeCheck = row.checked;
    segment.estimatedMinutes = M.estimate(row.from.place, row.to.place, "train");
    segment.manualMinutes = row.checked.minutes + row.checked.access + row.checked.egress;
    segment.overrideFingerprint = segment.coordinateFingerprint;
  }
  const scheduled = M.schedule(state, day);
  const savedById = new Map(scheduled.map(row => [row.stop.id, row]));
  if (plan.updates.some(row => {
    if (row.to.id === END_ANCHOR)
      return M.dayTravel(day, scheduled).inbound?.stale !== false;
    const saved = savedById.get(row.to.id);
    return !saved || saved.missed || saved.outbound?.stale || saved.timingConflict;
  })) throw Error("A timetable update would miss a saved departure or booking. Review the preceding travel before applying.");
}
