import { manualPlace } from "./model.js";
import { fold } from "./place-search.js";

export const tramPackLimit = 512 * 1024;
export const tramLine = "Hakodate City Tram";
export const tramTransfersUrl = "https://www.city.hakodate.hokkaido.jp/docs/2014012100960/";
const isText = (value, limit = 120) =>
  typeof value === "string" && !!value.trim() && value.length <= limit && !/[\u0000-\u001f]/u.test(value);
const isDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(value + "T00:00:00Z");
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
};
const isInt = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max;
const validUrl = value => {
  try {
    const link = new URL(value);
    return isText(value, 2048) && link.protocol === "https:" && !link.username && !link.password;
  } catch { return false; }
};
const coordinates = (lat, lng) => (lat === null && lng === null) ||
  (Number.isFinite(lat) && Number.isFinite(lng) && lat >= 41.6 && lat <= 42.0 && lng >= 140.5 && lng <= 141);
const stopId = (group, id) => group + "-" + id;
const codePattern = /^(?:DY\d{2}|[DY]\d{2})$/u;
const aliasKey = value => fold(value).replace(/[āīūēō]/gu, letter => "aiueo"["āīūēō".indexOf(letter)])
  .replace(/[\s\p{Dash_Punctuation}]+/gu, "");
const idPattern = /^[a-zA-Z0-9_-]{1,40}$/u;

export function compileTramPack(pack, { imported = false } = {}) {
  if (!object(pack) || pack.kind !== "hakodate-tram-timetable" || pack.schemaVersion !== 1)
    throw Error("Choose a Hakodate tram timetable JSON file.");
  const { source, coverage } = pack;
  if (!object(source) || !isText(source.publisher, 160) || !validUrl(source.url) ||
      !isText(source.license, 80) || !validUrl(source.licenseUrl) || !isText(source.note, 850))
    throw Error("The timetable needs a publisher, a source link and a licence.");
  const evidence = {
    publisher: source.publisher, url: source.url, license: source.license, licenseUrl: source.licenseUrl,
    note: source.note + (imported ? " Timetable imported on this device." : ""),
  };
  let locationSource = evidence;
  if (pack.locationSource !== undefined) {
    const { publisher, url, license, licenseUrl, note } = pack.locationSource ?? {};
    if (!isText(publisher, 160) || !validUrl(url) || !isText(license, 80) ||
        !validUrl(licenseUrl) || !isText(note, 850))
      throw Error("Stop positions need a publisher, a source link and a licence.");
    locationSource = { publisher, url, license, licenseUrl, note };
  }
  const within = day => isDate(day) && day >= coverage.start && day <= coverage.end;
  if (!object(coverage) || !isDate(coverage.start) || !within(coverage.end) ||
      Date.parse(coverage.end) - Date.parse(coverage.start) > 366 * 86400000 ||
      !list(pack.calendars, 1, 32))
    throw Error("The timetable needs bounded service dates.");
  const calendars = pack.calendars.map(calendar => {
    if (!object(calendar) || !within(calendar.start) || !within(calendar.end) || calendar.start > calendar.end ||
        !list(calendar.days, 0, 7) || !calendar.days.every(day => isInt(day, 6)) ||
        !object(calendar.exceptions) || Object.keys(calendar.exceptions).length > 367 ||
        !Object.entries(calendar.exceptions).every(([day, enabled]) =>
          within(day) && day >= calendar.start && day <= calendar.end && typeof enabled === "boolean"))
      throw Error("The timetable contains an invalid service calendar.");
    return calendar;
  });
  if (!list(pack.stops, 2, 120) || !list(pack.trips, 1, 2000) || !list(pack.transfers, 0, 500))
    throw Error("The timetable has an unsupported number of stops, trips or transfers.");
  const groups = new Map(), ids = new Set();
  const splitDirections = !imported && pack.intermediateArrivalBound === true;
  const inputStops = pack.stops.map(row => {
    if (!list(row, 7, 7)) throw Error("The timetable contains an invalid stop.");
    const [id, code, ja, en, kana, lat, lng] = row;
    if (typeof id !== "string" || !idPattern.test(id) || ids.has(id) ||
        typeof code !== "string" || !codePattern.test(code) ||
        !isText(ja) || !isText(en) || !isText(kana) || !coordinates(lat, lng))
      throw Error("The timetable contains an invalid or duplicate stop.");
    ids.add(id);
    const group = "hakodate-tram-" + code.toLowerCase();
    const name = en + " tram stop";
    const aliases = [...new Set([ja, ja + "電停", en, kana, kana + "でんてい", code, name,
      en.replace(/-/g, " "), en.replace(/[- ]/g, ""), ...(code === "D21" ? ["Suehirocho"] : [])])];
    const entry = groups.get(code);
    if (entry && (entry.ja !== ja || entry.en !== en || entry.kana !== kana))
      throw Error("Platforms with the same stop code need matching names.");
    const station = { id: stopId(group, id), name, aliases, platformGroup: group, lat, lng, boarding: 4, transfer: 4 };
    const directions = splitDirections
      ? { east: { ...station, id: station.id + "-east" }, west: { ...station, id: station.id + "-west" } }
      : { east: station, west: station };
    const platforms = [...new Set(Object.values(directions))];
    if (entry) entry.platforms.push(...platforms);
    else groups.set(code, { code, group, name, en, ja, kana, aliases, platforms });
    return directions;
  });
  let callCount = 0;
  const tripIds = new Set();
  const trips = pack.trips.map(row => {
    if (!list(row, 4, 4)) throw Error("The timetable contains an invalid trip.");
    const [id, line, calendar, times] = row;
    if (!isText(id, 200) || tripIds.has(id) || ![2, 5, null].includes(line) ||
        !isInt(calendar, calendars.length - 1) || !list(times, 2, 60))
      throw Error("The timetable contains an invalid or duplicate trip.");
    tripIds.add(id);
    callCount += times.length;
    if (callCount > 30000) throw Error("The timetable has too many stop times.");
    let last = -1;
    const visited = new Set();
    const calls = times.map((time, index) => {
      if (!list(time, 4, 4)) throw Error("The timetable contains an invalid stop time.");
      const [stop, flags, arrive, depart] = time;
      if (!isInt(stop, inputStops.length - 1) || visited.has(stop) ||
          !isInt(flags, 3) || !isInt(arrive, 1439) || !isInt(depart, 1439) ||
          arrive > depart || arrive <= last || (index === 0 && flags !== 1) ||
          (index === times.length - 1 && flags !== 2))
        throw Error("The timetable contains invalid stop times or boarding flags.");
      visited.add(stop);
      last = depart;
      return {
        stop, arrive, depart, pickup: !!(flags & 1), dropoff: !!(flags & 2),
        ...(pack.intermediateArrivalBound === true && index > 0 && index < times.length - 1
          ? { arrivalBound: true } : {}),
      };
    });
    const terminal = pack.stops[calls.at(-1).stop];
    const direction = Number(terminal[1].slice(-2)) > Number(pack.stops[calls[0].stop][1].slice(-2))
      ? "west" : "east";
    for (const call of calls) call.stop = inputStops[call.stop][direction].id;
    const toward = terminal[3];
    return { name: "Hakodate tram" + (line === null ? "" : " " + line) + " toward " + toward,
      line: tramLine, mode: "tram", calendar: calendars[calendar], source: evidence, calls };
  });
  const transferCalendar = { ...coverage, days: [0, 1, 2, 3, 4, 5, 6] };
  const transferPairs = new Set();
  const transfers = pack.transfers.flatMap(row => {
    if (!list(row, 4, 4)) throw Error("The timetable contains an invalid transfer.");
    const [from, to, type, seconds] = row;
    const pair = from + "|" + to;
    if (!isInt(from, inputStops.length - 1) || !isInt(to, inputStops.length - 1) ||
        !isInt(type, 3) || !isInt(seconds, 900) || transferPairs.has(pair))
      throw Error("The timetable contains an invalid or duplicate transfer.");
    transferPairs.add(pair);
    if (type === 3 || from === to) return [];
    // Cross-platform transfers use a three-minute crossing estimate unless the feed specifies more time.
    return [{ from: inputStops[from].east.id, to: inputStops[to].east.id, minutes: 3,
      minimum: Math.ceil(seconds / 60), calendar: transferCalendar }];
  });
  if (splitDirections) {
    const jujigai = groups.get("DY20");
    if (jujigai) {
      const [east, west] = jujigai.platforms;
      transfers.push({ from: east.id, to: west.id, minutes: 3, calendar: transferCalendar });
    }
  }
  const choices = [...groups.values()].sort((a, b) => a.code.slice(-2).localeCompare(b.code.slice(-2)));
  const stops = choices.flatMap(stop => stop.platforms);
  return { source: evidence, locationSource, coverage, choices, stops, trips, transfers, imported };
}

export function tramStopMatches(stops, query, exact = false) {
  const term = aliasKey(query);
  if (!term) return exact ? [] : stops;
  return stops.filter(stop => stop.aliases.some(alias => exact ? aliasKey(alias) === term : aliasKey(alias).includes(term)));
}

export function tramPlace(stop, source, locationSource = source) {
  const pins = stop.platforms.filter(item => Number.isFinite(item.lat));
  const lat = pins.length ? pins.reduce((sum, item) => sum + item.lat, 0) / pins.length : null;
  const lng = pins.length ? pins.reduce((sum, item) => sum + item.lng, 0) / pins.length : null;
  const credit = {
    field: "stop", sourceKind: "operator timetable", url: source.url, observedAt: null,
    note: stop.code + " · " + source.license,
  };
  const locationCredit = { ...credit, field: "location", url: locationSource.url,
    note: locationSource.publisher + " · " + locationSource.license + ". " + locationSource.note };
  return manualPlace({
    key: "manual:" + stop.group, sourceId: stop.group,
    names: { ja: stop.ja + "電停", en: stop.name, romaji: stop.en, branchJa: null },
    category: "Hakodate tram stop",
    address: { ja: null, en: null, prefecture: "北海道", city: "函館市", postalCode: null },
    location: { lat, lng, availability: lat === null ? "unknown" : "located",
      confidence: lat === null ? "unknown" : "medium", method: lat === null ? null : "tram stop reference point",
      provenance: lat === null ? [] : [locationCredit], verifiedAt: null },
    links: [{ kind: "source", label: source.publisher, url: source.url }],
    provenance: [credit],
  });
}
