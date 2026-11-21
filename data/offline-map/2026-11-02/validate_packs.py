"""Validate regional GeoJSON packs and report station-label evidence."""

import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path


REGIONS = {
    "tokyo-central": {
        "area": (139.55, 35.50, 139.96, 35.85),
        "anchors": [(139.767, 35.681)],
        "labels": [("Tokyo", "東京", "とうきょう"), ("Ueno", "上野")],
    },
    "sendai-matsushima": {
        "area": (140.65, 38.08, 141.28, 38.57),
        "anchors": [(140.882, 38.261), (141.058, 38.369)],
        "labels": [("Sendai", "仙台"), ("Matsushima", "松島")],
    },
    "yamagata-city": {
        "area": (140.14, 38.09, 140.53, 38.42),
        "anchors": [(140.327, 38.249)],
        "labels": [("Yamagata", "山形", "やまがた")],
    },
}
KINDS = {"station", "place", "road", "rail", "water"}
MAX_BYTES = 32 * 1024 * 1024


def require(test, message):
    if not test:
        raise ValueError(message)


def number(value):
    return type(value) in (float, int) and math.isfinite(value)


def bounds_contain(box, point):
    return box[0] <= point[0] <= box[2] and box[1] <= point[1] <= box[3]


def bounded_read(path, limit):
    require(0 < path.stat().st_size <= limit, f"{path.name}: unexpected file size")
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    require(len(data) <= limit, f"{path.name}: file grew during validation")
    return data


def fold(label):
    return unicodedata.normalize("NFKC", label).casefold().strip()


def validate_region(root, region):
    key = region["id"]
    expected = REGIONS[key]
    where = f"{key}: "
    path = root / "packs" / (key + ".geojson")
    require(region["path"] == f"packs/{key}.geojson", where + "unexpected pack path")
    require(isinstance(region["name"], str) and region["name"].strip(), where + "missing name")
    raw = bounded_read(path, MAX_BYTES)
    require(len(raw) == region["bytes"], where + "byte count differs")
    checksum = hashlib.sha256(raw).hexdigest()
    require(checksum == region["sha256"], where + "SHA-256 differs")
    pack = json.loads(raw)
    require(pack["type"] == "FeatureCollection", where + "expected FeatureCollection")
    bbox = region["bbox"]
    require(isinstance(bbox, list) and len(bbox) == 4 and all(map(number, bbox)),
            where + "invalid WGS84 bounds")
    require(bbox == pack["bbox"], where + "GeoJSON and manifest extents differ")
    require(bbox[0] < bbox[2] and bbox[1] < bbox[3], where + "inverted or empty bounds")
    require(bounds_contain(expected["area"], bbox[:2]) and
            bounds_contain(expected["area"], bbox[2:]), where + "extent outside expected region")
    for anchor in expected["anchors"]:
        require(bounds_contain(bbox, anchor), where + f"city centre outside map bounds: {anchor}")
    counts = Counter()
    stations = set()
    samples = {}
    extent = [180.0, 90.0, -180.0, -90.0]
    features = pack["features"]
    require(isinstance(features, list) and len(features) == region["featureCount"],
            where + "feature count differs")
    for index, feature in enumerate(features):
        context = f"{where}feature {index}: "
        require(feature["type"] == "Feature", context + "expected Feature")
        props = feature["properties"]
        kind = props["kind"]
        require(kind in KINDS and isinstance(props["class"], str) and props["class"].strip(),
                context + "invalid kind or class")
        labels = [props[field] for field in ("name", "nameJa", "nameEn") if field in props]
        require(all(isinstance(label, str) and label.strip() for label in labels),
                context + "invalid supplied label")
        if labels:
            samples.setdefault(kind, labels[0])
        geo = feature["geometry"]
        if kind in ("station", "place"):
            require(geo["type"] == "Point", context + "label must be a Point")
            points = [geo["coordinates"]]
            if kind == "station":
                stations.update(labels)
        else:
            require(geo["type"] == "LineString", context + "expected LineString")
            points = geo["coordinates"]
            require(isinstance(points, list) and len(points) >= 2, context + "short line")
        for point in points:
            require(isinstance(point, list) and len(point) == 2 and all(map(number, point))
                    and bounds_contain(bbox, point), context + "invalid or out-of-bounds position")
            extent = [min(extent[0], point[0]), min(extent[1], point[1]),
                      max(extent[2], point[0]), max(extent[3], point[1])]
        if geo["type"] == "LineString":
            require(any(point != points[0] for point in points[1:]), context + "collapsed line")
        counts[kind] += 1
    require(set(counts) == KINDS and dict(counts) == region["counts"], where + "kind counts differ")
    require(bool(stations), where + "missing station labels")
    # A coordinate system or clipping mistake should not hide behind a plausible manifest bbox.
    for axis in (0, 1):
        coverage = (extent[axis + 2] - extent[axis]) / (bbox[axis + 2] - bbox[axis])
        require(coverage >= 0.6, where + "features cover too little of the declared extent")
    print(f"{key}: {len(features):,} features, {len(raw):,} bytes, SHA-256 {checksum}")
    print(f"  bounds {bbox}, observed extent {extent}, counts {dict(sorted(counts.items()))}")
    print(f"  source-label samples {samples}")
    for variants in expected["labels"]:
        matches = [label for label in sorted(stations) if fold(label) in {fold(v) for v in variants}]
        if not matches:
            matches = [label for label in sorted(stations) if any(fold(v) in fold(label) for v in variants)]
        print(f"  {variants[0]} station labels: {', '.join(matches[:6]) if matches else 'check manually'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, nargs="?", default=Path(__file__).resolve().parent)
    root = parser.parse_args().root
    manifest = json.loads(bounded_read(root / "manifest.json", 256 * 1024))
    require(manifest["schemaVersion"] == 1, "unsupported manifest version")
    require(re.fullmatch(r"\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|[+]00:00)", manifest["sourceDataAsOf"]),
            "missing UTC source timestamp")
    require("openstreetmap" in manifest["attribution"].lower() and
            "contributor" in manifest["attribution"].lower(), "missing OSM attribution")
    require("odbl" in manifest["license"].lower(), "missing ODbL declaration")
    regions = manifest["regions"]
    require(len(regions) == len(REGIONS) and {r["id"] for r in regions} == set(REGIONS),
            "expected exactly the three agreed regions")
    for region in regions:
        validate_region(root, region)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, IndexError) as error:
        print(f"Validation failed: {error}", file=sys.stderr)
        sys.exit(1)
