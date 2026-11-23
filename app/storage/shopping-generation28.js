import { parseJSON, canonical } from "../core/contracts.js";

export const generation28Registry = Object.freeze({
  bytes: 750,
  sha256: "4c4294c8b9de9f1947aeed8507894b16270faa2391252edefbbdb74b4cf11d89",
});

const retailerHosts = new Set(["www.paseos.co.jp", "www.paseos-chirashi.jp"]);
const isRetailer = value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && retailerHosts.has(url.hostname);
  } catch { return false; }
};

export function validateGeneration28(base, next, overlay) {
  const facts = parseJSON(next.notices[
    `shopping:overture-${next.feed.datasetVersion}-paseos-release-facts.json`
  ]);
  const additions = overlay.additions;
  const mapped = additions.filter(place => place.location.availability === "located").length;
  if (facts.schemaVersion !== 1 || facts.kind !== "paseos-retailer-directory-facts" ||
      facts.previousLogicalDatasetVersion !== base.feed.datasetVersion || !isRetailer(facts.source) ||
      facts.records !== additions.length || facts.mapped !== mapped || facts.listOnly !== additions.length - mapped ||
      next.feed.places.length !== base.feed.places.length + additions.length ||
      overlay.replacements.length || canonical(base.aliases) !== canonical(next.aliases))
    throw Error("Shopping generation 28 must be an exact PASEOS-only addition");
  if (additions.some(place => place.shopping?.brandId !== "paseos" ||
      !place.key.startsWith("shopping:paseos:") || place.shopping.formatId !== "standard" ||
      !place.provenance.some(entry => isRetailer(entry.url))))
    throw Error("Unexpected store or retailer source in the PASEOS addition");
}
