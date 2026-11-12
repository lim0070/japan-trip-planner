import { canonical } from "../core/contracts.js";

// November 11, 2026 approval in the Japan manager chat. This allowance is
// restricted to one exact registry and these nine independently reviewed rows.
export const approvedShopping = Object.freeze({
  generation: 17,
  expanded: 33558528,
  storage: 100794368,
  registry: Object.freeze({
    bytes: 750,
    sha256: "4c666d4a6819b39b2a9e81416dfcc7bf96ea61b787de57eefdb3b8d5f3b624d4",
  }),
});

const approvedFields = new Map([
  ["shopping:overture:59d08d6d-6898-4c79-b62a-4994992ccea5", "hoursText"],
  ["shopping:overture:5d373c53-5151-484f-8206-4662a93f2b14", "hoursText"],
  ["shopping:overture:6f7fd410-87eb-416b-9b75-c04e96223be1", "hoursText"],
  ["shopping:overture:868c5354-245b-4625-9577-3b791e0efd74", "hoursText"],
  ["shopping:overture:ea533334-3b4b-43b0-a8c2-d32cd1fe1df9", "hoursText"],
  ["shopping:overture:ddfd8e3a-f4f8-4e7a-bbcf-27f6f0e6c50a", "operatingStatus"],
  ["shopping:overture:b391bf9a-999e-4d98-8261-887efff66e21", "operatingStatus"],
  ["shopping:overture:e94d616d-572a-4d2f-a16c-91322aedeed9", "operatingStatus"],
  ["shopping:overture:7403ce4b-b65b-43f8-be1e-bd7cd6ab90eb", "operatingStatus"],
]);

export function validateApprovedShoppingChanges(base, next, overlay) {
  if (overlay.replacements.length !== approvedFields.size ||
      canonical(next.aliases) !== canonical(base.aliases) ||
      next.feed.source.attribution !== base.feed.source.attribution)
    throw Error("Shopping update differs from the approved nine-record batch");

  for (const { index, place } of overlay.replacements) {
    const field = approvedFields.get(place.key);
    const previous = base.feed.places[index];
    const proof = place.provenance.at(-1);
    if (!field || place.provenance.length !== previous.provenance.length + 1 ||
        proof?.field !== field ||
        canonical({ ...place, [field]: previous[field], provenance: previous.provenance }) !== canonical(previous) ||
        canonical(place.provenance.slice(0, -1)) !== canonical(previous.provenance))
      throw Error("Shopping update changes an unapproved record field");

    if (field === "hoursText"
      ? previous.hoursText !== null ||
        !/^Tenant reference \d\d:\d\d–\d\d:\d\d\. Days and exceptions unverified\.$/.test(place.hoursText) ||
        proof.sourceKind !== "independent-tenant-hour-fact"
      : previous.operatingStatus.value !== "unknown" || place.operatingStatus.value !== "closed" ||
        proof.sourceKind !== "independent-dated-closure-fact")
      throw Error("Shopping update changes an unapproved record value");
  }
}
