import * as M from "./model.js";

export const prefectureGroups = [
  ["Hokkaidō", [["北海道", "Hokkaido"]]],
  ["Tōhoku", [["青森県", "Aomori"], ["岩手県", "Iwate"], ["宮城県", "Miyagi"], ["秋田県", "Akita"], ["山形県", "Yamagata"], ["福島県", "Fukushima"]]],
  ["Kantō", [["茨城県", "Ibaraki"], ["栃木県", "Tochigi"], ["群馬県", "Gunma"], ["埼玉県", "Saitama"], ["千葉県", "Chiba"], ["東京都", "Tokyo"], ["神奈川県", "Kanagawa"]]],
  ["Chūbu", [["新潟県", "Niigata"], ["富山県", "Toyama"], ["石川県", "Ishikawa"], ["福井県", "Fukui"], ["山梨県", "Yamanashi"], ["長野県", "Nagano"], ["岐阜県", "Gifu"], ["静岡県", "Shizuoka"], ["愛知県", "Aichi"]]],
  ["Kinki", [["三重県", "Mie"], ["滋賀県", "Shiga"], ["京都府", "Kyoto"], ["大阪府", "Osaka"], ["兵庫県", "Hyogo"], ["奈良県", "Nara"], ["和歌山県", "Wakayama"]]],
  ["Chūgoku", [["鳥取県", "Tottori"], ["島根県", "Shimane"], ["岡山県", "Okayama"], ["広島県", "Hiroshima"], ["山口県", "Yamaguchi"]]],
  ["Shikoku", [["徳島県", "Tokushima"], ["香川県", "Kagawa"], ["愛媛県", "Ehime"], ["高知県", "Kochi"]]],
  ["Kyūshū & Okinawa", [["福岡県", "Fukuoka"], ["佐賀県", "Saga"], ["長崎県", "Nagasaki"], ["熊本県", "Kumamoto"], ["大分県", "Oita"], ["宮崎県", "Miyazaki"], ["鹿児島県", "Kagoshima"], ["沖縄県", "Okinawa"]]],
];

export const prefectures = prefectureGroups.flatMap(([group, rows]) =>
  rows.map(([ja, en]) => ({ group, ja, en }))).map((place, index) => ({ ...place, code: index + 1 }));

const folded = value => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en")
  .normalize("NFD").replace(/\p{M}/gu, "");
const withoutSuffix = value => folded(value).replace(/\s+(?:prefecture|city)$/u, "").replace(/[市県府都]$/u, "");

export function storedPrefecture(value) {
  const key = folded(value);
  if (!key) return null;
  return prefectures.find(place => [place.ja, withoutSuffix(place.ja), place.en, place.en + " prefecture"]
    .some(name => folded(name) === key)) ?? null;
}

export function prefectureProgress(trips) {
  const codes = new Set(trips.flatMap(trip => trip.prefectureVisits ?? []));
  return prefectures.filter(prefecture => codes.has(prefecture.code));
}

const numbers = new Map("one two three four five six seven 一 二 三 四 五 六 七".split(" ")
  .map((name, index) => [name, index % 7 + 1]));

export function parseTripDraft(text) {
  const prompt = String(text).normalize("NFKC").trim();
  if (!prompt || prompt.length > 140) throw Error("Use a short request of up to 140 characters.");
  const english = /^(?<days>[1-7]|one|two|three|four|five|six|seven)\s+(?<quiet>quiet\s+)?days?\s+in\s+(?<location>[\p{L}\p{M}\s-]+?)(?:\s*[,;]\s*(?<diet>no raw fish))?[.!]?$/iu;
  const japanese = /^(?<location>[\p{L}\p{M}・\s-]+?)で\s*(?<quiet>静かな|静かに)?\s*(?<days>[1-7一二三四五六七])日(?:間)?(?:[、,\s]*?(?<diet>生魚なし|生魚を避ける))?[。！]?$/u;
  const matched = prompt.match(english) || prompt.match(japanese);
  if (!matched) throw Error("Try “three quiet days in Kyoto, no raw fish” or “京都で静かな3日間、生魚なし”.");
  const { days, location, quiet, diet } = matched.groups;
  const city = location.trim();
  if (city.length < 2 || city.length > 50) throw Error("Use a city or prefecture name of 2–50 characters.");
  return { days: numbers.get(folded(days)) ?? Number(days), city, quiet: Boolean(quiet), avoidRawFish: Boolean(diet) };
}

const cityAliases = new Map([
  ["Sapporo", "札幌"], ["Morioka", "盛岡"], ["Sendai", "仙台"], ["Mito", "水戸"],
  ["Utsunomiya", "宇都宮"], ["Maebashi", "前橋"], ["Shinjuku", "新宿"], ["Yokohama", "横浜"],
  ["Kofu", "甲府"], ["Kanazawa", "金沢"], ["Nagoya", "名古屋"], ["Tsu", "津"],
  ["Otsu", "大津"], ["Kobe", "神戸"], ["Matsue", "松江"], ["Okayama", "岡山"],
  ["Takamatsu", "高松"], ["Matsuyama", "松山"], ["Naha", "那覇"],
].flatMap(([en, ja]) => [[folded(en), ja], [ja, ja], [ja + "市", ja]]));
const cityName = value => folded(value).replace(/\s+city$/u, "");
const cityKey = value => cityAliases.get(cityName(value)) || cityName(value);
const tokyoWards = new Set(
  ("chiyoda chuo minato shinjuku bunkyo taito sumida koto shinagawa meguro ota setagaya shibuya " +
    "nakano suginami toshima kita arakawa itabashi nerima adachi katsushika edogawa " +
    "千代田 中央 港 新宿 文京 台東 墨田 江東 品川 目黒 大田 世田谷 渋谷 中野 杉並 豊島 北 荒川 板橋 練馬 足立 葛飾 江戸川").split(" "),
);

function belongsTo(place, query) {
  const location = cityName(query);
  const prefecture = storedPrefecture(query);
  const addressPrefecture = storedPrefecture(place.address.prefecture)?.code;
  const city = cityName(place.address.city);
  if (prefecture && (!city || prefecture.code === 1 || /\s+prefecture$/iu.test(query) || location === prefecture.ja))
    return prefecture.code === addressPrefecture;
  if (city && (city === location || city === location + "市" || cityKey(city) === cityKey(location))) return true;
  if (!prefecture || prefecture.code !== addressPrefecture) return false;
  if (prefecture.code === 13) {
    const ward = city.replace(/^東京都/u, "").replace(/(?:[-\s]ku|\sward|区)$/u, "");
    return tokyoWards.has(ward);
  }
  return storedPrefecture(city.replace(/市$/u, ""))?.code === prefecture.code;
}

export function tripDraft(state, firstDayId, request) {
  const first = state.days.find(day => day.id === firstDayId);
  const trip = state.trips.find(item => item.id === first?.tripId);
  if (!trip) throw Error("Choose a dated trip first.");
  const ids = trip.dayIds.slice(trip.dayIds.indexOf(first.id), trip.dayIds.indexOf(first.id) + request.days);
  if (ids.length !== request.days) throw Error("This trip needs more days from the selected start date.");
  const favourite = new Set(state.flags.filter(flag => flag.favourite).map(flag => flag.placeKey));
  const options = state.places.filter(local => favourite.has(local.snapshot.key))
    .map(local => ({ id: local.id, place: M.effective(local), version: local.sourceRef?.datasetVersion ?? null }))
    .filter(({ place }) => belongsTo(place, request.city) &&
      !["closed", "relocated"].includes(place.operatingStatus.value))
    .slice(0, 30);
  const days = ids.map(id => {
    const day = state.days.find(item => item.id === id);
    return { id, date: day.date, visits: M.schedule(state, day).map(({ stop, visitStart }) => {
      const place = M.visitPlace(stop);
      return { id: stop.id, key: place.key, name: M.name(place), when: M.timeLabel(day.date, visitStart),
        locked: stop.planLocked || stop.fixedStartMinute !== undefined };
    }) };
  });
  return { days, options, request };
}

export function applyTripDraft(state, original, selections) {
  const current = tripDraft(state, original.days[0].id, original.request);
  if (JSON.stringify(current) !== JSON.stringify(original)) throw Error("The trip or saved places changed. Review a fresh draft.");
  if (selections.length !== current.days.length || !selections.some(Boolean)) throw Error("Choose at least one visit from the list.");
  const planned = current.days.map((day, index) => {
    const id = selections[index];
    if (!id) return null;
    const choice = current.options.find(option => option.id === id);
    if (!choice || day.visits.some(visit => visit.key === choice.place.key)) throw Error("Choose a saved place not already planned for that date.");
    return { day: state.days.find(candidate => candidate.id === day.id), saved: state.places.find(local => local.id === choice.id) };
  });
  for (const row of planned.filter(Boolean)) {
    const stop = M.addSavedStop(state, row.day, row.saved);
    const preferences = [
      current.request.quiet ? "Prefer a quieter visit time. Check local conditions." : "",
      current.request.avoidRawFish ? "Avoid raw fish. Confirm ingredients and preparation with the venue." : "",
    ];
    stop.notes = preferences.filter(Boolean).join("\n");
  }
}

export const voteChoices = { yes: "Yes", maybe: "Maybe", no: "No" };
export const voteCapacity = 40;
const simpleId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const exactFields = (value, fields) =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

export function validVote(record) {
  return exactFields(record, ["id", "choice", "comment"]) && simpleId(record.id) &&
    Object.hasOwn(voteChoices, record.choice) && typeof record.comment === "string" && record.comment.length <= 280;
}

export function votePackage(stop, onlyIds) {
  const votes = (stop.togetherVotes || []).filter(row => !onlyIds || onlyIds.includes(row.id));
  return { kind: "planner-votes", version: 1, tripId: stop.tripId, stopId: stop.id, votes };
}

export function parseVotes(text, stop) {
  if (text.length > 64 * 1024) throw Error("Choose a vote file smaller than 64 KiB.");
  const packet = JSON.parse(text);
  if (!exactFields(packet, ["kind", "version", "tripId", "stopId", "votes"]) ||
      packet.kind !== "planner-votes" || packet.version !== 1 ||
      !Array.isArray(packet.votes) || packet.votes.length > voteCapacity ||
      !packet.votes.every(validVote)) throw Error("This file is not a supported vote export.");
  if (packet.tripId !== stop.tripId || packet.stopId !== stop.id) throw Error("This vote file belongs to another trip or visit.");
  if (new Set(packet.votes.map(row => row.id)).size !== packet.votes.length) throw Error("The vote file repeats a record ID.");
  return packet;
}

export function mergeVotes(stop, packet) {
  if (stop.id !== packet.stopId || stop.tripId !== packet.tripId) throw Error("The visit changed. Reopen the vote preview.");
  const merged = new Map((stop.togetherVotes || []).map(record => [record.id, record]));
  for (const row of packet.votes) {
    const current = merged.get(row.id);
    if (current && (current.choice !== row.choice || current.comment !== row.comment))
      throw Error("An existing vote has a different value for the same record ID. Review the file before merging.");
    if (!current) merged.set(row.id, row);
  }
  if (merged.size > voteCapacity) throw Error("This visit can hold up to 40 votes.");
  return [...merged.values()];
}

export const photoLimits = {
  inputBytes: 9 * 1024 * 1024,
  imageBytes: 1400 * 1024,
  totalBytes: 12 * 1024 * 1024,
  count: 48,
  maxPixels: 24000000,
  maxSide: 1600,
};
export const photoFileLimit = Math.ceil(photoLimits.totalBytes * 4 / 3) + 100000;

export function photoDimensions(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a &&
      view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452)
    return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes[0] !== 255 || bytes[1] !== 216) return null;
  let cursor = 2;
  while (cursor + 4 < bytes.length && bytes[cursor] === 255) {
    while (bytes[cursor] === 255) cursor++;
    const marker = bytes[cursor++];
    if (marker === 0xd9 || marker === 0xda || cursor + 2 > bytes.length) break;
    const length = view.getUint16(cursor);
    if (length < 2 || cursor + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) break;
      return { type: "image/jpeg", height: view.getUint16(cursor + 3), width: view.getUint16(cursor + 5) };
    }
    cursor += length;
  }
  return null;
}

// Preserve the encoded image while dropping metadata and bytes after the image terminator.
export function privateJpeg(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216) throw Error("Expected a JPEG image.");
  const kept = [bytes.subarray(0, 2)];
  let cursor = 2;
  let hasScan = false;
  let stripped = false;
  while (bytes[cursor] === 255) {
    const start = cursor++;
    while (bytes[cursor] === 255) cursor++;
    const marker = bytes[cursor++];
    if (marker === 0xd9 && hasScan) {
      if (!stripped && cursor === bytes.length) return bytes;
      kept.push(bytes.subarray(start, cursor));
      const output = new Uint8Array(kept.reduce((size, segment) => size + segment.length, 0));
      let offset = 0;
      for (const segment of kept) {
        output.set(segment, offset);
        offset += segment.length;
      }
      return output;
    }
    if (cursor + 2 > bytes.length || marker < 0xc0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) break;
    const length = bytes[cursor] * 256 + bytes[cursor + 1];
    if (length < 2 || cursor + length > bytes.length) break;
    cursor += length;
    if (marker === 0xda) {
      hasScan = true;
      while (cursor < bytes.length) {
        const next = bytes.indexOf(255, cursor);
        if (next === -1) break;
        cursor = next;
        let markerIndex = cursor + 1;
        while (bytes[markerIndex] === 255) markerIndex++;
        const markerByte = bytes[markerIndex];
        if (markerByte !== 0 && !(markerByte >= 0xd0 && markerByte <= 0xd7)) break;
        cursor = markerIndex + 1;
      }
    }
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) stripped = true;
    else kept.push(bytes.subarray(start, cursor));
  }
  throw Error("The JPEG image is incomplete or invalid.");
}

export async function photoDigest(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function photoBase64(bytes) {
  const chunks = [];
  for (let index = 0; index < bytes.length; index += 16384) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 16384)));
  return btoa(chunks.join(""));
}

export async function parsePhotoPack(text) {
  if (text.length > photoFileLimit) throw Error("The photo backup is too large.");
  const pack = JSON.parse(text);
  if (!exactFields(pack, ["kind", "version", "photos"]) ||
      pack.kind !== "planner-photo-journal" || pack.version !== 1 ||
      !Array.isArray(pack.photos) || !pack.photos.length || pack.photos.length > photoLimits.count)
    throw Error("This file is not a supported photo backup.");
  let total = 0;
  const ids = new Set();
  const photos = [];
  for (const row of pack.photos) {
    if (!exactFields(row, ["id", "caption", "digest", "data"]) || !simpleId(row.id) || ids.has(row.id) ||
        typeof row.caption !== "string" || row.caption.length > 200 ||
        typeof row.digest !== "string" || !/^[0-9a-f]{64}$/.test(row.digest) ||
        typeof row.data !== "string" || row.data.length > Math.ceil(photoLimits.imageBytes * 4 / 3) + 4)
      throw Error("A photo, caption or checksum in this file is invalid.");
    const bytes = Uint8Array.from(atob(row.data), char => char.charCodeAt(0));
    total += bytes.length;
    const dimensions = photoDimensions(bytes);
    if (bytes.length > photoLimits.imageBytes || total > photoLimits.totalBytes ||
        dimensions?.type !== "image/jpeg" || !dimensions.width || !dimensions.height ||
        Math.max(dimensions.width, dimensions.height) > photoLimits.maxSide ||
        await photoDigest(bytes) !== row.digest)
      throw Error("A photo exceeded a limit or did not match the backup checksum.");
    const clean = privateJpeg(bytes);
    const digest = clean === bytes ? row.digest : await photoDigest(clean);
    ids.add(row.id);
    photos.push({ id: row.id, caption: row.caption, digest, bytes: clean });
  }
  return photos;
}
