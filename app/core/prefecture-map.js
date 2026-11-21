import { prefectures } from "./together.js";

// North is up. Each index is a column, with empty cells separating the islands.
const rows = [
  { 12: 1 },
  {},
  { 12: 2 },
  { 11: 5, 12: 3 },
  { 11: 6, 12: 4 },
  { 10: 15, 11: 7 },
  { 7: 17, 8: 16, 9: 20, 10: 10, 11: 9, 12: 8 },
  { 3: 32, 4: 31, 5: 28, 6: 26, 7: 18, 8: 21, 9: 19, 11: 11 },
  { 2: 35, 3: 34, 4: 33, 6: 27, 7: 25, 8: 23, 9: 22, 11: 13, 12: 12 },
  { 6: 30, 7: 29, 8: 24, 11: 14 },
  { 2: 41, 3: 40, 5: 38, 6: 37 },
  { 1: 42, 3: 43, 4: 44, 5: 39, 6: 36 },
  { 3: 46, 4: 45 },
  { 1: 47 },
];
const tiles = rows.flatMap((columns, y) => Object.entries(columns).map(([x, code]) => ({
  place: prefectures[code - 1], x, y: y + 1,
})));
const numberOfPrefectures = prefectures.length;

export function prefectureMapHTML(visited, esc) {
  const checked = new Set(visited);
  const names = prefectures.filter(({ code }) => checked.has(code)).map(({ en }) => en);
  const status = names.length ? " Visited: " + names.join(", ") + "." : "";
  return `<figure class="prefecture-map">
    <figcaption><strong>Prefecture map</strong><small class="muted">Approximate geography</small></figcaption>
    <div class="prefecture-map-grid" role="img" aria-label="${esc(names.length + " of " + numberOfPrefectures + " prefectures visited." + status)}">
      ${tiles.map(({ place, x, y }) => {
        const { code, ja, en } = place;
        const selected = checked.has(code);
        const label = ja.replace(/[都府県]$/u, "").slice(0, 2);
        return `<span aria-hidden="true" data-prefecture-code="${code}" data-visited="${selected}" lang="ja"
          title="${esc(en + " · " + ja + " · " + (selected ? "Visited" : "Unconfirmed"))}"
          style="grid-row:${y};grid-column:${x}">${esc(label)}</span>`;
      }).join("")}
    </div>
    <p class="prefecture-map-key"><span><i aria-hidden="true" data-visited="true"></i>Visited</span>
      <span><i aria-hidden="true" data-visited="false"></i>Unconfirmed</span></p>
  </figure>`;
}
