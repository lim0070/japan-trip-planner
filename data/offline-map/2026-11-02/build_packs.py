"""Build three small orientation maps from a local Geofabrik OSM PBF (pyosmium 4)."""
import argparse
import collections
import datetime
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import time

OUT = Path(__file__).resolve().parent
REGIONS = {
    "tokyo-central": ("Central Tokyo", (139.680, 35.620, 139.833, 35.736)),
    "sendai-matsushima": ("Sendai to Matsushima Bay", (140.840, 38.230, 141.105, 38.401)),
    "yamagata-city": ("Central Yamagata City", (140.292, 38.210, 140.375, 38.292)),
}
ROAD = {"motorway", "trunk", "primary", "secondary", "tertiary"}
RAIL = {"rail", "subway", "light_rail", "tram", "monorail", "funicular", "narrow_gauge"}
PLACE = {"city", "town", "village", "suburb", "quarter"}
STATION = {"station", "halt", "tram_stop"}
WATERWAY = {"river", "canal"}
SOURCE_TIMESTAMP = "2026-11-01T21:21:36Z"
SOURCE_MD5 = "a49fa3af3d11e1702d236cd86dde67fb"
ATTRIBUTION = "© OpenStreetMap contributors; extract by Geofabrik"
CATEGORIES = ("road", "rail", "water", "station", "place")


def write_json(path, obj, pretty=False):
    path.write_text(json.dumps(obj, ensure_ascii=False, allow_nan=False,
                               indent=2 if pretty else None,
                               separators=None if pretty else (",", ":")) + "\n", encoding="utf-8")


def contains(bounds, point):
    w, s, e, n = bounds
    x, y = point
    return w <= x <= e and s <= y <= n


def clip_segment(a, b, bounds):
    """Liang–Barsky clips straight segments even when both endpoints are outside."""
    w, s, e, n = bounds
    x, y = a
    dx, dy = b[0] - x, b[1] - y
    low, high = 0.0, 1.0
    for p, q in ((-dx, x-w), (dx, e-x), (-dy, y-s), (dy, n-y)):
        if not p:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            low = max(low, t)
        else:
            high = min(high, t)
        if low > high:
            return None
    def endpoint(t):
        return (round(max(w, min(e, x + t*dx)), 5),
                round(max(s, min(n, y + t*dy)), 5))
    return endpoint(low), endpoint(high)


def clipped_parts(coords, bounds):
    part = []
    for a, b in zip(coords, coords[1:]):
        segment = clip_segment(a, b, bounds) if a and b else None
        if segment is None:
            if len(part) >= 2:
                yield part
            part = []
            continue
        start, end = segment
        if start == end:
            continue
        if part and start != part[-1]:
            if len(part) >= 2:
                yield part
            part = []
        if not part:
            part.append(start)
        part.append(end)
    if len(part) >= 2:
        yield part


def simplified(points):
    """Douglas–Peucker, ~5 m in a local planar approximation."""
    if len(points) < 3:
        return points
    xscale = math.cos(math.radians(points[0][1]))
    xy = [(x * xscale, y) for x, y in points]
    keep = {0, len(points)-1}
    stack = [(0, len(points)-1)]
    tolerance_sq = (5 / 111_200) ** 2
    while stack:
        left, right = stack.pop()
        ax, ay = xy[left]
        bx, by = xy[right]
        dx, dy = bx-ax, by-ay
        length_sq = dx*dx + dy*dy
        farthest, distance = None, tolerance_sq
        for i in range(left+1, right):
            px, py = xy[i]
            t = max(0, min(1, ((px-ax)*dx + (py-ay)*dy)/length_sq)) if length_sq else 0
            squared = (px-ax-t*dx)**2 + (py-ay-t*dy)**2
            if squared > distance:
                farthest, distance = i, squared
        if farthest is not None:
            keep.add(farthest)
            stack.extend(((left, farthest), (farthest, right)))
    return [points[i] for i in sorted(keep)]


def properties(tags, kind, category):
    result = {"kind":kind, "class":category}
    for source, target in (("name","name"),("name:ja","nameJa"),("name:en","nameEn")):
        if tags.get(source):
            result[target] = tags.get(source)
    if "name" not in result and (result.get("nameJa") or result.get("nameEn")):
        result["name"] = result.get("nameJa") or result["nameEn"]
    if kind == "road" and tags.get("ref"):
        result["ref"] = tags.get("ref")
    return result


def feature(geom_type, coords, props, osm_id):
    return {"type":"Feature","id":osm_id,"properties":props,
            "geometry":{"type":geom_type,"coordinates":coords}}


def classify_way(tags):
    if tags.get("highway") in ROAD:
        return "road", tags["highway"]
    if tags.get("railway") in RAIL and not tags.get("service"):
        return "rail", tags["railway"]
    if tags.get("waterway") in WATERWAY:
        return "water", tags["waterway"]
    if tags.get("natural") == "coastline":
        return "water", "coastline"
    return None


def run(pbf, deps):
    sys.path.insert(0, str(deps.resolve()))
    import osmium
    start = time.monotonic()
    packs = {key:[] for key in REGIONS}
    def status(message):
        print(f"{time.monotonic()-start:.1f}s {message}", flush=True)
    class Points(osmium.SimpleHandler):
        def node(self, node):
            if not node.location.valid():
                return
            point = (round(node.location.lon, 5), round(node.location.lat, 5))
            for key, (_, bounds) in REGIONS.items():
                if contains(bounds, point):
                    tags = node.tags
                    kind, cls = ("station", tags["railway"]) if tags.get("railway") in STATION else ("place", tags["place"])
                    props = properties(tags, kind, cls)
                    if props.get("name"):
                        packs[key].append(feature("Point", point, props, "node/"+str(node.id)))
    class Lines(osmium.SimpleHandler):
        def way(self, way):
            label = classify_way(way.tags)
            if not label or len(way.nodes) < 2 or way.tags.get("area") == "yes":
                return
            # These short-circuit checks keep domestic national scans feasible.
            # Every segment is accounted for: coarse bounding uses ALL valid vertices.
            coords = [(loc.lon,loc.lat) if loc.valid() else None
                      for loc in (ref.location for ref in way.nodes)]
            valid = [p for p in coords if p is not None]
            if len(valid) < 2:
                return
            west, south = map(min, zip(*valid))
            east, north = map(max, zip(*valid))
            for key, (_, (w,s,e,n)) in REGIONS.items():
                if west > e or east < w or south > n or north < s:
                    continue
                props = properties(way.tags, *label)
                for i, part in enumerate(clipped_parts(coords, (w,s,e,n))):
                    line = simplified(part)
                    if len(set(line)) < 2:
                        continue
                    packs[key].append(feature("LineString", line, props, f"way/{way.id}/{i}"))
    tags = osmium.filter.TagFilter
    point_filter = tags(*[("railway", t) for t in STATION], *[("place", t) for t in PLACE])
    way_filter = tags(*[("highway", t) for t in ROAD], *[("railway", t) for t in RAIL],
                      *[("waterway", t) for t in WATERWAY], ("natural","coastline"))
    with tempfile.TemporaryDirectory(dir=OUT) as tmp:
        index = osmium.index.create_map("sparse_file_array," + str(Path(tmp)/"nodes.idx"))
        positions = osmium.NodeLocationsForWays(index)
        positions.ignore_errors()
        status("Indexing nodes and selecting named regional stations and places")
        with osmium.io.Reader(str(pbf), osmium.osm.NODE) as reader:
            osmium.apply(reader, positions, point_filter, Points())
        status("Indexed nodes; named points per region: " + str({k:len(v) for k,v in packs.items()}))
        with osmium.io.Reader(str(pbf), osmium.osm.WAY) as reader:
            osmium.apply(reader, way_filter, positions, Lines())
        del positions, index
    manifest = {"schemaVersion":1,"sourceDataAsOf":SOURCE_TIMESTAMP,"attribution":ATTRIBUTION,
                "license":"ODbL-1.0","licensePath":"LICENSE.txt","sourcePath":"SOURCE.md","regions":[]}
    (OUT/"packs").mkdir(exist_ok=True)
    for key, (name,bounds) in REGIONS.items():
        features = packs[key]
        path = Path("packs")/(key+".geojson")
        counts = collections.Counter(f["properties"]["kind"] for f in features)
        write_json(OUT/path, {"type":"FeatureCollection","bbox":bounds,"features":features})
        raw = (OUT/path).read_bytes()
        manifest["regions"].append({"id":key,"name":name,"bbox":bounds,"path":str(path),"bytes":len(raw),
                                    "sha256":hashlib.sha256(raw).hexdigest(),"featureCount":len(features),
                                    "counts":{k:counts[k] for k in CATEGORIES}})
    write_json(OUT/"manifest.json",manifest,True)
    status("Wrote all regional packs and manifest")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pbf", type=Path)
    parser.add_argument("--deps",type=Path,default=Path("."))
    args = parser.parse_args()
    digest = hashlib.md5()
    with args.pbf.open("rb") as file:
        for block in iter(lambda:file.read(8*1024*1024), b""):
            digest.update(block)
    if digest.hexdigest() != SOURCE_MD5:
        parser.error("Source checksum does not match the documented Japan extract")
    run(args.pbf, args.deps)
