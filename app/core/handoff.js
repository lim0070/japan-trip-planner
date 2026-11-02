/** Key-free, offline URL/file construction. Google resolves destinations when opened. */
export const LIMITS = Object.freeze({ urlCharacters: 2048, mobileWaypoints: 3,
  desktopWaypoints: 8, shortlistPlaces: 20, csvRows: 1000, csvBytes: 39000000 });

const MODES = Object.freeze({ walk: 'walking', train: 'transit', drive: 'driving' });
const GENERAL = [
  'Google Maps resolves these destinations when opened. Check the place, entrance and route there.',
  'Links do not insert places into a saved list. Saving requires action in Google Maps.',
  'Links do not prefill departure times or guarantee schedules, opening hours or route availability.'
];
const text = value => typeof value === 'string' && value.trim().length > 0;

function validate(input) {
  if (!input || input.schemaVersion !== 1 || !Object.hasOwn(MODES, input.mode) || !Array.isArray(input.places))
    throw new TypeError('Expected schemaVersion 1, mode walk/train/drive, and places array.');
  const ids = new Set();
  input.places.forEach((p, i) => {
    const bad = reason => { throw new TypeError(`places[${i}]: ${reason}`); };
    if (!p || !text(p.selectionId) || !text(p.placeKey) || !text(p.name)) bad('selectionId, placeKey and name must be nonempty strings.');
    if (ids.has(p.selectionId)) bad('selectionId must identify a unique occurrence; repeated placeKey is allowed.');
    ids.add(p.selectionId);
    if (p.address !== null && typeof p.address !== 'string') bad('address must be a string or null.');
    const l = p.location;
    if (!l || !['high', 'medium', 'low', 'unknown'].includes(l.confidence)) bad('location confidence is required.');
    const pairedNull = l.lat === null && l.lng === null;
    const pairedValid = Number.isFinite(l.lat) && Number.isFinite(l.lng) && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180;
    if (!pairedNull && !pairedValid) bad('coordinates must be paired nulls or finite, in-range numbers.');
    if (p.googlePlaceId !== null && (!text(p.googlePlaceId) || /[|,\u0000-\u001f\u007f]/u.test(p.googlePlaceId)))
      bad('googlePlaceId must be null or a nonempty identifier without list separators/control characters.');
  });
  return input.places;
}

function destination(p) {
  if (text(p.address)) return `${p.name}, ${p.address}`;
  if (p.location.confidence === 'high' && p.location.lat !== null)
    return `${p.location.lat},${p.location.lng}`;
  return p.name;
}

function placeWarnings(p) {
  const out = [];
  if (!text(p.address)) out.push(`${p.selectionId}: no address supplied; verify the destination in Google Maps.`);
  if (p.location.lat !== null && p.location.confidence !== 'high')
    out.push(`${p.selectionId}: approximate coordinates are not used as a destination; name/address is used instead.`);
  if (p.location.lat === null && !text(p.address))
    out.push(`${p.selectionId}: location is unverified; a name search may be ambiguous.`);
  return out;
}

function url(path, params) {
  const u = new URL(`https://www.google.com/maps/${path}`);
  u.search = new URLSearchParams({ api: '1', ...params }).toString();
  return u.href;
}

function searchURL(p) {
  return url('search/', { query: destination(p), ...(p.googlePlaceId ? { query_place_id: p.googlePlaceId } : {}) });
}

function directionsURL(places, mode) {
  const first = places[0], last = places.at(-1), waypoints = places.slice(1, -1);
  const params = { origin: destination(first), destination: destination(last), travelmode: MODES[mode] };
  if (first.googlePlaceId) params.origin_place_id = first.googlePlaceId;
  if (last.googlePlaceId) params.destination_place_id = last.googlePlaceId;
  if (waypoints.length) {
    params.waypoints = waypoints.map(destination).join('|');
    // Google requires an aligned list. Never send sparse or mismatched IDs.
    if (waypoints.every(p => p.googlePlaceId)) params.waypoint_place_ids = waypoints.map(p => p.googlePlaceId).join('|');
  }
  return url('dir/', params);
}

function fitLink(label, href, places, warnings = []) {
  if (href.length > LIMITS.urlCharacters) return null;
  return { label, url: href, selectionIds: places.map(p => p.selectionId),
    warnings: [...new Set([...warnings, ...places.flatMap(placeWarnings)])] };
}

function result(input, links, warnings) {
  const covered = new Set(links.flatMap(l => l.selectionIds));
  const unhandledSelectionIds = input.places.filter(p => !covered.has(p.selectionId)).map(p => p.selectionId);
  return { schemaVersion: 1, links, warnings: [...new Set([...GENERAL, ...warnings,
    ...input.places.flatMap(placeWarnings)])], unhandledSelectionIds };
}

/** Exact planner contract v1. One link per adjacent pair; never uses waypoints. */
export function buildHandoff(input) {
  const places = validate(input), links = [], warnings = [];
  if (input.mode === 'train') warnings.push('Transit is exported as separate adjacent legs. Set date/time and check trains or buses in Google Maps for each leg.');
  if (places.length > 2) warnings.push('This journey is split into adjacent legs in selection order; each boundary place appears in both neighbouring links. Open each leg separately.');
  if (places.length === 1) {
    const link = fitLink(`Place 1: ${places[0].name}`, searchURL(places[0]), places);
    if (link) links.push(link);
  }
  for (let i = 0; i + 1 < places.length; i++) {
    const pair = places.slice(i, i + 2);
    const link = fitLink(`Leg ${i + 1}: ${i + 1} → ${i + 2} · ${pair[0].name} → ${pair[1].name}`,
      directionsURL(pair, input.mode), pair);
    if (link) links.push(link);
    else {
      warnings.push(`Leg ${i + 1} exceeds the 2,048-character URL limit. Use the individual place links and full selection files; this leg has no directions link.`);
      // Keep fallback searches next to this failed leg in journey order.
      for (const p of pair) {
        const fallback = fitLink(`Place ${places.indexOf(p) + 1}: ${p.name}`, searchURL(p), [p], ['Directions link exceeded the URL limit; this is a place search only.']);
        if (fallback) links.push(fallback);
      }
    }
  }
  if (places.length === 1 && links.length === 0) warnings.push('The place URL exceeds 2,048 characters. Use the full selection files or copy the place details.');
  const out = result(input, links, warnings);
  if (out.unhandledSelectionIds.length) out.warnings.push('Some selections cannot fit a valid link. Their IDs are listed in unhandledSelectionIds and all selections remain in the file exports.');
  return out;
}

/** Individual links, useful for the manual Google Maps Save workflow. */
export function buildPlaceLinks(input) {
  const places = validate(input);
  const links = places.map((p, i) => fitLink(`Place ${i + 1}: ${p.name}`, searchURL(p), [p])).filter(Boolean);
  return result(input, links, ['One search link per selection occurrence; oversized URLs are reported as unhandled.']);
}

/** Optional grouped route preview. Default handoff above is safer on all clients. */
export function buildRouteChunks(input, { platform = 'mobile' } = {}) {
  const places = validate(input);
  if (!['mobile', 'desktop'].includes(platform)) throw new TypeError('platform must be mobile or desktop.');
  if (input.mode === 'train' || places.length < 3) return buildHandoff(input);
  const links = [], warnings = [
    'Grouped route previews use waypoints, which some Google Maps products ignore. Check every stop; use buildHandoff for separate legs.',
    'Chunk boundary places overlap. Chunks follow selection order and do not optimize the journey.',
    platform === 'desktop' ? 'Desktop policy uses at most 8 intermediate points to respect the stricter Google Maps Help limit of 9 stops including destination.' : 'Mobile policy uses at most 3 intermediate points.'
  ];
  const maxPoints = (platform === 'mobile' ? LIMITS.mobileWaypoints : LIMITS.desktopWaypoints) + 2;
  let start = 0;
  while (start < places.length - 1) {
    let end = Math.min(places.length, start + maxPoints), href;
    while (end >= start + 2) {
      const slice = places.slice(start, end);
      // A literal pipe inside a destination could become an unintended extra waypoint.
      href = directionsURL(slice, input.mode);
      if (href.length <= LIMITS.urlCharacters && slice.slice(1, -1).every(p => !destination(p).includes('|'))) break;
      end--;
    }
    if (end < start + 2) {
      const pair = { ...input, places: places.slice(start, start + 2) };
      const fallback = buildHandoff(pair);
      links.push(...fallback.links);
      warnings.push(...fallback.warnings);
      start++;
      continue;
    }
    const slice = places.slice(start, end);
    links.push(fitLink(`Route part ${links.length + 1}: selections ${start + 1}–${end}`, href, slice,
      slice.length > 2 ? ['Some Maps clients ignore waypoints. Verify every stop or open separate leg links.'] : []));
    start = end - 1;
  }
  return result(input, links, warnings);
}

/** Optional user-saveable shortlist; requires existing genuine Google Place IDs. */
export function buildShortlists(input) {
  const places = validate(input), links = [], warnings = [
    'Shortlists require existing Google Place IDs. Missing IDs are unhandled here; use place links or files for them.',
    'Google may merge repeated places or change display order. Shortlists do not represent ordered stop occurrences.',
    'Shortlists require user action to save; they do not insert into an existing saved list.'
  ];
  let chunk = [];
  const makeURL = xs => url('@', { map_action: 'shortlist', place_ids: xs.map(p => p.googlePlaceId).join(',') });
  const flush = () => {
    if (chunk.length) links.push(fitLink(`Shortlist part ${links.length + 1}`, makeURL(chunk), chunk, warnings.slice(1)));
    chunk = [];
  };
  for (const p of places) {
    if (!p.googlePlaceId) continue;
    if (chunk.length && (chunk.length === LIMITS.shortlistPlaces || makeURL([...chunk, p]).length > LIMITS.urlCharacters)) flush();
    if (makeURL([p]).length > LIMITS.urlCharacters) continue;
    chunk.push(p);
  }
  flush();
  return result(input, links, warnings);
}

const csvCell = value => {
  let s = String(value ?? '');
  // Quoting alone does not stop spreadsheet formula execution. JSON stays exact.
  if (/^[\s\uFEFF]*[=+\-@]/u.test(s) || /^[\t\r\n]/u.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
};

/** Full lossless JSON + conservative CSV parts for manual My Maps import. */
export function buildSelectionFiles(input) {
  const places = validate(input);
  const files = [{ name: 'selected-places.json', mimeType: 'application/json;charset=utf-8',
    content: JSON.stringify(input, null, 2) + '\n', selectionIds: places.map(p => p.selectionId), warnings: [] }];
  // Seven columns × 1,000 rows leaves room under the documented 20,000-cell map limit.
  const header = ['Order', 'Selection ID', 'Place key', 'Name', 'Search location', 'Address', 'Google Place ID'];
  const row = (p, i) => [i + 1, p.selectionId, p.placeKey, p.name, destination(p), p.address, p.googlePlaceId].map(csvCell).join(',') + '\r\n';
  const head = '\uFEFF' + header.map(csvCell).join(',') + '\r\n';
  const encoder = new TextEncoder();
  let part = [], content = head, bytes = encoder.encode(head).length;
  const flush = () => {
    if (!part.length) return;
    files.push({ name: `selected-places-${String(files.length).padStart(3, '0')}.csv`, mimeType: 'text/csv;charset=utf-8',
      content, selectionIds: part.map(p => p.selectionId), warnings: [
        'Import Search location as the location column and Name as the title. Verify geocoding and use Order to inspect the original sequence.',
        'CSV cells with spreadsheet formula prefixes are apostrophe-protected. JSON preserves exact original text.',
        'CSV parts are location records, not routes, saved lists or a planner backup. My Maps map-wide limits may require separate maps.'
      ] });
    part = []; content = head; bytes = encoder.encode(head).length;
  };
  const warnings = [];
  places.forEach((p, i) => {
    const line = row(p, i), size = encoder.encode(line).length;
    if (size + encoder.encode(head).length > LIMITS.csvBytes) {
      warnings.push(`${p.selectionId}: too large for a My Maps CSV file; preserved in selected-places.json.`);
      return;
    }
    if (part.length && (part.length === LIMITS.csvRows || bytes + size > LIMITS.csvBytes)) flush();
    part.push(p); content += line; bytes += size;
  });
  flush();
  return { schemaVersion: 1, files, warnings };
}
