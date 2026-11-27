const kinds = new Set(["caption", "location", "ocr", "speech", "catalogue", "official", "manual"]);
export const feedKind = "japan-planner-reel-list";
export const listId = "foods-in-japan";
export const listName = "Foods in Japan";
export const reelLimit = 4 * 1024 * 1024;
export const emptyReels = () => ({schemaVersion:1, cards:[], decisions:[]});

function requireValue(condition, message) {
  if (!condition) throw Error(message);
}
function fields(value, allowed) {
  requireValue(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)), "Unrecognized reel list fields.");
}
function text(value, maximum, required = false) {
  if (value == null && !required) return null;
  requireValue(typeof value === "string" && value.length <= maximum && (!required || value.trim()), "Invalid reel list text.");
  return value.trim() || null;
}
function identifier(value) {
  requireValue(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value), "Invalid reel or branch identifier.");
  return value;
}
function https(value) {
  const address = text(value, 2048, true);
  let url;
  try { url = new URL(address); } catch {}
  requireValue(url?.protocol === "https:" && !url.username && !url.password, "Source links must be HTTPS.");
  return address;
}
function checkSize(data) {
  requireValue(new TextEncoder().encode(JSON.stringify(data)).length <= reelLimit, "The private reel list exceeds 4 MiB.");
}
function array(value, maximum) {
  requireValue(Array.isArray(value) && value.length <= maximum, "Invalid reel list count.");
  return value;
}
export function reelPlace(value) {
  fields(value, ["branchId","name","address","city","cuisine","lat","lng"]);
  const {lat = null,lng = null} = value;
  requireValue((lat === null && lng === null) ||
    (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180),
    "Supply both latitude and longitude or leave both empty.");
  return {branchId:value.branchId == null ? null : identifier(value.branchId), name:text(value.name,500,true),
    address:text(value.address,1000), city:text(value.city,200), cuisine:text(value.cuisine,200), lat, lng};
}
function evidence(value) {
  fields(value, ["kind","text","url","seconds"]);
  requireValue(kinds.has(value.kind), "Unrecognized reel evidence.");
  const seconds = value.seconds ?? null;
  requireValue(seconds === null || Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400, "Invalid evidence timestamp.");
  return {kind:value.kind, text:text(value.text,1800,true), seconds, url:value.url == null ? null : https(value.url)};
}
function card(value) {
  fields(value, ["id","revision","status","place","source","candidates"]);
  requireValue(Number.isSafeInteger(value.revision) && value.revision > 0, "Invalid reel revision.");
  requireValue(["verified","needs-review"].includes(value.status), "Unrecognized reel status.");
  fields(value.source, ["reelId","url","evidence","playerUrl"]);
  const source = {reelId:identifier(value.source.reelId), url:https(value.source.url),
    playerUrl:value.source.playerUrl == null ? null : https(value.source.playerUrl),
    evidence:array(value.source.evidence,100).map(evidence)};
  const place = reelPlace(value.place);
  const supported = place.branchId && place.address &&
    source.evidence.some(item => item.kind === "catalogue" || item.kind === "official" && item.url);
  return {id:identifier(value.id), revision:value.revision,
    status:value.status === "verified" && supported ? "verified" : "needs-review",
    place, source, candidates:array(value.candidates ?? [],30).map(reelPlace)};
}
function unique(rows) {
  requireValue(new Set(rows.map(row => row.id)).size === rows.length, "Duplicate reel card identifiers.");
  return rows;
}
export function readReelFeed(value) {
  fields(value, ["kind","schemaVersion","listId","name","cards"]);
  requireValue(value.kind === feedKind && value.schemaVersion === 1 && value.listId === listId && value.name === listName,
    "Choose a Foods in Japan reel list.");
  checkSize(value);
  return unique(array(value.cards,10000).map(card));
}
function decision(value) {
  fields(value, ["id","status","place"]);
  const id = identifier(value.id);
  if (value.status === "dismissed" && !value.place) return {id,status:"dismissed"};
  requireValue(value.status === "confirmed", "Invalid local review.");
  const place = reelPlace(value.place);
  requireValue(place.address && place.branchId, "Confirm the specific branch and its address.");
  return {id,status:"confirmed",place};
}
export function readReelBackup(value) {
  fields(value, ["schemaVersion","cards","decisions"]);
  requireValue(value.schemaVersion === 1, "Unsupported private reel backup.");
  checkSize(value);
  const cards = unique(array(value.cards,10000).map(card));
  const decisions = unique(array(value.decisions,10000).map(decision));
  const ids = new Set(cards.map(row => row.id));
  requireValue(decisions.every(row => ids.has(row.id)), "A local review is missing its source card.");
  return {schemaVersion:1,cards,decisions};
}
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function mergeReels(saved, incoming, incomingDecisions = []) {
  const rows = new Map(saved.cards.map(row => [row.id,row]));
  for (const next of incoming) {
    const previous = rows.get(next.id);
    if (previous) {
      requireValue(previous.source.reelId === next.source.reelId, "A reel identifier was reused for another source.");
      if (next.revision < previous.revision) continue;
      if (next.revision === previous.revision) {
        requireValue(equal(previous,next), "A source changed without a newer revision. The list was kept.");
        continue;
      }
    }
    rows.set(next.id,next);
  }
  const decisions = new Map(incomingDecisions.map(row => [row.id,row]));
  for (const local of saved.decisions) decisions.set(local.id,local);
  return readReelBackup({schemaVersion:1,cards:[...rows.values()],decisions:[...decisions.values()]});
}
export function decideReel(saved, base, previous, change) {
  const current = saved.cards.find(row => row.id === base.id);
  const existing = saved.decisions.find(row => row.id === base.id) ?? null;
  requireValue(current?.revision === base.revision && equal(previous,existing), "This card changed. Reopen it before reviewing.");
  const decisions = saved.decisions.filter(row => row.id !== base.id);
  if (change) decisions.push(decision({id:base.id,...change}));
  return readReelBackup({...saved,decisions});
}

export function reelGroups(saved) {
  const decisions = new Map(saved.decisions.map(row => [row.id,row]));
  const branches = new Map(), review = [], dismissed = [];
  for (const row of saved.cards) {
    const choice = decisions.get(row.id);
    if (choice?.status === "dismissed") { dismissed.push(row); continue; }
    if (!choice && row.status === "needs-review") { review.push(row); continue; }
    const place = choice?.place ?? row.place;
    const group = branches.get(place.branchId) ?? {place, cards:[], addresses:new Set(), manual:false};
    group.cards.push(row);
    group.addresses.add(place.address.normalize("NFKC").replace(/\s+/g,""));
    if (choice) { group.place = place; group.manual = true; }
    else if (!group.manual && group.place.lat === null && place.lat !== null) group.place = place;
    branches.set(place.branchId,group);
  }
  for (const [id,group] of branches) {
    if (group.addresses.size <= 1) continue;
    if (group.manual) {
      const address = group.place.address.normalize("NFKC").replace(/\s+/g,"");
      group.cards = group.cards.filter(row => {
        const matches = (decisions.get(row.id)?.place ?? row.place).address.normalize("NFKC").replace(/\s+/g,"") === address;
        if (!matches) review.push(row);
        return matches;
      });
    } else {
      branches.delete(id);
      review.push(...group.cards);
    }
  }
  return {branches:[...branches.values()],review,dismissed};
}
