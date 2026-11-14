import { bytes } from "../core/shopping-bundle.js";
import { digest, parseJSON } from "../core/contracts.js";

const MAX_ROW_BYTES = 20 * 1024 * 1024;

export async function encodeShoppingHistory(entries) {
  const raw = JSON.stringify(entries);
  const length = bytes(raw);
  if (length > MAX_ROW_BYTES) throw Error("Shopping history row exceeds 20 MiB");
  const compressed = await new Response(new Blob([raw]).stream()
    .pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const data = new Uint8Array(compressed);
  const blocks = [];
  for (let offset = 0; offset < data.length; offset += 0x6000) {
    blocks.push(btoa(String.fromCharCode(...data.subarray(offset, offset + 0x6000))));
  }
  return { length, checksum: await digest(raw), gzip: blocks.join("") };
}

export async function decodeShoppingHistory(encoded) {
  if (!encoded || !Number.isSafeInteger(encoded.length) ||
      encoded.length < 2 || encoded.length > MAX_ROW_BYTES ||
      typeof encoded.gzip !== "string" || encoded.gzip.length > MAX_ROW_BYTES)
    throw Error("Invalid Shopping history archive");
  const data = Uint8Array.from(atob(encoded.gzip), (c) => c.charCodeAt(0));
  const reader = new Blob([data]).stream()
    .pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > encoded.length) throw Error("Shopping history size mismatch");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const raw = parts.join("");
  if (size !== encoded.length || await digest(raw) !== encoded.checksum)
    throw Error("Shopping history checksum mismatch");
  const entries = parseJSON(raw);
  if (!Array.isArray(entries)) throw Error("Invalid archived Shopping history");
  return entries;
}
