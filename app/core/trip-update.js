import { canonical, validateState } from "./contracts.js";
import { clone, id, name, now, reconcile, visitPlace } from "./model.js";

const tripFields = [
  ["Trip name", ["name"]], ["Trip notes", ["notes"]], ["Planning thresholds", ["thresholds"]],
  ["Trip notes and budget", ["localPlan"]], ["Checked rail pass", ["checkedPass"]],
  ["Prefecture progress", ["prefectureVisits"]],
];
const dayFields = [
  ["Day label", ["label"]], ["Day starts", ["startMinute"]],
  ["Schedule, checkpoints and anchors", ["planEndMinute", "planStartAnchor", "planEndAnchor", "planVisitStarts", "planDepartures"]],
  ["Weather, transit and journal notes", ["travelNotes"]], ["Backup train", ["backupTrain"]],
  ["Finished visits", ["finishedStopIds"]],
];
const visitFields = [
  ["Visit notes", ["notes"]], ["Duration", ["durationMinutes"]],
  ["Booking and plan lock", ["fixedStartMinute", "planLocked"]],
  ["Place snapshot", ["placeId", "placeSnapshot", "sourceDatasetVersion"]],
  ["Visit place edits", ["placeOverrides"]], ["Confirmed entrance", ["entrance"]],
  ["Checked hours", ["hoursCheck"]], ["Visit notes and reference details", ["visitDetails"]],
  ["Sauna sets", ["saunaSets"]], ["Votes and comments", ["togetherVotes"]],
];
const travelFields = [
  ["Mode and checked travel time", ["mode", "manualMinutes", "overrideFingerprint", "routeCheck"]],
  ["Checked fare", ["railFare"]], ["Transit notes and evidence", ["transitEvidence"]],
];

const byId = rows => new Map(rows.map(row => [row.id, row]));
const segmentId = row => row.fromStopId + "|" + row.toStopId;
const same = (a, b) => canonical(a) === canonical(b);
const pick = (row, fields) => row && Object.fromEntries(fields
  .filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]]));
const dayLabel = day => day.date + (day.label ? " · " + day.label : "");
const visitLabel = row => name(visitPlace(row));

function tripClosure(state, tripId) {
  const trip = state.trips.find(item => item.id === tripId);
  if (!trip) return null;
  const days = byId(state.days.filter(day => day.tripId === tripId));
  return {
    trip,
    days: trip.dayIds.map(dayId => days.get(dayId)),
    stops: state.stops.filter(visit => visit.tripId === tripId),
    segments: state.segments.filter(leg => leg.tripId === tripId),
  };
}

export function tripUpdateBase(data, tripId) {
  const closure = tripClosure(data, tripId);
  return closure && { ...closure, exportedAt: data.exportedAt, appVersion: data.appVersion };
}

const calendar = closure => closure && ({
  startDate: closure.trip.startDate,
  endDate: closure.trip.endDate,
  days: closure.days.map(({id, date, stopIds}) => ({id, date, stopIds})),
  unassigned: closure.trip.unassignedStopIds,
});

const versionNumbers = version => typeof version === "string" && /^\d+(?:\.\d+){1,2}$/u.test(version)
  ? version.split(".").map(Number) : null;
function earlierVersion(a, b) {
  const left = versionNumbers(a), right = versionNumbers(b);
  if (!left || !right) return true;
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference < 0;
  }
  return false;
}

// A matching ID, a previous source value and a recent file are separate signals.
// Only an unchanged browser value with a known baseline is safe to preselect.
function resolution(browser, file, base, older) {
  if (older) return { choice: "browser", status: "Older file · review" };
  if (base === undefined) return { choice: "browser", status: "Review both versions" };
  if (same(file, base)) return { choice: "browser", status: "Browser edit" };
  if (same(browser, base)) return { choice: "file", status: "File change" };
  return { choice: "browser", status: "Both changed" };
}

function pairDays(browser, file) {
  // Reserve exact IDs before pairing independently created days with the same date.
  const local = byId(browser.days), shared = new Set(file.days.map(day => day.id));
  const byDate = new Map(browser.days.filter(day => !shared.has(day.id)).map(day => [day.date, day]));
  return new Map(file.days.map(day => [day.id, local.get(day.id) ?? byDate.get(day.date)]));
}

export function previewTripUpdate(state, data, tripId, baseline = null, protectedVisits = new Set()) {
  const local = tripClosure(state, tripId), incoming = tripClosure(data, tripId);
  if (!local || !incoming) throw Error("This file does not match the saved trip ID.");
  if (baseline?.trip.id !== tripId) baseline = null;
  const older = Boolean(baseline && (Date.parse(data.exportedAt) < Date.parse(baseline.exportedAt) ||
    earlierVersion(data.appVersion, baseline.appVersion)));
  const incomingDays = new Set(incoming.trip.dayIds), incomingStops = byId(incoming.stops);
  if (state.days.some(day => day.tripId !== tripId && incomingDays.has(day.id)) ||
      state.stops.some(stop => stop.tripId !== tripId && incomingStops.has(stop.id)))
    throw Error("Some days or visits in this file belong to a different saved trip. Use the copy import.");
  const pairedDays = pairDays(local, incoming);
  const fileDates = new Set(incoming.days.map(day => day.date));
  const removedDays = local.days.filter(day => !fileDates.has(day.date));
  const removedVisits = local.stops.filter(stop => !incomingStops.has(stop.id) && !protectedVisits.has(stop.id));
  const protectedDates = new Set(local.days.filter(day => day.stopIds.some(id => protectedVisits.has(id))).map(day => day.date));
  const localStops = byId(local.stops);
  const baseStops = byId(baseline?.stops ?? []);
  const baseDays = new Map(baseline ? [...pairDays(baseline, incoming)] : []);
  const changes = [];
  function add(change, before) {
    if (same(change.browser, change.file)) return;
    const decision = resolution(change.browser, change.file, before, older);
    changes.push({ ...change, ...decision, index: changes.length });
  }
  add({ kind:"calendar", label:"Trip dates and visit order", group:"Calendar",
    browser:calendar(local), file:calendar(incoming) }, baseline ? calendar(baseline) : undefined);
  if (changes[0]?.kind === "calendar" && removedDays.length) {
    changes[0].choice = "browser";
    changes[0].status = "File removes days · review";
  }
  if (changes[0]?.kind === "calendar" && protectedDates.size) {
    changes[0].choice = "browser";
    if (!removedDays.length) changes[0].status = "Protected repeat visits · review";
  }

  function fields(kind, group, rowId, browser, file, base, definitions) {
    for (const [label, keys] of definitions)
      add({ kind, group, label, rowId, keys, browser:pick(browser, keys), file:pick(file, keys) }, pick(base, keys));
  }
  fields("trip", "Trip details", tripId, local.trip, incoming.trip, baseline?.trip, tripFields);
  for (const fileDay of incoming.days) {
    const browserDay = pairedDays.get(fileDay.id);
    if (!browserDay) continue;
    fields("day", dayLabel(fileDay), fileDay.id, browserDay, fileDay,
      baseDays.get(fileDay.id), dayFields);
  }
  for (const stop of incoming.stops) {
    const browser = localStops.get(stop.id);
    if (browser) {
      fields("visit", visitLabel(browser), stop.id, browser, stop, baseStops.get(stop.id), visitFields);
    } else {
      add({ kind:"new-visit", group:visitLabel(stop), label:"Add this visit", rowId:stop.id,
        browser:null, file:stop }, baseline ? baseStops.get(stop.id) ?? null : undefined);
    }
  }
  const alreadyUnassigned = new Set(local.trip.unassignedStopIds);
  for (const stop of removedVisits.filter(stop => !alreadyUnassigned.has(stop.id))) {
    changes.push({ kind:"unassign-visit", group:visitLabel(stop), label:"Keep this browser-only visit",
      rowId:stop.id, browser:stop, file:null, choice:"browser", status:"Missing from file · review", index:changes.length });
  }
  const localLegs = new Map(local.segments.map(leg => [segmentId(leg), leg]));
  const baseLegs = new Map((baseline?.segments ?? []).map(leg => [segmentId(leg), leg]));
  for (const leg of incoming.segments) {
    const key = segmentId(leg), old = localLegs.get(key);
    const group = visitLabel(incomingStops.get(leg.fromStopId)) + " → " + visitLabel(incomingStops.get(leg.toStopId));
    if (old) fields("segment", group, key, old, leg, baseLegs.get(key), travelFields);
    else add({ kind:"new-segment", group, label:"Travel for a new leg", rowId:key,
      browser:null, file:leg }, baseline ? baseLegs.get(key) ?? null : undefined);
  }
  return { local, incoming, baseline, older, pairedDays, removedDays, removedVisits,
    protectedVisits, protectedDates, changes };
}

function setFields(record, change) {
  for (const key of change.keys) {
    if (Object.hasOwn(change.file, key)) record[key] = clone(change.file[key]);
    else delete record[key];
  }
}

function addPlace(state, places, placeId, placeMap) {
  if (placeMap.has(placeId)) return placeMap.get(placeId);
  const incoming = places.get(placeId);
  const current = state.places.find(place => place.id === placeId);
  let target = placeId;
  if (!current || !same(current, incoming)) {
    if (current) target = id();
    state.places.push({ ...clone(incoming), id: target });
  }
  placeMap.set(placeId, target);
  return target;
}

function insertExtraDaysVisits(days, used, extras, allowedIds) {
  const byDate = new Map(days.map(day => [day.date, day]));
  for (const extra of extras) {
    const target = byDate.get(extra.date);
    if (!target) continue;
    for (const stopId of extra.stopIds) {
      if (!allowedIds.has(stopId) || used.has(stopId)) continue;
      target.stopIds.push(stopId);
      used.add(stopId);
    }
  }
}

export function applyTripUpdate(state, data, preview, selected) {
  const answers = preview.changes.filter(row => selected.has(row.index));
  if (!answers.length) return;
  const { local, incoming, pairedDays } = preview;
  const tripId = local.trip.id;
  const current = tripClosure(state, tripId);
  if (!same(current, local)) throw Error("The trip changed after the preview. Reopen the import and review it again.");
  const oldStops = byId(current.stops);
  const nextTrip = clone(current.trip);
  const nextStops = new Map(current.stops.map(stop => [stop.id, clone(stop)]));
  const filePlaces = byId(data.places), placeMap = new Map();
  const useCalendar = answers.some(change => change.kind === "calendar");
  const chosen = useCalendar ? incoming : current;
  const datesAndPositions = calendar(chosen);
  const fileDayByBrowser = new Map([...pairedDays].filter(entry => entry[1]).map(([fileId, day]) => [day.id, fileId]));
  const daysByFile = new Map();
  const keptOrders = new Map();
  if (useCalendar) {
    const remainingDates = new Set(chosen.days.map(day => day.date));
    for (const day of current.days)
      if (remainingDates.has(day.date) && preview.protectedDates.has(day.date)) keptOrders.set(day.date, day.stopIds);
  }
  const fixedOwners = new Map([...keptOrders].flatMap(([date, ids]) => ids.map(stopId => [stopId, date])));
  const chosenDays = chosen.days.map(day => {
    const old = useCalendar ? pairedDays.get(day.id) : day;
    const fixed = keptOrders.get(day.date) ?? [];
    const next = { ...clone(old ?? day), id: old?.id ?? day.id, date:day.date,
      stopIds:[...fixed, ...day.stopIds.filter(stopId => !fixedOwners.has(stopId))] };
    daysByFile.set(useCalendar ? day.id : fileDayByBrowser.get(day.id), next);
    return next;
  });
  const fileDays = byId(incoming.days);
  const planningBasis = new Map(chosen.days.map((day,index) => [
    chosenDays[index].id, useCalendar ? pairedDays.get(day.id) ?? day : day,
  ]));
  const finishedBasis = new Map(planningBasis);
  const oldLegs = new Map(current.segments.map(leg => [segmentId(leg), clone(leg)]));
  const unassign = new Set();
  for (const change of answers) {
    switch (change.kind) {
      case "trip": setFields(nextTrip, change); break;
      case "day": {
        const day = daysByFile.get(change.rowId);
        if (day) {
          setFields(day, change);
          if (change.keys.includes("planDepartures")) planningBasis.set(day.id,fileDays.get(change.rowId));
          if (change.keys.includes("finishedStopIds")) finishedBasis.set(day.id,fileDays.get(change.rowId));
        }
        break;
      }
      case "visit": setFields(nextStops.get(change.rowId), change); break;
      case "segment": setFields(oldLegs.get(change.rowId), change); break;
      case "new-segment": oldLegs.set(change.rowId, clone(change.file)); break;
      case "new-visit": nextStops.set(change.rowId, clone(change.file)); break;
      case "unassign-visit": unassign.add(change.rowId); break;
    }
  }
  for (const stop of nextStops.values()) {
    if (oldStops.get(stop.id)?.placeId !== stop.placeId)
      stop.placeId = addPlace(state, filePlaces, stop.placeId, placeMap);
  }
  const used = new Set(unassign);
  for (const day of chosenDays) {
    day.stopIds = day.stopIds.filter(stopId => nextStops.has(stopId) && !unassign.has(stopId));
    for (const stopId of day.stopIds) used.add(stopId);
  }
  const chosenUnassigned = datesAndPositions.unassigned.filter(stopId => nextStops.has(stopId) && !used.has(stopId));
  chosenUnassigned.forEach(stopId => used.add(stopId));
  const other = useCalendar ? current : incoming;
  // Preserve a visit from either version on its date when that date survives.
  // Items missing from the chosen calendar or explicitly unassigned remain in the trip.
  const chosenStopIds = new Set(chosen.stops.map(stop => stop.id));
  const eligible = new Set([...nextStops.keys()].filter(stopId => !chosenStopIds.has(stopId)));
  insertExtraDaysVisits(chosenDays, used, other.days, eligible);
  for (const day of chosenDays) {
    const basis = planningBasis.get(day.id);
    if (basis.date !== day.date) {
      delete day.planDepartures;
      delete day.planVisitStarts;
    } else if (day.planDepartures) {
      const firstChange = day.stopIds.findIndex((stopId,i) => basis.stopIds[i] !== stopId);
      if (firstChange !== -1) {
        const prefix = new Set(day.stopIds.slice(0,firstChange));
        day.planDepartures = Object.fromEntries(Object.entries(day.planDepartures).filter(([stopId]) => prefix.has(stopId)));
      }
    }
    if (finishedBasis.get(day.id).date !== day.date) delete day.finishedStopIds;
  }
  nextTrip.startDate = datesAndPositions.startDate;
  nextTrip.endDate = datesAndPositions.endDate;
  nextTrip.dayIds = chosenDays.map(day => day.id);
  nextTrip.unassignedStopIds = [...new Set([
    ...chosenUnassigned, ...unassign, ...[...nextStops.keys()].filter(stopId => !used.has(stopId)),
  ])];
  nextTrip.updatedAt = now();

  // A segment can retain its established inputs only while its endpoints
  // remain adjacent. Reconcile derives all estimates from the final order.
  const activeLegs = [];
  for (const day of chosenDays) {
    for (let i = 1; i < day.stopIds.length; i++) {
      const key = day.stopIds[i - 1] + "|" + day.stopIds[i];
      const leg = oldLegs.get(key);
      if (leg) activeLegs.push(clone(leg));
    }
  }
  state.trips = state.trips.map(trip => trip.id === tripId ? nextTrip : trip);
  state.days = [...state.days.filter(day => day.tripId !== tripId), ...chosenDays];
  state.stops = [...state.stops.filter(stop => stop.tripId !== tripId), ...nextStops.values()];
  state.segments = [...state.segments.filter(leg => leg.tripId !== tripId), ...activeLegs];
  state.dataLicenses = { ...data.dataLicenses, ...state.dataLicenses };
  state.sourceVersions = { ...data.sourceVersions, ...state.sourceVersions };
  reconcile(state);
  validateState(state);
}

export function dayAfterTripUpdate(state, tripId, previousDay) {
  const closure = tripClosure(state, tripId);
  if (!closure?.days.length) return null;
  const days = closure.days;
  const sameDate = days.find(day => day.date === previousDay?.date);
  if (sameDate || !previousDay) return sameDate ?? days[0];
  const distance = day => Math.abs(Date.parse(day.date) - Date.parse(previousDay.date));
  return days.reduce((nearest, day) => distance(day) < distance(nearest) ? day : nearest);
}

function remapKeys(record, ids) {
  return Object.fromEntries(Object.entries(record)
    .filter(([key]) => ids.has(key)).map(([key, value]) => [ids.get(key), value]));
}

export function projectCopyUpdate(data, copyId, link) {
  const found = tripClosure(data, link.sourceTripId);
  if (!found) throw Error("This file does not contain the linked source trip.");
  const { trip, days, stops, segments } = found;
  const protectedSource = new Set(link.protectedSource);
  const usable = stops.filter(stop => !protectedSource.has(stop.id));
  function extend(rows, stored) {
    const ids = new Map(stored);
    for (const key of rows) if (!ids.has(key)) ids.set(key, id());
    return ids;
  }
  const dayIds = extend(trip.dayIds, link.dayIds);
  const stopIds = extend(usable.map(row => row.id), link.stopIds);
  const sourcePlaces = new Set(usable.map(row => row.placeId));
  const placeIds = extend(sourcePlaces, link.placeIds);
  const mapStops = rows => rows.filter(key => stopIds.has(key) && !protectedSource.has(key)).map(key => stopIds.get(key));
  const projected = {
    ...data,
    kind:"trip",
    trips:[{
      ...trip, id:copyId, name:trip.name + " (imported copy)",
      dayIds:trip.dayIds.map(key => dayIds.get(key)), unassignedStopIds:mapStops(trip.unassignedStopIds),
    }],
    days:days.map(day => {
      const row = { ...day, id:dayIds.get(day.id), tripId:copyId, stopIds:mapStops(day.stopIds) };
      for (const field of ["planStartAnchor", "planEndAnchor"]) {
        const anchor = day[field];
        if (anchor?.stopId && stopIds.has(anchor.stopId)) row[field] = { ...anchor, stopId:stopIds.get(anchor.stopId) };
        if (anchor?.stopId && protectedSource.has(anchor.stopId)) {
          const { routeCheck, stopId, ...location } = anchor;
          row[field] = location;
        }
      }
      for (const field of ["planDepartures", "planVisitStarts"]) {
        if (day[field]) row[field] = remapKeys(day[field],stopIds);
      }
      if (day.finishedStopIds) row.finishedStopIds = mapStops(day.finishedStopIds.filter(key => stopIds.has(key)));
      return row;
    }),
    stops:usable.map(row => ({ ...row, id:stopIds.get(row.id), tripId:copyId, placeId:placeIds.get(row.placeId) })),
    segments:segments.filter(row => !protectedSource.has(row.fromStopId) && !protectedSource.has(row.toStopId)).map(row => ({
      ...row, tripId:copyId, fromStopId:stopIds.get(row.fromStopId), toStopId:stopIds.get(row.toStopId),
    })),
    places:data.places.filter(place => sourcePlaces.has(place.id)).map(place => ({ ...place, id:placeIds.get(place.id) })),
  };
  return { data:projected, link:{ ...link, dayIds, stopIds, placeIds } };
}

export function legacyCopyLink(state, earlier, copyId, sourceId) {
  const copy = tripClosure(state,copyId), source = tripClosure(earlier,sourceId);
  if (!copy || !source || copyId === sourceId || copy.trip.createdAt !== source.trip.createdAt)
    throw Error("The earlier file’s trip identity does not match this copy.");
  const copyDates = new Map(copy.days.map(day => [day.date,day.id]));
  const dayIds = new Map(source.days.filter(day => copyDates.has(day.date)).map(day => [day.id,copyDates.get(day.date)]));
  const stopDates = closure => new Map(closure.days.flatMap(day => day.stopIds.map(key => [key, day.date])));
  const oldDates = stopDates(source), newDates = stopDates(copy);
  function byPlace(closure) {
    const groups = new Map();
    for (const stop of closure.stops) {
      const key = stop.placeSnapshot.key;
      if (!groups.has(key)) groups.set(key,[]);
      groups.get(key).push(stop);
    }
    return groups;
  }
  const oldGroups = byPlace(source), newGroups = byPlace(copy);
  const stopIds = new Map(), placeIds = new Map();
  const protectedSource = new Set(), protectedLocal = new Set();
  function pair(before, after) {
    stopIds.set(before.id,after.id);
    const key = before.placeId, known = placeIds.get(key);
    if (known && known !== after.placeId)
      throw Error("This copy’s saved-place history is ambiguous. Update it using a backup exported from the copy.");
    placeIds.set(key,after.placeId);
  }
  for (const [key, original] of oldGroups) {
    const candidates = newGroups.get(key) ?? [];
    if (!candidates.length) continue;
    if (original.length === 1 && candidates.length === 1) {
      pair(original[0],candidates[0]);
      continue;
    }
    const matched = new Set();
    function uniquePairs(oldKey, newKey) {
      const unmatched = original.filter(item => !stopIds.has(item.id));
      for (const item of unmatched) {
        const key = oldKey(item);
        const possible = candidates.filter(row => !matched.has(row.id) && newKey(row) === key);
        if (possible.length !== 1 || unmatched.filter(other => oldKey(other) === key).length !== 1) continue;
        pair(item,possible[0]);
        matched.add(possible[0].id);
      }
    }
    const unchangedVisit = ({ id, tripId, placeId, ...content }) => canonical(content);
    uniquePairs(unchangedVisit,unchangedVisit);
    uniquePairs(item => oldDates.get(item.id),item => newDates.get(item.id));
    const ambiguous = candidates.filter(item => !matched.has(item.id));
    if (!ambiguous.length) continue;
    for (const item of original.filter(item => !stopIds.has(item.id))) protectedSource.add(item.id);
    for (const item of ambiguous) protectedLocal.add(item.id);
  }
  if (!dayIds.size || !stopIds.size)
    throw Error("This older file does not provide enough matching days and visits to verify the copy.");
  return { sourceTripId:sourceId, dayIds, stopIds, placeIds, protectedSource, protectedLocal };
}
