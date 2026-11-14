import { canonical, parseJSON, verifyFeed } from "../core/contracts.js";

const normalizedVersion = "sha256:efd77068d20ebcea9f06610efb889b51965d06510843703ae3ab4d6c206631b5";
const frozenVersion = "sha256:97c4c2d0a9d83a886f72445cf7e607201039c2a5741ba01e8d14b21342aee367";
const short = "Overture status unknown at release; check current status.";
const original = "Overture source operating_status=None at release; not a current operator check.";
const field = "operatingStatus";
const sourceKind = "overture-places";
const occurrences = 5391;

export const closureRegistry = Object.freeze({
  bytes: 751,
  sha256: "f24f62298d56ea88a8238f5bb3f435dd639cd7e847063ab47b6c81d125dc4255",
});

function rewriteNotes(pkg, from, to) {
  let count = 0;
  const places = pkg.feed.places.map(place => {
    let changed = false;
    const provenance = place.provenance.map(item => {
      if (item.field !== field || item.sourceKind !== sourceKind || item.note !== from)
        return item;
      changed = true;
      count++;
      return { ...item, note: to };
    });
    return changed ? { ...place, provenance } : place;
  });
  if (count !== occurrences) throw Error("Unexpected Shopping provenance note count");
  return { ...pkg, feed: { ...pkg.feed, places } };
}

export function normalizeClosureParent(pkg) {
  return rewriteNotes(pkg, original, short);
}

export async function validateClosureUpdate(base, next, overlay) {
  const prefix = `shopping:overture-${normalizedVersion}-`;
  const text = next.notices[prefix + "provenance-original-wording-g18.json"];
  const map = text && parseJSON(text);
  if (next.feed.datasetVersion !== normalizedVersion || map?.kind !== "reversible-shopping-provenance-wording" ||
      map.normalizedLogicalDatasetVersion !== normalizedVersion || map.frozenLogicalDatasetVersion !== frozenVersion ||
      map.occurrences !== occurrences || canonical(map.rule) !== canonical({ field, sourceKind, short, original }) ||
      overlay.replacements.length !== 1 || canonical(next.aliases) !== canonical(base.aliases))
    throw Error("Shopping closure package differs from the verified release");
  const { index, place } = overlay.replacements[0];
  const prior = base.feed.places[index];
  const decisions = parseJSON(next.notices[prefix + "shopping-lifecycle-field-decisions-g18.json"]);
  const decision = decisions.records?.[0];
  if (place.key !== "shopping:overture:e7e28e15-6066-4bc9-a238-0af8d6e0df07" ||
      prior.operatingStatus.value !== "unknown" || place.operatingStatus.value !== "closed" ||
      place.operatingStatus.checkedAt !== "2026-11-12" || decision?.closureDate !== "2023-05-14" ||
      decision.memberKey !== place.key || decisions.records.length !== 1 ||
      canonical(decision.before) !== canonical(prior.operatingStatus) ||
      canonical(decision.after) !== canonical(place.operatingStatus) ||
      place.provenance.length !== prior.provenance.length + 1 ||
      canonical({ ...place, operatingStatus: prior.operatingStatus, provenance: place.provenance.slice(0, -1) }) !== canonical(prior))
    throw Error("Unexpected Shopping closure record change");
  const restored = rewriteNotes(next, short, original);
  await verifyFeed({ ...restored.feed, datasetVersion: frozenVersion });
}
