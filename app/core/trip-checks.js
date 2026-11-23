import * as M from "./model.js";
import { travelVisit } from "./timetable.js";
import { transitStatus } from "../transit-tools.js";
import { findDirectionStation, jorudanDirections } from "./direction-search.js";

function railLinks(day, row, from, to, recordedUrl = null, label = "Recorded operator or route source") {
  const check = row.segment?.routeCheck, first = check?.legs?.[0], last = check?.legs?.at(-1);
  const station = place => Object.values(place?.names ?? {}).map(name => findDirectionStation(name)).find(Boolean)?.name || "";
  const start = first?.from || station(from);
  const end = last?.to || station(to);
  const minute = row.routeDeparture ?? check?.departMinute ?? day.startMinute;
  const stamp = new Date(Date.parse(day.date+"T00:00:00Z") + minute*60000).toISOString();
  const url = jorudanDirections(start,end,{when:"depart",date:stamp.slice(0,10),time:stamp.slice(11,16)});
  const source = recordedUrl ?? first?.source?.url;
  return { url, needsStations:!start || !end, source:M.safeURL(source) ? source : null, label };
}

export function collectTripChecks(state, trip) {
  const byId = new Map(state.days.map(day => [day.id, day]));
  const groups = [];
  for (const dayId of trip.dayIds) {
    const day = byId.get(dayId);
    if (!day) continue;
    const rows = M.schedule(state, day), summary = M.dayTravel(day, rows), checks = [];
    const transfers = new Set();
    const add = (kind, message, stopId = null, target = "day", rail = null) => checks.push({kind,message,stopId,target,rail});
    const checkInterchanges = (route, stopId, target, row = {}) => {
      const legs = route?.legs ?? [];
      for (let i = 1; i < legs.length; i++) {
        const previous = legs[i-1], leg = legs[i];
        const available = leg.depart-previous.arrive;
        const required = (leg.transferWalk ?? 0)+(leg.margin ?? 0);
        const spare = available-required;
        const key = [previous.to,leg.from,previous.arrive,leg.depart].join("|");
        if (spare > 5 || transfers.has(key)) continue;
        transfers.add(key);
        const station = previous.to === leg.from ? leg.from : previous.to + " → " + leg.from;
        add("Transfer", `Short interchange at ${station} · ${M.timeLabel(day.date,previous.arrive)}–${M.timeLabel(day.date,leg.depart)}` +
          ` · ${available} min scheduled${previous.arrivalBound ? " using the alight-by bound" : ""}, ${required} min required` +
          ` · ${spare < 0 ? `${-spare} min short` : `${spare} min spare`}`, stopId,target,
          railLinks(day,{...row,segment:{routeCheck:route}},null,null,leg.source?.url,
            leg.source?.publisher || "Recorded timetable source"));
      }
    };
    if (day.planStartAnchor && (summary.outbound?.minutes === null || summary.outbound?.stale))
      add("Travel", "Review the start anchor and its route.", null, "planning");
    if (day.planEndAnchor && (summary.inbound?.minutes === null || summary.inbound?.stale))
      add("Travel", "Review the return anchor and its route.", null, "planning");
    if (summary.outbound?.stale === false) checkInterchanges(day.planStartAnchor?.routeCheck,null,"planning");
    if (summary.inbound?.stale === false) checkInterchanges(day.planEndAnchor?.routeCheck,null,"planning");
    const cutoff = M.dayDeadline(day);
    if (summary.finish !== null && cutoff !== undefined && summary.finish > cutoff)
      add("Timing", "The day finishes after its saved deadline.");
    if (summary.finish !== null && summary.finish > trip.thresholds.lateFinishMinute)
      add("Timing", "The day finishes after the trip’s late-finish threshold.");
    for (const row of rows) {
      const { stop, segment } = row, place = M.visitPlace(stop), venue = M.name(place), walkingPlace = M.visitDestination(stop);
      if (segment) {
        const route = transitStatus(row,day,state);
        const travel = row.missed ? "Saved route needs review after a timing or endpoint change" :
          route?.missesLast ? "Planned departure is after the recorded last service" :
          route && !route.stale && route.evidence.status === "suspended" ? "Service recorded as suspended" :
          row.travel === null ? "Travel time unknown" :
          segment.mode === "train" && !segment.routeCheck ? "Train timing needs a timetable check" :
          segment.manualMinutes !== null && segment.overrideFingerprint !== segment.coordinateFingerprint ? "Review minutes after a place change" : null;
        if (travel) {
          const previous = state.stops.find(item=>item.id===segment.fromStopId);
          const rail = segment.mode === "train" ? railLinks(day,row,previous && M.visitDestination(previous),walkingPlace,
            route?.evidence.sourceUrl,route?.stale ? "Earlier route source · recheck required" : undefined) : null;
          add("Travel", `${travel} · toward ${venue}`, stop.id, "leg", rail);
        }
        if (!row.missed) checkInterchanges(segment.routeCheck,stop.id,"leg",row);
      }
      const fixed = stop.fixedStartMinute ?? day.planVisitStarts?.[stop.id];
      if (fixed !== undefined && (row.arrival === null || row.arrival > fixed))
        add("Timing", `${row.arrival === null ? "Arrival unknown for fixed visit" : "Arrival is after the fixed visit start"} · ${venue}`, stop.id, "visit");
      if (!travelVisit(place)) {
        if (!M.located(walkingPlace)) add("Location", `Location unknown · ${venue}`, stop.id, "visit");
        else if (!stop.entrance && walkingPlace.location.confidence !== "high")
          add("Location", `Confirm the entrance at the approximate pin · ${venue}`, stop.id, "visit");
        const hours = M.visitHoursNotice(place, day.date, row);
        if (hours) add("Hours", `${hours} · ${venue}`, stop.id, "visit");
      }
    }
    if (dayId === trip.dayIds[0] && trip.unassignedStopIds.length)
      add("Itinerary", `${trip.unassignedStopIds.length} unassigned ${trip.unassignedStopIds.length===1?"visit":"visits"}`, null, "unassigned");
    if (checks.length) groups.push({day,checks});
  }
  return groups;
}

export function checkDayHash(dayId, stopId, target) {
  const params = new URLSearchParams({day:dayId, check:target});
  if (stopId) params.set("visit",stopId);
  return "#day?" + params;
}

export function readCheckDayHash(hash, state) {
  if (!hash.startsWith("#day?")) return null;
  const params = new URLSearchParams(hash.slice(5));
  const day = state.days.find(day => day.id === params.get("day"));
  if (!day) return null;
  const target = params.get("check"), stopId = params.get("visit");
  if (!["day","planning","unassigned","visit","leg"].includes(target) ||
      (["visit","leg"].includes(target) && !day.stopIds.includes(stopId))) return null;
  return {day, target, stopId};
}
