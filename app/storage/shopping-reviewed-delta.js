import { canonical, parseJSON } from "../core/contracts.js";

export function validateReviewedDelta(base, next, overlay, { generation, parentManifest, reviewed, checkSource }) {
  const proof = parseJSON(next.notices[
    `shopping:overture-${next.feed.datasetVersion}-shopping-reviewed-facts-mixed-g${generation}-1.json`
  ]);
  // The changed input inventory is independently bound by the pinned manifest.
  const { inputSha256: parentInputs, ...parentSource } = base.feed.source;
  const { inputSha256: nextInputs, ...nextSource } = next.feed.source;
  if (proof.schemaVersion !== 1 || proof.kind !== "shopping-reviewed-field-decisions" ||
      proof.baseline?.manifestSha256 !== parentManifest ||
      proof.baseline.logicalDatasetVersion !== base.feed.datasetVersion ||
      proof.records?.length !== reviewed.size || overlay.replacements.length !== reviewed.size ||
      canonical(base.aliases) !== canonical(next.aliases) ||
      canonical(parentSource) !== canonical(nextSource))
    throw Error("Shopping update differs from its reviewed delta");

  const decisions = new Map(proof.records.map(record => [record.memberKey, record]));
  for (const { index, place } of overlay.replacements) {
    const prior = base.feed.places[index], decision = decisions.get(place.key);
    const [field, after] = reviewed.get(place.key) || [];
    const evidence = place.provenance.at(-1);
    if (!field || decision?.sourceNativeId !== prior.sourceId ||
        decision.field !== field || decision.before !== null || decision.after !== after ||
        evidence?.field !== field || evidence.url !== decision.sourceUrl ||
        evidence.observedAt !== decision.observedAt)
      throw Error("Unexpected Shopping fact or evidence");

    const expected = { ...prior, provenance: [...prior.provenance, evidence] };
    if (field === "address.prefecture" && prior.address.prefecture === null)
      expected.address = { ...prior.address, prefecture: after };
    else if (field === "hoursText" && prior.hoursText === null)
      expected.hoursText = after;
    else throw Error("Unexpected prior Shopping fact");
    if (canonical(place) !== canonical(expected))
      throw Error("Unexpected unrelated Shopping field change");
    checkSource(place, decision, evidence);
  }
}
