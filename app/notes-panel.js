import { findNotes, linksInNote, makeNote, noteLimits, sameNoteText } from "./core/notes.js";
import { changeNote, readNotes } from "./storage/db.js";

const sessionKey = "japan-notes-editor";
const newKey = ":new";

export function createNotesPanel({ esc }) {
  let root, notes = null, editor = null, active = null;
  let query = "", issue = "", saving = false, draftsStored = true, readGeneration = 0;
  let conflicts = false, refreshList = null;
  const drafts = new Map();
  try {
    const session = JSON.parse(sessionStorage.getItem(sessionKey));
    active = typeof session?.active === "string" ? session.active : null;
    for (const [key, draft] of session?.drafts ?? []) {
      if (typeof key === "string" && typeof draft?.title === "string" && typeof draft?.body === "string")
        drafts.set(key, draft);
    }
  } catch {}

  function persist() {
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify({ active, drafts: [...drafts] }));
      draftsStored = true;
    } catch { draftsStored = false; }
  }

  function remember() {
    if (editor.base ? sameNoteText(editor, editor.base) : !editor.title && !editor.body)
      drafts.delete(active);
    else drafts.set(active, editor);
    persist();
  }

  function open(key) {
    const saved = notes?.find(note => note.id === key) ?? null;
    active = key;
    editor = drafts.get(key) ?? (saved || key === newKey
      ? { base: saved, title: saved?.title ?? "", body: saved?.body ?? "" }
      : null);
    issue = "";
    conflicts = false;
    persist();
  }

  function list() {
    root.innerHTML = `<header class="notes-heading"><h1>Notes</h1><button type="button" class="primary" data-note-new>New note</button></header>
      <p class="muted">Your notes are saved in this browser and available offline.</p>
      <label for="note-search">Find notes</label>
      <input id="note-search" type="search" maxlength="160" autocomplete="off">
      <p class="form-error" role="alert">${esc(issue)}</p>
      <ul class="notes-list"></ul>`;
    const search = root.querySelector("#note-search"), rows = root.querySelector("ul");
    search.value = query;
    refreshList = () => {
      root.querySelector("[role=alert]").textContent = issue;
      const entries = (notes ?? []).map(note => {
        const draft = drafts.get(note.id);
        return draft ? { ...note, title: draft.title, body: draft.body, draft: true } : note;
      });
      for (const [key, draft] of drafts) {
        if (entries.some(note => note.id === key)) continue;
        entries.push({ id: key, title: draft.title, body: draft.body, draft: true,
          updatedAt: draft.base?.updatedAt ?? "9999-01-01T00:00:00Z" });
      }
      const matches = findNotes(entries, query);
      rows.innerHTML = matches.map(note => {
        const preview = note.body.replace(/\s+/g, " ").trim().slice(0, 145);
        return `<li><button type="button" data-note-id="${esc(note.id)}">
          <strong>${esc(note.title || "Untitled note")}</strong>
          ${note.draft ? '<span class="muted">Draft</span>' : ""}
          ${preview ? `<span class="muted note-snippet">${esc(preview)}</span>` : ""}
        </button></li>`;
      }).join("") || `<li class="muted">${notes === null ? issue ? "Notes could not be opened." : "Opening notes…" :
        query.trim() ? "No notes match this search." : "Save text, addresses or links to find them here later."}</li>`;
    };
    search.oninput = () => { query = search.value; refreshList(); };
    root.querySelector("[data-note-new]").onclick = () => {
      open(newKey);
      draw();
      root.querySelector("#note-title")?.focus();
    };
    rows.onclick = event => {
      const button = event.target.closest("[data-note-id]");
      if (!button) return;
      open(button.dataset.noteId);
      draw();
      root.querySelector("#note-title")?.focus();
    };
    refreshList();
  }

  function edit() {
    refreshList = null;
    const links = linksInNote(editor.base?.body ?? "");
    root.innerHTML = `<button class="note-back" type="button">← All notes</button>
      <h1>${editor.base ? "Edit note" : "New note"}</h1>
      <form class="note-editor">
        <label for="note-title">Title <span class="muted">(optional)</span></label>
        <input id="note-title" maxlength="${noteLimits.title}">
        <label for="note-body">Note text</label>
        <textarea id="note-body" rows="8" maxlength="${noteLimits.body}" dir="auto"></textarea>
        <p class="notes-status muted" role="status"></p>
        <p class="form-error" role="alert" tabindex="-1">${esc(issue)}</p>
        <div class="actions">
          <button class="primary" type="submit" ${saving || conflicts ? "disabled" : ""}>Save note</button>
          ${editor.base && !conflicts ? '<button type="button" class="danger" data-note-delete>Delete note</button>' : ""}
        </div>
        ${conflicts ? `<div class="actions note-conflict">
          <button type="button" class="primary" data-note-copy>Save draft as a new note</button>
          <button type="button" data-note-latest>${notes.some(note => note.id === active) ? "Open latest saved note" : "Discard draft"}</button>
        </div>` : ""}
      </form>
      ${links.length ? `<details class="note-links"><summary>Links in saved note</summary><ul>
        ${links.map(link => `<li><a href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.text)}</a></li>`).join("")}
      </ul></details>` : ""}`;
    const form = root.querySelector("form");
    const title = root.querySelector("#note-title"), body = root.querySelector("#note-body");
    const status = root.querySelector(".notes-status");
    title.value = editor.title;
    body.value = editor.body;
    const showStatus = () => {
      const message = saving ? "Saving…" : drafts.has(active)
        ? draftsStored ? "Unsaved draft kept in this tab." : "Draft is in memory. Save before refreshing."
        : editor.base ? "Saved on this device." : "";
      if (status.textContent !== message) status.textContent = message;
    };
    form.oninput = () => {
      if (saving) return;
      editor.title = title.value;
      editor.body = body.value;
      remember();
      if (!conflicts) { issue = ""; form.querySelector("[role=alert]").textContent = ""; }
      showStatus();
    };
    form.onsubmit = event => { event.preventDefault(); void save("save"); };
    root.querySelector(".note-back").onclick = () => {
      open(null);
      draw();
      root.querySelector("#note-search")?.focus();
    };
    const remove = root.querySelector("[data-note-delete]");
    if (remove) remove.onclick = () => {
      if (confirm("Delete this note and its draft from this browser?")) void save("delete");
    };
    const copy = root.querySelector("[data-note-copy]");
    if (copy) copy.onclick = () => void save("copy");
    const latest = root.querySelector("[data-note-latest]");
    if (latest) latest.onclick = () => {
      if (!confirm("Discard this draft?")) return;
      drafts.delete(active);
      open(notes.some(note => note.id === active) ? active : null);
      draw();
      root.querySelector("#note-title, #note-search")?.focus();
    };
    if (saving) {
      form.querySelectorAll("input, textarea, button").forEach(control => { control.disabled = true; });
      root.querySelector(".note-back").disabled = true;
    }
    showStatus();
  }

  function draw() {
    if (!root?.isConnected) return;
    if (active && editor) edit();
    else list();
  }

  async function save(action) {
    if (saving || !editor || (conflicts && action !== "copy")) return;
    if (action !== "delete" && !editor.title.trim() && !editor.body.trim()) {
      issue = "Enter a title or note text.";
      root.querySelector("form [role=alert]").textContent = issue;
      root.querySelector("#note-body").focus();
      return;
    }
    const key = active, base = action === "copy" ? null : editor.base;
    const next = action === "delete" ? null : makeNote(editor.title, editor.body, base);
    const form = root.querySelector("form");
    form.querySelectorAll("input, textarea, button").forEach(control => { control.disabled = true; });
    form.querySelector(".notes-status").textContent = action === "delete" ? "Deleting…" : "Saving…";
    root.querySelector(".note-back").disabled = true;
    saving = true;
    readGeneration++;
    try {
      const result = await changeNote(base, next);
      notes = result.notes;
      if (result.conflict) {
        remember();
        conflicts = true;
        issue = notes.some(note => note.id === key)
          ? "Another tab saved a newer version. Your draft is still here."
          : "This note was removed in another tab. Your draft is still here.";
        // Keep the last saved text available as a draft when deletion raced an edit.
        drafts.set(active, editor);
        persist();
      } else {
        drafts.delete(key);
        open(next?.id ?? null);
      }
    } catch (error) {
      remember();
      issue = error.message;
    } finally {
      saving = false;
      draw();
      if (root.isConnected) root.querySelector(issue ? "form [role=alert]" :
        action === "delete" ? "[data-note-new]" : "[type=submit]")?.focus();
    }
  }

  return {
    render(container) {
      if (root?.parentElement === container) return;
      root = document.createElement("section");
      root.className = "notes-panel narrow";
      container.replaceChildren(root);
      if (active && !editor) editor = drafts.get(active) ?? null;
      draw();
      const request = ++readGeneration;
      void readNotes().then(saved => {
        if (request !== readGeneration || !root.isConnected) return;
        notes = saved;
        if (active && !editor) open(saved.some(note => note.id === active) ? active : null);
        if (active && editor && !root.querySelector("form")) draw();
        else refreshList?.();
      }).catch(error => {
        if (request !== readGeneration) return;
        issue = error.message;
        draw();
      });
    },
    unloadRisk: () => saving || (!draftsStored && drafts.size > 0),
  };
}
