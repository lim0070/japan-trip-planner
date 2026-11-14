import { canonical, parseJSON } from "../core/contracts.js";

export const mixedRegistry = Object.freeze({
  bytes: 750,
  sha256: "2774e90804f561a0f46bb0df9ef987b66febf0e0078d881622e37d77e67ff6f2",
});

const reviewed = new Map([
  ["shopping:overture:8cfcf285-032e-4929-8bfc-13b3b070bc82", ["address.prefecture", "東京都"]],
  ["shopping:overture:a2053dbc-4308-4e9d-82ba-285f659767b4", ["address.prefecture", "千葉県"]],
  ["shopping:overture:00d329e4-e82e-4e0e-be9c-60e56ff3fc92",
    ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
]);

export function validateMixedUpdate(base, next, overlay) {
  const proof = parseJSON(next.notices[
    `shopping:overture-${next.feed.datasetVersion}-shopping-reviewed-facts-mixed-g22-1.json`
  ]);
  if (proof.schemaVersion !== 1 || proof.kind !== "shopping-reviewed-field-decisions" ||
      proof.baseline?.manifestSha256 !== "c43650dc4fafd2312137e2355193fd5adff5bcff0ecd6b011d7a62cbdd9f3708" ||
      proof.baseline.logicalDatasetVersion !== base.feed.datasetVersion ||
      proof.records?.length !== reviewed.size || overlay.replacements.length !== reviewed.size ||
      canonical(base.aliases) !== canonical(next.aliases) ||
      base.feed.source.attribution !== next.feed.source.attribution)
    throw Error("Shopping update differs from the three reviewed facts");

  const decisions = new Map(proof.records.map(row => [row.memberKey, row]));
  for (const { index, place } of overlay.replacements) {
    const prior = base.feed.places[index], decision = decisions.get(place.key);
    const [field, after] = reviewed.get(place.key) ?? [];
    const evidence = place.provenance.at(-1);
    if (!field || decision?.sourceNativeId !== prior.sourceId ||
        decision.field !== field || decision.before !== null || decision.after !== after ||
        evidence?.field !== field || evidence.url !== decision.sourceUrl ||
        evidence.observedAt !== decision.observedAt)
      throw Error("Unexpected Shopping fact or evidence");

    const expected = { ...prior, provenance: [...prior.provenance, evidence] };
    if (field === "address.prefecture") {
      if (prior.address.prefecture !== null) throw Error("Unexpected prior prefecture");
      expected.address = { ...prior.address, prefecture: after };
    } else {
      if (prior.hoursText !== null) throw Error("Unexpected prior hours");
      expected.hoursText = after;
    }
    if (canonical(place) !== canonical(expected))
      throw Error("Unexpected unrelated Shopping field change");
  }
}
