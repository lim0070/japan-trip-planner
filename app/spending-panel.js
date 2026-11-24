import { SELF, categories, spendingTotals, settlement, suggestedTransfers, dailyAllowance } from "./core/spending.js";
import { validateLedger, mergeSpending } from "./core/spending-contract.js";
import { id, clone, visitPlace } from "./core/model.js";
import { brands } from "./core/shopping-catalog.js";
import { japanDateTime } from "./core/direction-search.js";
import { photoDimensions, privateJpeg } from "./core/together.js";
import { receiptLimit, readSpending, saveSpending } from "./storage/db.js";
import { yen, cat, currentEntry, amountInput, openExpenseEditor } from "./spending-editor.js";

const walletNames={cash:"Cash",suica:"Suica",external:"Outside wallets"};
const sections={entries:"Transactions",breakdown:"Breakdown",balances:"Balances"};
const typeNames={expense:"Purchase",draft:"Draft",refund:"Refund",repayment:"Repayment",transfer:"Wallet transfer"};
const filtersBlank=()=>({q:"",date:"",category:"",person:"",area:""});
function encode(bytes) {
  let text="";
  for(let offset=0;offset<bytes.length;offset+=16384) text+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  return btoa(text);
}
const encodedImages=photos=>photos.map(({id,entryId,bytes})=>({id,entryId,jpeg:encode(bytes)}));
function download(data,filename) {
  const csv=typeof data==="string";
  const url=URL.createObjectURL(new Blob([csv?data:JSON.stringify(data)],{type:csv?"text/csv;charset=utf-8":"application/json"}));
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export function createSpendingPanel({getState,getTrip,getDay,selectTrip,modal,close,esc,toast}) {
  let root, owner, current, request=0, section="entries", filters=filtersBlank(), scope="whole", error="";
  const select=(items,value)=>items.map(([key,label])=>`<option value="${esc(key)}" ${key===value?"selected":""}>${esc(label)}</option>`).join("");
  const title=entry=>entry.merchant||typeNames[entry.type];
  const spendingPeople=ledger=>ledger.people.map(person=>[person.id,person.name]);
  const tripDays=trip=>getState().days.filter(day=>day.tripId===trip.id);
  async function load(trip) {
    const signal=++request;
    owner=trip.id; current=null; error=""; paint();
    try {const row=await readSpending(trip.id);if(signal===request) current=row;}
    catch(err) {if(signal===request) error=err.message;}
    if(signal===request) paint();
  }
  function filtersMatch(entry, totals, values) {
    if (values.date && entry.date!==values.date) return false;
    const refund=entry.type==="refund" ? totals.records.find(row=>row.id===entry.expenseId)?.lines.find(line=>line.id===entry.lineId) : null;
    const rows=entry.lines ?? (refund?[refund]:[]);
    if (values.category && !rows.some(line=>line.category===values.category) && entry.category!==values.category) return false;
    if (values.person && ![entry.payer,entry.from,entry.to,...rows.flatMap(line=>line.shares.map(row=>row.person))].includes(values.person)) return false;
    const norm=value=>String(value??"").normalize("NFKC").toLowerCase();
    const purchase=refund ? totals.records.find(row=>row.id===entry.expenseId) : null;
    const location=entry.area||purchase?.area;
    const visitId=entry.visitId||purchase?.visitId;
    const visit=visitId&&getState().stops.find(stop=>stop.id===visitId);
    const place=visit&&visitPlace(visit);
    const names=place?[...Object.values(place.names),brands[place.shopping?.brandId]]:[];
    return norm([entry.merchant,purchase?.merchant,entry.memo,location,...names].filter(Boolean).join(" ")).includes(norm(values.q.trim())) &&
      (!values.area.trim() || norm(location||entry.merchant||purchase?.merchant).includes(norm(values.area.trim())));
  }
  function rowsHTML(totals,ledger) {
    const rows=[...totals.records,...ledger.entries.filter(entry=>entry.type==="draft")].filter(row=>filtersMatch(row,totals,filters));
    rows.sort((a,b)=>a.type==="draft"&&b.type!=="draft"?-1:b.type==="draft"&&a.type!=="draft"?1:((b.date??"")+(b.time??"")).localeCompare((a.date??"")+(a.time??"")));
    return rows.map(entry=>{
      const label=entry.type==="refund"?(entry.received?"Received refund":"Pending refund"):typeNames[entry.type];
      const description=[entry.date??"Date unknown",entry.time,entry.area,label,entry.legacy?"Legacy":""].filter(Boolean).join(" · ");
      return `<li><button type="button" data-spend-entry="${esc(entry.id)}"><strong>${esc(title(entry))}</strong><span>${entry.type==="refund"&&entry.received?"−":""}${yen(entry.amount)}</span><small>${esc(description)}</small></button></li>`;
    }).join("")||'<li class="muted">No transactions match.</li>';
  }
  function matchingSummary(totals) {
    if (!Object.values(filters).some(Boolean)) return "";
    let whole=0,mine=0;
    const category=filters.category;
    for (const entry of totals.records) {
      if(!filtersMatch(entry,totals,filters)) continue;
      if(entry.type==="expense") for(const item of entry.lines) {
        if(category&&item.category!==category) continue;
        whole+=item.amount;
        mine+=item.shares.find(row=>row.person===SELF)?.yen??0;
      }
      if(entry.type==="refund"&&entry.received) {
        const impact=totals.impacts.get(entry.id);
        if(!impact||(category&&category!==impact.category)) continue;
        whole-=entry.amount;
        mine+=impact.shares.find(row=>row.person===SELF)?.yen??0;
      }
    }
    return `Matching known purchases and refunds ${yen(whole)} · your share ${yen(mine)}`;
  }
  function entryHTML(totals,ledger) {
    return `<div class="spending-filters grid2"><label>Search merchant<input type="search" data-spend-filter="q" value="${esc(filters.q)}"></label>
    <label>Date<input type="date" data-spend-filter="date" value="${esc(filters.date)}"></label>
    <label>Category<select data-spend-filter="category">${select([["","All categories"],...Object.entries(categories),["unclassified","Unclassified"]],filters.category)}</select></label>
    <label>Person<select data-spend-filter="person">${select([["","All people"],...spendingPeople(ledger)],filters.person)}</select></label>
    <label>Place<input type="search" data-spend-filter="area" value="${esc(filters.area)}"></label></div>
    <div class="actions"><button type="button" data-spend="today-filter">Today</button><button type="button" data-spend="clear-filter">Clear filters</button><button type="button" data-spend="refund">Record refund</button></div>
    <p id="spending-match-total" role="status">${matchingSummary(totals)}</p>
    <ul id="spending-records" class="spending-records">${rowsHTML(totals,ledger)}</ul>`;
  }
  function breakdown(totals,ledger,trip) {
    const value=scope==="whole"?totals.total:totals.mine;
    const values=[...(scope==="whole"?totals.whole:totals.personal)].sort((a,b)=>b[1]-a[1]);
    const today= dailyAllowance(ledger,trip,japanDateTime().date);
    return `<label>Show<select id="spending-breakdown-scope">${select([["whole","Whole trip"],["mine","My share"]],scope)}</select></label>
      <p><strong>${yen(value)}</strong> · ${scope==="whole"?"Whole trip":"My share"}</p>
      ${today?`<p>Today in Japan · ${yen(today.recordedToday)} recorded · ${yen(today.discretionaryToday)} discretionary</p>`:""}
      ${totals.unknownRefund&&scope==="whole"?`<p class="notice">Known amounts net to ${yen(totals.knownTotal)}. An older received refund has an unknown amount.</p>`:""}
      <ul class="spending-breakdown">${values.map(([id,amount])=>{
        const percent=value>0?Math.round(amount/value*100):null;
        return `<li><button type="button" data-spend-category="${esc(id)}"><span>${esc(cat(id))}</span><strong>${yen(amount)}${percent===null?"":` · ${percent}%`}</strong></button>
          ${percent===null?"":`<progress value="${Math.min(100,Math.max(0,percent))}" max="100" aria-label="${esc(cat(id))}"></progress>`}</li>`;
      }).join("")}</ul>${totals.pending?`<p>${yen(totals.pending)} pending merchant refunds</p>`:""}`;
  }
  function balances(totals,ledger,trip) {
    const suggestion=suggestedTransfers(totals.people);
    return `<ul class="spending-balances">${[...totals.people.values()].map(person=>{
      const pair=person.id===SELF?null:settlement(ledger,trip,person.id).owed;
      const label=pair>0?`${person.name} owes you ${yen(pair)}`:pair<0?`You owe ${person.name} ${yen(-pair)}`:`${person.name} · no direct balance with you`;
      return `<li><strong>${esc(person.id===SELF?person.name:label)}</strong><small>Paid ${yen(person.paid)} · Share ${yen(person.share)} · Repaid ${yen(person.repaid)} · Received ${yen(person.received)} · Net ${yen(person.balance)}</small>
        ${person.id!==SELF?`<button type="button" data-spend-settlement="${esc(person.id)}">View settlement</button>`:""}</li>`;
    }).join("")}</ul>
    ${totals.unassigned||totals.unknownRefund?`<p class="notice">${yen(totals.unassigned)} known legacy spending is unassigned. ${totals.unknownRefund?"A received legacy refund amount is unknown. ":""}Personal balances use assigned purchases.</p>`:""}
    <button type="button" data-spend="repayment">Record repayment</button>
    ${ledger.people.length>2&&suggestion.length?`<details><summary>Suggested group transfers</summary><p>These preserve assigned net balances. Record a repayment when money changes hands.</p>
      <ul>${suggestion.map(x=>`<li>${esc(totals.people.get(x.from).name)} → ${esc(totals.people.get(x.to).name)} · ${yen(x.amount)}</li>`).join("")}</ul></details>`:""}`;
  }
  function paint() {
    if (!root?.isConnected) return;
    const trip=getTrip();
    if (!trip) {root.innerHTML='<h1>Spending</h1><p>Create a trip to start tracking spending.</p><a href="#trips">Open Trips</a>';return;}
    const inactive = current ? "" : "disabled";
    const shell=`<div class="toolbar"><h1>Spending</h1><button type="button" class="primary" data-spend="add" ${inactive}>Add expense</button></div>
      <label>Trip<select id="spending-trip" ${inactive}>${select(getState().trips.map(item=>[item.id,item.name]),trip.id)}</select></label>`;
    if (!current) {root.innerHTML=shell+`<p role="status">${esc(error||"Opening spending…")}</p>`;return;}
    const {ledger}=current, totals=spendingTotals(ledger,trip), today=japanDateTime().date;
    root.innerHTML=shell+`<p><strong>${yen(totals.total)}</strong> trip spending · <strong>${yen(totals.mine)}</strong> your share</p>
      <div class="actions"><button type="button" data-spend="people">Travelers</button><button type="button" data-spend="wallet">Cash and Suica</button><button type="button" data-spend="reserve">Reserved costs</button></div>
      <div class="actions" role="group" aria-label="Spending views">${Object.entries(sections).map(([id,label])=>`<button type="button" data-spend-view="${id}" aria-pressed="${section===id}">${label}</button>`).join("")}</div>
      ${section==="entries"?entryHTML(totals,ledger):section==="breakdown"?breakdown(totals,ledger,trip):balances(totals,ledger,trip)}
      <details><summary>Private spending backups</summary><p>Full notebook backup includes spending entries. Receipt images use this separate trip backup.</p><div class="actions">
      <button type="button" data-spend="receipt-export">Backup with receipt images</button><button type="button" data-spend="receipt-import">Restore spending and receipt images</button><button type="button" data-spend="csv">Export spending CSV</button></div></details>`;
    root.querySelector("#spending-trip").onchange=e=>{filters=filtersBlank();selectTrip(e.target.value);};
    root.oninput=e=>{
      const key=e.target.dataset.spendFilter;
      if(key){
        filters[key]=e.target.value;
        root.querySelector("#spending-match-total").textContent=matchingSummary(totals);
        root.querySelector("#spending-records").innerHTML=rowsHTML(totals,ledger);
      }
      if(e.target.id==="spending-breakdown-scope"){scope=e.target.value;paint();}
    };
    root.onclick=e=>{
      const button=e.target.closest("button");if(!button) return;
      const data=button.dataset;
      if(data.spendView){section=data.spendView;paint();return;}
      if(data.spendCategory){filters={...filtersBlank(),category:data.spendCategory};section="entries";paint();return;}
      if(data.spendEntry){void details(trip,data.spendEntry).catch(err=>toast(err.message));return;}
      if(data.spendSettlement){statement(trip,current,data.spendSettlement);return;}
      const action=data.spend;if(!action)return;
      if(action==="today-filter"||action==="clear-filter"){filters=filtersBlank();if(action==="today-filter") filters.date=today;paint();return;}
      if(action==="add"){void addExpense().catch(err=>toast(err.message));return;}
      if(action==="csv") {exportCsv(totals);return;}
      if(action==="receipt-export"){exportReceipts(trip,current);return;}
      if(action==="receipt-import"){restoreReceipts(trip,current);return;}
      if(action==="wallet"){walletDialog(trip,current,totals);return;}
      if(action==="people"){peopleDialog(trip,current);return;}
      if(action==="reserve"){reservationDialog(trip,current);return;}
      quick(trip,current,action);
    };
  }

  async function write(trip,row,update,images) {
    const ledger=clone(row.ledger);
    update(ledger);
    const saved=await saveSpending(trip.id,row.revision,ledger,images);
    if(owner===trip.id){current=saved;paint();}
    return saved;
  }
  function saveEntry(trip,row,entry,images) {
    return write(trip,row,ledger=>{
      const i=ledger.entries.findIndex(value=>value.id===entry.id);
      if(i<0) ledger.entries.push(entry);else ledger.entries[i]=entry;
    },images&&[...row.images.filter(x=>x.entryId!==entry.id),...images]);
  }
  function editor(trip,row,entry,visit,visitDay) {
    openExpenseEditor({ledger:row.ledger,images:row.images,days:tripDays(trip),entry,visit,visitDay,modal,esc,close,
      save:(value,images)=>saveEntry(trip,row,value,images),erase:id=>write(trip,row,d=>{d.entries=d.entries.filter(x=>x.id!==id);}),
      assign:value=>write(trip,row,d=>{d.legacyAssignments=d.legacyAssignments.filter(x=>x.id!==value.id).concat(value);})});
  }
  async function addExpense(visitId=null) {
    const visit=getState().stops.find(item=>item.id===visitId), active=getTrip();
    const trip=visit?getState().trips.find(item=>item.id===visit.tripId):active;
    if(!trip){toast("Choose a trip before adding spending.");return;}
    const visitDay=visit?getState().days.find(day=>day.stopIds.includes(visit.id)):getDay();
    editor(trip,await readSpending(trip.id),null,visit,visitDay);
  }
  async function details(trip,id) {
    const row=await readSpending(trip.id), totals=spendingTotals(row.ledger,trip);
    const entry=row.ledger.entries.find(x=>x.id===id) ?? totals.records.find(x=>x.id===id);
    if(!entry) throw Error("This transaction is no longer available.");
    if(entry.type==="expense"||entry.type==="draft"){editor(trip,row,entry);return;}
    if(entry.legacy){modal("Legacy refund",`<p>${yen(entry.amount)} · ${entry.received?"Received":"Pending"}. Edit the legacy refund from Budget and travel checks.</p>`);return;}
    quick(trip,row,entry.type,entry);
  }
  function form(title,html,label,submit,after) {
    modal(title,`<form id="spending-small-form">${html}<p class="form-error" role="alert"></p><button type="submit" class="primary">${label}</button></form>`,()=>{
      const form=document.getElementById("spending-small-form");
      let working=false;
      form.onsubmit=async e=>{e.preventDefault();if(working)return;working=true;
        try{await submit(new FormData(form));close();}catch(err){form.querySelector('[role="alert"]').textContent=err.message;}finally{working=false;}};
      after?.(form);
    });
  }
  const input=(name,value="")=>`<input name="${name}" type="number" inputmode="numeric" min="0" max="999999999" step="1" value="${esc(value)}" required>`;
  function quick(trip,row,type,entry) {
    const {ledger}=row, existing=entry ?? currentEntry(type,0), people=spendingPeople(ledger);
    const wallets=Object.entries(walletNames), opt=(name,items,value)=>`<select name="${name}">${select(items,value)}</select>`;
    let fields="";
    if(type==="refund") {
      const lines=ledger.entries.filter(e=>e.type==="expense").flatMap(e=>e.lines.map(line=>[JSON.stringify([e.id,line.id]),`${title(e)} · ${line.label||cat(line.category)} · ${yen(line.amount)}`]));
      if(!lines.length){modal("Record refund","<p>Save the original purchase first so its refund can be linked to an item.</p>");return;}
      fields=`<label>Original purchase and item${opt("line",lines,entry?JSON.stringify([entry.expenseId,entry.lineId]):"")}</label>
      <label>Status${opt("status",[["yes","Received"],["no","Pending"]],entry?.received===false?"no":"yes")}</label>
      <label>Return to wallet${opt("wallet",[["","No wallet"],...wallets.filter(([id])=>id!=="external")],entry?.wallet??"")}</label>`;
    } else if(type==="repayment") {
      if(people.length<2){modal("Record repayment","<p>Add a traveler before recording a repayment.</p>");return;}
      fields=`<p>Record a repayment after the money has changed hands.</p><label>From${opt("from",people,entry?.from??people[1][0])}</label><label>To${opt("to",people,entry?.to??SELF)}</label>`;
    } else fields=`<p>Transfers update wallet balances.</p><label>From${opt("from",wallets,entry?.from??"external")}</label><label>To${opt("to",wallets,entry?.to??"cash")}</label>`;
    form(entry?`Edit ${typeNames[type].toLowerCase()}`:`Record ${typeNames[type].toLowerCase()}`,`${fields}<label>Amount (JPY)${input("amount",entry?.amount??"")}</label>
      <label>Japan date<input type="date" name="date" value="${existing.date}" required></label><label>Time (optional)<input type="time" name="time" value="${existing.time??""}"></label>
      <label>Memo<input name="memo" maxlength="1000" value="${esc(existing.memo)}"></label>${entry?'<button type="button" class="danger" data-delete-entry>Delete transaction</button>':""}`,"Save",values=>{
      const base={...existing,type,amount:amountInput(values.get("amount")),date:values.get("date"),time:values.get("time")||null,memo:values.get("memo")};
      if(type==="refund"){const [expenseId,lineId]=JSON.parse(values.get("line"));return saveEntry(trip,row,{...base,expenseId,lineId,received:values.get("status")==="yes",wallet:values.get("wallet")||null});}
      return saveEntry(trip,row,{...base,from:values.get("from"),to:values.get("to")});
    },form=>{const remove=form.querySelector("[data-delete-entry]");if(remove)remove.onclick=async()=>{
      if(!confirm("Delete this transaction?"))return;
      try{await write(trip,row,d=>{d.entries=d.entries.filter(x=>x.id!==entry.id);});close();}catch(err){form.querySelector('[role="alert"]').textContent=err.message;}
    };});
  }
  function peopleDialog(trip,row) {
    const names=row.ledger.people;
    form("Travelers",`<ul>${names.map(p=>`<li>${esc(p.name)}${p.id===SELF?" · you":""}</li>`).join("")}</ul>
      <label>Display name<input name="name" maxlength="80" required></label>`,"Add traveler",values=>write(trip,row,ledger=>{
      const name=values.get("name").trim();if(!name) throw Error("Enter a display name.");
      ledger.people.push({id:id(),name});
    }));
  }
  function reservationDialog(trip,row,edit=null) {
    const {ledger}=row;
    form("Reserved costs",`<p>Expected costs set aside from the daily allowance. Link a purchase when you pay one.</p>
      ${ledger.reservations.length?`<ul>${ledger.reservations.map(r=>`<li>${esc(r.label)} · ${yen(r.amount)} <button type="button" data-reservation="${esc(r.id)}">Edit</button></li>`).join("")}</ul>`:""}
      <label>Reserved cost<input name="label" maxlength="160" required value="${esc(edit?.label??"")}"></label>
      <label>Amount (JPY)${input("amount",edit?.amount??"")}</label>
      <label>For itinerary day<select name="day">${select([["","No day"],...tripDays(trip).map(d=>[d.id,d.date])],edit?.dayId??"")}</select></label>
      ${edit?'<button type="button" id="spending-dismiss-reserve">Remove reservation</button>':""}`,edit?"Save reservation":"Reserve cost",values=>write(trip,row,current=>{
      const reservation={id:edit?.id??id(),label:values.get("label").trim(),amount:amountInput(values.get("amount")),dayId:values.get("day")||null};
      current.reservations=current.reservations.filter(x=>x.id!==reservation.id).concat(reservation);
    }),element=>{
      for(const button of element.querySelectorAll("[data-reservation]"))button.onclick=()=>reservationDialog(trip,row,ledger.reservations.find(item=>item.id===button.dataset.reservation));
      const remove=element.querySelector("#spending-dismiss-reserve");
      if(remove) remove.onclick=async()=>{
        if(!confirm("Remove the reservation? Its recorded purchases will remain."))return;
        try{await write(trip,row,current=>{
          current.reservations=current.reservations.filter(x=>x.id!==edit.id);
          current.entries=current.entries.map(x=>x.reservationId===edit.id?{...x,reservationId:null}:x);
        });close();}catch(err){element.querySelector('[role="alert"]').textContent=err.message;}
      };
    });
  }
  function walletDialog(trip,row,totals) {
    modal("Cash and Suica",`<p>Expected cash <strong>${yen(totals.wallet.cash)}</strong> · Suica <strong>${yen(totals.wallet.suica)}</strong></p>
      <div class="actions"><button type="button" id="spending-opening">Opening balances</button>
      <button type="button" id="spending-transfer">Record wallet transfer</button><button type="button" id="spending-wallet-check">Check observed balance</button></div>`,()=>{
      document.getElementById("spending-opening").onclick=()=>form("Opening wallet balances",`<label>Cash (JPY)${input("cash",row.ledger.openings.cash)}</label>
        <label>Suica (JPY)${input("suica",row.ledger.openings.suica)}</label>`,"Save opening balances",values=>write(trip,row,ledger=>{
        ledger.openings={cash:amountInput(values.get("cash")),suica:amountInput(values.get("suica"))};
      }));
      document.getElementById("spending-transfer").onclick=()=>quick(trip,row,"transfer");
      document.getElementById("spending-wallet-check").onclick=()=>form("Compare wallet balance",`<label>Wallet<select name="wallet">${select(Object.entries(walletNames).filter(([id])=>id!=="external"),"cash")}</select></label>
        <label>Observed balance (JPY)${input("amount")}</label><p id="wallet-difference" role="status"></p>
        <p>Review wallet payments or transfers in Transactions before recording a correction.</p>`,"Record balance correction",values=>{
        const wallet=values.get("wallet"), observed=amountInput(values.get("amount")), delta=observed-totals.wallet[wallet];
        if(!delta) return;
        if(!confirm(`Record a ${yen(Math.abs(delta))} balance correction?`)) throw Error("Review your wallet transactions first.");
        return saveEntry(trip,row,currentEntry("transfer",Math.abs(delta),{
          from:delta>0?"external":wallet,to:delta>0?wallet:"external",memo:"Observed balance correction",
        }));
      },element=>{
        const update=()=>{const wallet=element.elements.wallet.value, value=element.elements.amount.value;
          element.querySelector("#wallet-difference").textContent=`Expected ${yen(totals.wallet[wallet])}${value!==""?` · difference ${yen(Number(value)-totals.wallet[wallet])}`:""}`;};
        element.oninput=update;update();
      });
    });
  }
  function statement(trip,row,companion) {
    const data=settlement(row.ledger,trip,companion);
    const person=row.ledger.people.find(item=>item.id===companion);
    const qualifying=new Set(data.records.filter(record=>record.type==="Purchase").map(record=>record.id));
    const photos=row.images.filter(item=>qualifying.has(item.entryId));
    const balance=data.owed>0?`${person.name} owes you ${yen(data.owed)}`:data.owed<0?`You owe ${person.name} ${yen(-data.owed)}`:"No direct balance";
    form("Settlement with "+person.name,`<p><strong>${esc(balance)}</strong></p><ul class="spending-balances">${data.records.map(r=>
      `<li>${esc(r.date??"Date unknown")} · ${esc(r.type)} · ${esc(r.merchant||"")}<small>${r.payer?esc(r.payer)+" · ":""}You ${yen(r.mine)} · ${esc(person.name)} ${yen(r.theirs)}</small></li>`).join("")}</ul>
      <p>Review this local download before sharing it. Select only the receipt images you want to include.</p>
      ${photos.map((photo,i)=>`<label class="check"><input type="checkbox" name="images" value="${esc(photo.id)}">Include image ${i+1} · ${esc(data.records.find(r=>r.id===photo.entryId)?.merchant||"Receipt")}</label>`).join("")}`,
      "Download settlement",values=>{
        const include=new Set(values.getAll("images"));
        const publicIds=new Map(data.records.map((record,i)=>[record.id,String(i+1)]));
        download({schemaVersion:1,kind:"spending-settlement",currency:"JPY",companion:person.name,owed:data.owed,
          records:data.records.map(({id,...record})=>({...record,number:publicIds.get(id)})),
          ...(include.size?{images:photos.filter(p=>include.has(p.id)).map(p=>({purchase:publicIds.get(p.entryId),jpeg:encode(p.bytes)}))}:{}),
        },"japan-spending-settlement.json");
      });
  }
  function exportReceipts(trip,row) {
    form("Backup with receipt images",`<p>This private file includes the trip’s spending and ${row.images.length} receipt ${row.images.length===1?"image":"images"}. Keep the full notebook backup with it to restore the trip.</p>
      <label class="check"><input type="checkbox" required>Include every receipt image in the private backup</label>`,"Download private spending backup",()=>download({
      schemaVersion:1,kind:"spending-with-receipts",tripId:trip.id,ledger:row.ledger,images:encodedImages(row.images),
    },"japan-spending-with-receipts.json"));
  }
  function restoreReceipts(trip,row) {
    form("Restore spending and receipt images",`<p>Restore the full notebook first if this is another device. Choose the matching private receipt backup for this trip.</p>
      <label>Receipt backup<input type="file" name="file" accept=".json,application/json" required></label>`,"Restore private backup",async values=>{
      const file=values.get("file");
      if(!file?.size||file.size>24*1024*1024)throw Error("Choose a receipt backup under 24 MiB.");
      const data=JSON.parse(await file.text());
      if(data?.schemaVersion!==1||data.kind!=="spending-with-receipts"||data.tripId!==trip.id||
          !Array.isArray(data.images)||data.images.length>receiptLimit.count) throw Error("Choose a receipt backup for this exact trip.");
      validateLedger(data.ledger);
      const ledger=mergeSpending(row.revision?row.ledger:null,data.ledger);
      const images=new Map(row.images.map(image=>[image.id,image]));
      const owners=new Set(ledger.entries.filter(e=>["expense","draft"].includes(e.type)).map(e=>e.id)), decodedIds=new Set();
      for(const image of data.images) {
        if(!image||typeof image.id!=="string"||!/^[a-z0-9-]{1,160}$/i.test(image.id)||decodedIds.has(image.id)||
            !owners.has(image.entryId)||typeof image.jpeg!=="string"||image.jpeg.length>Math.ceil(receiptLimit.imageBytes/3)*4)
          throw Error("Invalid receipt image or missing transaction.");
        decodedIds.add(image.id);
        const bytes=Uint8Array.from(atob(image.jpeg),character=>character.charCodeAt(0));
        const dimensions=photoDimensions(bytes);
        if(dimensions?.type!=="image/jpeg"||!dimensions.width||!dimensions.height||dimensions.width*dimensions.height>24000000)
          throw Error("Unsupported receipt JPEG.");
        if(!images.has(image.id))images.set(image.id,{id:image.id,entryId:image.entryId,bytes:privateJpeg(bytes)});
      }
      const saved=await saveSpending(trip.id,row.revision,ledger,[...images.values()]);
      if(owner===trip.id){current=saved;paint();}toast("Private spending backup restored.");
    });
  }
  function exportCsv(totals) {
    const cell=value=>{const text=String(value??"");return '"'+(/^[\s]*[=+\-@]/.test(text)?"'":"")+text.replaceAll('"','""')+'"';};
    const rows=totals.records.map(e=>[e.date,e.time,e.type,e.merchant,e.area,e.amount,e.received===undefined?"":e.received?"received":"pending",e.memo]);
    download([["Japan date","Japan time","Type","Merchant","Place","JPY","Refund status","Memo"],...rows].map(row=>row.map(cell).join(",")).join("\r\n"),"japan-spending.csv");
  }
  return {
    addExpense,
    render(container) {
      if(root?.parentElement===container&&owner===getTrip()?.id)return;
      root=document.createElement("section");root.className="spending-panel narrow";container.replaceChildren(root);
      const trip=getTrip();if(trip)void load(trip);else paint();
    },
    async today(trip,date) {
      const {ledger}=await readSpending(trip.id), data=dailyAllowance(ledger,trip,date);
      if(!data)return "";
      return `<section class="spending-today"><h3>Daily allowance</h3><p><strong>${yen(data.allowance)}</strong> per day · ${data.remainingDays} days left</p>
        <p>Today ${yen(data.recordedToday)} recorded · ${yen(data.discretionaryToday)} discretionary · ${yen(data.reserved)} reserved at start of today</p></section>`;
    },
  };
}
