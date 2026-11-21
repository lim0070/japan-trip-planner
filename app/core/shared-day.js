const marker = "#day1=";
const byteLimit = 1140;
const fragmentLimit = 1520;
const visitLimit = 18;

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const time = "(?:(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]) )?(?:[01][0-9]|2[0-3]):[0-5][0-9]";
const timeRange = new RegExp(`^${time}–${time}$`);
function validDay(view) {
  if (!exactKeys(view, ["v", "date", "visits"]) || view.v !== 1 ||
      typeof view.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(view.date)) return false;
  const date = new Date(view.date + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === view.date &&
    Array.isArray(view.visits) && view.visits.length <= visitLimit &&
    view.visits.every(visit => exactKeys(visit, ["name", "time"]) &&
      typeof visit.name === "string" && visit.name.trim() && visit.name.length <= 120 &&
      !/[\u0000-\u001f\u007f]/u.test(visit.name) &&
      (visit.time === "Time unknown" || (typeof visit.time === "string" && timeRange.test(visit.time))));
}

export function encodeSharedDay(view) {
  if (Array.isArray(view?.visits) && view.visits.length > visitLimit)
    throw Error("This day is too large for a link. Use the HTML file instead.");
  if (!validDay(view)) throw Error("Invalid shared day.");
  const bytes = new TextEncoder().encode(JSON.stringify(view));
  if (bytes.length > byteLimit) throw Error("This day is too large for a link. Use the HTML file instead.");
  return marker + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeSharedDay(fragment) {
  if (typeof fragment !== "string" || !fragment.startsWith(marker) ||
      fragment.length > marker.length + fragmentLimit) throw Error("Invalid shared day link.");
  const encoded = fragment.slice(marker.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1)
    throw Error("Invalid shared day link.");
  try {
    const raw = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    if (raw.length > byteLimit) throw Error();
    const view = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, char => char.charCodeAt(0))));
    if (!validDay(view)) throw Error();
    return view;
  } catch {
    throw Error("Invalid shared day link.");
  }
}
