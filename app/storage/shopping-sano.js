import { canonical, parseJSON } from "../core/contracts.js";

export const sanoRegistry = Object.freeze({
  bytes: 750,
  sha256: "cef126bbff8aa861ced137a48b04322e3bdf2d39a3314edf4be9b646382f760c",
});

const keys = new Set([
  "shopping:overture:02f52d14-d874-4c3b-ac7f-7aa61ab1ef9c",
  "shopping:overture:c7884960-ea54-4c29-9b78-a5408826e1f0",
]);
const url = "https://www.city.sano.lg.jp/sanomaru/1029.html";
const prefecture = "栃木県";

export function validateSanoUpdate(base, next, overlay) {
  const proof = parseJSON(next.notices[
    `shopping:overture-${next.feed.datasetVersion}-shopping-reviewed-facts-address-prefecture-g21-1.json`
  ]);
  if (proof.schemaVersion !== 1 || proof.kind !== "shopping-reviewed-field-decisions" ||
      proof.baseline?.manifestSha256 !== "d5fd1eeb39f0cf82e1bbeafa51aa2ec232a1b9d740b0e0b407c71c481d2fa84e" ||
      proof.baseline.logicalDatasetVersion !== base.feed.datasetVersion ||
      proof.records?.length !== keys.size || overlay.replacements.length !== keys.size ||
      canonical(base.aliases) !== canonical(next.aliases) ||
      base.feed.source.attribution !== next.feed.source.attribution)
    throw Error("Sano Shopping update differs from the reviewed release");
  const decisions = new Map(proof.records.map(row => [row.memberKey, row]));
  for (const { index, place } of overlay.replacements) {
    const prior = base.feed.places[index], decision = decisions.get(place.key);
    const evidence = place.provenance.at(-1);
    const expected = {
      ...prior,
      address: { ...prior.address, prefecture },
      provenance: [...prior.provenance, evidence],
    };
    if (!keys.has(place.key) || prior.address.prefecture !== null ||
        decision?.sourceNativeId !== prior.sourceId || decision.before !== null ||
        decision.after !== prefecture || decision.field !== "address.prefecture" ||
        decision.sourceUrl !== url || evidence?.field !== decision.field ||
        evidence.url !== url || evidence.observedAt !== decision.observedAt ||
        canonical(place) !== canonical(expected))
      throw Error("Unexpected Sano Shopping detail");
  }
}
