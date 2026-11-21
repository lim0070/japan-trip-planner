import { validateReviewedDelta } from "./shopping-reviewed-delta.js";

export const generation27Registry = Object.freeze({
  bytes: 755,
  sha256: "3f0f11bc29400e3d381f1d50b048ded8e8b306f38627f4ab00b9bd4e104734ab",
});

export const formerGuCitation = Object.freeze({
  key: "shopping:overture:d0922b97-fc42-48e6-b4ba-70c339eac723",
  field: "address.prefecture",
  url: "https://www.fastretailing.com/jp/group/news/1503021700.html",
  observedAt: "2026-11-21T01:46:51.512925Z",
  label: "Fast Retailing group opening announcement",
  documentDate: "2015-03-02",
  attribution: "Fast Retailing. Historical prefecture extracted by Japan Shopping Data.",
});

const reviewed = new Map([[formerGuCitation.key, ["address.prefecture", "熊本県"]]]);

export function validateGeneration27(base, next, overlay) {
  validateReviewedDelta(base, next, overlay, {
    generation: 27,
    parentManifest: "a899c7dbfd2c936f43fdc5359ea5e1e82d1168e235fb6fc46aaa64ca686fa7f1",
    reviewed,
    checkSource(place, decision) {
      if (place.key !== formerGuCitation.key ||
          decision.sourceUrl !== formerGuCitation.url || decision.observedAt !== formerGuCitation.observedAt ||
          decision.sourceLabel !== formerGuCitation.label || decision.sourceDocumentDate !== formerGuCitation.documentDate ||
          decision.sourceAttribution !== formerGuCitation.attribution)
        throw Error("Former GU citation differs from the reviewed source");
    },
  });
}
