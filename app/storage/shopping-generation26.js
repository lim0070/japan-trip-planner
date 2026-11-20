import { validateReviewedDelta } from "./shopping-reviewed-delta.js";

export const generation26Registry = Object.freeze({
  bytes: 755,
  sha256: "203411ff94fcd4d31d4dd9dc8d4188390504d54acf39c34184237aadd534138e",
});

export const generation26Citations = [
  {
    key: "shopping:overture:257ed14c-57f7-4922-ac90-77a788f9728b",
    field: "address.prefecture",
    url: "https://www.city.nagoya.jp/_res/projects/default_project/_page_/001/010/571/keikakushiryo81-86_2025.pdf",
    href: "https://www.city.nagoya.jp/_res/projects/default_project/_page_/001/010/571/keikakushiryo81-86_2025.pdf#page=7",
    label: "Nagoya City disaster planning materials (PDF, 1,385,743 bytes, page 7)",
    observedAt: "2026-11-20T07:55:24.167482Z",
    bytes: 1385743,
    page: 7,
    printedPage: 371,
    section: "row 38",
  },
  {
    key: "shopping:overture:9305eed5-3df9-426f-922b-8fd267c168b0",
    field: "address.prefecture",
    url: "https://www.env.go.jp/policy/etv/pdf/plan/01s.pdf",
    href: "https://www.env.go.jp/policy/etv/pdf/plan/01s.pdf#page=8",
    label: "Ministry of the Environment website (PDF, 536,900 bytes, page 8)",
    observedAt: "2026-11-20T07:51:55.058986Z",
    bytes: 536900,
    page: 8,
    attribution: "Ministry of the Environment website. Prefecture derived by Japan Shopping Data.",
    printedPage: 4,
    section: "3.1, table 3-1",
    documentDate: "2003-11-14",
  },
  {
    key: "shopping:overture:9fa1300a-42ee-4351-b983-d12843552c56",
    field: "hoursText",
    url: "https://acrossplaza.jp/_img/news/akishima/202603.pdf",
    href: "https://acrossplaza.jp/_img/news/akishima/202603.pdf#page=2",
    label: "Across Plaza Akishima (PDF, 6,817,653 bytes, page 2)",
    observedAt: "2026-11-20T07:53:40.188420Z",
    bytes: 6817653,
    page: 2,
    documentMonth: "2026-03",
  },
];

const reviewed = new Map([
  ["shopping:overture:23839253-e2d8-4448-8afe-55a5c4641717", ["address.prefecture", "埼玉県"]],
  ["shopping:overture:257ed14c-57f7-4922-ac90-77a788f9728b", ["address.prefecture", "愛知県"]],
  ["shopping:overture:2f5984f3-1473-4a46-93aa-1deb8f59568c", ["address.prefecture", "群馬県"]],
  ["shopping:overture:3d6c9a0a-0e44-48ae-b4ea-7eea59e0c3e6", ["address.prefecture", "佐賀県"]],
  ["shopping:overture:4591dbba-40ae-4b17-a76e-c925d5acc59a", ["address.prefecture", "神奈川県"]],
  ["shopping:overture:65c82506-f05c-4b32-b196-ada0b091718b", ["address.prefecture", "福岡県"]],
  ["shopping:overture:748bada2-0387-40b7-b69d-eb84380e9106", ["address.prefecture", "埼玉県"]],
  ["shopping:overture:827c8e30-601f-4dab-b997-87ca1ae9e2ff", ["address.prefecture", "福島県"]],
  ["shopping:overture:891f1947-f5c6-4bda-9797-8e1ec3849ffc", ["address.prefecture", "熊本県"]],
  ["shopping:overture:9305eed5-3df9-426f-922b-8fd267c168b0", ["address.prefecture", "大阪府"]],
  ["shopping:overture:b36d8bad-8fd9-4361-84a6-cb447b1a1433", ["address.prefecture", "鹿児島県"]],
  ["shopping:overture:bbc4b346-8776-4106-b614-dcd88e12a0ed", ["address.prefecture", "東京都"]],
  ["shopping:overture:e1a21d27-cd46-4b5f-af67-f537de54d0cf", ["address.prefecture", "福井県"]],
  ["shopping:overture:ee7e5422-5e38-44b7-977f-07ca060765ac", ["address.prefecture", "静岡県"]],
  ["shopping:overture:ef4ad7a1-cbda-4749-86dd-e5e6a3dfe1e0", ["address.prefecture", "熊本県"]],
  ["shopping:overture:fd2599a0-9650-4433-be89-1669c144b779", ["address.prefecture", "大阪府"]],
  ["shopping:overture:172c1b17-c64b-487d-b638-4e66c18323b6", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
  ["shopping:overture:830c408c-ba40-4a3a-93ea-93ca75fd383f", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
  ["shopping:overture:9fa1300a-42ee-4351-b983-d12843552c56", ["hoursText", "Tenant reference from March 2026: 10:00–20:00. Dated exceptions unverified."]],
  ["shopping:overture:c2f96ae9-b519-4882-ae06-237bec6005ef", ["hoursText", "Tenant reference weekdays 11:00–20:00, weekends and public holidays 10:00–20:00. Exceptions unverified."]],
  ["shopping:overture:ed05253a-48fe-42d5-ba17-ab74d222be4b", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:fe39a6e6-ab31-43d3-8451-90fddb0ebf10", ["hoursText", "Tenant reference weekdays 11:00–20:00, weekends and public holidays 10:00–20:00. Exceptions unverified."]],
  ["shopping:overture:ffa00bf7-f9f5-4e68-b1aa-f529b531befc", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
]);

export function validateGeneration26(base, next, overlay) {
  validateReviewedDelta(base, next, overlay, {
    generation: 26,
    parentManifest: "a35aea74593fe57a1328e722d553d6a7945c391271cf4cf0f3a37b846e491412",
    reviewed,
    checkSource(place, decision) {
      const citation = generation26Citations.find(source => source.key === place.key);
      if (!citation) return;
      if (decision.sourceUrl !== citation.url || decision.sourcePageUrl !== citation.href ||
          decision.sourceLabel !== citation.label || decision.observedAt !== citation.observedAt ||
          decision.sourceMediaType !== "application/pdf" ||
          decision.sourcePage !== citation.page || decision.sourceBytes !== citation.bytes ||
          decision.sourceAttribution !== citation.attribution ||
          decision.sourcePrintedPage !== citation.printedPage || decision.sourceSection !== citation.section ||
          decision.sourceDocumentDate !== citation.documentDate || decision.sourceDocumentMonth !== citation.documentMonth)
        throw Error("Shopping PDF citation differs from the reviewed source");
    },
  });
}
