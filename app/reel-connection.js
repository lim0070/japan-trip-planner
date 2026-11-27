import { feedKind, reelLimit } from "./core/reel-lists.js";

const pairingKey = "japan-private-reel-pair";
export function privateOrigin(input) {
  let url;
  try { url = new URL(input); } catch {}
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || !(url.hostname.endsWith(".ts.net") || url.hostname === "localhost"))
    throw Error("Enter the HTTPS origin of your private Tailscale service, including its port if needed.");
  return url.origin;
}
const validToken = token => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
function pairing() {
  try {
    const saved = JSON.parse(localStorage.getItem(pairingKey));
    if (validToken(saved?.token)) return {origin:privateOrigin(saved.origin),token:saved.token};
  } catch {}
  return null;
}
async function readFeed(response) {
  if (!response.ok) throw Error(response.status === 401 || response.status === 403 ?
    "Pair this browser again to authorize the private connection." : "The private service could not deliver the list.");
  if (!response.body || Number(response.headers.get("content-length")) > reelLimit) throw Error("Invalid private list response.");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8",{fatal:true});
  let size = 0, text = "";
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > reelLimit) throw Error("The private reel list exceeds 4 MiB.");
      text += decoder.decode(value,{stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}

export function reelConnection({save,report}) {
  let pending = null, pulling = null, generation = 0;
  function clearPending() {
    if (pending) { clearTimeout(pending.timeout); pending = null; }
  }
  async function pull() {
    const saved = pairing();
    if (!saved || !navigator.onLine || pulling) return;
    const current = generation;
    const request = new AbortController();
    pulling = request;
    const timer = setTimeout(() => request.abort(),15000);
    try {
      const response = await fetch(saved.origin + "/api/planner/foods-in-japan", {
        mode:"cors",credentials:"omit",redirect:"error",cache:"no-store",referrerPolicy:"no-referrer",
        headers:{Authorization:"Bearer " + saved.token},signal:request.signal,
      });
      const feed = await readFeed(response);
      if (current !== generation || pairing()?.token !== saved.token) return;
      await save(feed);
      report("Private list is up to date.");
    } catch (error) {
      if (current === generation) report(error instanceof TypeError || error.name === "AbortError" ?
        "Private service unavailable. Saved cards are available offline. Retry on Tailscale or import a list file." : error.message);
    } finally { clearTimeout(timer); if (pulling === request) pulling = null; }
  }
  function connect(input) {
    const origin = privateOrigin(input);
    clearPending();
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)),byte => byte.toString(16).padStart(2,"0")).join("");
    const popup = window.open(origin + "/planner/foods-in-japan#" + nonce, "_blank", "popup");
    if (!popup) throw Error("The browser blocked the private window. Allow popups or import a list file.");
    pending = {popup,origin,nonce,timeout:setTimeout(() => {
      clearPending();
      report("The pairing window expired. Reconnect or import the private list file.");
    },180000)};
    report("Approve the transfer in the private window.");
  }
  window.addEventListener("message",async event => {
    const attempt = pending, message = event.data;
    if (!attempt || event.origin !== attempt.origin || event.source !== attempt.popup ||
        message?.type !== feedKind || message.nonce !== attempt.nonce) return;
    clearPending();
    const current = ++generation;
    pulling?.abort();
    try {
      if (message.deviceToken != null && !validToken(message.deviceToken)) throw Error("Invalid private device pairing.");
      const persistedCount = await save(message.feed);
      if (current !== generation) return;
      if (message.deviceToken) {
        localStorage.setItem(pairingKey,JSON.stringify({origin:attempt.origin,token:message.deviceToken}));
      }
      event.source.postMessage({type:feedKind + "-ack",nonce:attempt.nonce,persistedCount},attempt.origin);
      report(message.deviceToken ? "Paired. New cards will be checked when Planner opens." : "Private reel list received.");
    } catch (error) { report(error.message); }
  });
  return { connect,pull,pairedOrigin:() => pairing()?.origin,
    disconnect() {
      ++generation; clearPending(); pulling?.abort();
      localStorage.removeItem(pairingKey); report("Disconnected on this device. Your saved cards are still here.");
    } };
}
