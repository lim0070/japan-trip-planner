# 旅のしおり · Japan Trip Planner

A personal, local-first Japan trip notebook. Open `app/` to plan inclusive trip dates, ordered daily visits, saved places and award-map discovery.

- Vanilla JavaScript, IndexedDB and locally bundled Leaflet/MarkerCluster; no account, backend or paid API.
- All itinerary dates/times are Japan time. Travel estimates are rough planning assumptions, not timetable or road-routing results.
- Duplicate visits keep independent notes/durations. Manual travel times belong to an ordered visit pair and mode. Unknown legs keep downstream times unknown.
- Bundled SAUNACHELIN and Tabelog Hyakumeiten snapshots preserve source IDs and award memberships. Award history is not evidence a venue is operating. Approximate pins are not verified entrances.
- Export full/per-trip JSON backups. Local browser storage is not a backup and does not synchronize between devices.
- Previously loaded shell, bundled data and editing work offline. The basemap may be blank. No offline tile-area downloads.
- User-submitted Nominatim search is for personal use on one actively searching device only. It is not autocomplete; do not send confidential addresses. Disable or switch the endpoint in `app/config.json` before wider/concurrent use. See [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) and [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/).

## Installation

Open the HTTPS app in iPhone Safari, then Share → Add to Home Screen. Load once online and keep a backup outside the browser before travelling. Physical iPhone installation and real GPS should be checked on the device.

## Static hosting

This repository contains only the sanitized static publication assets. GitHub Pages serves the root and redirects to `app/`. Paths support a repository subdirectory. No build command or API key is required. Leaflet/MarkerCluster licence notices are in `app/vendor/`.

The sample January 11–17, 2027 week is clearly labelled illustrative: Tokyo → Sendai → Yamagata → Matsushima. It is not validated winter travel advice; Hakodate is a later extension.
