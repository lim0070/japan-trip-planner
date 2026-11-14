import { canonical, parseJSON } from "../core/contracts.js";

export const reviewedClosureRegistry = Object.freeze({
  bytes: 751,
  sha256: "f1aaef617abc9feb1c57f368e4581d8d2a757b8832614831b32ba51a0a7be616",
});

const closureDates = new Map([
  ["shopping:overture:109d6248-b48c-4d41-b54f-09ec77a27e71", "2025-03-31"],
  ["shopping:overture:7dd99e6f-ab56-458b-a5fc-d066a88c95ed", "2024-03-03"],
  ["shopping:overture:8c4a81c9-cd86-43d1-b051-dce7c13180f2", "2025-10-13"],
]);

export function validateReviewedClosures(base, next, overlay) {
  const prefix = `shopping:overture-${next.feed.datasetVersion}-`;
  const text = next.notices[prefix + "shopping-lifecycle-field-decisions-g19.json"];
  const proof = text && parseJSON(text);
  if (proof?.kind !== "shopping-lifecycle-field-decisions" ||
      proof.schemaVersion !== 1 ||
      proof.baseline?.manifestSha256 !== "d7d2d59c152b1244e6f72c3606d563a67dc297ebd893cef9cd29325d8e09c674" ||
      proof.baseline?.logicalDatasetVersion !== base.feed.datasetVersion ||
      !Array.isArray(proof.records) || proof.records.length !== closureDates.size ||
      proof.records.length !== overlay.replacements.length ||
      canonical(next.aliases) !== canonical(base.aliases) ||
      next.feed.source.attribution !== base.feed.source.attribution)
    throw Error("Shopping closures differ from the reviewed release");

  const decisions = new Map(proof.records.map(record => [record.memberKey, record]));
  for (const { index, place } of overlay.replacements) {
    const prior = base.feed.places[index], decision = decisions.get(place.key);
    const evidence = place.provenance.at(-1);
    if (decision?.field !== "operatingStatus" || decision.sourceNativeId !== place.sourceId ||
        !closureDates.has(place.key) || decision.closureDate !== closureDates.get(place.key) ||
        prior.operatingStatus.value !== "unknown" || place.operatingStatus.value !== "closed" ||
        place.operatingStatus.checkedAt !== "2026-11-12" ||
        canonical(decision.before) !== canonical(prior.operatingStatus) ||
        canonical(decision.after) !== canonical(place.operatingStatus) ||
        evidence?.field !== decision.field || evidence.url !== decision.sourceUrl ||
        evidence.observedAt !== decision.observedAt ||
        place.provenance.length !== prior.provenance.length + 1 ||
        canonical({ ...place, operatingStatus: prior.operatingStatus, provenance: place.provenance.slice(0, -1) }) !== canonical(prior))
      throw Error("Unexpected Shopping closure record change");
  }
}
