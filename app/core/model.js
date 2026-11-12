import { categoryFor } from "./shopping-catalog.js";
export const clone = (x) => structuredClone(x);
export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const defaults = {
  dayMinutes: 720,
  lateFinishMinute: 1320,
  longWalkMinutes: 45,
  longWalkKm: 3,
  longTrainKm: 100,
};
export const blank = () => ({
  schemaVersion: 1,
  trips: [],
  days: [],
  stops: [],
  segments: [],
  places: [],
  flags: [],
  settings: {
    theme: "system",
    defaultMode: "walk",
    thresholds: { ...defaults },
  },
  sourceVersions: {},
  imports: {},
});
export const name = (p) =>
  p.names.ja || p.names.en || p.names.romaji || p.address.ja || "Unnamed place";
export const effective = (p) => ({
  ...clone(p.snapshot),
  ...clone(p.overrides),
});
export const visitPlace = (s) => ({
  ...clone(s.placeSnapshot),
  ...clone(s.placeOverrides),
});
export const located = (p) =>
  p.location.lat !== null && p.location.lng !== null;
export const dates = (a, b) => {
  const out = [];
  for (
    let t = Date.parse(a + "T00:00:00Z"), end = Date.parse(b + "T00:00:00Z");
    t <= end;
    t += 86400000
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
export function makeTrip(s, { name: label, startDate, endDate, notes = "" }) {
  const stamp = now(),
    trip = {
      schemaVersion: 1,
      id: id(),
      name: label,
      startDate,
      endDate,
      timeZone: "Asia/Tokyo",
      notes,
      dayIds: [],
      unassignedStopIds: [],
      thresholds: { ...s.settings.thresholds },
      createdAt: stamp,
      updatedAt: stamp,
    };
  for (const date of dates(startDate, endDate)) {
    const day = {
      schemaVersion: 1,
      id: id(),
      tripId: trip.id,
      date,
      startMinute: 540,
      stopIds: [],
    };
    s.days.push(day);
    trip.dayIds.push(day.id);
  }
  s.trips.push(trip);
  return trip;
}
export function changeDates(s, trip, start, end, shift = false) {
  const old = s.days.filter((d) => d.tripId === trip.id),
    keep = [];
  for (const [i, date] of dates(start, end).entries()) {
    let d = shift ? old[i] : old.find((x) => x.date === date);
    if (!d) {
      d = {
        schemaVersion: 1,
        id: id(),
        tripId: trip.id,
        date,
        startMinute: 540,
        stopIds: [],
      };
      s.days.push(d);
    }
    d.date = date;
    keep.push(d.id);
  }
  for (const d of old.filter((d) => !keep.includes(d.id)))
    trip.unassignedStopIds.push(...d.stopIds);
  s.days = s.days.filter((d) => d.tripId !== trip.id || keep.includes(d.id));
  trip.dayIds = keep;
  trip.startDate = start;
  trip.endDate = end;
  trip.updatedAt = now();
  reconcile(s);
}
export function manualPlace(fields = {}) {
  const k = id();
  return {
    schemaVersion: 1,
    key: "manual:" + k,
    sourceId: k,
    names: { ja: null, en: null, romaji: null, branchJa: null },
    address: {
      ja: null,
      en: null,
      prefecture: null,
      city: null,
      postalCode: null,
    },
    category: null,
    location: {
      lat: null,
      lng: null,
      availability: "unknown",
      confidence: "unknown",
      method: null,
      provenance: [],
      verifiedAt: null,
    },
    operatingStatus: { value: "unknown", checkedAt: null, note: null },
    hoursText: null,
    hours: null,
    links: [],
    awards: [],
    memberships: [],
    hallOfFame: null,
    reviewNotes: [],
    provenance: [],
    ...fields,
  };
}
export function ensurePlace(s, p, version = null) {
  let local = s.places.find((l) => l.snapshot.key === p.key);
  if (!local) {
    const stamp = now();
    local = {
      schemaVersion: 1,
      id: p.key.startsWith("manual:") ? p.sourceId : id(),
      sourceRef: p.key.startsWith("manual:")
        ? null
        : {
            key: p.key,
            sourceId: p.sourceId,
            datasetVersion: version || "unknown",
          },
      snapshot: clone(p),
      overrides: {},
      createdAt: stamp,
      updatedAt: stamp,
    };
    s.places.push(local);
  }
  return local;
}
export function flag(s, key, field, value) {
  let f = s.flags.find((f) => f.placeKey === key);
  if (!f) {
    f = {
      schemaVersion: 1,
      placeKey: key,
      favourite: false,
      visited: false,
      updatedAt: null,
    };
    s.flags.push(f);
  }
  f[field] = value;
  f.updatedAt = now();
}
export function addStop(s, day, p, version) {
  const l = ensurePlace(s, p, version),
    stop = {
      schemaVersion: 1,
      id: id(),
      tripId: day.tripId,
      placeId: l.id,
      placeSnapshot: effective(l),
      sourceDatasetVersion: l.sourceRef?.datasetVersion || null,
      placeOverrides: {},
      notes: "",
      durationMinutes: 60,
    };
  s.stops.push(stop);
  day.stopIds.push(stop.id);
  reconcile(s);
  return stop;
}
export function moveStop(s, stopId, toDayId, index) {
  const stop = s.stops.find((x) => x.id === stopId),
    trip = s.trips.find((t) => t.id === stop.tripId);
  for (const d of s.days) d.stopIds = d.stopIds.filter((x) => x !== stopId);
  trip.unassignedStopIds = trip.unassignedStopIds.filter((x) => x !== stopId);
  const to = s.days.find((d) => d.id === toDayId);
  if (to)
    to.stopIds.splice(
      Math.max(0, Math.min(index, to.stopIds.length)),
      0,
      stopId,
    );
  else trip.unassignedStopIds.push(stopId);
  reconcile(s);
}
export function removeStop(s, stopId) {
  s.stops = s.stops.filter((x) => x.id !== stopId);
  for (const d of s.days) d.stopIds = d.stopIds.filter((x) => x !== stopId);
  for (const t of s.trips)
    t.unassignedStopIds = t.unassignedStopIds.filter((x) => x !== stopId);
  reconcile(s);
}
export function removeTrip(s, tripId) {
  s.trips = s.trips.filter((t) => t.id !== tripId);
  s.days = s.days.filter((d) => d.tripId !== tripId);
  s.stops = s.stops.filter((x) => x.tripId !== tripId);
  s.segments = s.segments.filter((x) => x.tripId !== tripId);
}
export function distance(a, b) {
  const r = Math.PI / 180,
    h =
      Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
      Math.cos(a.lat * r) *
        Math.cos(b.lat * r) *
        Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return (
    6371 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)))
  );
}
export const fingerprint = (a, b) => JSON.stringify([a.location, b.location]);
export const routeEndpoints = (a, b) =>
  JSON.stringify([a, b].map((p) => [name(p), p.address.ja, p.location.lat, p.location.lng]));
export function estimate(a, b, mode) {
  if (!located(a) || !located(b)) return null;
  const km = distance(a.location, b.location),
    [detour, speed, allowance] = {
      walk: [1.25, 4, 0],
      train: [1.3, 45, 20],
      drive: [1.35, 35, 10],
    }[mode];
  const minutes = Math.ceil(((km * detour) / speed) * 60 + allowance);
  return minutes > 10080 ? null : minutes;
}
export const segmentKey = (x) =>
  [x.tripId, x.fromStopId, x.toStopId, x.mode].join("|");
export function reconcile(s) {
  const active = [];
  for (const d of s.days) {
    for (let i = 1; i < d.stopIds.length; i++) {
      const from = s.stops.find((x) => x.id === d.stopIds[i - 1]),
        to = s.stops.find((x) => x.id === d.stopIds[i]);
      if (!from || !to) continue;
      const a = visitPlace(from),
        b = visitPlace(to);
      let seg = s.segments.find(
        (x) =>
          x.tripId === d.tripId &&
          x.fromStopId === from.id &&
          x.toStopId === to.id,
      );
      if (!seg)
        seg = {
          schemaVersion: 1,
          tripId: d.tripId,
          fromStopId: from.id,
          toStopId: to.id,
          mode: s.settings.defaultMode,
          estimatedMinutes: null,
          manualMinutes: null,
          estimateModel: "rough-v1",
          coordinateFingerprint: "",
          overrideFingerprint: null,
        };
      seg.estimatedMinutes = estimate(a, b, seg.mode);
      seg.coordinateFingerprint = fingerprint(a, b);
      active.push(seg);
    }
  }
  s.segments = active;
}
export function setMode(s, seg, mode) {
  seg.mode = mode;
  seg.manualMinutes = null;
  seg.overrideFingerprint = null;
  delete seg.routeCheck;
  reconcile(s);
}
export function checkedRouteApplies(check, date, minute, endpoints) {
  return minute !== null && check.date === date &&
    check.departMinute >= minute && check.endpoints === endpoints;
}
export function schedule(s, day) {
  let minute = day.startMinute;
  return day.stopIds.map((stopId, i) => {
    const stop = s.stops.find((x) => x.id === stopId),
      segment = i
        ? s.segments.find(
            (x) => x.fromStopId === day.stopIds[i - 1] && x.toStopId === stopId,
          )
        : null;
    const check = segment?.routeCheck;
    const missed = check && !checkedRouteApplies(
      check, day.date, minute,
      routeEndpoints(visitPlace(s.stops.find((x) => x.id === segment.fromStopId)), visitPlace(stop)),
    );
    const travel = segment
      ? (missed ? segment.estimatedMinutes : (segment.manualMinutes ?? segment.estimatedMinutes))
      : 0;
    const routeWait = check && !missed ? check.departMinute - minute : 0;
    if (minute !== null) minute += routeWait;
    minute = minute === null || travel === null ? null : minute + travel;
    const arrival = minute;
    const start = arrival === null ? null : (
      day.planEndMinute === undefined ? Math.max(arrival, stop.fixedStartMinute ?? arrival)
        : planningStart(stop, visitPlace(stop), day.date, arrival, day.planEndMinute)
    );
    // Keep displaying the computed itinerary if later edits introduce conflicts.
    const visitStart = start ?? arrival;
    minute = visitStart === null ? null : visitStart + stop.durationMinutes;
    return { stop, segment, travel, arrival, visitStart, departure: minute,
      routeWait, missed, timingConflict: start === null && arrival !== null };
  });
}
export function timeLabel(date, minutes) {
  if (minutes === null) return "Time unknown";
  const stamp = new Date(Date.parse(date + "T00:00:00Z") + minutes * 60000);
  return (
    (stamp.toISOString().slice(0, 10) !== date
      ? stamp.toISOString().slice(5, 10) + " "
      : "") + stamp.toISOString().slice(11, 16)
  );
}
function hoursSpans(hours, date, start, end) {
  const base = Date.parse(date + "T00:00:00Z"),
    week = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  let spans = [],
    unknown = [];
  for (
    let offset = Math.floor(start / 1440) - 1;
    offset <= Math.floor(end / 1440);
    offset++
  ) {
    const dt = new Date(base + offset * 86400000),
      key = dt.toISOString().slice(0, 10),
      rule = Object.hasOwn(hours.exceptions, key)
        ? hours.exceptions[key]
        : hours.weekly[week[dt.getUTCDay()]];
    if (rule === null) unknown.push([offset * 1440, (offset + 1) * 1440]);
    else
      for (const r of rule)
        spans.push([
          offset * 1440 + r.startMinute,
          offset * 1440 + r.endMinute,
        ]);
  }
  // Date-specific closure clips all overnight spill into that calendar date.
  for (let o = Math.floor(start / 1440); o <= Math.floor(end / 1440); o++) {
    const key = new Date(base + o * 86400000).toISOString().slice(0, 10);
    if (
      Array.isArray(hours.exceptions[key]) &&
      hours.exceptions[key].length === 0
    ) {
      const l = o * 1440,
        r = l + 1440;
      spans = spans.flatMap(([a, b]) =>
        b <= l || a >= r
          ? [[a, b]]
          : [
              [a, Math.min(b, l)],
              [Math.max(a, r), b],
            ].filter(([x, y]) => x < y),
      );
    }
  }
  return { spans, unknown };
}
export function hoursResult(hours, date, start, end) {
  if (!hours || start === null || end === null) return "Hours not checked";
  const { spans, unknown } = hoursSpans(hours, date, start, end);
  const target = end === start ? end + 0.001 : end;
  const covers = (ranges) => {
    let at = start;
    for (const [a, b] of ranges.sort((x, y) => x[0] - y[0])) {
      if (b <= at) continue;
      if (a > at) return false;
      at = Math.max(at, b);
      if (at >= target) return true;
    }
    return false;
  };
  if (covers([...spans])) return "Within recorded hours · confirm";
  if (covers([...spans, ...unknown])) return "Hours not checked";
  return "Outside recorded hours";
}
export function planningStart(stop, place, date, arrival, finishBy) {
  const fixed = stop.fixedStartMinute;
  const earliest = fixed ?? arrival;
  const latest = finishBy - stop.durationMinutes;
  if (earliest < arrival || earliest > latest ||
      ["closed", "relocated"].includes(place.operatingStatus.value)) return null;
  const hours = place.hours;
  const trusted = hours && (hours.checkedAt || Object.hasOwn(stop.placeOverrides, "hours"));
  if (!trusted) return earliest;
  const candidates = fixed !== undefined ? [fixed] : [
    earliest,
    ...hoursSpans(hours, date, earliest, finishBy).spans
      .map(([start]) => start)
      .filter((start) => start > earliest && start <= latest)
      .sort((a, b) => a - b),
  ];
  return candidates.find((start) =>
    hoursResult(hours, date, start, start + stop.durationMinutes) !== "Outside recorded hours",
  ) ?? null;
}
export function warnings(s, day, trip) {
  const rows = schedule(s, day),
    out = [];
  if (!rows.length) return out;
  const end = rows.at(-1).departure;
  if (end === null) out.push("Finish unknown — enter missing travel times.");
  else {
    if (end - day.startMinute > trip.thresholds.dayMinutes)
      out.push("Long day — review the planned duration.");
    if (end > trip.thresholds.lateFinishMinute)
      out.push("Late finish in Japan time.");
    if (day.planEndMinute !== undefined && end > day.planEndMinute)
      out.push("The itinerary exceeds your finish-by time.");
    const next = s.days.find(
      (d) =>
        d.tripId === trip.id &&
        d.date ===
          new Date(Date.parse(day.date + "T00:00:00Z") + 86400000)
            .toISOString()
            .slice(0, 10),
    );
    if (next && end > 1440 + next.startMinute)
      out.push("This day overlaps the next day’s start.");
  }
  for (const row of rows) {
    const p = visitPlace(row.stop);
    if (row.timingConflict || (row.arrival !== null && row.stop.fixedStartMinute !== undefined &&
        row.arrival > row.stop.fixedStartMinute))
      out.push("Review the timing for " + name(p) + ".");
    if (hoursResult(p.hours, day.date, row.visitStart, row.departure) === "Outside recorded hours" ||
        ["closed", "relocated"].includes(p.operatingStatus.value))
      out.push("Opening conflict at " + name(p) + ".");
    if (row.missed) out.push("A checked route needs review after a timing or location change.");
    if (!row.segment) continue;
    const a = visitPlace(s.stops.find((x) => x.id === row.segment.fromStopId)),
      b = visitPlace(row.stop),
      km = located(a) && located(b) ? distance(a.location, b.location) : null;
    if (
      row.segment.mode === "walk" &&
      ((row.travel ?? 0) > trip.thresholds.longWalkMinutes ||
        (km ?? 0) > trip.thresholds.longWalkKm)
    )
      out.push("Long walk — verify access and conditions.");
    if (
      row.segment.mode === "train" &&
      ((km ?? 0) >= trip.thresholds.longTrainKm || (row.travel ?? 0) >= 120)
    )
      out.push(
        "Verify intercity journey in a timetable — no Shinkansen or winter feasibility assumed.",
      );
  }
  return [...new Set(out)];
}
export function nearby(p, origins) {
  return located(p) && origins.length
    ? Math.min(...origins.map((o) => distance(o, p.location)))
    : null;
}
export function filterPlaces(
  feed,
  f,
  origins,
  scheduled = new Set(),
  flags = [],
) {
  const lm = new Map(feed.lists.map((l) => [l.listId, l])),
    saved = new Map(flags.map((x) => [x.placeKey, x]));
  let rows = feed.places
    .filter((p) => {
      if (!f.includeScheduled && scheduled.has(p.key)) return false;
      if (f.saved && !saved.get(p.key)?.favourite) return false;
      if (f.visited && !saved.get(p.key)?.visited) return false;
      if (f.prefecture && p.address.prefecture !== f.prefecture) return false;
      if (
        f.region &&
        feed.source.namespace === "saunachelin" &&
        !(regions[f.region] || []).includes(p.address.prefecture)
      )
        return false;
      const q = (f.q || "").normalize("NFKC").toLowerCase();
      if (
        q &&
        !Object.values({ ...p.names, ...p.address })
          .filter(Boolean)
          .join(" ")
          .normalize("NFKC")
          .toLowerCase()
          .includes(q)
      )
        return false;
      if (feed.source.namespace === "shopping") {
        if (f.includeClosed === false && p.operatingStatus.value === "closed")
          return false;
        return (
          (!f.shopCategories?.length ||
            f.shopCategories.includes(categoryFor(p.shopping.brandId))) &&
          (!f.brands?.length || f.brands.includes(p.shopping.brandId)) &&
          (!f.formats?.length || f.formats.includes(p.shopping.formatId))
        );
      }
      if (feed.source.namespace === "tabelog")
        return p.memberships.some((m) => {
          const l = lm.get(m.listId);
          return (
            (!f.categories.length || f.categories.includes(l.category)) &&
            (!f.years.length || f.years.includes(String(l.year))) &&
            (!f.region || l.region === f.region) &&
            (!f.listId || l.listId === f.listId) &&
            (!f.first || m.firstTimePick)
          );
        });
      return (
        (!f.hof || p.hallOfFame) &&
        (!f.multi ||
          new Set(
            p.awards
              .filter((a) => a.type !== "hall_of_fame")
              .map((a) => a.year),
          ).size > 1) &&
        p.awards.some(
          (a) =>
            (!f.years.length || f.years.includes(String(a.year))) &&
            (a.type === "ranked" ||
              (f.special && a.type === "special") ||
              (f.hof && a.type === "hall_of_fame")),
        )
      );
    })
    .map((p) => ({ p, km: nearby(p, origins) }));
  const unknown = rows.filter((x) => !located(x.p));
  rows = rows
    .filter(
      (x) => located(x.p) && (!f.radius || (x.km !== null && x.km <= f.radius)),
    )
    .sort(
      (a, b) =>
        (a.km ?? Infinity) - (b.km ?? Infinity) ||
        name(a.p).localeCompare(name(b.p), "ja"),
    );
  return { rows, unknown };
}
export const regions = {
  Hokkaido: ["Hokkaido"],
  Tohoku: ["Aomori", "Iwate", "Miyagi", "Akita", "Yamagata", "Fukushima"],
  Kanto: [
    "Ibaraki",
    "Tochigi",
    "Gunma",
    "Saitama",
    "Chiba",
    "Tokyo",
    "Kanagawa",
  ],
  Chubu: [
    "Niigata",
    "Toyama",
    "Ishikawa",
    "Fukui",
    "Yamanashi",
    "Nagano",
    "Gifu",
    "Shizuoka",
    "Aichi",
  ],
  Kansai: ["Mie", "Shiga", "Kyoto", "Osaka", "Hyogo", "Nara", "Wakayama"],
  Chugoku: ["Tottori", "Shimane", "Okayama", "Hiroshima", "Yamaguchi"],
  Shikoku: ["Tokushima", "Kagawa", "Ehime", "Kochi"],
  Kyushu: [
    "Fukuoka",
    "Saga",
    "Nagasaki",
    "Kumamoto",
    "Oita",
    "Miyazaki",
    "Kagoshima",
    "Okinawa",
  ],
};
export const presets = {
  Tokyo: [35.6812, 139.7671],
  Sendai: [38.2602, 140.8824],
  Yamagata: [38.2486, 140.3273],
  Matsushima: [38.3682, 141.0615],
  Hakodate: [41.7739, 140.7264],
};
export function safeURL(s) {
  try {
    const u = new URL(s);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      s.length <= 2048
      ? u.href
      : null;
  } catch {
    return null;
  }
}
const destination = (p) =>
  p.address.ja && (p.location.confidence !== "high" || !located(p))
    ? name(p) + " " + p.address.ja
    : located(p)
      ? p.location.lat + "," + p.location.lng
      : name(p) + " " + (p.address.ja || p.address.city || "");
export function directions(a, b, mode) {
  return (
    "https://www.google.com/maps/dir/?" +
    new URLSearchParams({
      api: "1",
      origin: destination(a),
      destination: destination(b),
      travelmode: { walk: "walking", train: "transit", drive: "driving" }[mode],
    })
  );
}
export function parseCoordinates(raw) {
  const match = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const [lat, lng] = match.slice(1).map(Number);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
export function parseMapURL(raw) {
  const safe = safeURL(raw);
  if (!safe) return null;
  const u = new URL(safe);
  return ["www.google.com", "maps.google.com", "www.google.co.jp"].includes(
    u.hostname,
  ) &&
    u.pathname === "/maps/search/" &&
    u.searchParams.get("api") === "1" &&
    !u.searchParams.has("query_place_id")
    ? parseCoordinates(u.searchParams.get("query") || "")
    : null;
}
