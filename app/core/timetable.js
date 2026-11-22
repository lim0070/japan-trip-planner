import { distance, located } from "./model.js";
import { fold } from "./place-search.js";

const walkLimitKm = 1;
const maxRides = 3;
const normalize = text => fold(text).trim().replace(/\s+/gu, " ");
const clockDate = date => new Date(date + "T00:00:00Z");
const walkingMinutes = km => Math.ceil(km * 1.3 * 15);

export function coversService(calendar, date) {
  if (!calendar || date < calendar.start || date > calendar.end) return false;
  const day = clockDate(date);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date) return false;
  const exception = calendar.exceptions?.[date];
  return typeof exception === "boolean" ? exception : calendar.days.includes(day.getUTCDay());
}

export function travelVisit(place) {
  return Object.values(place?.names ?? {}).some(name => name &&
    /^(?:(?:take |ride |on board |onboard )(?:the )?(?:train|bus|flight|shinkansen)\b|(?:flight|airline transfer|airport transfer|shinkansen ride|train ride|bus ride)(?:\s|$)|(?:新幹線|電車|バス|航空便)に乗車)/iu.test(normalize(name)));
}

function stationIndex(stops) {
  const index = new Map();
  for (const stop of stops) {
    for (const label of [stop.name, ...stop.aliases]) {
      const key = normalize(label);
      if (!index.has(key)) index.set(key, new Set());
      index.get(key).add(stop);
    }
  }
  return index;
}

function endpoint(place, stops, index) {
  if (!place || travelVisit(place)) return [];
  const matches = new Set();
  for (const name of Object.values(place.names ?? {})) {
    const key = normalize(name).split(/\s+·\s+/u)[0];
    for (const match of index.get(key) ?? []) matches.add(match);
  }
  // Ambiguous exact labels are not a reason to guess a city or an operator.
  const named = matches.size === 1 ? [...matches][0] : null;
  if (named && (!located(place) || !Number.isFinite(named.lat) || !Number.isFinite(named.lng)))
    return [{ stop: named, walk: 0, exact: true }];
  if (!located(place)) return [];
  const exact = matches.size ? [...matches] : stops;
  return exact.flatMap(stop => {
    const km = Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
      ? distance(place.location, stop) : Infinity;
    return km <= walkLimitKm ? [{ stop, walk: km <= 0.025 ? 0 : walkingMinutes(km), exact: matches.has(stop) }] : [];
  }).sort((a, b) => a.walk - b.walk).slice(0, 4);
}

function buildDepartures(trips, date) {
  const departures = new Map();
  for (const trip of trips) {
    if (!coversService(trip.calendar, date)) continue;
    for (const [i, origin] of trip.calls.entries()) {
      if (!origin.pickup) continue;
      if (!departures.has(origin.stop)) departures.set(origin.stop, []);
      const outgoing = departures.get(origin.stop);
      for (const destination of trip.calls.slice(i + 1)) {
        if (!destination.dropoff || origin.stop === destination.stop ||
            !Number.isInteger(origin.depart) || !Number.isInteger(destination.arrive) ||
            origin.depart < 0 || destination.arrive <= origin.depart) continue;
        outgoing.push({
          from: origin.stop, to: destination.stop, depart: origin.depart, arrive: destination.arrive,
          service: trip.name, coverage: trip.calendar, source: trip.source, mode: trip.mode, line: trip.line,
          arrivalBound: destination.arrivalBound,
        });
      }
    }
  }
  for (const edges of departures.values()) edges.sort((a, b) => a.depart - b.depart);
  return departures;
}

function firstAfter(edges, minute) {
  let lo = 0, hi = edges.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (edges[mid].depart < minute) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function record(map, station, arrival) {
  if ((map.get(station)?.time ?? Infinity) > arrival.time) map.set(station, arrival);
}

// The date cache keeps local route checks bounded. Routing never requests a service.
export function createTimetableRouter({ stops, trips, transfers = [], standards = [], accessLinks = [] }) {
  const byId = new Map(stops.map(stop => [stop.id, stop]));
  const names = stationIndex(stops);
  const dates = new Map();
  const transfersFrom = new Map();
  for (const transfer of transfers) {
    if (!transfersFrom.has(transfer.from)) transfersFrom.set(transfer.from, []);
    transfersFrom.get(transfer.from).push(transfer);
  }
  const candidates = new WeakMap();
  const resolve = place => {
    if (!place) return [];
    if (!candidates.has(place)) {
      const base = endpoint(place, stops, names);
      const links = base.filter(entry => entry.exact).flatMap(entry =>
        (transfersFrom.get(entry.stop.id) ?? []).filter(link => link.access).map(link =>
          ({ stop: byId.get(link.to), walk: entry.walk + link.minutes, exact: true })));
      const labels = Object.values(place.names ?? {}).map(normalize);
      const walks = accessLinks.filter(link => link.aliases.some(name => labels.includes(normalize(name))))
        .map(link => ({ stop: byId.get(link.to), walk: link.minutes, exact: true, source: link.url }));
      candidates.set(place, [...base, ...links, ...walks]);
    }
    return candidates.get(place);
  };
  const transferRule = (station, prior, edge) => {
    if (!prior.line) return null;
    const lineMatch = (a, b) => a === b || (b.includes("Shinkansen") &&
      (a === "Shinkansen" || (a === "Tohoku Shinkansen" && b.includes("Tohoku")) ||
        (a === "Hokkaido Shinkansen" && b.includes("Hokkaido"))));
    return standards.find(rule => rule.station === station && (
      (lineMatch(rule.line1, prior.line) && lineMatch(rule.line2, edge.line)) ||
      (lineMatch(rule.line2, prior.line) && lineMatch(rule.line1, edge.line))));
  };

  return function route(from, to, date, ready, finishBy = 1439, { atStopSince = null, incoming = null, busOnly = false } = {}) {
    const origins = resolve(from).filter(entry => !busOnly || (entry.exact && entry.stop.bus));
    const destinations = resolve(to).filter(entry => !busOnly || (entry.exact && entry.stop.bus));
    const hint = [origins[0]?.stop.name, destinations[0]?.stop.name];
    if (busOnly && (!origins.length || !destinations.length))
      return { reason: "mode", hint };
    if (!origins.length || !destinations.length) return { reason: "access", hint };
    if (origins.length === 1 && destinations.length === 1 &&
        origins[0].stop.id === destinations[0].stop.id &&
        origins[0].walk === 0 && destinations[0].walk === 0)
      return { same: true, hint };
    if (!Number.isInteger(ready) || ready > finishBy) return { reason: "time", hint };
    if (!dates.has(date)) {
      if (dates.size >= 14) dates.delete(dates.keys().next().value);
      dates.set(date, buildDepartures(trips, date));
    }
    const edges = dates.get(date);
    const egress = new Map();
    for (const destination of destinations) {
      const old = egress.get(destination.stop.id);
      if (!old || old.walk > destination.walk) egress.set(destination.stop.id, destination);
    }
    const destinationsOnDate = new Set();
    for (const outgoing of edges.values()) for (const edge of outgoing) {
      if (egress.has(edge.to) && (!busOnly || edge.mode === "bus")) destinationsOnDate.add(edge.to);
      if (destinationsOnDate.size === egress.size) break;
    }
    if (!origins.some(({ stop }) => edges.has(stop.id)) || !destinationsOnDate.size)
      return { reason: "coverage", hint };
    let readyAt = new Map();
    for (const { stop, walk, exact, source } of origins) {
      const connection = exact && walk === 0 && incoming?.to === stop.name ? incoming : null;
      const margin = connection ? stop.transfer ?? 8 : stop.boarding ?? 5;
      const atStation = connection?.at ?? (exact && walk === 0 ? atStopSince : null);
      record(readyAt, stop.id, { station: stop.id, access: walk, accessSource: source,
        margin, atStation, line: connection?.line, time: ready + walk, legs: [] });
    }
    let best = null;
    for (let ride = 0; ride < maxRides && readyAt.size; ride++) {
      const arrivals = new Map();
      for (const prior of readyAt.values()) {
        const outgoing = edges.get(prior.station) ?? [];
        for (let i = firstAfter(outgoing, prior.time); i < outgoing.length; i++) {
          const edge = outgoing[i];
          const standard = prior.transferWalk ? null : transferRule(prior.station, prior, edge);
          const fullMargin = standard?.minutes ?? prior.margin;
          const credited = prior.atStation == null ? 0
            : Math.min(fullMargin, Math.max(0, prior.time - prior.atStation));
          const margin = fullMargin - credited;
          if (edge.depart < prior.time + margin) continue;
          const limit = Math.min(best?.arrival ?? finishBy, finishBy);
          if (edge.depart > limit) break;
          if (edge.arrive > limit || !byId.has(edge.to) || (busOnly && edge.mode !== "bus")) continue;
          const option = {
            station: edge.to, line: edge.line, access: prior.access, accessSource: prior.accessSource, time: edge.arrive,
            legs: [...prior.legs, {
              from: byId.get(edge.from).name, to: byId.get(edge.to).name,
              depart: edge.depart, arrive: edge.arrive, wait: edge.depart - prior.time,
              margin, priorWait: credited, transferWalk: prior.transferWalk ?? 0, line: edge.line,
              ...(standard ? { marginSource: standard.source } : {}),
              ...(edge.arrivalBound ? { arrivalBound: true } : {}),
              service: edge.service, source: edge.source,
              validFrom: edge.coverage.start, validThrough: edge.coverage.end,
            }],
          };
          record(arrivals, edge.to + "|" + edge.line, option);
          if (!egress.has(edge.to)) continue;
          const exit = egress.get(edge.to), arrival = edge.arrive + exit.walk;
          if (arrival <= finishBy && (!best || arrival < best.arrival))
            best = { date, ready, arrival, access: option.access, accessSource: option.accessSource,
              egress: exit.walk, egressSource: exit.source, legs: option.legs };
        }
      }
      readyAt = new Map();
      for (const prior of arrivals.values()) {
        const station = prior.station;
        record(readyAt, station + "|" + prior.line, { ...prior, margin: byId.get(station).transfer ?? 8 });
        for (const edge of transfersFrom.get(station) ?? []) {
          if (!byId.has(edge.to) || !coversService(edge.calendar, date)) continue;
          record(readyAt, edge.to + "|" + prior.line, { ...prior, station: edge.to, time: prior.time + edge.minutes,
            margin: byId.get(edge.to).transfer ?? 8, transferWalk: edge.minutes });
        }
      }
    }
    return best ? { journey: best, hint } : { reason: "no-service", hint };
  };
}

export function timetableCheck(journey, endpoints) {
  return {
    provider: "timetable", date: journey.date, departMinute: journey.ready,
    minutes: journey.arrival - journey.ready - journey.access - journey.egress,
    access: journey.access, egress: journey.egress, endpoints, legs: journey.legs,
    ...(journey.accessSource ? { accessSource: journey.accessSource } : {}),
    ...(journey.egressSource ? { egressSource: journey.egressSource } : {}),
  };
}
