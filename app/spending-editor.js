import { SELF, categories, equalShares, money, yenLimit } from "./core/spending.js";
import { id, name, visitPlace } from "./core/model.js";
import { japanDateTime } from "./core/direction-search.js";
import { journalImage } from "./together.js";
import { photoLimits } from "./core/together.js";
import { receiptLimit } from "./storage/db.js";

export const yen = value => value===null ? "Unknown" : "¥"+new Intl.NumberFormat("en-US").format(value);
export const cat = value => categories[value] ?? "Unclassified";
export const currentEntry = (type, amount, fields={}) => ({
  id:id(), type, amount, ...japanDateTime(), dayId:null, visitId:null, merchant:"", area:"", method:"", memo:"", ...fields,
});
export function amountInput(value, optional=false) {
  if (optional && value==="") return null;
  const amount=Number(value);
  if (value==="" || !money(amount)) throw Error("Enter a whole yen amount.");
  return amount;
}

export function openExpenseEditor({ledger, images, days, entry, visit, visitDay, modal, esc, close, save, erase, assign, failure}) {
  const place=visit&&visitPlace(visit);
  const initial=entry ?? currentEntry("draft",0,{payer:SELF,wallet:null,reservationId:null,dayId:visitDay?.id ?? null,
    visitId:visit?.id ?? null,merchant:place ? name(place) : "",area:place?.address.city || place?.address.prefecture || "",lines:[]});
  const legacy=!!entry?.legacy;
  const walletOptions=[['','No wallet'],['cash','Cash'],['suica','Suica']];
  const options=(pairs,v)=>pairs.map(([value,label])=>`<option value="${esc(value)}" ${value===v?"selected":""}>${esc(label)}</option>`).join("");
  const number=(field,value)=>`<input type="number" name="${field}" inputmode="numeric" min="0" max="${yenLimit}" step="1" value="${value??""}">`;
  const fields=ledger.people.map(p=>[p.id,p.name]);
  const attached=images.filter(photo=>photo.entryId===initial.id);
  let pictures=[...attached], lines=initial.lines.length ? initial.lines.map(line=>({...line,rule:"exact"})) : [
    {id:id(),amount:0,category:"food",label:"",shares:[],rule:"equal"},
  ];
  let working=false;
  const cleanText=(value,max)=>String(value??"").slice(0,max);
  modal(legacy?"Assign legacy spending":entry?.type==="expense"?"Edit expense":"Add expense",`<form id="spending-expense">
    <div class="grid2"><label>Amount charged (JPY)${number("amount",entry ? initial.amount : null)}</label>
    <label>Paid by<select name="payer">${options(fields,initial.payer ?? SELF)}</select></label></div>
    <label>Split<select name="layout">${options([["single","One category"],["items","Split by item"]],lines.length>1?"items":"single")}</select></label>
    <div id="spending-lines"></div><button type="button" id="spending-add-item">Add an item</button>
    <p id="spending-allocation" role="status"></p>
    ${legacy?'<p class="muted">Assignment adds people and a category to the original amount. Edit the amount from Budget and travel checks.</p>':`
    <details ${entry?.type==="expense"?"open":""}><summary>Date, place and payment</summary>
      <div class="grid2"><label>Japan date<input name="date" type="date" value="${esc(initial.date ?? "")}"></label>
      <label>Time (optional)<input name="time" type="time" value="${esc(initial.time ?? "")}"></label>
      <label>For itinerary day<select name="day">${options([["","No day"],...days.map(d=>[d.id,d.date+(d.label?" · "+d.label:"")])],initial.dayId??"")}</select></label>
      <label>Merchant<input name="merchant" maxlength="160" value="${esc(initial.merchant)}"></label>
      <label>City or place<input name="area" maxlength="160" value="${esc(initial.area)}"></label>
      <label>Method<input name="method" maxlength="80" value="${esc(initial.method)}" placeholder="Card, cash, Suica…"></label>
      <label>Deduct from wallet<select name="wallet">${options(walletOptions,initial.wallet??"")}</select></label>
      <label>Pay a reservation<select name="reservation">${options([["","No reservation"],...ledger.reservations.map(r=>[r.id,r.label])],initial.reservationId??"")}</select></label></div>
      <label>Memo<textarea name="memo" maxlength="1000" rows="2">${esc(initial.memo)}</textarea></label></details>
    <details ${pictures.length?"open":""}><summary>Receipt images</summary><p>Up to two JPEG or PNG images. Planner removes camera metadata.</p>
      <label>Take a photo<input type="file" id="spending-camera" accept="image/*" capture="environment"></label>
      <label>Choose receipt image<input type="file" id="spending-image" accept="image/jpeg,image/png"></label>
      <div id="spending-pictures"></div></details>`}
    <p class="form-error" role="alert"></p><div class="actions"><button class="primary" type="submit">${legacy?"Save assignment":"Save expense"}</button>
    ${legacy||entry?.type==="expense"?"":'<button type="button" id="spending-save-draft">Save draft</button>'}
    ${entry&&!legacy?'<button type="button" id="spending-remove" class="danger">Delete transaction</button>':""}</div></form>`,()=>{
    const form=document.getElementById("spending-expense"), input=form.elements, editor=form.querySelector("#spending-lines");
    const error=form.querySelector('[role="alert"]');
    if (legacy) { input.amount.readOnly=true; input.layout.disabled=true; }
    const groupHtml=(line,index)=>{
      const selected=new Map(line.shares.map(row=>[row.person,row.yen]));
      const picked=selected.size ? selected : new Map([[SELF,0]]);
      const area=[...(legacy?[["unclassified","Choose category"]]:[]),...Object.entries(categories)];
      return `<fieldset data-line="${index}"><legend>${input.layout.value==="items"?`Item ${index+1}`:"Purchase allocation"}</legend>
      <div class="grid2"><label>Category<select data-category>${options(area,line.category)}</select></label>
      ${input.layout.value==="items"?`<label>Item total (JPY)${number("item",line.amount||null)}</label><label>Item label<input data-label maxlength="160" value="${esc(line.label)}"></label>`:""}
      <label>Allocation<select data-rule>${options([["equal","Equal shares"],["exact","Exact amounts"]],line.rule)}</select></label></div>
      <div class="actions"><button type="button" data-cover="me">Just me</button><button type="button" data-cover="all">Everyone</button></div>
      <div class="spending-shares">${ledger.people.map(person=>`<div><label class="check"><input type="checkbox" data-person="${esc(person.id)}" ${picked.has(person.id)?"checked":""}>${esc(person.name)}</label>
      <label data-exact ${line.rule!=="exact"?"hidden":""}><span class="sr-only">Yen for ${esc(person.name)}</span>${number("share",selected.get(person.id)??null)}</label><output></output></div>`).join("")}</div>
      <p class="muted" data-line-status></p>${input.layout.value==="items"&&lines.length>1?'<button type="button" data-remove-line>Remove item</button>':""}</fieldset>`;
    };
    function readLines() {
      const results=[];
      for (const block of editor.querySelectorAll("[data-line]")) {
        const line=lines[Number(block.dataset.line)], rule=block.querySelector("[data-rule]").value;
        const amount=Number((block.querySelector('[name="item"]')??input.amount).value || 0);
        const picked=[...block.querySelectorAll("[data-person]:checked")];
        const shares=rule==="equal" && picked.length && money(amount) ? equalShares(amount,picked.map(item=>item.dataset.person)) : picked.map(item=>({
          person:item.dataset.person,yen:Number(item.closest(".spending-shares > div").querySelector('[name="share"]').value || 0),
        }));
        results.push({...line,rule,amount,category:block.querySelector("[data-category]").value,shares,
          label:block.querySelector("[data-label]")?.value || ""});
      }
      return results;
    }
    function preview() {
      const values=readLines();
      for (const [i,block] of [...editor.querySelectorAll("[data-line]")].entries()) {
        const line=values[i], divisor=line.shares.length;
        const left=line.amount-line.shares.reduce((sum,share)=>sum+share.yen,0);
        block.querySelector("[data-line-status]").textContent=left ?
          left>0 ? `${yen(left)} still unallocated for this line.` : `${yen(-left)} over this line total.` : "";
        for (const row of block.querySelectorAll(".spending-shares > div")) {
          const id=row.querySelector("[data-person]").dataset.person;
          const share=line.shares.find(item=>item.person===id);
          row.querySelector("[data-exact]").hidden=line.rule!=="exact";
          row.querySelector("output").textContent=share ? yen(share.yen)+(line.rule==="equal"&&divisor&&share.yen>Math.floor(line.amount/divisor)?" (+¥1 remainder)":"") : "";
        }
      }
      const shortage=Number(input.amount.value||0)-values.reduce((sum,line)=>sum+line.shares.reduce((n,row)=>n+row.yen,0),0);
      const difference=Number(input.amount.value||0)-values.reduce((sum,line)=>sum+line.amount,0);
      document.getElementById("spending-allocation").textContent=(shortage===0?"Yen allocated in full.":shortage>0?`${yen(shortage)} unallocated.`:`${yen(-shortage)} over the amount charged.`)+
        (difference ? ` Item totals differ from the charge by ${yen(Math.abs(difference))}.` : "");
    }
    const draw=()=>{
      editor.innerHTML=(input.layout.value==="items"?lines:lines.slice(0,1)).map(groupHtml).join("");
      form.querySelector("#spending-add-item").hidden=input.layout.value!=="items";
      preview();
    };
    form.oninput=event=>{
      if (event.target===input.layout) { lines=readLines(); draw(); }
      else preview();
    };
    editor.onclick=event=>{
      const button=event.target.closest("button"), block=button?.closest("[data-line]");
      if (!block) return;
      if (button.hasAttribute("data-remove-line")) {
        lines=readLines().filter((_,i)=>i!==Number(block.dataset.line)); draw();
      } else if (button.dataset.cover) {
        for (const box of block.querySelectorAll("[data-person]")) box.checked=button.dataset.cover==="all"||box.dataset.person===SELF;
        preview();
      }
    };
    form.querySelector("#spending-add-item").onclick=()=>{
      lines=readLines();
      if (lines.length>=60) { error.textContent="Use up to 60 items per receipt."; return; }
      lines.push({id:id(),category:"other",amount:0,label:"",shares:[],rule:"equal"}); draw();
    };
    const gallery=form.querySelector("#spending-pictures");
    const drawPhotos=()=>{
      for (const img of gallery?.querySelectorAll("img")??[]) URL.revokeObjectURL(img.src);
      if (!gallery) return;
      gallery.replaceChildren(...pictures.map((pic,i)=>{
        const wrap=document.createElement("div"), toggle=document.createElement("button"), img=document.createElement("img");
        toggle.type="button";toggle.setAttribute("aria-label",`Zoom receipt image ${i+1}`);toggle.setAttribute("aria-pressed","false");
        img.src=URL.createObjectURL(new Blob([pic.bytes],{type:"image/jpeg"}));img.alt=`Receipt ${i+1}`;
        const url=img.src;
        document.getElementById("dialog").addEventListener("close",()=>URL.revokeObjectURL(url),{once:true});
        toggle.append(img);toggle.onclick=()=>{const zoom=wrap.classList.toggle("receipt-zoom");toggle.setAttribute("aria-pressed",String(zoom));};
        const remove=document.createElement("button");remove.type="button";remove.textContent="Remove image";
        remove.onclick=()=>{pictures=pictures.filter(p=>p.id!==pic.id);drawPhotos();};
        wrap.append(toggle,remove);return wrap;
      }));
    };
    for (const field of [form.querySelector("#spending-image"),form.querySelector("#spending-camera")]) if (field) field.onchange=async()=>{
      if (working || !field.files[0]) return;
      if (pictures.length>=2) {error.textContent="Use up to two images per transaction.";field.value="";return;}
      working=true;
      try {
        const bytes=await journalImage(field.files[0],{...photoLimits,maxSide:2400,imageBytes:receiptLimit.imageBytes});
        pictures.push({id:id(),entryId:initial.id,bytes}); drawPhotos();
      } catch (err) {error.textContent=err.message;}
      finally {working=false;field.value="";}
    };
    async function finish(draft) {
      if (working) return;
      working=true; error.textContent="";
      try {
        const amount=amountInput(input.amount.value,draft)??0;
        const lines=readLines().map(({rule,...line})=>line);
        if (legacy) await assign({id:entry.id,amount,payer:input.payer.value,category:lines[0].category,shares:lines[0].shares});
        else {
          const type=draft?"draft":"expense";
          await save({ id:initial.id,type,amount,payer:input.payer.value,lines,wallet:input.wallet.value||null,
            reservationId:input.reservation.value||null,date:input.date.value||null,time:input.time.value||null,
            dayId:input.day.value||null,visitId:initial.visitId,merchant:cleanText(input.merchant.value,160),
            area:cleanText(input.area.value,160),method:cleanText(input.method.value,80),memo:cleanText(input.memo.value,1000) },pictures);
        }
        close();
      } catch (err) { error.textContent=err.message; failure?.(err); }
      finally { working=false; }
    }
    form.onsubmit=event=>{event.preventDefault();void finish(false);};
    if (form.querySelector("#spending-save-draft")) form.querySelector("#spending-save-draft").onclick=()=>void finish(true);
    if (form.querySelector("#spending-remove")) form.querySelector("#spending-remove").onclick=async()=>{
      if (working || !confirm("Delete this transaction and its receipt images?")) return;
      try {await erase(initial.id);close();} catch(err) {error.textContent=err.message;}
    };
    draw();drawPhotos();
  });
}
