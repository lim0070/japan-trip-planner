import * as M from "./model.js";

export const MAX_PLAN_STOPS = 16;
export const MAX_ROUTE_CHECKS = 64;
const SEARCH_WIDTH = 48;
export const START_ANCHOR = "@departure";
export const END_ANCHOR = "@end";

export function daySnapshot(state, day) {
  const ids = new Set(day.stopIds);
  return M.clone({
    day,
    stops: state.stops.filter((stop) => ids.has(stop.id)),
    segments: state.segments.filter((segment) => ids.has(segment.fromStopId)),
  });
}

export function restoreDay(state, saved) {
  const ids = new Set(saved.day.stopIds);
  state.days = state.days.map((day) => day.id === saved.day.id ? saved.day : day);
  const stops = new Map(saved.stops.map((stop) => [stop.id, stop]));
  state.stops = state.stops.map((stop) => stops.get(stop.id) ?? stop);
  state.segments = state.segments.filter((segment) => !ids.has(segment.fromStopId))
    .concat(saved.segments);
}

const checkedMinutes = ({ minutes, access, egress }) => minutes + access + egress;

// Synchronous, local provider. Checks belong to one directed leg, mode and date.
export function createRouteProvider(snapshot, checks, defaultMode, allowEstimates) {
  const saved = new Map(snapshot.segments.map((segment) =>
    [segment.fromStopId + "|" + segment.toStopId, segment],
  ));
  const routes = new Map();
  return ({ from, to, date, departMinute }) => {
    const pair = from.id + "|" + to.id;
    const isAnchor = from.id === START_ANCHOR || to.id === END_ANCHOR;
    if (isAnchor && M.sameRoutingPlace(from.place, to.place))
      return [{ kind: "same", mode: defaultMode, minutes: 0 }];
    const key = pair + "|" + date;
    if (!routes.has(key)) {
      const segment = saved.get(pair);
      const a = from.place, b = to.place;
      const mode = segment?.mode ?? defaultMode;
      const matching = checks.filter((check) => check.from === from.id && check.to === to.id);
      if (segment?.routeCheck) {
        const check = segment.routeCheck;
        const exists = matching.some((item) =>
          item.mode === mode && item.departMinute === check.departMinute);
        if (!exists) matching.push({ ...check, mode });
      }
      const checked = matching
        .filter((check) => check.date === date && check.endpoints === M.routeEndpoints(a, b))
        .map(({ provider, date, departMinute, minutes, access, egress, endpoints, mode }) => ({
          kind: provider,
          mode,
          minutes: checkedMinutes({ minutes, access, egress }),
          check: { provider, date, departMinute, minutes, access, egress, endpoints },
        }));
      const manual = segment && !segment.routeCheck && segment.manualMinutes !== null &&
        segment.overrideFingerprint === segment.coordinateFingerprint;
      const estimate = allowEstimates ? M.estimate(a, b, mode) : null;
      const fallback = manual ? { kind: "manual", mode, minutes: segment.manualMinutes }
        : estimate === null ? null : { kind: "estimate", mode, minutes: estimate };
      routes.set(key, { checked, fallback });
    }
    const { checked, fallback } = routes.get(key);
    return [
      ...checked.filter((route) => route.check.departMinute >= departMinute),
      ...(fallback ? [fallback] : []),
    ];
  };
}

function compare(a, b) {
  return a.estimates - b.estimates || a.travel - b.travel ||
    a.departure - b.departure || a.moved - b.moved;
}

export function suggestDay(snapshot, {
  finishBy, constraints, getRoutes, startMinute = snapshot.day.startMinute,
  startAnchor = null, endAnchor = null, allowEstimates = true,
}) {
  const { day, stops } = snapshot;
  if (day.stopIds.length > MAX_PLAN_STOPS || finishBy < startMinute) return null;
  const start = startAnchor && { id: START_ANCHOR, place: startAnchor.place };
  const end = endAnchor && { id: END_ANCHOR, place: endAnchor.place };
  function finish(plan, from) {
    if (!end || !from) return [plan];
    return getRoutes({ from, to: end, date: day.date, departMinute: plan.departure })
      .flatMap(route => {
        const leave = route.check?.departMinute ?? plan.departure;
        const arrival = leave + route.minutes;
        return arrival > finishBy ? [] : [{
          ...plan, departure: arrival, travel: plan.travel + route.minutes,
          estimates: plan.estimates + Number(route.kind === "estimate"),
          endLeg: { leave, arrival, route, from },
        }];
      });
  }
  const byId = new Map(stops.map((stop) => [stop.id, stop]));
  const visits = day.stopIds.map((id) => {
    const stop = byId.get(id);
    return { ...stop, ...constraints[id], place: M.visitDestination(stop) };
  });
  // Each locked position forms a boundary. Visits cannot cross it.
  const groups = [];
  let group = [];
  for (const visit of visits) {
    if (visit.planLocked) {
      if (group.length) groups.push(group);
      groups.push([visit]);
      group = [];
    } else group.push(visit);
  }
  if (group.length) groups.push(group);
  let beam = [{ rows: [], used: new Set(), travel: 0, estimates: 0,
    departure: startMinute, moved: 0, startMinute, startAnchor, endAnchor, allowEstimates }];
  if (!visits.length) return finish(beam[0], start).sort(compare)[0] || null;
  let position = 0;
  for (const choices of groups) {
    for (let i = 0; i < choices.length; i++, position++) {
      const next = [];
      for (const plan of beam) {
        const from = plan.rows.at(-1)?.stop ?? start;
        for (const stop of choices) {
          if (plan.used.has(stop.id)) continue;
          const routes = from ? getRoutes({ from, to: stop, date: day.date,
            departMinute: plan.departure }) : [null];
          for (const route of routes) {
            const leave = route?.check?.departMinute ?? plan.departure;
            const arrival = leave + (route?.minutes ?? 0);
            const start = M.planningStart(stop, stop.place, day.date, arrival, finishBy);
            if (start === null) continue;
            const departure = start + stop.durationMinutes;
            const candidate = {
              ...plan,
              rows: [...plan.rows, { stop, leave, arrival, start, departure, route }],
              used: new Set([...plan.used, stop.id]),
              travel: plan.travel + (route?.minutes ?? 0),
              estimates: plan.estimates + Number(route?.kind === "estimate"),
              departure,
              moved: plan.moved + Number(day.stopIds[position] !== stop.id),
            };
            next.push(...(position === visits.length - 1 ? finish(candidate, stop) : [candidate]));
          }
        }
      }
      // Identical end position, remaining visits and time have identical continuations.
      const seen = new Set();
      beam = [];
      for (const plan of next.sort(compare)) {
        const key = [plan.rows.at(-1).stop.id, plan.departure, ...[...plan.used].sort()].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        beam.push(plan);
        if (beam.length === SEARCH_WIDTH) break;
      }
      if (!beam.length) return null;
    }
  }
  return beam[0];
}

function saveAnchor(day, key, anchor, route, stopId, defaultMode, allowEstimates) {
  if (!anchor) {
    delete day[key];
    return;
  }
  day[key] = {
    place: anchor.place,
    mode: route?.mode ?? anchor.mode ?? defaultMode,
    allowEstimates,
    ...(anchor.sourceVersion ? { sourceVersion: anchor.sourceVersion } : {}),
    ...(route?.check ? { routeCheck: route.check, ...(stopId ? { stopId } : {}) } : {}),
  };
}

export function applyDayPlan(state, dayId, finishBy, plan) {
  const day = state.days.find((day) => day.id === dayId);
  day.stopIds = plan.rows.map(({ stop }) => stop.id);
  day.planEndMinute = finishBy;
  delete day.planDepartures;
  day.startMinute = plan.startMinute;
  const first = plan.rows[0], last = plan.rows.at(-1);
  saveAnchor(day, "planStartAnchor", plan.startAnchor, first?.route, first?.stop.id, state.settings.defaultMode, plan.allowEstimates);
  saveAnchor(day, "planEndAnchor", plan.endAnchor, plan.endLeg?.route, last?.stop.id, state.settings.defaultMode, plan.allowEstimates);
  const stops = new Map(state.stops.map((stop) => [stop.id, stop]));
  for (const { stop } of plan.rows) {
    const saved = stops.get(stop.id);
    if (stop.planLocked) saved.planLocked = true;
    else delete saved.planLocked;
    if (stop.fixedStartMinute !== undefined) saved.fixedStartMinute = stop.fixedStartMinute;
    else delete saved.fixedStartMinute;
  }
  M.reconcile(state);
  const segments = new Map(state.segments.map((segment) => [segment.toStopId, segment]));
  for (const { stop, route } of plan.rows.slice(1)) {
    const segment = segments.get(stop.id);
    segment.mode = route.mode;
    if (route.check) segment.routeCheck = route.check;
    else delete segment.routeCheck;
    segment.manualMinutes = route.kind === "estimate" ? null : route.minutes;
    segment.overrideFingerprint = segment.manualMinutes === null ? null : segment.coordinateFingerprint;
  }
}
