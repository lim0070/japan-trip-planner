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

function endpoint(place, stops, index, platforms) {
  if (!place || travelVisit(place)) return [];
  const selected = platforms.get(place.key?.replace(/^manual:/u, ""));
  const matches = new Set(selected);
  if (!selected) {
    for (const name of Object.values(place.names ?? {})) {
      const key = normalize(name).split(/\s+·\s+/u)[0];
      for (const match of index.get(key) ?? []) matches.add(match);
    }
  }
  // Named platforms for a single signed stop share an endpoint, unlike an ambiguous city or station name.
  const labels = [...matches];
  const group = labels[0]?.platformGroup;
  const oneStop = labels.length === 1 || (group && labels.every(stop => stop.platformGroup === group));
  if (oneStop && (!located(place) ||
      (group && labels.some(stop => distance(place.location, stop) <= 0.08)) ||
      !Number.isFinite(labels[0].lat) || !Number.isFinite(labels[0].lng)))
    return labels.map(stop => ({ stop, walk: 0, exact: true }));
  if (!located(place)) return [];
  const exact = matches.size ? [...matches] : stops;
  const candidates = exact.flatMap(stop => {
    const km = Number.isFinite(stop.lat) && Number.isFinite(stop.lng)
      ? distance(place.location, stop) : Infinity;
    return km <= walkLimitKm ? [{ stop, walk: km <= 0.025 ? 0 : walkingMinutes(km), exact: matches.has(stop) }] : [];
  }).sort((a, b) => a.walk - b.walk);
  const nearby = new Set();
  return candidates.filter(({ stop }) => {
    const key = stop.platformGroup ?? stop.id;
    if (nearby.size === 4 && !nearby.has(key)) return false;
    nearby.add(key);
    return true;
  });
}

function buildDepartures(trips, date) {
  const departures = new Map();
  const dropoffs = new Set(), busDropoffs = new Set(), busOrigins = new Set();
  for (const trip of trips) {
    if (!coversService(trip.calendar, date)) continue;
    const last = trip.calls.length - 1;
    for (const [index, call] of trip.calls.entries()) {
      if (index > 0 && call.dropoff && Number.isInteger(call.arrive)) {
        dropoffs.add(call.stop);
        if (trip.mode === "bus") busDropoffs.add(call.stop);
      }
      if (index === last || !call.pickup || !Number.isInteger(call.depart) || call.depart < 0) continue;
      if (!departures.has(call.stop)) departures.set(call.stop, []);
      departures.get(call.stop).push({ trip, index, depart: call.depart });
      if (trip.mode === "bus") busOrigins.add(call.stop);
    }
  }
  for (const edges of departures.values()) edges.sort((a, b) => a.depart - b.depart);
  return { departures, dropoffs, busDropoffs, busOrigins };
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
  const platforms = new Map();
  for (const stop of stops) {
    if (!stop.platformGroup) continue;
    if (!platforms.has(stop.platformGroup)) platforms.set(stop.platformGroup, []);
    platforms.get(stop.platformGroup).push(stop);
  }
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
      const base = endpoint(place, stops, names, platforms);
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

  return function route(from, to, date, ready, finishBy = 1439, {
    atStopSince = null, incoming = null, busOnly = false, boardAfter = ready,
  } = {}) {
    const origins = resolve(from).filter(entry => !busOnly || (entry.exact && entry.stop.bus));
    const destinations = resolve(to).filter(entry => !busOnly || (entry.exact && entry.stop.bus));
    const hint = [origins[0]?.stop.name, destinations[0]?.stop.name];
    if (busOnly && (!origins.length || !destinations.length))
      return { reason: "mode", hint };
    if (!origins.length || !destinations.length) return { reason: "access", hint };
    const originGroup = origins[0].stop.platformGroup || origins[0].stop.id;
    const samePlace = ({ stop, walk }) => !walk && (stop.platformGroup || stop.id) === originGroup;
    if (origins.every(samePlace) && destinations.every(samePlace))
      return { same: true, hint };
    if (!Number.isInteger(ready) || ready > finishBy) return { reason: "time", hint };
    if (!dates.has(date)) {
      if (dates.size >= 14) dates.delete(dates.keys().next().value);
      dates.set(date, buildDepartures(trips, date));
    }
    const { departures, dropoffs, busDropoffs, busOrigins } = dates.get(date);
    const egress = new Map();
    for (const destination of destinations) {
      const old = egress.get(destination.stop.id);
      if (!old || old.walk > destination.walk) egress.set(destination.stop.id, destination);
    }
    if (!origins.some(({ stop }) => (busOnly ? busOrigins : departures).has(stop.id)) ||
        !destinations.some(({ stop }) => (busOnly ? busDropoffs : dropoffs).has(stop.id)))
      return { reason: "coverage", hint };
    let readyAt = new Map();
    for (const { stop, walk, exact, source } of origins) {
      const connection = exact && walk === 0 && incoming?.to === stop.name ? incoming : null;
      const changedPlatform = connection?.platform && connection.platform !== stop.id;
      const crossing = changedPlatform && (transfersFrom.get(connection.platform) ?? [])
        .find(link => link.to === stop.id && coversService(link.calendar, date));
      if (changedPlatform && !crossing) continue;
      const margin = connection ? Math.max(stop.transfer ?? 8, (crossing?.minimum ?? 0) - (crossing?.minutes ?? 0)) : stop.boarding ?? 5;
      const atStation = connection?.at ?? (exact && walk === 0 ? atStopSince : null);
      const access = walk + (crossing?.minutes ?? 0);
      const stationSince = atStation === null ? null : atStation + (crossing?.minutes ?? 0);
      const time = crossing && stationSince !== null ? Math.max(ready, stationSince) : ready + access;
      record(readyAt, stop.id, { station: stop.id, access: time - ready, accessSource: source,
        margin, atStation: stop.platformGroup && connection && !connection.platform ? null : stationSince,
        line: connection?.line, time, legs: [] });
    }
    let best = null;
    for (let ride = 0; ride < maxRides && readyAt.size; ride++) {
      const arrivals = new Map();
      for (const prior of readyAt.values()) {
        const outgoing = departures.get(prior.station) ?? [];
        const earliest = ride ? prior.time : Math.max(prior.time, boardAfter);
        for (let i = firstAfter(outgoing, earliest); i < outgoing.length; i++) {
          const { trip, index, depart } = outgoing[i];
          if (depart > Math.min(best?.arrival ?? finishBy, finishBy)) break;
          if (busOnly && trip.mode !== "bus") continue;
          const standard = prior.transferWalk ? null : transferRule(prior.station, prior, trip);
          const fullMargin = standard?.minutes ?? prior.margin;
          const credited = prior.atStation == null ? 0
            : Math.min(fullMargin, Math.max(0, prior.time - prior.atStation));
          const margin = fullMargin - credited;
          if (depart < prior.time + margin) continue;
          for (let j = index + 1; j < trip.calls.length; j++) {
            const { stop, dropoff, arrive, arrivalBound } = trip.calls[j];
            if (!dropoff || stop === prior.station || !Number.isInteger(arrive) || arrive <= depart ||
                arrive > Math.min(best?.arrival ?? finishBy, finishBy) || !byId.has(stop)) continue;
            const recordKey = stop + "|" + trip.line;
            const exit = egress.get(stop);
            const arrival = exit ? arrive + exit.walk : Infinity;
            const bestHere = arrival <= finishBy && (!best || arrival < best.arrival);
            if (!bestHere && (arrivals.get(recordKey)?.time ?? Infinity) <= arrive) continue;
            const option = {
              station: stop, line: trip.line, access: prior.access, accessSource: prior.accessSource, time: arrive,
              legs: [...prior.legs, {
                from: byId.get(prior.station).name, to: byId.get(stop).name,
                depart, arrive, wait: depart - prior.time, margin, priorWait: credited,
                transferWalk: prior.transferWalk ?? 0, line: trip.line,
                ...(standard ? { marginSource: standard.source } : {}),
                ...(arrivalBound ? { arrivalBound: true } : {}),
                service: trip.name, source: trip.source,
                validFrom: trip.calendar.start, validThrough: trip.calendar.end,
              }],
            };
            record(arrivals, recordKey, option);
            if (bestHere)
              best = { date, ready, arrival, access: option.access, accessSource: option.accessSource,
                egress: exit.walk, egressSource: exit.source, legs: option.legs,
                ...(byId.get(stop).platformGroup ? { platform: stop } : {}) };
          }
        }
      }
      readyAt = new Map();
      for (const prior of arrivals.values()) {
        const station = prior.station;
        record(readyAt, station + "|" + prior.line, { ...prior, margin: byId.get(station).transfer ?? 8 });
        for (const edge of transfersFrom.get(station) ?? []) {
          if (!byId.has(edge.to) || !coversService(edge.calendar, date)) continue;
          record(readyAt, edge.to + "|" + prior.line, { ...prior, station: edge.to, time: prior.time + edge.minutes,
            margin: Math.max(byId.get(edge.to).transfer ?? 8, (edge.minimum ?? 0) - edge.minutes), transferWalk: edge.minutes });
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
