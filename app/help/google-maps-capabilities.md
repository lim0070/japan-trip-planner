# Google Maps handoff capabilities

Official sources checked November 2, 2026. Documentation review establishes supported syntax; this module does not claim a live test on every installed Google Maps app.

| Handoff | Supported boundary and module policy |
| --- | --- |
| Place search | Name/address, coordinates or an existing Google Place ID; `api=1`, key-free HTTPS. Exact resolved place still needs checking. |
| Ordered directions | URLs list intermediates in order. Documented URL ceiling: 2,048 characters after encoding. Waypoint limits: 3 on mobile browsers, 9 otherwise; some products ignore waypoints. Default module links use no waypoints. |
| Grouped preview | Optional mobile chunks use 3 intermediates; desktop uses 8 because Maps Help gives a stricter 9-stop limit including destination. Consecutive chunks overlap at their boundary. |
| Shortlist | Official URL action accepts at most 20 existing Place IDs; user can save it in Maps. Optional only; no existing-list insertion or guaranteed occurrence order. |

Sources: [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started), [Maps directions Help](https://support.google.com/maps/answer/144339?hl=en&co=GENIE.Platform%3DDesktop).

Transit directions do not support multiple destinations. Export each adjacent leg, then choose date/time in Google Maps. The universal URL parameter reference supplies no documented departure-time parameter; we emit none. Transit availability depends on local providers. Selected order expresses user intent and does not establish a feasible timetable. [Directions and travel time controls](https://support.google.com/maps/answer/144339?hl=en&co=GENIE.Platform%3DDesktop).

My Maps supports CSV, TSV, KML/KMZ, GPX, XLSX and Google Sheets import on a computer, with location names, addresses or coordinates. Limits: 2,000 rows/import; unzipped KML/KMZ 5 MB, other files 40 MB. This module exports CSV parts of at most 1,000 records and 39 MB, plus exact JSON. Import is a manual Google-account workflow, not a Maps saved list. [Import documentation](https://support.google.com/mymaps/answer/3024836?hl=en).

A My Maps layer allows 2,000 features; the entire map allows 10,000 features and 20,000 table cells. The seven-column CSV schema intentionally uses smaller parts, but multiple parts can still exceed an existing map's remaining allowance. Create additional maps as needed; no export is silently discarded. [My Maps map/layer limits](https://support.google.com/mymaps/answer/3433053?hl=en).

Google documents manually opening a place and choosing Save/a list, and sharing existing lists. This module neither authenticates to Google nor writes an existing saved list. Its optional shortlist is a user-opened handoff, not programmatic persistence. [Saved-list workflow](https://support.google.com/maps/answer/7280933?hl=en).

CSV is preferred here over KML because names/addresses are available when coordinates are approximate or unknown. CSV import may geocode ambiguously; verify matches. JSON retains every input field, stable ID, Japanese string and repeated selection occurrence. Neither file claims routes, optimized order or exact schedules.
