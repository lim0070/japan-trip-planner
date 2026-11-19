import { canonical, parseJSON } from "../core/contracts.js";

export const generation24Registry = Object.freeze({
  bytes: 755,
  sha256: "9d69095fabffd25aa45b69ffa19d82d1a9214fd4d7f0fa3f3e6963f8de547baa",
});

export const aichiPdf = Object.freeze({
  key: "shopping:overture:ef62f707-2987-4be9-9974-dc0d8b39dc2e",
  url: "https://www.pref.aichi.jp/uploaded/attachment/356368.pdf",
  label: "Aichi Prefecture website (PDF, 616,406 bytes)",
  bytes: 616406,
});

const reviewed = new Map([
  ["shopping:overture:0711058c-1b1c-496c-9796-1dbad89c7d59", ["address.prefecture", "千葉県"]],
  ["shopping:overture:5d43073b-3571-4a49-ba8b-c3d000330ae5", ["address.prefecture", "大阪府"]],
  ["shopping:overture:a67917c9-e1ab-46e9-8703-a2652045ff0a", ["address.prefecture", "大阪府"]],
  ["shopping:overture:e30d1bb9-ede3-4dda-abb9-985d93619f4b", ["address.prefecture", "岐阜県"]],
  ["shopping:overture:ef62f707-2987-4be9-9974-dc0d8b39dc2e", ["address.prefecture", "愛知県"]],
  ["shopping:overture:5dcf489d-690e-4daa-8b4e-cc2c1a8cca7c", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
  ["shopping:overture:6751dd35-0853-4aca-afda-2acec981809e", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
  ["shopping:overture:6e726316-f21b-4800-b95f-ecea23cf5d38", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:7010442e-09c4-4495-88b5-5e257a860446", ["hoursText", "Tenant reference weekdays 11:00–20:00, weekends and holidays 10:00–20:00. Exceptions unverified."]],
  ["shopping:overture:848fba0e-9800-4621-908f-7719aa451427", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
  ["shopping:overture:be3446a5-2c24-4e98-8606-ff6e699e54b4", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:e2ba5a31-8605-4ac1-befa-596cad3d68f0", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
  ["shopping:overture:f7c74bc0-f798-4432-bf31-e49f1596184d", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
]);

export function validateGeneration24(base, next, overlay) {
  const proof = parseJSON(next.notices[
    `shopping:overture-${next.feed.datasetVersion}-shopping-reviewed-facts-mixed-g24-1.json`
  ]);
  // The changed input inventory is independently bound by the pinned manifest.
  const { inputSha256: parentInputs, ...parentSource } = base.feed.source;
  const { inputSha256: nextInputs, ...nextSource } = next.feed.source;
  if (proof.schemaVersion !== 1 || proof.kind !== "shopping-reviewed-field-decisions" ||
      proof.baseline?.manifestSha256 !== "56cb060ead8f7f57bde08c7db6f580e78bb76940a66eb2354bb33d21afdc82fc" ||
      proof.baseline.logicalDatasetVersion !== base.feed.datasetVersion ||
      proof.records?.length !== reviewed.size || overlay.replacements.length !== reviewed.size ||
      canonical(base.aliases) !== canonical(next.aliases) ||
      canonical(parentSource) !== canonical(nextSource))
    throw Error("Shopping generation 24 differs from its reviewed delta");

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
    if (place.key === aichiPdf.key &&
        (decision.sourceUrl !== aichiPdf.url || decision.sourceLabel !== aichiPdf.label ||
         decision.sourceMediaType !== "application/pdf" || decision.sourceBytes !== aichiPdf.bytes ||
         !evidence.note?.startsWith(aichiPdf.label)))
      throw Error("Aichi PDF label or size differs from the reviewed source");
  }
}
