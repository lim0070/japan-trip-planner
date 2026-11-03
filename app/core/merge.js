import { clone, id, now, blank } from "./model.js";
import {
  validateBackup,
  validateLegacy,
  digest,
  validateState,
} from "./contracts.js";
export function backup(s, tripId = null, aliases = new Map()) {
  const data = clone(s);
  delete data.imports;
  if (tripId) {
    const allKeys = new Set([
      ...s.places.map((p) => p.snapshot.key),
      ...s.stops.map((x) => x.placeSnapshot.key),
      ...s.places.map((p) => p.sourceRef?.key).filter(Boolean),
    ]);
    data.trips = data.trips.filter((t) => t.id === tripId);
    data.days = data.days.filter((d) => d.tripId === tripId);
    data.stops = data.stops.filter((x) => x.tripId === tripId);
    data.segments = data.segments.filter((x) => x.tripId === tripId);
    const ids = new Set(data.stops.map((x) => x.placeId));
    data.places = data.places.filter((p) => ids.has(p.id));
    const keys = new Set([
      ...data.places.map((p) => p.snapshot.key),
      ...data.stops.map((x) => x.placeSnapshot.key),
      ...data.places.map((p) => p.sourceRef?.key).filter(Boolean),
    ]);
    for (const key of [...keys])
      for (const member of aliases.get(key)?.memberKeys || []) keys.add(member);
    data.flags = data.flags.filter(
      (f) => keys.has(f.placeKey) || !allKeys.has(f.placeKey),
    );
  }
  return {
    schemaVersion: 1,
    kind: tripId ? "trip" : "full",
    exportId: id(),
    exportedAt: now(),
    appVersion: "2.4.2",
    ...data,
  };
}
export async function previewImport(s, data) {
  const legacy = data.kind === "standalone-flags";
  legacy ? validateLegacy(data) : validateBackup(data);
  const hash = await digest(data);
  const conflicts = legacy
    ? data.flags.filter((f) => {
        const old = s.flags.find(
          (x) => x.placeKey === data.source + ":" + f.sourceId,
        );
        return (
          old && (old.favourite !== f.favourite || old.visited !== f.visited)
        );
      }).length
    : data.trips.filter((t) => s.trips.some((x) => x.id === t.id)).length;
  return {
    hash,
    legacy,
    conflicts,
    already: !!s.imports[hash],
    message: legacy
      ? `${data.flags.length} flags; ${conflicts} differing records. Default merges true flags without clearing existing flags.`
      : `${data.trips.length} trips, ${data.stops.length} visits, ${data.places.length} places. ${conflicts} existing trip IDs. Different trips are copied with new IDs; existing edits are preserved. Personal notes are included.`,
  };
}
export function mergeImport(s, data, preview, flagPolicy = "merge") {
  if (preview.already || s.imports[preview.hash]) return s;
  if (preview.legacy) {
    for (const f of data.flags) {
      const key = data.source + ":" + f.sourceId;
      let old = s.flags.find((x) => x.placeKey === key);
      if (!old) {
        s.flags.push({
          schemaVersion: 1,
          placeKey: key,
          favourite: f.favourite,
          visited: f.visited,
          updatedAt: null,
        });
        continue;
      }
      for (const k of ["favourite", "visited"])
        if (flagPolicy === "incoming") old[k] = f[k];
        else if (flagPolicy === "merge") old[k] ||= f[k];
    }
  } else {
    s.dataLicenses = {
      ...(s.dataLicenses || {}),
      ...(data.dataLicenses || {}),
    };
    s.sourceVersions = { ...data.sourceVersions, ...s.sourceVersions };
    // Compare the complete trip closure before deciding a repeated ID is identical.
    const closure = (state, t) =>
      JSON.stringify({
        t,
        days: state.days.filter((x) => x.tripId === t.id),
        stops: state.stops.filter((x) => x.tripId === t.id),
        segments: state.segments.filter((x) => x.tripId === t.id),
      });
    const placeMap = new Map();
    for (const p of data.places) {
      const old = s.places.find((x) => x.id === p.id);
      if (old && JSON.stringify(old) === JSON.stringify(p)) {
        placeMap.set(p.id, p.id);
        continue;
      }
      const cp = clone(p);
      if (old) cp.id = id();
      placeMap.set(p.id, cp.id);
      s.places.push(cp);
    }
    for (const t of data.trips) {
      const old = s.trips.find((x) => x.id === t.id);
      if (old && closure(s, old) === closure(data, t)) continue;
      const remap = !!old,
        tid = remap ? id() : t.id,
        dayMap = new Map(),
        stopMap = new Map();
      for (const d of data.days.filter((d) => d.tripId === t.id))
        dayMap.set(
          d.id,
          remap || s.days.some((x) => x.id === d.id) ? id() : d.id,
        );
      for (const st of data.stops.filter((st) => st.tripId === t.id))
        stopMap.set(
          st.id,
          remap || s.stops.some((x) => x.id === st.id) ? id() : st.id,
        );
      s.trips.push({
        ...clone(t),
        id: tid,
        name: remap ? t.name + " (imported copy)" : t.name,
        dayIds: t.dayIds.map((x) => dayMap.get(x)),
        unassignedStopIds: t.unassignedStopIds.map((x) => stopMap.get(x)),
      });
      s.days.push(
        ...data.days
          .filter((d) => d.tripId === t.id)
          .map((d) => ({
            ...clone(d),
            id: dayMap.get(d.id),
            tripId: tid,
            stopIds: d.stopIds.map((x) => stopMap.get(x)),
          })),
      );
      s.stops.push(
        ...data.stops
          .filter((st) => st.tripId === t.id)
          .map((st) => ({
            ...clone(st),
            id: stopMap.get(st.id),
            tripId: tid,
            placeId: placeMap.get(st.placeId),
          })),
      );
      s.segments.push(
        ...data.segments
          .filter((x) => x.tripId === t.id)
          .map((x) => ({
            ...clone(x),
            tripId: tid,
            fromStopId: stopMap.get(x.fromStopId),
            toStopId: stopMap.get(x.toStopId),
          })),
      );
    }
    for (const f of data.flags) {
      const old = s.flags.find((x) => x.placeKey === f.placeKey);
      if (old) {
        old.favourite ||= f.favourite;
        old.visited ||= f.visited;
      } else s.flags.push(clone(f));
    }
    // Imported settings never silently replace current preferences.
  }
  s.imports[preview.hash] = now();
  validateState(s);
  return s;
}
