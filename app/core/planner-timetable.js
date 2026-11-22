import flower from "./flower-nagai-data.js";
import winter from "./winter-transit-data.js";
import { directionStations } from "./direction-search.js";
import { routeEndpoints } from "./model.js";
import { createTimetableRouter, timetableCheck } from "./timetable.js";

const minutes = value => value === null ? null : Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
const flowerCalendar = {
  start: flower.service.startInclusive, end: flower.service.endInclusive, days: [0, 1, 2, 3, 4, 5, 6],
};
const flowerSource = {
  publisher: flower.source.publisher, url: flower.source.catalog,
  license: flower.source.license, licenseUrl: flower.source.licenseUrl,
  note: "Flower Nagai Line GTFS. Scheduled service only.",
};
const flowerStops = flower.stations.map(item => {
  const known = directionStations.find(station => station.id === item.id);
  return {
    id: "flower-" + item.id, name: known.name + " Station", lat: item.lat, lng: item.lng,
    aliases: [known.name + " Station", item.nameJa + "駅", ...known.aliases.filter(Boolean)],
    boarding: 5,
  };
});
const flowerTrips = flower.trips.map(trip => ({
  name: "Flower Nagai Line", line: "Flower Nagai Line", mode: "train", source: flowerSource, calendar: flowerCalendar,
  calls: trip.calls.map(call => ({
    stop: "flower-" + call.stopId, arrive: minutes(call.arrive), depart: minutes(call.depart),
    pickup: call.pickup, dropoff: call.dropoff,
  })),
}));
export const winterRouter = createTimetableRouter({
  ...winter, stops: [...winter.stops, ...flowerStops],
  trips: [...winter.trips.map(trip => ({
    ...trip, source: winter.sources[trip.source], calendar: winter.calendars[trip.calendar],
  })), ...flowerTrips],
});

export function optimizedTransit(from, to, date, ready, mode) {
  const { journey } = winterRouter(from, to, date, ready, 1439, { busOnly: mode === "drive" });
  if (!journey) return null;
  return {
    kind: "timetable", mode: "train", minutes: journey.arrival - ready,
    check: timetableCheck(journey, routeEndpoints(from, to)),
  };
}

export function airportTimetableCheck(a, b) {
  const matches = (place, name) => Object.values(place?.names ?? {}).some(value =>
    value && new RegExp(name, "iu").test(value));
  if (!matches(a, "Narita|成田") || !matches(b, "Haneda|羽田")) return null;
  return "https://www.limousinebus.co.jp/en/timetable/detail/Narita-Haneda/";
}
