import { directionStations } from "./direction-search.js";
import timetable from "./flower-nagai-data.js";
import { fold } from "./place-search.js";
import { prefectures } from "./together.js";

// Station-area reference points © OpenStreetMap contributors, ODbL 1.0.
// The complete source is data/stations/2026-11-01/station-pack-20261101.json.
// Flower Nagai Line stations retain Yamagata Prefecture's CC BY 4.0 credit.
export const stationPack = "../data/stations/2026-11-01/station-pack-20261101.json";
const areaStations = [
  ["Tokyo", "東京", "とうきょう", 35.6811412, 139.7674549],
  ["Shinjuku", "新宿", "しんじゅく", 35.6902618, 139.7005142],
  ["Shibuya", "渋谷", "しぶや", 35.65808, 139.7017647],
  ["Kyoto", "京都", "きょうと", 34.9853497, 135.758766],
  ["Osaka", "大阪", "おおさか", 34.7022133, 135.4955732],
  ["Ueno", "上野", "うえの", 35.7134128, 139.7765418],
  ["Shinagawa", "品川", "しながわ", 35.6286688, 139.7391673],
  ["Ikebukuro", "池袋", "いけぶくろ", 35.730185, 139.7111512],
  ["Akihabara", "秋葉原", "あきはばら", 35.6983666, 139.7730325],
  ["Asakusa", "浅草", "あさくさ", 35.7119514, 139.7983683],
  ["Yokohama", "横浜", "よこはま", 35.466292, 139.6220811],
  ["Nagoya", "名古屋", "なごや", 35.1707285, 136.8818431],
  ["Shin-Osaka", "新大阪", "しんおおさか", 34.7335385, 135.5001888],
  ["Namba", "難波", "なんば", 34.6661565, 135.500271],
  ["Sapporo", "札幌", "さっぽろ", 43.0686365, 141.3509218],
  ["Sendai (Miyagi)", "仙台", "せんだい", 38.2603516, 140.8823921],
  ["Yamagata", "山形", "やまがた", 38.2484701, 140.3278031],
  ["Kanazawa", "金沢", "かなざわ", 36.5780499, 136.6480247],
  ["Hiroshima", "広島", "ひろしま", 34.3973947, 132.4758369],
  ["Tennoji", "天王寺", "てんのうじ", 34.6473432, 135.5152413],
  ["Sannomiya", "三ノ宮", "さんのみや", 34.6948605, 135.1950871],
  ["Hakata", "博多", "はかた", 33.5899996, 130.4210055],
].map(([name, ja, kana, lat, lng]) => ({
  label: name + " Station · " + ja + "駅", terms: [name, name.split(" (")[0], ja, kana],
  lat, lng, source: "osm",
}));
const railwayStations = timetable.stations.map(({ id, nameJa, kana, lat, lng }) => {
  const name = directionStations.find(station => station.id === id).name;
  return {
    label: name + " Station · " + nameJa + "駅",
    terms: [name, name.split(" (")[0], nameJa, kana], lat, lng, source: "railway",
  };
});
const stations = [...areaStations, ...railwayStations];
const stationTerm = text => fold(text).trim()
  .replace(/ (city|station)(?= |$)|(?:駅|えき)$|市$/gu, "")
  .replace(/[\s-]+/gu, "");

export function mapStations(query) {
  const term = stationTerm(query);
  if (term.length < 2) return [];
  return stations.filter(station => station.terms.some(alias => stationTerm(alias) === term));
}

const cities = new Map([
  ["札幌", ["Sapporo", "さっぽろ"]], ["函館", ["Hakodate", "はこだて"]],
  ["盛岡", ["Morioka", "もりおか"]], ["仙台", ["Sendai", "せんだい"]],
  ["山形", ["Yamagata", "やまがた"]], ["松島", ["Matsushima", "まつしま"]],
  ["横浜", ["Yokohama", "よこはま"]], ["金沢", ["Kanazawa", "かなざわ"]],
  ["名古屋", ["Nagoya", "なごや"]], ["京都", ["Kyoto", "きょうと"]],
  ["大阪", ["Osaka", "おおさか"]], ["神戸", ["Kobe", "こうべ"]],
  ["奈良", ["Nara", "なら"]], ["広島", ["Hiroshima", "ひろしま"]],
  ["福岡", ["Fukuoka", "ふくおか"]], ["熊本", ["Kumamoto", "くまもと"]],
  ["鹿児島", ["Kagoshima", "かごしま"]], ["那覇", ["Naha", "なは"]],
]);
const cityReadings = new Map([...cities].flatMap(([ja, names]) =>
  [ja, ...names.map(fold)].map(name => [name, [ja, ...names]])));
const prefectureByName = new Map(prefectures.flatMap(({ ja, en }) =>
  [ja, ja.replace(/[県府都]$/u, ""), en, en + " prefecture"].map(name => [fold(name), [ja, en]])));
const addressCache = new WeakMap();

export function mapAddressAliases(place) {
  if (addressCache.has(place)) return addressCache.get(place);
  const { city, prefecture } = place.address || {};
  const aliases = [
    ...(cityReadings.get(fold(city).trim().replace(/市(?:[^市]*区)?$|町$|(?:\s+city)$/u, "")) || []),
    ...(prefectureByName.get(fold(prefecture).trim()) || []),
    ...(prefecture === "東京都" ? ["とうきょう"] : []),
  ];
  addressCache.set(place, aliases);
  return aliases;
}
