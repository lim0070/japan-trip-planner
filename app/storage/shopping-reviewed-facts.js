import { canonical, parseJSON } from "../core/contracts.js";

export const reviewedFactsRegistry = Object.freeze({
  bytes: 750,
  sha256: "9f79cd3e32ad1c04ff96e5996098e3cabd351fba084185f202c97ef171a31a49",
});

const proofCounts = [
  ["address-prefecture", "address.prefecture", [13]],
  ["hoursText", "hoursText", [42, 10]],
  ["operatingStatus", "operatingStatus", [42, 42, 11]],
];

export function validateReviewedFacts(base, next, overlay) {
  if (overlay.replacements.length !== 156 ||
      canonical(next.aliases) !== canonical(base.aliases) ||
      next.feed.source.attribution !== base.feed.source.attribution)
    throw Error("Shopping facts differ from the reviewed release");

  const prefix = `shopping:overture-${next.feed.datasetVersion}-shopping-reviewed-facts-`;
  const byKey = new Map();
  for (const [filename, field, counts] of proofCounts) {
    for (const [part, count] of counts.entries()) {
      const proof = parseJSON(next.notices[`${prefix}${filename}-g20-${part + 1}.json`]);
      if (proof.schemaVersion !== 1 || proof.kind !== "shopping-reviewed-field-decisions" ||
          proof.baseline?.manifestSha256 !== "bfd8f401ffc81d5aca6e001bb76e3e5a2d27b7979851c616806d7c059f203d8f" ||
          proof.baseline.logicalDatasetVersion !== base.feed.datasetVersion ||
          !Array.isArray(proof.records) || proof.records.length !== count)
        throw Error("Shopping facts proof is invalid");
      for (const decision of proof.records) {
        const fields = byKey.get(decision.memberKey) || new Map();
        if (decision.field !== field || fields.has(field))
          throw Error("Duplicate or unexpected Shopping fact");
        fields.set(field, decision);
        byKey.set(decision.memberKey, fields);
      }
    }
  }
  if (byKey.size !== overlay.replacements.length)
    throw Error("Shopping facts proof has a different record count");
  for (const { index, place } of overlay.replacements) {
    const prior = base.feed.places[index], fields = byKey.get(place.key);
    if (!fields) throw Error("Unexpected Shopping record change");
    const expected = { ...prior, address: { ...prior.address }, provenance: place.provenance };
    const added = place.provenance.slice(prior.provenance.length);
    if (added.length !== fields.size ||
        canonical(place.provenance.slice(0, prior.provenance.length)) !== canonical(prior.provenance))
      throw Error("Unexpected Shopping evidence change");
    for (const evidence of added) {
      const decision = fields.get(evidence.field);
      if (!decision || decision.sourceNativeId !== prior.sourceId ||
          evidence.url !== decision.sourceUrl || evidence.observedAt !== decision.observedAt)
        throw Error("Shopping evidence does not match its decision");
      const { field, before, after } = decision;
      const record = field === "address.prefecture" ? expected.address : expected;
      const key = field === "address.prefecture" ? "prefecture" : field;
      if (canonical(record[key]) !== canonical(before) ||
          (field === "operatingStatus" && (before.value !== "unknown" || after.value !== "closed")))
        throw Error("Shopping fact does not match its parent");
      record[key] = after;
      fields.delete(field);
    }
    if (canonical(expected) !== canonical(place))
      throw Error("Unexpected Shopping field change");
  }
}
