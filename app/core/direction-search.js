import timetable from "./flower-nagai-data.js";

const stationRows = [
  ["sendai", "Sendai (Miyagi)", "仙台", ["Sendai(Miyagi)", "Sendai Station (Miyagi)", "仙台駅", "せんだい"]],
  ["sendai-kagoshima", "Sendai (Kagoshima)", "川内", ["Sendai(Kagoshima)", "Sendai Station (Kagoshima)", "川内駅"]],
  ["tokyo", "Tokyo", "東京", ["Tokyo Station", "東京駅", "とうきょう"]],
  ["yamagata", "Yamagata", "山形", ["Yamagata Station", "山形駅"]],
  ["matsushima", "Matsushima", "松島", ["Matsushima Station", "松島駅"]],
  ["nagai-osaka", "Nagai (Osaka)", "長居", ["Nagai(Osaka)", "長居駅"]],
  ["shinjuku", "Shinjuku", "新宿", ["Shinjuku Station", "新宿駅"]],
  ["shibuya", "Shibuya", "渋谷", ["Shibuya Station", "渋谷駅"]],
  ["ueno", "Ueno", "上野", ["Ueno Station", "上野駅"]],
  ["shinagawa", "Shinagawa", "品川", ["Shinagawa Station", "品川駅"]],
  ["ikebukuro", "Ikebukuro", "池袋", ["Ikebukuro Station", "池袋駅"]],
  ["akihabara", "Akihabara", "秋葉原", ["Akihabara Station", "秋葉原駅"]],
  ["yokohama", "Yokohama", "横浜", ["Yokohama Station", "横浜駅"]],
  ["nagoya", "Nagoya", "名古屋", ["Nagoya Station", "名古屋駅"]],
  ["kyoto", "Kyoto", "京都", ["Kyoto Station", "京都駅"]],
  ["osaka", "Osaka", "大阪", ["Osaka Station", "大阪駅", "JR大阪"]],
  ["shin-osaka", "Shin-Osaka", "新大阪", ["Shin-Osaka Station", "Shin Osaka", "新大阪駅"]],
  ["kanazawa", "Kanazawa", "金沢", ["Kanazawa Station", "金沢駅"]],
  ["hiroshima", "Hiroshima", "広島", ["Hiroshima Station", "広島駅"]],
  ["hakata", "Hakata", "博多", ["Hakata Station", "博多駅"]],
  ["sapporo", "Sapporo", "札幌", ["Sapporo Station", "札幌駅", "さっぽろ"]],
  ["hakodate", "Hakodate", "函館", ["Hakodate Station", "函館駅"]],
];
const localNames = {
  "2_01": "Shikinosato", "3_01": "Ayukai", "4_01": "Koguwa", "5_01": "Shirousagi",
  "6_01": "Uzen-Narita", "7_01": "Ayame-Koen", "8_02": "Nagai (Yamagata)", "9_01": "Minami-Nagai",
  "10_01": "Tokiniwa", "11_02": "Imaizumi", "12_01": "Nishi-Otsuka", "13_01": "Ringo",
  "14_01": "Orihata", "15_02": "Miyauchi (Yamagata)", "16_01": "Nanyo-Shiyakusho",
};
export const directionStations = [
  ...stationRows.map(([id, name, ja, aliases]) => ({ id, name, ja, aliases })),
  ...timetable.stations.map(({id,nameEn,nameJa,kana}) => ({
    id, name: localNames[id] || nameEn || nameJa, ja: nameJa, aliases: [nameJa + "駅", kana],
  })),
];
const localStations = new Map(timetable.stations.map(station => [station.id, station]));
const normalize = (text) => String(text ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const stationByAlias = new Map(directionStations.flatMap(station =>
  [station.name, station.ja, ...station.aliases].map(alias => [normalize(alias), station])));
export const findDirectionStation = (input) => stationByAlias.get(normalize(input)) || null;
export function stationChoices(input) {
  const qualified = { nagai: ["Nagai (Yamagata)", "Nagai (Osaka)"], sendai: ["Sendai (Miyagi)", "Sendai (Kagoshima)"] };
  const key = normalize(input);
  return Object.hasOwn(qualified, key) ? qualified[key] : [];
}

export function japanDateTime(now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600000).toISOString();
  return { date: jst.slice(0, 10), time: jst.slice(11, 16) };
}

export function trainWhen(when, date, time, now = new Date()) {
  if (when === "now") return { when, ...japanDateTime(now) };
  if (when !== "depart" && when !== "arrive") throw Error("Choose a time option.");
  const timestamp = new Date(date + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp.getTime()) ||
      timestamp.toISOString().slice(0, 10) !== date ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw Error("Enter a valid date and time in Japan.");
  return { when, date, time };
}

function minute(clock) {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

export function localTrainResults(from, to, when) {
  const a = findDirectionStation(from), b = findDirectionStation(to);
  if (!a || !b) return null;
  if (!localStations.has(a.id) || !localStations.has(b.id) || a.id === b.id) return null;
  const { startInclusive, endInclusive } = timetable.service;
  const covered = when.date >= startInclusive && when.date <= endInclusive;
  const arrival = when.when === "arrive";
  const trains = [];
  if (covered) {
    for (const train of timetable.trips) {
      const start = train.calls.findIndex(call => call.stopId === a.id && call.pickup);
      const end = train.calls.findIndex(call => call.stopId === b.id && call.dropoff);
      if (start < 0 || end <= start) continue;
      const depart = train.calls[start].depart, arrive = train.calls[end].arrive;
      if (arrival ? arrive > when.time : depart < when.time) continue;
      const toward = timetable.stations.find(station => station.nameJa === train.towardJa);
      trains.push({ depart, arrive, duration: minute(arrive) - minute(depart),
        toward: toward?.nameEn || train.towardJa });
    }
    trains.sort((x, y) => arrival ? y.arrive.localeCompare(x.arrive) : x.depart.localeCompare(y.depart));
  }
  return { source: timetable.source, line: timetable.route, operator: timetable.operator,
    coverage: timetable.service, covered, fareJPY: timetable.faresJPY[a.id]?.[b.id] ?? null, trains: trains.slice(0,5) };
}

export function googleDirectionLink(from, to, mode) {
  const travelmode = { walk: "walking", train: "transit", drive: "driving" }[mode];
  if (!to || !travelmode) return null;
  const url = new URL("https://www.google.com/maps/dir/");
  url.search = new URLSearchParams({ api: "1", destination: to, travelmode });
  if (from) url.searchParams.set("origin", from);
  return url.href;
}

export const jorudanHome = "https://world.jorudan.co.jp/mln/en/";
const jorudanName = (raw) => {
  const station = findDirectionStation(raw);
  if (!station) return raw;
  if (station.id === "sendai") return "Sendai(Miyagi)";
  if (station.id === "sendai-kagoshima") return "Sendai(Kagoshima)";
  if (localStations.has(station.id)) return station.ja;
  return station.name;
};

export function jorudanDirections(from, to, timing, { japanese = false } = {}) {
  const arrival = timing.when === "arrive";
  const [year, month, day] = timing.date.split("-");
  if (japanese) {
    const start = findDirectionStation(from), finish = findDirectionStation(to);
    if (!start || !finish) return null;
    const url = new URL("https://www.jorudan.co.jp/norikae/cgi/nori.cgi");
    url.search = new URLSearchParams({ eki1: start.ja, eki2: finish.ja, Cway: arrival ? "1" : "0", S: "検索" });
    if (timing.when !== "now") {
      const [hour, minute] = timing.time.split(":");
      for (const [key, value] of Object.entries({ Dyy:year, Dmm:month, Ddd:day, Dhh:hour, Dmn:minute }))
        url.searchParams.set(key, value);
    }
    return url.href;
  }
  const url = new URL(jorudanHome);
  url.search = new URLSearchParams({ p:"0", xpd:"1", from: jorudanName(from), to: jorudanName(to),
    ft: arrival ? "1" : "0" });
  if (timing.when !== "now") {
    url.searchParams.set("date", [month, day, year].join("/"));
    url.searchParams.set("time", timing.time);
  }
  return url.href;
}
