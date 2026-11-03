import { canonical, digest, parseJSON } from "./contracts.js";
import { isOSM } from "./shopping-sources.js";
import { effective } from "./model.js";
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) n++;
    else if (c < 2048) n += 2;
    else if (
      c >= 0xd800 &&
      c <= 0xdbff &&
      s.charCodeAt(i + 1) >= 0xdc00 &&
      s.charCodeAt(i + 1) <= 0xdfff
    ) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
export function preflightFiles(files, max = 30 * 1024 * 1024) {
  if (!Array.isArray(files) || !files.length || files.length > 1000)
    throw Error("Invalid export file count");
  let total = 22;
  const names = new Set();
  for (const f of files) {
    if (
      typeof f.name !== "string" ||
      !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(
        f.name,
      ) ||
      f.name.includes("..") ||
      utf8Length(f.name) > 200 ||
      names.has(f.name.toLowerCase()) ||
      typeof f.content !== "string"
    )
      throw Error("Unsafe or duplicate export filename");
    names.add(f.name.toLowerCase());
    total += utf8Length(f.content) + 76 + 2 * utf8Length(f.name);
    if (total > max)
      throw Error(
        "Export exceeds30MiB. Use a smaller selection or JSON backup with its immutable source offer.",
      );
  }
  return total;
}
export function savedOSMVersions(state) {
  const versions = new Set();
  for (const p of state.places.filter((p) => isOSM(p.snapshot))) {
    if (!p.sourceRef?.datasetVersion)
      throw Error(
        "Historical OSM source version is unknown; JSON preserves the original snapshot and offer.",
      );
    versions.add(p.sourceRef.datasetVersion);
  }
  for (const st of state.stops.filter((st) => isOSM(st.placeSnapshot))) {
    const local = state.places.find((p) => p.id === st.placeId);
    const v =
      st.sourceDatasetVersion ||
      (local?.sourceRef &&
      canonical(st.placeSnapshot) === canonical(effective(local))
        ? local.sourceRef.datasetVersion
        : null);
    if (!v)
      throw Error(
        "Historical OSM visit source version is unknown; retain the JSON snapshot and immutable offer.",
      );
    versions.add(v);
  }
  return [...versions];
}
export async function completeOSMFiles(versions, resolve) {
  const files = [];
  for (const version of new Set(versions)) {
    const p = await resolve(version);
    if (!p || p.feed.datasetVersion !== version)
      throw Error(
        "Exact historical OSM source " +
          version +
          " is not cached. JSON retains its original snapshots/notices and immutable source offer; do not substitute current data.",
      );
    const root = "osm-source/" + version.replace("sha256:", "") + "/";
    const entries = {
      ...p.resources,
      "shopping-osm.v1.json": JSON.stringify(p.feed) + "\n",
    };
    for (const d of p.manifest.files) {
      const text = entries[d.path];
      if (
        typeof text !== "string" ||
        utf8Length(text) !== d.bytes ||
        (await digest(text)).slice(7) !== d.sha256
      )
        throw Error("Historical source component is incomplete: " + d.path);
      files.push({ name: root + d.path, content: text });
    }
    files.push({
      name: root + "package-inventory.v1.json",
      content: p.inventoryText,
    });
  }
  return files;
}
export async function completeBackupFiles(data, resolve) {
  parseJSON(JSON.stringify(data));
  const files = [{ name: "trip/backup.json", content: JSON.stringify(data) }];
  files.push(...(await completeOSMFiles(savedOSMVersions(data), resolve)));
  preflightFiles(files);
  return files;
}
export function selectionGroups(input) {
  const groups = { overture: [], osm: [], other: [] };
  for (const p of input.places) {
    const id = p.placeKey.startsWith("shopping:osm:")
      ? "osm"
      : p.placeKey.startsWith("shopping:")
        ? "overture"
        : "other";
    groups[id].push(p);
  }
  return groups;
}
export function visitVersion(state, stop) {
  const local = state.places.find((p) => p.id === stop.placeId);
  return (
    stop.sourceDatasetVersion ||
    (local?.sourceRef &&
    canonical(stop.placeSnapshot) === canonical(effective(local))
      ? local.sourceRef.datasetVersion
      : null)
  );
}
