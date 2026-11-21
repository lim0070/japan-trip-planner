import * as M from "./core/model.js";
import { prefectureMapHTML } from "./core/prefecture-map.js";
import { readPhotoJournal, updatePhotoJournal } from "./storage/db.js";
import {
  applyTripDraft, mergeVotes, parsePhotoPack, parseTripDraft, parseVotes, photoBase64,
  photoDigest, photoDimensions, photoFileLimit, photoLimits, prefectureGroups, prefectureProgress,
  prefectures, privateJpeg, storedPrefecture, tripDraft, validVote, voteCapacity, voteChoices, votePackage,
} from "./core/together.js";

const voteFileLimit = 64 * 1024;

function savePhotos(stop, photos) {
  return updatePhotoJournal(stop, existing => {
    const known = new Map(existing.map(row => [row.id, row]));
    for (const photo of photos) {
      const old = known.get(photo.id);
      if (old && (old.digest !== photo.digest || old.caption !== photo.caption))
        throw Error("This visit has a different photo or caption for the same backup record.");
      if (!old) known.set(photo.id, photo);
    }
    return [...known.values()];
  });
}

function chosenFile(form, size, description) {
  const file = form.get("file");
  if (!file?.size || file.size > size) throw Error(description);
  return file;
}

async function journalImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dimensions = photoDimensions(bytes);
  if (!dimensions?.width || !dimensions.height || dimensions.width * dimensions.height > photoLimits.maxPixels)
    throw Error("Choose a JPEG or PNG photo with up to 24 megapixels.");
  const url = URL.createObjectURL(new Blob([bytes], { type: dimensions.type }));
  try {
    const original = new Image();
    original.src = url;
    await original.decode();
    const scale = Math.min(1, photoLimits.maxSide / Math.max(original.naturalWidth, original.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(original.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(original.naturalHeight * scale));
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(original, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.70, 0.54]) {
      const image = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
      if (image?.type === "image/jpeg" && image.size <= photoLimits.imageBytes) {
        return privateJpeg(new Uint8Array(await image.arrayBuffer()));
      }
    }
    throw Error("This photo could not be compressed to fit. Choose a smaller photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function downloadData(payload, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function createTogether({ getState, getDay, openDay, openAutoPlan, commit, modal, close, setupForm, footer, esc, val, toast }) {
  const findStop = id => getState().stops.find(stop => stop.id === id);
  const findTrip = id => getState().trips.find(trip => trip.id === id);
  const button = (action, id, label) => `<button type="button" data-action="together-${action}" data-id="${esc(id)}">${label}</button>`;
  const dialogBody = () => document.getElementById("dialog-body");
  const visitLabel = stop => {
    const day = getState().days.find(day => day.stopIds.includes(stop.id));
    return [M.name(M.visitPlace(stop)), day?.date].filter(Boolean).join(" · ");
  };
  const showForm = (title, body, label, submit) => {
    modal(title, `<form class="together-dialog">${body}${footer(label)}</form>`, () => {
      const action = dialogBody().querySelector('button[type="submit"]');
      setupForm(async data => {
        if (action.disabled) return;
        action.disabled = true;
        try {
          await submit(data);
        } finally {
          action.disabled = false;
        }
      });
    });
    dialogBody().querySelector("#dialog-title").focus();
  };

  function tripButtons(trip) {
    return button("progress", trip.id, "Prefecture progress") + button("draft", trip.id, "Draft from a sentence");
  }
  function visitTools(stop) {
    return button("photos", stop.id, "Photo journal") + button("votes", stop.id, "Votes &amp; comments");
  }

  function openProgress(trip) {
    const confirmed = new Set(trip.prefectureVisits ?? []);
    const allTrips = prefectureProgress(getState().trips).length;
    const visits = getState().stops.filter(stop => stop.tripId === trip.id);
    const suggestions = new Set(visits.map(stop => storedPrefecture(M.visitPlace(stop).address.prefecture)?.code).filter(Boolean));
    const regions = prefectureGroups.map(([region]) => {
      const options = prefectures.filter(row => row.group === region).map(({ code, en, ja }) =>
        `<label class="check"><input type="checkbox" name="prefecture" value="${code}" ${confirmed.has(code) ? "checked" : ""}><span>${esc(en)} <small lang="ja">${esc(ja)}</small>${suggestions.has(code) ? ' <small class="muted">· on a visit’s address</small>' : ""}</span></label>`).join("");
      return `<fieldset><legend>${esc(region)}</legend>${options}</fieldset>`;
    }).join("");
    showForm("Prefecture progress",
      `<p><strong>${confirmed.size} of 47</strong> confirmed for this trip. ${allTrips} confirmed across your trips.</p>${prefectureMapHTML(confirmed, esc)}<p>Check only the prefectures you actually visited. Stored addresses can help you remember.</p><div class="grid2">${regions}</div>`,
      "Save confirmed visits", async form => {
        const visitCodes = [...new Set(form.getAll("prefecture").map(Number))].filter(code => prefectures.some(row => row.code === code));
        if (await commit(next => {
          const target = next.trips.find(row => row.id === trip.id);
          if (!target) throw Error("This trip no longer exists.");
          target.prefectureVisits = visitCodes;
        })) {
          close();
          toast(`${visitCodes.length} of 47 prefectures confirmed for this trip.`);
        }
      });
  }

  function openDraft(trip) {
    const dates = trip.dayIds.map(id => getState().days.find(day => day.id === id));
    const active = getDay()?.id;
    const options = dates.map(day => `<option value="${esc(day.id)}" ${day.id === active ? "selected" : ""}>${esc(day.date)}</option>`).join("");
    showForm("Draft from a sentence",
      `<label>First day<select name="date" required>${options}</select></label>
      <label>Trip request<input name="request" required maxlength="140" placeholder="Three quiet days in Kyoto, no raw fish"></label>
      <p class="muted">Use 1–7 days, a city or prefecture, and optional preferences for a quieter visit or avoiding raw fish.</p><p class="muted" lang="ja">例：京都で静かな3日間、生魚なし</p>`,
      "Review draft", form => reviewDraft(tripDraft(getState(), val(form, "date"), parseTripDraft(val(form, "request")))));
  }

  function reviewDraft(draft) {
    const choices = draft.days.map((day, index) => {
      const current = day.visits.length ? `<ul>${day.visits.map(visit =>
        `<li>${esc(visit.name)} · ${esc(visit.when)}${visit.locked ? " · locked or booked" : ""}</li>`).join("")}</ul>` : "<p>No planned visits</p>";
      const available = draft.options.filter(option => !day.visits.some(visit => visit.key === option.place.key));
      return `<fieldset><legend>${esc(day.date)}</legend><p><strong>Current plan</strong></p>${current}<label>Proposed additional visit<select name="choice-${index}" ${available.length ? "" : "disabled"}><option value="">Keep this day as is</option>${available.map(({ id, place }) => `<option value="${esc(id)}">${esc(M.name(place))} · ${esc(place.address.city || place.address.prefecture || "Stored area")}</option>`).join("")}</select></label></fieldset>`;
    }).join("");
    const preferences = [draft.request.quiet && "Prefer a quieter visit", draft.request.avoidRawFish && "Avoid raw fish"].filter(Boolean);
    const explanation = `<p>${esc(draft.request.city)} · ${draft.days.length} ${draft.days.length === 1 ? "day" : "days"}${preferences.length ? " · " + esc(preferences.join(" · ")) : ""}</p><p>Append selected Saved Spots to the day. Existing bookings and visit order stay in place. Check venue conditions and ingredients before your visit.</p>`;
    if (!draft.options.length) {
      modal("Compare trip draft", `${explanation}<p>No eligible Saved Spots match the stored area. Save a matching place or try another area.</p>${choices}`);
      dialogBody().querySelector("#dialog-title").focus();
      return;
    }
    const handoff = openAutoPlan ? '<label class="check"><input type="checkbox" name="auto-plan">Open Auto-plan for the first day after adding visits</label>' : "";
    showForm("Compare trip draft", explanation + choices + handoff, "Add selected visits", async form => {
      const picks = draft.days.map((_, index) => val(form, `choice-${index}`));
      if (!picks.some(Boolean)) throw Error("Choose at least one new visit.");
      if (await commit(next => applyTripDraft(next, draft, picks))) {
        close();
        openDay(draft.days[0].id);
        toast("Draft visits added. Use Auto-plan to review timing and order.");
        if (form.has("auto-plan")) openAutoPlan?.();
      }
    });
  }

  const voteLines = votes => `<ul>${votes.map(row => `<li><strong>${voteChoices[row.choice]}</strong>${row.comment ? `<p>${esc(row.comment)}</p>` : ""}</li>`).join("")}</ul>`;
  const totals = votes => Object.entries(voteChoices).map(([key, title]) => `${title} ${votes.filter(row => row.choice === key).length}`).join(" · ");
  const voteActions = hasVotes => `<div class="actions"><button type="button" id="together-vote-export" ${hasVotes ? "" : "disabled"}>Export vote file</button><button type="button" id="together-vote-import">Import vote file</button></div>`;

  function openVotes(stop) {
    const rows = stop.togetherVotes || [];
    const body = `<p>${esc(visitLabel(stop))}</p><p>${totals(rows)}</p>${rows.length ? voteLines(rows) : '<p class="muted">No votes yet.</p>'}${voteActions(rows.length)}`;
    if (rows.length >= voteCapacity) modal("Votes & comments", body + "<p>This visit has reached 40 votes.</p>");
    else showForm("Votes & comments", body + `<label>Vote<select name="choice" required><option value="">Choose a vote</option>${Object.entries(voteChoices).map(([key, label]) => `<option value="${key}">${label}</option>`).join("")}</select></label><label>Comment (optional)<textarea name="comment" maxlength="280" rows="3"></textarea></label>`, "Add vote", async form => {
      const vote = { id: M.id(), choice: val(form, "choice"), comment: val(form, "comment") };
      if (!validVote(vote)) throw Error("Choose a vote and use up to 280 characters for a comment.");
      if (await commit(next => {
        const target = next.stops.find(row => row.id === stop.id);
        if (!target) throw Error("This visit no longer exists.");
        target.togetherVotes = mergeVotes(target, { ...votePackage(stop, []), votes: [vote] });
      })) openVotes(findStop(stop.id));
    });
    dialogBody().querySelector("#together-vote-export").onclick = () => exportVotes(stop);
    dialogBody().querySelector("#together-vote-import").onclick = () => importVotes(stop);
  }

  function exportVotes(stop) {
    showForm("Export vote file", `<p>Choose what to include. The file contains the trip and visit IDs plus the votes and comments you select. Give it to travellers using a copy of the same trip.</p>${(stop.togetherVotes || []).map(row => `<label class="check"><input type="checkbox" name="vote" value="${esc(row.id)}"><span>${voteChoices[row.choice]}${row.comment ? ` · ${esc(row.comment)}` : ""}</span></label>`).join("")}`, "Download selected votes", form => {
      const target = findStop(stop.id);
      if (!target) throw Error("This visit no longer exists.");
      const pack = votePackage(target, form.getAll("vote"));
      if (!pack.votes.length) throw Error("Select one or more vote records to export.");
      downloadData(pack, "japan-visit-votes.json");
      openVotes(target);
    });
  }

  function importVotes(stop) {
    showForm("Import vote file", '<label>Vote file<input type="file" name="file" accept=".json,application/json" required></label><p>Use a Planner vote file from the same trip and visit.</p>', "Review votes", async form => {
      const file = chosenFile(form, voteFileLimit, "Choose a vote file smaller than 64 KiB.");
      const packet = parseVotes(await file.text(), stop);
      const target = findStop(stop.id);
      if (!target) throw Error("This visit no longer exists.");
      const additions = mergeVotes(target, packet).length - (target.togetherVotes || []).length;
      showForm("Review imported votes", `<p>${esc(visitLabel(target))}</p><p>${additions} new votes · ${packet.votes.length - additions} already recorded.</p>${voteLines(packet.votes)}`, "Merge votes", async () => {
        if (await commit(next => {
          const latest = next.stops.find(row => row.id === stop.id);
          if (!latest) throw Error("This visit no longer exists.");
          latest.togetherVotes = mergeVotes(latest, packet);
        })) openVotes(findStop(stop.id));
      });
    });
  }

  let photoUrls = [];
  let observedDialog;
  function releasePhotoUrls() {
    for (const url of photoUrls) URL.revokeObjectURL(url);
    photoUrls = [];
  }

  function showPhotoForm(title, body, label, submit) {
    releasePhotoUrls();
    showForm(title, body, label, submit);
  }

  async function openPhotos(stop) {
    releasePhotoUrls();
    // The loading state lets a slow read finish without taking focus from a later dialog.
    modal("Photo journal", '<p id="together-load-photos" role="status">Opening photos on this device…</p>');
    const marker = dialogBody().querySelector("#together-load-photos");
    const dialog = marker.closest("dialog");
    if (observedDialog !== dialog) {
      observedDialog = dialog;
      dialog.addEventListener("close", () => {
        if (!dialog.open) releasePhotoUrls();
      });
    }
    try {
      const photos = await readPhotoJournal(stop);
      if (!marker.isConnected || !dialog.open) return;
      const gallery = photos.map(row => {
        const url = URL.createObjectURL(new Blob([row.bytes], { type: "image/jpeg" }));
        photoUrls.push(url);
        return `<figure><img src="${url}" alt="${esc(row.caption || "Visit photo")}" loading="lazy" width="160" style="max-width:100%;height:auto"><figcaption>${esc(row.caption)}</figcaption><button type="button" data-photo-remove="${esc(row.id)}">Remove photo</button></figure>`;
      }).join("");
      showForm("Photo journal", `<p>${esc(visitLabel(stop))} · ${photos.length} ${photos.length === 1 ? "photo" : "photos"}</p><p>Photos stay in this browser. Added photos are resized and original camera metadata is removed. Export a photo backup separately to keep a copy.</p>${gallery}<div class="actions"><button type="button" id="together-photo-export" ${photos.length ? "" : "disabled"}>Export photo backup</button><button type="button" id="together-photo-import">Restore photo backup</button></div><label>JPEG or PNG (up to 9 MiB)<input name="file" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" required></label><label>Caption (optional)<input name="caption" maxlength="200"></label>`, "Attach photo", async form => {
        const file = chosenFile(form, photoLimits.inputBytes, "Choose a JPEG or PNG photo up to 9 MiB.");
        const bytes = await journalImage(file);
        const digest = await photoDigest(bytes);
        const latest = findStop(stop.id);
        if (!latest) throw Error("This visit no longer exists.");
        await savePhotos(latest, [{ id: M.id(), caption: val(form, "caption"), digest, bytes }]);
        await openPhotos(latest);
      });
      dialogBody().querySelector("#together-photo-export").onclick = () => exportPhotos(stop, photos);
      dialogBody().querySelector("#together-photo-import").onclick = () => importPhotos(stop);
      for (const button of dialogBody().querySelectorAll("[data-photo-remove]"))
        button.onclick = () => removePhoto(stop, photos.find(row => row.id === button.dataset.photoRemove));
    } catch (error) {
      if (marker.isConnected) marker.textContent = error.message;
    }
  }

  function exportPhotos(stop, photos) {
    showPhotoForm("Export photos for this visit", `<p>${esc(visitLabel(stop))} · ${photos.length} ${photos.length === 1 ? "photo" : "photos"}</p><p>This separate backup includes the images and captions for this visit. Anyone with the file can see them.</p><label class="check"><input type="checkbox" required>Include the photos and captions in the download</label>`, "Download photo backup", async () => {
      const records = [];
      for (const { id, caption, digest, bytes } of photos)
        records.push({ id, caption, digest, data: photoBase64(bytes) });
      downloadData({ kind: "planner-photo-journal", version: 1, photos: records }, "japan-visit-photos.json");
      await openPhotos(stop);
    });
  }

  function importPhotos(stop) {
    showPhotoForm("Restore photos to this visit", `<p>Destination · ${esc(visitLabel(stop))}</p><p>Restore your regular trip backup first if the original visit is missing. Then open that visit’s Photo journal to restore the images.</p><label>Photo backup<input name="file" type="file" accept=".json,application/json" required></label>`, "Review photo backup", async form => {
      const file = chosenFile(form, photoFileLimit, "Choose a Planner photo backup up to 17 MiB.");
      const photos = await parsePhotoPack(await file.text());
      showPhotoForm("Confirm photo restore", `<p>Attach ${photos.length} ${photos.length === 1 ? "photo" : "photos"} to ${esc(visitLabel(stop))}.</p><ul>${photos.map(row => `<li>${esc(row.caption || "Photo without a caption")}</li>`).join("")}</ul>`, "Restore these photos", async () => {
        const target = findStop(stop.id);
        if (!target) throw Error("This visit no longer exists.");
        const added = await savePhotos(target, photos);
        await openPhotos(target);
        toast(`${added} ${added === 1 ? "photo" : "photos"} restored. Existing copies were kept.`);
      });
    });
  }

  function removePhoto(stop, photo) {
    showPhotoForm("Remove this photo?", `<p>${esc(photo.caption || "Photo without a caption")}</p><p>The copy saved for this visit will be removed from this browser.</p>`, "Remove this photo", async () => {
      await updatePhotoJournal(stop, rows => rows.filter(row => row.id !== photo.id));
      await openPhotos(stop);
    });
  }

  async function handle(action, id) {
    if (!action.startsWith("together-")) return false;
    const target = action === "together-progress" || action === "together-draft" ? findTrip(id) : findStop(id);
    if (!target) {
      toast("This trip or visit is unavailable.");
      return true;
    }
    if (action === "together-progress") openProgress(target);
    if (action === "together-draft") openDraft(target);
    if (action === "together-votes") openVotes(target);
    if (action === "together-photos") await openPhotos(target);
    return true;
  }
  return { tripButtons, visitTools, handle };
}
