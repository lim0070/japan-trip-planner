# Station-area map data

The exact derived database is [station-pack-20261101.json](./station-pack-20261101.json). It may be downloaded and reused under the Open Database License 1.0. Keep the file available wherever the guide distributes these station features.

© OpenStreetMap contributors. Geofabrik supplied the Japan extract. The snapshot represents 2026-11-01 at 21:21:36 UTC. Object links identify the feature on the current OSM site. Each database row records its version and retains the tags from this snapshot. [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) · [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) · [Source extract](https://download.geofabrik.de/asia/japan-261101.osm.pbf)

## Reading the data

Each station has a mapped railway station node as its center. Features lie within 600 metres of that point. The displayed distance is a rounded straight-line distance. Some urban points serve other nearby stations. A point’s distance does not establish a route, a particular platform connection, accessibility along the route, or an exit serving a destination. Original OSM tags include entrance references, levels and accessibility where mapped.

The pack includes only point features with railway entrance tags and facilities with explicit passenger luggage evidence. An explicitly tagged luggage locker mapped as a closed way at Shinjuku is also included. Its marker is the mean of the distinct corner coordinates and its complete original ring appears in osmNodes. Each entry represents one mapped OSM object. Separate objects can represent adjacent locker banks. Only the capacity field, when present, gives a mapped number of compartments.

The extraction excludes generic parcel lockers, generic courier offices, unspecified locker vending machines, buildings tagged only with a door, and points tagged closed, restricted, disused, or service-only. A missing access tag leaves public access unconfirmed. No included record explicitly identifies a passenger luggage forwarding service. The Sagawa counter near Tokyo has a Japanese name identifying baggage storage. The Yamato desk near Akihabara is tagged for left luggage. Neither establishes a forwarding service, price, delivery time or hotel eligibility.

Hours, fees, charges, capacity by size and payment methods are original source tags. A fee tag alone gives no amount. A compartment category gives no physical dimensions. Missing values are unknown. No availability checks or physical inspections were performed.

## Reproduction

The local input was japan-261101.osm.pbf, 2,566,575,684 bytes with SHA-256 34784d4e2cb82fce8e76cdcba38b76422295686b9639facbc05162441aa6f05d. Its MD5 agreed with the cached Geofabrik metadata. The extractor scanned tagged nodes in broad rectangles around the search seeds, located exact named station centers, filtered to the 600-metre radius, checked tagged luggage ways and preserved source versions, positions and tags. The verification independently reopened the PBF, compared every included object and way vertex, and recomputed every distance using spherical trigonometry. The machine-readable coverage totals and the pack checksum are in [station-evidence-20261101.json](./station-evidence-20261101.json).
