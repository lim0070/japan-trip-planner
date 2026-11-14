import { canonical, parseJSON } from "../core/contracts.js";

export const tenantHoursRegistry = Object.freeze({
  bytes: 750,
  sha256: "32177214ffd1b050d51b43d9914e239e4e91f2c8bcadabde82082d8adcfebb25",
});

const reviewed = new Map([
  ["shopping:overture:67ccc349-2a2a-4c84-a781-368bd5b87cac",
    "Tenant reference 10:00–20:00. Days and exceptions unverified."],
  ["shopping:overture:9d8a1642-0b63-433e-9496-52c83c8e7139",
    "Tenant reference 10:00–21:00. Days and exceptions unverified."],
  ["shopping:overture:e37cb7ba-cb4f-49b7-8927-aaa1d7ae5b75",
    "Tenant reference 10:00–21:00. Days and exceptions unverified."],
  ["shopping:overture:fdcb518b-38b9-4ddb-8b28-bbf5d0a54aa6",
    "Tenant numeric reference 10:00–21:00. Days and exceptions unverified."],
]);

export function validateTenantHoursUpdate(base, next, overlay) {
  const proof = parseJSON(next.notices[
    `shopping:overture-${next.feed.datasetVersion}-shopping-reviewed-facts-hoursText-g23-1.json`
  ]);
  if (proof.schemaVersion !== 1 || proof.kind !== "shopping-reviewed-field-decisions" ||
      proof.baseline?.manifestSha256 !== "4adb2f4ef302cd2348db433161bdb1642e5f2951dc93b6015d7d92ddc58dcd51" ||
      proof.baseline.logicalDatasetVersion !== base.feed.datasetVersion ||
      proof.records?.length !== reviewed.size || overlay.replacements.length !== reviewed.size ||
      canonical(base.aliases) !== canonical(next.aliases) ||
      base.feed.source.attribution !== next.feed.source.attribution)
    throw Error("Shopping update differs from the four reviewed tenant hours");

  const decisions = new Map(proof.records.map(row => [row.memberKey, row]));
  for (const { index, place } of overlay.replacements) {
    const prior = base.feed.places[index], decision = decisions.get(place.key);
    const hoursText = reviewed.get(place.key), evidence = place.provenance.at(-1);
    const expected = { ...prior, hoursText, provenance: [...prior.provenance, evidence] };
    if (!hoursText || prior.hoursText !== null || decision?.sourceNativeId !== prior.sourceId ||
        decision.field !== "hoursText" || decision.before !== null || decision.after !== hoursText ||
        evidence?.field !== decision.field || evidence.url !== decision.sourceUrl ||
        evidence.observedAt !== decision.observedAt || canonical(place) !== canonical(expected))
      throw Error("Unexpected Shopping hours or evidence change");
  }
}
