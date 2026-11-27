import { emptyReels, readReelFeed, mergeReels, decideReel, reelGroups, reelLimit } from "./core/reel-lists.js";
import { manualPlace } from "./core/model.js";
import { changeReels, readReels } from "./storage/db.js";
import { privateOrigin, reelConnection } from "./reel-connection.js";

async function opaqueId(value) {
  const bytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2,"0")).join("");
}
function snapshot(place,id) {
  const p = manualPlace();
  p.key = "manual:" + id;
  p.sourceId = id;
  p.names.ja = place.name;
  p.address.ja = place.address;
  p.address.city = place.city;
  p.category = place.cuisine;
  if (place.lat !== null) Object.assign(p.location,{lat:place.lat,lng:place.lng,availability:"located"});
  return p;
}
const normalized = text => (text ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g,"");
const sameBranch = (a,b) => normalized(a.name) === normalized(b.name) && normalized(a.address) === normalized(b.address);

export function createReelPanel({esc,modal,close,addPlace,showPin,render,visible}) {
  let saved = emptyReels(), groups = reelGroups(saved), places = new Map(), view = "saved";
  let active = false, status = "", city = "", cuisine = "", page = 0, sequence = 0, suppliedOrigin = "";
  let busy = false;
  try { active = sessionStorage.getItem("japan-spot-list") === "foods-in-japan"; } catch {}
  function setActive(value) {
    active = value;
    try { sessionStorage.setItem("japan-spot-list",value ? "foods-in-japan" : ""); } catch {}
  }
  function report(message) {
    status = message;
    const node = document.getElementById("reel-status");
    if (node) node.textContent = status;
    const state = document.getElementById("reel-service-state");
    if (state) state.textContent = connection.pairedOrigin() ? "Manage private connection" : "Connect private service";
  }
  async function load() {
    const latest = ++sequence, data = await readReels(), next = reelGroups(data);
    const resolved = await Promise.all(next.branches.map(async group => [group.place.branchId,
      snapshot(group.place,await opaqueId("japan-planner-branch:" + group.place.branchId))]));
    if (latest !== sequence) return data.cards.length;
    saved = data; groups = next; places = new Map(resolved);
    if (active && visible()) render();
    return data.cards.length;
  }
  async function acceptFeed(data) {
    const incoming = readReelFeed(data);
    await changeReels(current => mergeReels(current,incoming));
    return load();
  }
  const connection = reelConnection({save:acceptFeed,report});
  function allViewRows() {
    if (view === "review") return groups.review.map(row => ({place:row.place,cards:[row]}));
    if (view === "dismissed") return groups.dismissed.map(row => ({place:row.place,cards:[row]}));
    return groups.branches;
  }
  const matches = () => allViewRows().filter(({place}) =>
    (!city || (place.city || "Unknown") === city) && (!cuisine || (place.cuisine || "Unknown") === cuisine));
  function sourceHTML(row) {
    const source = row.source;
    const link = (href,label) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
    const stamp = sec => Math.floor(sec / 60) + ":" + String(Math.floor(sec % 60)).padStart(2,"0");
    return `<p>${link(source.url,"Open original reel")}</p><ul class="reel-evidence">${source.evidence.map(clue => {
      const time = clue.seconds == null ? "" : source.playerUrl ? link(source.playerUrl.split("#")[0] + "#t=" + clue.seconds,stamp(clue.seconds)) : esc(stamp(clue.seconds));
      return `<li><strong>${esc(clue.kind)}</strong> ${time} ${esc(clue.text)} ${clue.url ? link(clue.url,"Source") : ""}</li>`;
    }).join("")}</ul>`;
  }
  function placeCard({place,cards}) {
    const branch = view === "saved";
    return `<article class="place-card reel-card"><h3 dir="auto">${esc(place.name)}</h3>
      <p dir="auto">${esc(place.address || "Address unknown")}</p>
      <p class="muted">${esc(place.city || "Unknown city")} · ${esc(place.cuisine || "Unknown cuisine")}${branch && place.lat === null ? " · Address only" : ""}</p>
      ${branch ? `<div class="actions"><button class="primary" data-reel-add="${esc(place.branchId)}">Add to day</button>
        ${place.lat !== null ? `<button data-reel-pin="${esc(place.branchId)}">Show pin</button>` : ""}</div>` : ""}
      ${cards.map(row => `<details class="reel-source"${branch ? "" : " open"}><summary>${branch ? (cards.length === 1 ? "Reel and evidence" : "Reel " + (cards.indexOf(row)+1) + " and evidence") : "Evidence"}</summary>
        ${sourceHTML(row)}</details><button data-reel-review="${esc(row.id)}">${view === "dismissed" ? "Reopen review" : branch ? "Correct or dismiss" : "Review match"}</button>`).join("")}</article>`;
  }
  function redraw() { if (active && visible()) render(); }
  function draw(root) {
    const rows = matches(), all = allViewRows();
    const filter = (field,label,current) => {
      const values = [...new Set(all.map(({place}) => place[field] || "Unknown"))].sort((a,b) => a.localeCompare(b,"ja"));
      if (current && !values.includes(current)) values.push(current);
      return `<label>${label}<select id="reel-${field}"><option value="">All</option>${values.map(x =>
        `<option ${current === x ? "selected" : ""} value="${esc(x)}">${esc(x)}</option>`).join("")}</select></label>`;
    };
    const tabs = [["saved","Saved branches",groups.branches.length],["review","Needs review",groups.review.length],["dismissed","Dismissed",groups.dismissed.length]];
    page = Math.min(page,Math.max(0,Math.ceil(rows.length/30)-1));
    root.innerHTML = `<section class="narrow reel-list"><button class="note-back" id="reel-back">← Saved Spots</button>
      <div class="toolbar"><div><p class="muted">Saved Spots / Lists</p><h1>Foods in Japan</h1></div></div>
      <div class="actions"><button id="reel-connect"><span id="reel-service-state">${connection.pairedOrigin() ? "Manage private connection" : "Connect private service"}</span></button>
      <button id="reel-import">Import list file</button><input id="reel-file" type="file" accept=".json,application/json" aria-label="Private reel list file" hidden></div>
      <p role="status" id="reel-status">${esc(status)}</p>
      <div class="actions" aria-label="Collection view">${tabs.map(([key,label,count]) =>
        `<button data-reel-view="${key}" aria-pressed="${key === view}">${label} (${count})</button>`).join("")}</div>
      <div class="reel-filters">${filter("city","City",city)}${filter("cuisine","Cuisine",cuisine)}</div>
      <div id="reel-cards">${rows.slice(page*30,page*30+30).map(placeCard).join("") || `<p class="empty">${view === "saved" && !saved.cards.length ? "Connect your private reel service or import a Foods in Japan file." : "No matches in this view."}</p>`}</div>
      ${rows.length > 30 ? `<div class="actions"><button id="reel-previous" ${page ? "" : "disabled"}>Previous</button><span>${page+1} of ${Math.ceil(rows.length/30)}</span><button id="reel-next" ${(page+1)*30 < rows.length ? "" : "disabled"}>Next</button></div>` : ""}</section>`;
    const q = selector => root.querySelector(selector);
    q("#reel-back").onclick = () => { setActive(false); render(); };
    q("#reel-city").onchange = event => { city = event.target.value; page = 0; redraw(); };
    q("#reel-cuisine").onchange = event => { cuisine = event.target.value; page = 0; redraw(); };
    q("#reel-import").onclick = () => q("#reel-file").click();
    q("#reel-file").onchange = async event => {
      try {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > reelLimit) throw Error("Choose a reel list file under 4 MiB.");
        await acceptFeed(JSON.parse(await file.text()));
        report("Private list imported on this device.");
      } catch (e) { report(e.message); }
      event.target.value = "";
    };
    q("#reel-connect").onclick = connectDialog;
    if (q("#reel-next")) q("#reel-next").onclick = () => { page++; redraw(); };
    if (q("#reel-previous")) q("#reel-previous").onclick = () => { page--; redraw(); };
    root.querySelectorAll("[data-reel-view]").forEach(b => b.onclick = () => {
      view = b.dataset.reelView; page = 0; city = ""; cuisine = ""; redraw();
    });
    q("#reel-cards").onclick = event => {
      const b = event.target.closest("button");
      if (!b) return;
      if (b.dataset.reelAdd) addPlace(places.get(b.dataset.reelAdd));
      if (b.dataset.reelPin) showPin(places.get(b.dataset.reelPin).key);
      if (b.dataset.reelReview) review(saved.cards.find(row => row.id === b.dataset.reelReview));
    };
  }
  function connectDialog() {
    const paired = connection.pairedOrigin();
    modal("Private reel connection",`<form id="reel-pair-form"><label>Private service address<input id="reel-origin" type="url" value="${esc(suppliedOrigin || paired || "")}" placeholder="https://…" required></label>
      <p>Approve the transfer on your private service. A paired browser checks for new cards when Planner opens on Tailscale.</p>
      <p class="form-error" id="reel-pair-error" role="alert"></p><div class="actions"><button class="primary">Connect</button>
      ${paired ? '<button type="button" id="reel-refresh">Check now</button><button type="button" id="reel-disconnect">Disconnect this device</button>' : ""}
      </div></form>`,() => {
      const q = id => document.getElementById(id);
      q("reel-pair-form").onsubmit = event => {
        event.preventDefault();
        try { connection.connect(q("reel-origin").value.trim()); close(); }
        catch (error) { q("reel-pair-error").textContent = error.message; }
      };
      if (paired) {
        q("reel-refresh").onclick = () => { close(); void connection.pull(); };
        q("reel-disconnect").onclick = () => { connection.disconnect(); close(); redraw(); };
      }
    });
  }
  function review(row) {
    const previous = saved.decisions.find(d => d.id === row.id) ?? null;
    const initial = previous?.place ?? row.place;
    const options = [initial,...row.candidates];
    const fields = [["name","Branch name"],["address","Street address"],["city","City"],["cuisine","Cuisine"],["lat","Latitude"],["lng","Longitude"]];
    modal("Review restaurant branch",`<p>Confirm the branch against the reel and its source. Leave coordinates empty for an address-only spot.</p>${sourceHTML(row)}
      <form id="review-reel-form">${options.length > 1 ? `<label>Candidate branch<select id="reel-candidate">${options.map((place,i) => `<option value="${i}">${esc(place.name)} · ${esc(place.address || "Unknown address")}</option>`).join("")}</select></label>` : ""}
      ${fields.map(([key,label]) => `<label>${label}<input name="${key}" value="${esc(initial[key])}" ${key === "name" || key === "address" ? "required" : ""}></label>`).join("")}
      <p class="form-error" role="alert"></p><div class="actions"><button class="primary">Confirm branch</button>
        <button type="button" id="reel-dismiss">Dismiss match</button>
        ${previous ? '<button type="button" id="reel-undo">Use source match</button>' : ""}</div></form>`,() => {
      const form = document.getElementById("review-reel-form"), candidate = document.getElementById("reel-candidate");
      const input = field => form.elements.namedItem(field);
      const current = () => options[Number(candidate?.value ?? 0)];
      if (candidate) candidate.onchange = () => { for (const [key] of fields) input(key).value = current()[key] ?? ""; };
      function clearPoint() { input("lat").value = ""; input("lng").value = ""; }
      input("name").oninput = input("address").oninput = clearPoint;
      const safeChange = async make => {
        if (busy) return;
        busy = true;
        try {
          const change = await make();
          await changeReels(state => decideReel(state,row,previous,change));
          await load(); close(); report("Review saved on this device.");
        } catch (e) { form.querySelector('[role="alert"]').textContent = e.message; }
        finally { busy = false; }
      };
      document.getElementById("reel-dismiss").onclick = () => safeChange(() => ({status:"dismissed"}));
      if (previous) document.getElementById("reel-undo").onclick = () => safeChange(() => null);
      form.onsubmit = event => {
        event.preventDefault();
        void safeChange(async () => {
          const place = Object.fromEntries(fields.map(([key]) => [key,input(key).value.trim() || null]));
          for (const key of ["lat","lng"]) if (place[key] !== null) place[key] = Number(place[key]);
          const exact = [...options,...groups.branches.map(group => group.place)].find(p => p.branchId && sameBranch(p,place));
          place.branchId = exact?.branchId ?? "manual:" + await opaqueId(JSON.stringify([normalized(place.name),normalized(place.address)]));
          return {status:"confirmed",place};
        });
      };
    });
  }
  function handoff(hash) {
    if (!hash.startsWith("#spots?reels=")) return false;
    try { suppliedOrigin = privateOrigin(new URLSearchParams(hash.slice(7)).get("reels")); }
    catch { suppliedOrigin = ""; }
    history.replaceState(null,"","#spots");
    setActive(true);
    if (suppliedOrigin) queueMicrotask(connectDialog);
    return true;
  }
  return {active:() => active, draw, load, handoff,
    open() { setActive(true); redraw(); void load().catch(error => report(error.message)); },
    async start() {
      try { await load(); await connection.pull(); }
      catch (error) { report(error.message); }
    },
    places:() => view === "saved" ? matches().map(row => ({p:places.get(row.place.branchId)})) : [],
    findPlace:key => active && visible() ? [...places.values()].find(p => p.key === key) : null,
  };
}
