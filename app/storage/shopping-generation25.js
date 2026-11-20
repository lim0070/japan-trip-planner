import { validateReviewedDelta } from "./shopping-reviewed-delta.js";

export const generation25Registry = Object.freeze({
  bytes: 755,
  sha256: "0ce9b49b846fb1049307dbfe4208a08cf8937e217d6e39e1f1e1c3fb8d599a65",
});

export const noctySource = Object.freeze({
  key: "shopping:overture:ebf57277-3023-4503-a0cd-9f70f2685a54",
  field: "hoursText",
  url: "https://www.nocty.jp/shop/detail.html?sid=7372",
  label: "Nocty Plaza",
});

const reviewed = new Map([
  ["shopping:overture:3df389a3-3fd4-49d0-ab99-96bb31c1c27c", ["address.prefecture", "東京都"]],
  ["shopping:overture:6da067bc-4dd8-4c01-bbd2-2df0bfeea23d", ["address.prefecture", "宮城県"]],
  ["shopping:overture:ddf8f22e-c3ac-4a6a-aaa6-682a8b59323e", ["address.prefecture", "東京都"]],
  ["shopping:overture:172837cd-f691-4ea6-8368-b2f84ba265ec", ["hoursText", "Tenant reference 09:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:3a14c584-70cc-4c32-819d-4a1753bb163f", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:3cfde7de-6a41-43e6-a024-11d3c2e4e4be", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:5f838d47-8bf2-4030-bdf4-7ff201c800d4", ["hoursText", "Tenant reference weekdays 10:00–20:00, weekends and holidays 10:00–20:00. Exceptions unverified."]],
  ["shopping:overture:8250b8ce-c3cf-47f0-b961-208d7d05a9b3", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:8ee067a8-70f3-4a3b-bfc5-24f121ccd6a9", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:93a08679-47a7-440b-97df-4cc6231be1c7", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
  ["shopping:overture:a7583991-85ab-4d42-abde-e04dac3df353", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:c1acff23-a284-4c2c-9278-32269d92c4ae", ["hoursText", "Tenant reference 11:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:c6e7c28c-248c-4833-b949-21d482ca7cfe", ["hoursText", "Tenant reference 10:00–21:00. Days and exceptions unverified."]],
  ["shopping:overture:d7951ac2-63bb-428f-970b-868ab3c2d358", ["hoursText", "Tenant reference 10:00–20:00. Days and exceptions unverified."]],
  ["shopping:overture:ebf57277-3023-4503-a0cd-9f70f2685a54", ["hoursText", "Tenant reference weekdays 10:30–20:30, weekends and holidays 10:30–20:30. Exceptions unverified."]],
]);

export function validateGeneration25(base, next, overlay) {
  validateReviewedDelta(base, next, overlay, {
    generation: 25,
    parentManifest: "2631651299a1196d63bb537d6cdc15e5a8e8f336f3c0ba894c776be3d0c84cc9",
    reviewed,
    checkSource(place, decision, evidence) {
      if (place.key === noctySource.key &&
          (decision.sourceUrl !== noctySource.url || decision.sourceLabel !== noctySource.label ||
           decision.sourceLinkCondition !== "separate-window-or-tab" ||
           !evidence.note?.startsWith(noctySource.label)))
        throw Error("Nocty Plaza link differs from the reviewed source");
    },
  });
}
