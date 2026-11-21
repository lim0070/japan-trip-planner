import { distance, visitDestination } from "./model.js";

// Verified selection from the operator GTFS, with source and licence retained.
const timetable = {
  "operator": "Yamagata Railway Co., Ltd. (山形鉄道株式会社)",
  "route": "Flower Nagai Line",
  "routeId": "10",
  "timeZone": "Asia/Tokyo",
  "kind": "scheduled",
  "source": {
    "publisher": "山形鉄道株式会社",
    "catalog": "https://www.pref.yamagata.jp/020057/kurashi/kendo/kotsuseisaku/kokyokotsu_gtfs-jp.html",
    "download": "https://api.gtfs-data.jp/v2/organizations/yamagatatetsudo/feeds/flowerliner/files/feed.zip?rid=current",
    "statusUrl": "https://flower-liner.jp/",
    "timetableUrl": "https://flower-liner.jp/timetable/",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "adaptation": "Selected two stops and both direct journey directions from the GTFS timetable, with romanized stop names and fares.",
    "sha256": "245af967b8cee8d06e9e568c7ca15e70f17f0fbdd56f10d97a6f5adde2e1b6c1",
    "bytes": 6616,
    "feedVersion": "2026/03/14改正-見える化ver2.6e",
    "checkedDate": "2026-11-21",
    "publisherReleaseDate": "2026-03-09"
  },
  "service": {
    "id": "全日",
    "startInclusive": "2026-03-14",
    "endInclusive": "2027-03-13",
    "weekdays": [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    ],
    "exceptionDates": []
  },
  "directions": [
    {
      "from": "Akayu",
      "fromJa": "赤湯",
      "fromId": "17_01",
      "to": "Nagai",
      "toJa": "長井",
      "toId": "8_02",
      "directionId": "1",
      "toward": "Arato",
      "fareJPY": 620,
      "trains": [
        {
          "depart": "07:09",
          "arrive": "07:43",
          "tripId": "1全日_07時09分_系統102001"
        },
        {
          "depart": "08:54",
          "arrive": "09:27",
          "tripId": "1全日_08時54分_系統102001"
        },
        {
          "depart": "10:49",
          "arrive": "11:22",
          "tripId": "1全日_10時49分_系統102001"
        },
        {
          "depart": "12:28",
          "arrive": "13:01",
          "tripId": "1全日_12時28分_系統102001"
        },
        {
          "depart": "16:08",
          "arrive": "16:43",
          "tripId": "1全日_16時08分_系統102001"
        },
        {
          "depart": "17:26",
          "arrive": "18:05",
          "tripId": "1全日_17時26分_系統102001"
        },
        {
          "depart": "18:44",
          "arrive": "19:23",
          "tripId": "1全日_18時44分_系統102001"
        },
        {
          "depart": "20:56",
          "arrive": "21:29",
          "tripId": "1全日_20時56分_系統102001"
        }
      ]
    },
    {
      "from": "Nagai",
      "fromJa": "長井",
      "fromId": "8_02",
      "to": "Akayu",
      "toJa": "赤湯",
      "toId": "17_01",
      "directionId": "0",
      "toward": "Akayu",
      "fareJPY": 620,
      "trains": [
        {
          "depart": "06:22",
          "arrive": "06:53",
          "tripId": "1全日_06時00分_系統101001"
        },
        {
          "depart": "07:44",
          "arrive": "08:17",
          "tripId": "1全日_07時17分_系統101001"
        },
        {
          "depart": "08:31",
          "arrive": "09:06",
          "tripId": "1全日_08時09分_系統101001"
        },
        {
          "depart": "10:55",
          "arrive": "11:33",
          "tripId": "1全日_10時34分_系統101001"
        },
        {
          "depart": "14:45",
          "arrive": "15:18",
          "tripId": "1全日_14時24分_系統101001"
        },
        {
          "depart": "16:13",
          "arrive": "16:54",
          "tripId": "1全日_15時52分_系統101001"
        },
        {
          "depart": "17:33",
          "arrive": "18:15",
          "tripId": "1全日_17時12分_系統101001"
        },
        {
          "depart": "19:01",
          "arrive": "19:33",
          "tripId": "1全日_18時40分_系統101001"
        }
      ]
    }
  ]
};

const stations = [
  {
    name: "Akayu",
    ja: ["赤湯", "赤湯駅"],
    aliases: ["akayu", "akayu station", "akayu-eki", "あかゆ", "あかゆ駅", "アカユ", "アカユ駅"],
    location: { lat: 38.047088, lng: 140.149289 },
  },
  {
    name: "Nagai",
    ja: ["長井", "長井駅"],
    aliases: ["nagai", "nagai station", "nagai-eki", "ながい", "ながい駅", "ナガイ", "ナガイ駅"],
    location: { lat: 38.106531, lng: 140.033879 },
  },
];
const normalize = text => (text ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const yamagata = new Set(["山形県", "山形", "yamagata", "yamagata prefecture", "jp-06"]);

function stationName(place) {
  const names = [place.names.ja, place.names.en, place.names.romaji].map(normalize);
  const prefecture = normalize(place.address.prefecture);
  if (prefecture && !yamagata.has(prefecture)) return null;
  const matching = stations.filter(station => names.some(name => station.ja.includes(name) || station.aliases.includes(name)));
  if (matching.length !== 1) return null;
  const [station] = matching;
  const { lat, lng } = place.location;
  // The operator's platform coordinates disambiguate local station entrances and similarly named places.
  if (Number.isFinite(lat) && Number.isFinite(lng))
    return distance({ lat, lng }, station.location) <= 0.25 ? station.name : null;
  return station.ja.includes(names[0]) || yamagata.has(prefecture) ? station.name : null;
}

function minuteOf(text) {
  const [hour, minute] = text.split(":").map(Number);
  return hour * 60 + minute;
}

export function yamagataRailCheck(state, day, row) {
  const { startInclusive, endInclusive } = timetable.service;
  if (row.segment?.mode !== "train" || day.date < startInclusive || day.date > endInclusive) return null;
  const { fromStopId, toStopId } = row.segment;
  const from = state.stops.find(stop => stop.id === fromStopId);
  const to = state.stops.find(stop => stop.id === toStopId);
  if (!from || !to) return null;
  const fromName = stationName(visitDestination(from));
  const toName = stationName(visitDestination(to));
  const direction = timetable.directions.find(item => item.from === fromName && item.to === toName);
  if (!direction) return null;

  const depart = row.routeDeparture;
  // This route's trains all leave on their stated service date. An itinerary
  // spilling into the next date needs a new timetable check for that date.
  if (depart !== null && (!Number.isInteger(depart) || depart < 0 || depart >= 1440)) return null;
  const { trains, fareJPY } = direction;
  return {
    operator: timetable.operator,
    line: timetable.route,
    source: timetable.source,
    coverage: timetable.service,
    from: direction.from,
    to: direction.to,
    fromJa: direction.fromJa,
    toJa: direction.toJa,
    last: trains.at(-1),
    next: depart === null ? null : trains.find(train => minuteOf(train.depart) >= depart) ?? null,
    earlier: depart === null ? null : trains.findLast(train => minuteOf(train.depart) < depart) ?? null,
    missedLast: depart !== null && depart > minuteOf(trains.at(-1).depart),
    depart,
    fareJPY,
  };
}
