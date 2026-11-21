import { canonical } from "./contracts.js";
import {
  createRouteProvider, daySnapshot, END_ANCHOR, MAX_PLAN_STOPS, restoreDay,
  START_ANCHOR, suggestDay,
} from "./day-plan.js";
import * as M from "./model.js";

const validClock = value => Number.isInteger(value) && value >= 0 && value < 1440;

function getTrip(state, day) {
  return state.trips.find(trip => trip.id === day.tripId);
}

export function completedPrefixLength(day) {
  let count = day.stopIds.slice(0, -1)
    .findLastIndex(id => Object.hasOwn(day.planDepartures ?? {}, id)) + 1;
  const finished = new Set(day.finishedStopIds);
  while (finished.has(day.stopIds[count])) count++;
  return count;
}

export function remainingDaySnapshot(state, day, skippedId = null) {
  return {
    ...daySnapshot(state, day),
    unassignedStopIds: [...getTrip(state, day).unassignedStopIds],
    skipped: skippedId && M.clone(state.stops.find(stop => stop.id === skippedId)),
    defaultMode: state.settings.defaultMode,
  };
}

// Removing a stop before a lock would change the locked visit's position.
export function skippableRemainingStops(state, day, completed) {
  const byId = new Map(state.stops.map(stop => [stop.id, stop]));
  const remaining = day.stopIds.slice(completed).map(id => byId.get(id));
  return remaining.length <= 1 ? [] : remaining
    .slice(remaining.findLastIndex(stop => stop.planLocked) + 1)
    .filter(stop => stop.fixedStartMinute === undefined);
}

export function suggestRemainingDay(state, day, {
  completed, departMinute, finishBy, skipId = null, allowEstimates,
  keepPositions = [], keepStarts = [], keepNotices = [],
}) {
  if (!Number.isInteger(completed) || completed < completedPrefixLength(day) || completed >= day.stopIds.length)
    throw Error("Keep the completed visits and leave at least one to plan.");
  const prefix = day.stopIds.slice(0, completed);
  if (day.finishedStopIds?.some(id => !prefix.includes(id)))
    throw Error("Keep all finished visits first. Reorder the existing itinerary before re-planning.");
  if (!validClock(departMinute) || !validClock(finishBy) || finishBy < departMinute)
    throw Error("Choose a departure and finish on this date, in Japan time.");
  const current = M.schedule(state, day);
  const previousDeparture = current[completed - 1]?.departure;
  if (previousDeparture != null && departMinute < previousDeparture)
    throw Error("Departure must be at or after the last completed visit ends.");
  if (skipId && !skippableRemainingStops(state, day, completed).some(stop => stop.id === skipId))
    throw Error("Choose a remaining visit that can be set aside without moving a locked stop or booking.");

  const original = remainingDaySnapshot(state, day, skipId);
  const remaining = day.stopIds.slice(completed).filter(id => id !== skipId);
  if (remaining.length > MAX_PLAN_STOPS)
    throw Error(`Re-planning supports up to ${MAX_PLAN_STOPS} remaining visits. Choose a smaller group.`);
  const constraints = Object.fromEntries(remaining.map(id => [id, {}]));
  const retainedStarts = {};
  for (const id of [...keepPositions, ...keepStarts, ...keepNotices]) {
    if (!remaining.includes(id)) throw Error("Only changes to remaining visits can be dismissed.");
  }
  for (const id of keepPositions) constraints[id].position = day.stopIds.indexOf(id) - completed;
  for (const id of keepStarts) {
    const row = current.find(({ stop }) => stop.id === id);
    if (!validClock(row.visitStart) ||
        (row.stop.fixedStartMinute !== undefined && row.stop.fixedStartMinute !== row.visitStart))
      throw Error("This visit needs a usable original start time.");
    constraints[id].fixedStartMinute = row.visitStart;
    if (row.stop.fixedStartMinute === undefined) retainedStarts[id] = row.visitStart;
  }
  for (const id of keepNotices) {
    const row = current.find(({ stop }) => stop.id === id);
    constraints[id].hoursNotice = M.visitHoursNotice(M.visitPlace(row.stop), day.date, row);
  }
  const snapshot = { ...original, day: { ...original.day, stopIds: remaining } };
  const places = new Map(snapshot.stops.map(stop => [stop.id, M.visitDestination(stop)]));
  const resumeId = prefix.at(-1);
  const fromAnchor = resumeId ? { place: places.get(resumeId) } : day.planStartAnchor ?? null;
  const toAnchor = day.planEndAnchor ?? null;
  const checks = [];
  if (!resumeId && fromAnchor?.routeCheck)
    checks.push({ ...fromAnchor.routeCheck, from: START_ANCHOR, to: fromAnchor.stopId, mode: fromAnchor.mode });
  if (toAnchor?.routeCheck)
    checks.push({ ...toAnchor.routeCheck, from: toAnchor.stopId, to: END_ANCHOR, mode: toAnchor.mode });
  const normalRoutes = createRouteProvider(snapshot, checks, original.defaultMode, allowEstimates);
  const startRoutes = fromAnchor?.mode
    ? createRouteProvider(snapshot, checks, fromAnchor.mode, allowEstimates) : normalRoutes;
  const endRoutes = toAnchor?.mode
    ? createRouteProvider(snapshot, checks, toAnchor.mode, allowEstimates) : normalRoutes;
  const getRoutes = ({ from, to, ...timing }) => {
    const fromId = from.id === START_ANCHOR && resumeId ? resumeId : from.id;
    const routes = fromId === START_ANCHOR ? startRoutes : to.id === END_ANCHOR ? endRoutes : normalRoutes;
    return routes({
      ...timing,
      from: { id: fromId, place: places.get(fromId) ?? from.place },
      to: { id: to.id, place: places.get(to.id) ?? to.place },
    });
  };
  const plan = suggestDay(snapshot, {
    finishBy, constraints, getRoutes, startMinute: departMinute,
    startAnchor: fromAnchor, endAnchor: toAnchor, allowEstimates,
  });
  if (!plan)
    throw Error("No schedule fits the remaining hours, travel times, locks and bookings. Check the time limits or set aside an eligible stop.");
  return { original, prefix, skipId, finishBy, plan, retainedStarts, current: current.slice(completed) };
}

function withAnchorRoute(anchor, route, stopId, allowEstimates) {
  const saved = { ...anchor, mode: route.mode, allowEstimates };
  delete saved.routeCheck;
  delete saved.stopId;
  if (route.check) {
    saved.routeCheck = route.check;
    saved.stopId = stopId;
  }
  return saved;
}

export function applyRemainingDay(state, proposal) {
  const { original, prefix, skipId, finishBy, plan, retainedStarts } = proposal;
  const day = state.days.find(item => item.id === original.day.id);
  if (!day || canonical(remainingDaySnapshot(state, day, skipId)) !== canonical(original))
    throw Error("The itinerary changed. Open a new re-planning preview.");
  if (skipId) getTrip(state, day).unassignedStopIds.push(skipId);
  day.stopIds = [...prefix, ...plan.rows.map(row => row.stop.id)];
  const starts = Object.fromEntries(prefix
    .filter(id => Object.hasOwn(day.planVisitStarts ?? {}, id))
    .map(id => [id, day.planVisitStarts[id]]));
  Object.assign(starts, retainedStarts);
  if (Object.keys(starts).length) day.planVisitStarts = starts;
  else delete day.planVisitStarts;
  const first = plan.rows[0], last = plan.rows.at(-1), resumeId = prefix.at(-1);
  if (resumeId) {
    day.planDepartures = Object.fromEntries(prefix
      .filter(id => Object.hasOwn(day.planDepartures ?? {}, id))
      .map(id => [id, day.planDepartures[id]]));
    day.planDepartures[resumeId] = { departMinute: plan.startMinute, finishBy };
  } else {
    delete day.planDepartures;
    day.startMinute = plan.startMinute;
    day.planEndMinute = finishBy;
    if (day.planStartAnchor)
      day.planStartAnchor = withAnchorRoute(day.planStartAnchor, first.route, first.stop.id, plan.allowEstimates);
  }
  if (day.planEndAnchor)
    day.planEndAnchor = withAnchorRoute(day.planEndAnchor, plan.endLeg.route, last.stop.id, plan.allowEstimates);
  M.reconcile(state);
  const segments = new Map(state.segments.map(segment => [segment.toStopId, segment]));
  for (const { stop, route } of plan.rows.slice(resumeId ? 0 : 1)) {
    const segment = segments.get(stop.id);
    // Reconcile uses the selected mode for future coordinate estimates.
    if (segment.mode !== route.mode) M.setMode(state, segment, route.mode);
    if (route.check) segment.routeCheck = route.check;
    else delete segment.routeCheck;
    segment.manualMinutes = route.kind === "estimate" ? null : route.minutes;
    segment.overrideFingerprint = segment.manualMinutes === null ? null : segment.coordinateFingerprint;
  }
}

export function undoRemainingDay(state, original, applied, skippedId) {
  const day = state.days.find(item => item.id === original.day.id);
  if (!day || canonical(remainingDaySnapshot(state, day, skippedId)) !== applied)
    throw Error("This day changed after re-planning. The latest edits were kept.");
  restoreDay(state, M.clone(original));
  getTrip(state, day).unassignedStopIds = [...original.unassignedStopIds];
}
