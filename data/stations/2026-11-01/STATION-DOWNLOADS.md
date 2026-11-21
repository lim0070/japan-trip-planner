# Individual station downloads

These five self-contained JSON files contain 474 mapped station-area features from the November 1, 2026 snapshot. Each file has the same format as the complete derived database, with one station in its `stations` array. Each station includes its original center, source object and version, tags, ordered features, and any recorded geometry.

| Download | Features | Bytes |
| --- | ---: | ---: |
| [Tokyo](station-tokyo-20261101.json) | 70 | 15,344 |
| [Shinjuku](station-shinjuku-20261101.json) | 126 | 29,349 |
| [Shibuya](station-shibuya-20261101.json) | 36 | 10,033 |
| [Kyoto](station-kyoto-20261101.json) | 16 | 4,315 |
| [Osaka](station-osaka-20261101.json) | 226 | 46,781 |

The [download manifest](station-downloads-20261101.json) lists the filename, exact byte size and SHA-256 of each file. It also identifies the complete source pack, its accompanying notice, and the upstream extract. The original pack is 204,522 bytes, with SHA-256 `59f392cea0eb324e877cd92c6d31e303598635aecef9b424a8c83f8be91eda1d`.

## License and interpretation

© OpenStreetMap contributors, extract by Geofabrik. Each download is a derived database available under the Open Database License 1.0. Keep its attribution and offer the downloadable database wherever the station features are distributed. The source object in each JSON includes the original attribution and license links. [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) · [Original Geofabrik extract](https://download.geofabrik.de/asia/japan-261101.osm.pbf)

The 600-metre search radius and distances are measured from the mapped station center. Nearby features can serve adjoining stations. Public access, walking connections, locker availability, fees and physical dimensions can be unknown. The source notice describes the extraction and feature definitions in more detail.

## Source verification

Each subset was compared to the full ordered station row, source metadata, tags and recorded geometry in the [complete database](station-pack-20261101.json). See [the original notice](STATION-SOURCES.md) for the source and extraction method.
