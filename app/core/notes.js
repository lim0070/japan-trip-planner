import { clone, id, now } from "./model.js";

export const noteLimits = Object.freeze({
  title: 160,
  body: 60000,
  count: 500,
  bytes: 4 * 1024 * 1024,
});

export function sameNoteText(a, b) {
  return a.title === b.title && a.body === b.body;
}

export function sameSavedNote(a, b) {
  return !!a && !!b && a.id === b.id && a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt && sameNoteText(a, b);
}

export function makeNote(title, body, previous = null) {
  const time = now();
  return {
    id: previous?.id ?? id(),
    title: title.trim(),
    body,
    createdAt: previous?.createdAt ?? time,
    updatedAt: time,
  };
}

export function mergeNotes(current, incoming) {
  const byId = new Map(current.map(note => [note.id, note]));
  const noteKey = note => JSON.stringify([note.createdAt, note.title, note.body]);
  const content = new Set(current.map(noteKey));
  for (const note of incoming) {
    const match = byId.get(note.id);
    if ((match && sameNoteText(note, match)) || content.has(noteKey(note))) continue;
    const copy = clone(note);
    if (match) copy.id = id();
    byId.set(copy.id, copy);
    content.add(noteKey(copy));
  }
  return [...byId.values()];
}

export function findNotes(notes, query) {
  const normalize = text => text.normalize("NFKC").toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, letter => String.fromCharCode(letter.charCodeAt(0) - 0x60));
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  return notes.filter(note => {
    const text = normalize(note.title + "\n" + note.body);
    return terms.every(term => text.includes(term));
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

export function linksInNote(body) {
  const links = new Map();
  for (const match of body.matchAll(/https?:\/\/[^\s<>"'「」『』【】、。！？]+/gi)) {
    let text = match[0].replace(/[.,;!?]+$/, "");
    for (const [opening, closing] of [["(", ")"], ["[", "]"]])
      while (text.endsWith(closing) && text.split(closing).length > text.split(opening).length)
        text = text.slice(0, -1);
    try {
      const url = new URL(text);
      if (text.length <= 2048 && !url.username && !url.password)
        links.set(url.href, { href: url.href, text });
    } catch {}
  }
  return [...links.values()];
}
