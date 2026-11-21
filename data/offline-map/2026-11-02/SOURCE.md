# Japan offline orientation maps

© OpenStreetMap contributors. Source extract by Geofabrik. All three regional GeoJSON derivatives are distributed under the Open Data Commons Open Database License 1.0. Show the OpenStreetMap credit and licence link on each displayed map. [OpenStreetMap copyright](https://www.openstreetmap.org/copyright) · [Full licence](LICENSE.txt)

## Free download of the complete derivatives

Each link below provides the entire machine-readable derivative used to render its region. Keep these files, the manifest, and the notices together when distributing the packs. Each file contains only public OpenStreetMap geometry and labels.

- [Central Tokyo](packs/tokyo-central.geojson) covers the central wards from Shinjuku and Shibuya east to Asakusa, including Tokyo Station and Ueno.
- [Sendai to Matsushima Bay](packs/sendai-matsushima.geojson) covers central Sendai, the corridor through Shiogama, Matsushima and part of the bay.
- [Central Yamagata City](packs/yamagata-city.geojson) covers Yamagata Station, the centre and nearby neighbourhoods.

The manifest gives the exact WGS84 coverage in west, south, east, north order, the source date, feature counts, byte lengths and SHA-256 digests. A region can be stored or replaced independently. Offline coverage is limited to features drawn inside its rectangle.

## Source and modifications

The input was the local, previously downloaded Geofabrik Japan extract dated 2026-11-01 21:21:36 UTC. The original file contains 2,566,575,684 bytes and its recorded MD5 is a49fa3af3d11e1702d236cd86dde67fb. [Original extract](https://download.geofabrik.de/asia/japan-261101.osm.pbf) · [Geofabrik download documentation](https://www.geofabrik.de/data/download.html)

The builder selects principal through-roads down to tertiary class, rail and tram lines, rivers and canals, coastline, and named station and settlement nodes. Sidings, service tracks and mapped road areas are excluded. Ways are clipped to their region, simplified to an approximate five-metre tolerance and rounded to five decimal places. Water and coastline appear as lines. Point and line labels retain available source names and supplied Japanese and English variants. Features retain their OSM node or way identifiers. These are dated orientation maps. Minor streets, pedestrian paths, entrances, platform layouts, current services and navigable routes require other information.

Run the following with Python 3.9+ and pyosmium 4.3.2. The builder checks the source MD5, creates and removes a temporary disk index in this directory, then writes the packs and manifest. The validator uses the Python standard library.

```sh
python3 -B build_packs.py /path/to/japan-261101.osm.pbf --deps /path/to/python/packages
python3 -B validate_packs.py
```
