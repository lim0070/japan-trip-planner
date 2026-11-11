import { canonical, verifyFeed } from "../core/contracts.js";
import { validateAliases } from "../core/shopping-aliases.js";

// Store only complete replacements and the new package metadata. The base
// stays in the existing codec row, which older clients can still read.
export function makeShoppingOverlay(base, next) {
  const { feed, ...metadata } = next;
  const { places, ...feedMetadata } = feed;
  if (!base?.manifest || !next.manifest ||
      base.feed.places.length !== places.length)
    throw Error("Shopping overlay requires an exact base with the same record keys");

  const replacements = [];
  for (const [index, place] of places.entries()) {
    const previous = base.feed.places[index];
    if (previous.key !== place.key)
      throw Error("Shopping overlay changed the record order");
    if (canonical(previous) !== canonical(place))
      replacements.push({ index, place });
  }
  return {
    baseArtifact: base.manifest.datasetVersion,
    package: { ...metadata, feed: feedMetadata },
    replacements,
  };
}

export async function readShoppingOverlay(base, overlay) {
  if (!base?.manifest || base.manifest.datasetVersion !== overlay.baseArtifact)
    throw Error("Exact Shopping overlay base is unavailable");

  const places = base.feed.places.slice();
  let previousIndex = -1;
  for (const { index, place } of overlay.replacements) {
    if (!Number.isSafeInteger(index) || index <= previousIndex ||
        places[index]?.key !== place?.key || !place)
      throw Error("Invalid Shopping overlay replacement");
    places[index] = place;
    previousIndex = index;
  }

  const result = {
    ...overlay.package,
    feed: { ...overlay.package.feed, places },
  };
  if (result.manifest.logicalDatasetVersion !== result.feed.datasetVersion)
    throw Error("Shopping overlay manifest does not match its feed");
  await verifyFeed(result.feed);
  validateAliases(result.aliases, result.feed);
  return result;
}
