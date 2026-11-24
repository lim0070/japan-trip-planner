import { categories, money, SELF } from "./spending.js";

const ledgerKeys = ["schemaVersion","people","entries","reservations","openings","legacyAssignments"];
const kinds = {
  expense:["payer","lines","wallet","reservationId"],
  draft:["payer","lines","wallet","reservationId"],
  refund:["expenseId","lineId","received","wallet"],
  repayment:["from","to"],
  transfer:["from","to"],
};
const common = ["id","type","amount","date","time","dayId","visitId","merchant","area","method","memo"];
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const fields = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k=>Object.hasOwn(v,k));
const string = (v,lim) => typeof v === "string" && v.length <= lim;
const identifier = v => string(v,160) && /^[a-z0-9][a-z0-9_.:-]*$/i.test(v) && !["constructor","prototype"].includes(v);
const optionalId = v => v === null || identifier(v);
const clock = v => v === null || (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
const date = v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v+"T00:00:00Z")) && new Date(v+"T00:00:00Z").toISOString().startsWith(v);
const wallet = v => v === null || ["cash","suica"].includes(v);
const unique = values => new Set(values).size === values.length;
const array = (v,limit,each) => Array.isArray(v) && v.length <= limit && v.every(each);
const fail = message => { throw Error(message); };
const isCategory = v => Object.hasOwn(categories,v);

export function validateLedger(ledger) {
  if (!fields(ledger,ledgerKeys) || ledger.schemaVersion !== 1 ||
      !array(ledger.people,30,p=>fields(p,["id","name"]) && identifier(p.id) && string(p.name,80) && p.name.trim()) ||
      !unique(ledger.people.map(p=>p.id)) || !ledger.people.some(p=>p.id===SELF) ||
      !fields(ledger.openings,["cash","suica"]) || !money(ledger.openings.cash) || !money(ledger.openings.suica))
    fail("Unsupported spending ledger or participants.");
  const people = new Set(ledger.people.map(p=>p.id));
  const share = v => fields(v,["person","yen"]) && people.has(v.person) && money(v.yen);
  const shares = (rows, amount, canDraft) => array(rows,30,share) && unique(rows.map(r=>r.person)) &&
    (canDraft || (rows.length && rows.reduce((s,r)=>s+r.yen,0)===amount));
  if (!array(ledger.reservations,100,r=>fields(r,["id","amount","label","dayId"]) && identifier(r.id) &&
      money(r.amount) && r.amount>0 && string(r.label,160) && r.label.trim() && optionalId(r.dayId)) ||
      !unique(ledger.reservations.map(r=>r.id))) fail("Invalid spending reservations.");
  const reservations = new Set(ledger.reservations.map(r=>r.id));
  if (!array(ledger.legacyAssignments,201,r=>fields(r,["id","amount","payer","category","shares"]) &&
      string(r.id,400) && /^(receipt|other):/.test(r.id) &&
      money(r.amount) && people.has(r.payer) && isCategory(r.category) && shares(r.shares,r.amount,false)) ||
      !unique(ledger.legacyAssignments.map(r=>r.id))) fail("Invalid legacy spending assignment.");
  const expense = (entry,draft) => people.has(entry.payer) && wallet(entry.wallet) &&
    (entry.wallet===null || entry.payer===SELF) && (entry.reservationId===null || reservations.has(entry.reservationId)) &&
    array(entry.lines,60,line=>fields(line,["id","amount","category","shares","label"]) && identifier(line.id) && money(line.amount) &&
      isCategory(line.category) && string(line.label,160) && shares(line.shares,line.amount,draft)) &&
    unique(entry.lines.map(line=>line.id)) && (draft || (entry.lines.length && entry.lines.reduce((sum,line)=>sum+line.amount,0)===entry.amount));
  if (!array(ledger.entries,1500,entry=>{
    if (!object(entry) || !Object.hasOwn(kinds,entry.type) || !fields(entry,[...common,...kinds[entry.type]]) ||
        !identifier(entry.id) || !money(entry.amount) || (entry.type!=="draft" && entry.amount===0) ||
        !(date(entry.date) || (entry.type==="draft" && entry.date===null)) || !clock(entry.time) ||
        !optionalId(entry.dayId) || !optionalId(entry.visitId) || !string(entry.merchant,160) ||
        !string(entry.area,160) || !string(entry.method,80) || !string(entry.memo,1000)) return false;
    switch(entry.type) {
      case "expense": case "draft": return expense(entry,entry.type==="draft");
      case "refund": return identifier(entry.expenseId) && identifier(entry.lineId) && typeof entry.received==="boolean" && wallet(entry.wallet);
      case "repayment": return people.has(entry.from) && people.has(entry.to) && entry.from!==entry.to;
      case "transfer": return ["cash","suica","external"].includes(entry.from) &&
        ["cash","suica","external"].includes(entry.to) && entry.from!==entry.to;
    }
  }) || !unique(ledger.entries.map(entry=>entry.id))) fail("Invalid transaction, dates, or whole-yen allocation.");
  const purchased = new Map(ledger.entries.filter(entry=>entry.type==="expense").map(entry=>[
    entry.id, {date:entry.date,lines:new Map(entry.lines.map(line=>[line.id,line.amount]))},
  ]));
  for (const refund of ledger.entries.filter(entry=>entry.type==="refund")) {
    const purchase = purchased.get(refund.expenseId), available = purchase?.lines.get(refund.lineId) ?? 0;
    if (refund.amount > available) fail("Combined refunds exceed the associated item amount.");
    if (refund.date < purchase.date) fail("A refund date cannot precede the purchase date.");
    purchase.lines.set(refund.lineId,available-refund.amount);
  }
  return ledger;
}

export function mergeSpending(local, incoming) {
  if (!local) return validateLedger(incoming);
  const kept = new Map(local.entries.map(row=>[row.id,row]));
  const offered = new Map(incoming.entries.map(row=>[row.id,row]));
  for (const refund of incoming.entries.filter(row=>row.type==="refund"&&!kept.has(row.id))) {
    const retained=kept.get(refund.expenseId), original=offered.get(refund.expenseId);
    if (!retained || !original) continue;
    const details=expense=>{
      const line=expense.lines?.find(row=>row.id===refund.lineId);
      return line&&[expense.payer,expense.wallet,line.amount,line.category,line.shares.map(row=>[row.person,row.yen])];
    };
    if (JSON.stringify(details(retained))!==JSON.stringify(details(original)))
      fail("An incoming refund belongs to a different version of a local purchase. Review the purchase before restoring.");
  }
  const join = (existing,additions) => {
    const index = new Map(additions.map(row=>[row.id,row]));
    for (const row of existing) index.set(row.id,row);
    // Keep the order of local entries, which decides the remainder in partial refunds.
    return [...new Map([...existing.map(row=>[row.id,row]),...index]).values()];
  };
  return validateLedger({
    ...local, people:join(local.people,incoming.people), entries:join(local.entries,incoming.entries),
    reservations:join(local.reservations,incoming.reservations), legacyAssignments:join(local.legacyAssignments,incoming.legacyAssignments),
  });
}

export function validateSpendingBackups(rows, trips) {
  const ids=new Set(trips.map(trip=>trip.id));
  if (!array(rows,100,row=>fields(row,["tripId","ledger"]) && ids.has(row.tripId)) ||
      !unique(rows.map(row=>row.tripId))) fail("Spending information must belong to a trip in the file.");
  for (const row of rows) validateLedger(row.ledger);
  return rows;
}

export function remapSpending(rows, copies) {
  return rows.map(row=>{
    const copy=copies.get(row.tripId);
    if (!copy) return row;
    const fields = value => ({dayId:value.dayId ? copy.dayIds.get(value.dayId) ?? null : null});
    return {tripId:copy.id,ledger:{ ...row.ledger,
      entries:row.ledger.entries.map(item=>({...item,...fields(item),visitId:item.visitId ? copy.stopIds.get(item.visitId) ?? null : null})),
      reservations:row.ledger.reservations.map(item=>({...item,...fields(item)})),
    }};
  });
}
