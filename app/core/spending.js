import { dates } from "./model.js";

export const SELF = "me";
export const categories = Object.freeze({
  food: "Food & drink", transport: "Transport", lodging: "Lodging", shopping: "Shopping",
  activity: "Activities & admission", sauna: "Onsen & sauna", other: "Other",
});
export const yenLimit = 999999999;
export const money = amount => Number.isSafeInteger(amount) && amount >= 0 && amount <= yenLimit;
export const newLedger = () => ({ schemaVersion: 1, people: [{ id: SELF, name: "Me" }],
  entries: [], reservations: [], openings: { cash: 0, suica: 0 }, legacyAssignments: [] });

// Integer largest-remainder allocation. Order is the tie break displayed on equal splits.
export function allocate(amount, weights) {
  if (!money(amount) || !weights.length || weights.some(row => !money(row.weight)) ||
      new Set(weights.map(row => row.person)).size !== weights.length) throw Error("Choose people and whole yen amounts.");
  const total = weights.reduce((sum, row) => sum + row.weight, 0);
  if (!total) throw Error("Choose at least one share.");
  const rows = weights.map(({ person, weight }, i) => {
    const numerator = BigInt(amount) * BigInt(weight);
    return { person, i, yen: Number(numerator / BigInt(total)), remainder: numerator % BigInt(total) };
  });
  const unassigned = amount - rows.reduce((sum, row) => sum + row.yen, 0);
  [...rows].sort((a,b) => a.remainder === b.remainder ? a.i-b.i : a.remainder > b.remainder ? -1 : 1)
    .slice(0,unassigned).forEach(row => row.yen++);
  return rows.map(({person,yen}) => ({person,yen}));
}
export const equalShares = (amount, people) => allocate(amount, people.map(person => ({person,weight:1})));

// Legacy figures remain the original trip fields. Stable projection keys keep
// repeated copies of identical receipts independent without adding the totals again.
export function legacyEntries(plan = {}, assignments = []) {
  const assigned = new Map(assignments.map(row => [row.id,row]));
  const seen = new Map();
  const expense = (id, yen, merchant) => {
    const override = assigned.get(id);
    return { type:"expense", id, amount:yen, payer:override?.payer ?? null, merchant, date:null, legacy:true,
      lines:[{id:"main", amount:yen, category:override?.category ?? "unclassified", shares:override?.shares ?? []}] };
  };
  const rows = (plan.receipts ?? []).map(({yen,label}) => {
    const key=JSON.stringify([yen,label]);
    const position=seen.get(key) ?? 0;
    seen.set(key,position+1);
    return expense("receipt:"+position+":"+key,yen,label||"Legacy receipt");
  });
  if (plan.spentYen != null) rows.push(expense("other:"+plan.spentYen,plan.spentYen,"Other legacy spending"));
  if (plan.refundYen != null && ["pending","received"].includes(plan.refundStatus)) rows.push({
    type:"refund", id:"legacy-refund", amount:plan.refundYen, received:plan.refundStatus==="received", legacy:true,
    category:"unclassified", date:null, merchant:"Legacy refund", payer:null,
  });
  return rows;
}

function bucket(map, key, amount) { map.set(key, (map.get(key) ?? 0) + amount); }
export function spendingTotals(ledger, trip, through = null) {
  const records = [...legacyEntries(trip?.localPlan,ledger.legacyAssignments), ...ledger.entries].filter(entry =>
    entry.type !== "draft" && (!through || !entry.date || entry.date < through));
  const people = new Map(ledger.people.map(({id,name}) => [id,{id,name,paid:0,share:0,repaid:0,received:0,balance:0}]));
  const whole = new Map(), personal = new Map(), wallet = { ...ledger.openings }, lines = new Map(), impacts = new Map();
  let total = 0, mine = 0, unassigned = 0, pending = 0;
  const write = (id, field, delta) => { if (people.has(id)) people.get(id)[field] += delta; };
  const charge = (amount, category, shares, payer) => {
    const allocated = shares.reduce((sum,row) => sum+row.yen,0);
    const owned = shares.find(row=>row.person===SELF)?.yen ?? 0;
    total += amount; mine += owned; unassigned += amount-allocated;
    bucket(whole,category,amount); bucket(personal,category,owned);
    write(payer,"paid",amount);
    for (const {person,yen} of shares) write(person,"share",yen);
  };
  for (const entry of records) {
    if (entry.type !== "expense") continue;
    for (const line of entry.lines) {
      const key = JSON.stringify([entry.id,line.id]);
      lines.set(key,{ ...line, payer:entry.payer, remaining:line.amount, shares:line.shares.map(share=>({...share})) });
      charge(line.amount,line.category,line.shares,entry.payer);
    }
    if (entry.wallet) wallet[entry.wallet] -= entry.amount;
  }
  for (const entry of records) {
    if (entry.type === "refund") {
      if (!entry.received) { pending += entry.amount; continue; }
      const line = lines.get(JSON.stringify([entry.expenseId,entry.lineId]));
      if (!line && !entry.legacy) continue;
      let shares = [];
      if (line) {
        if (entry.amount > line.remaining) throw Error("Refund exceeds the line’s remaining amount.");
        if (line.shares.length) {
          const reduction = allocate(entry.amount,line.shares.map(({person,yen})=>({person,weight:yen})));
          for (const item of line.shares) item.yen -= reduction.find(row=>row.person===item.person).yen;
          shares = reduction.map(({person,yen})=>({person,yen:-yen}));
        }
        line.remaining -= entry.amount;
      }
      const category = line?.category ?? entry.category;
      charge(-entry.amount,category,shares,line?.payer ?? null);
      impacts.set(entry.id,{category,shares});
      if (entry.wallet) wallet[entry.wallet] += entry.amount;
    } else if (entry.type === "repayment") {
      write(entry.from,"repaid",entry.amount); write(entry.to,"received",entry.amount);
    } else if (entry.type === "transfer") {
      if (entry.from !== "external") wallet[entry.from] -= entry.amount;
      if (entry.to !== "external") wallet[entry.to] += entry.amount;
    }
  }
  for (const person of people.values()) person.balance = person.paid-person.share+person.repaid-person.received;
  const unknownRefund = trip?.localPlan?.refundStatus === "received" && trip.localPlan.refundYen == null;
  return { total:unknownRefund ? null : total, knownTotal:total, unknownRefund,
    mine,unassigned,pending,whole,personal,people,wallet,impacts,records };
}

export function settlement(ledger, trip, companion) {
  const totals = spendingTotals(ledger, trip), purchases = new Map(), records = [];
  let owed = 0;
  const amountFor = (shares, person) => shares.find(row=>row.person===person)?.yen ?? 0;
  for (const entry of totals.records) {
    if (entry.type!=="expense") continue;
    purchases.set(entry.id,entry);
    const mine = entry.lines.reduce((sum,line)=>sum+amountFor(line.shares,SELF),0);
    const theirs = entry.lines.reduce((sum,line)=>sum+amountFor(line.shares,companion),0);
    const includesBoth = (mine>0 || entry.payer===SELF) && (theirs>0 || entry.payer===companion);
    if (!includesBoth) continue;
    owed += entry.payer===SELF ? theirs : entry.payer===companion ? -mine : 0;
    records.push({ id:entry.id, type:"Purchase", date:entry.date, merchant:entry.merchant, mine, theirs,
      payer:entry.payer===SELF ? "Me" : entry.payer===companion ? totals.people.get(companion).name : "Another participant" });
  }
  for (const entry of totals.records) {
    if (entry.type==="repayment" && [entry.from,entry.to].includes(SELF) && [entry.from,entry.to].includes(companion)) {
      const paidByCompanion = entry.from===companion;
      owed += paidByCompanion ? -entry.amount : entry.amount;
      records.push({ id:entry.id, type:"Repayment", date:entry.date, merchant:"Already exchanged",
        mine:paidByCompanion?0:entry.amount, theirs:paidByCompanion?entry.amount:0,
        payer:paidByCompanion?totals.people.get(companion).name:"Me" });
    } else if (entry.type==="refund" && entry.received) {
      const purchase = purchases.get(entry.expenseId), impact = totals.impacts.get(entry.id);
      if (!purchase || !impact || !records.some(row=>row.id===purchase.id)) continue;
      const mine=amountFor(impact.shares,SELF), theirs=amountFor(impact.shares,companion);
      if (!mine && !theirs) continue;
      owed += purchase.payer===SELF ? theirs : purchase.payer===companion ? -mine : 0;
      records.push({ id:entry.id, type:"Refund", date:entry.date, merchant:purchase.merchant, mine, theirs });
    }
  }
  return { owed, records };
}

export function suggestedTransfers(people) {
  const owing = [...people.values()].filter(person=>person.balance<0).map(p=>({id:p.id,yen:-p.balance}));
  const owed = [...people.values()].filter(person=>person.balance>0).map(p=>({id:p.id,yen:p.balance}));
  const transfers=[];
  let deb=0, cred=0;
  while (deb<owing.length && cred<owed.length) {
    const amount=Math.min(owing[deb].yen,owed[cred].yen);
    transfers.push({from:owing[deb].id,to:owed[cred].id,amount});
    owing[deb].yen-=amount;
    owed[cred].yen-=amount;
    if (!owing[deb].yen) deb++;
    if (!owed[cred].yen) cred++;
  }
  return transfers;
}

export function dailyAllowance(ledger, trip, today) {
  if (!trip || today < trip.startDate || today > trip.endDate || trip.localPlan?.budgetYen == null) return null;
  const remainingDays = dates(today, trip.endDate).length;
  const previous = spendingTotals(ledger,trip,today).total;
  const recordedToday = ledger.entries.reduce((sum,entry)=>entry.date!==today ? sum :
    entry.type==="expense" ? sum+entry.amount : entry.type==="refund" && entry.received ? sum-entry.amount : sum,0);
  let coveredToday = 0;
  const reserved = ledger.reservations.reduce((sum,reservation)=>{
    const paid=ledger.entries.reduce((yen,entry)=>entry.type==="expense" && entry.reservationId===reservation.id &&
      entry.date < today ? yen+entry.amount : yen,0);
    const due=Math.max(0,reservation.amount-paid);
    const paidToday=ledger.entries.reduce((yen,entry)=>entry.type==="expense" && entry.reservationId===reservation.id &&
      entry.date===today ? yen+entry.amount : yen,0);
    coveredToday += Math.min(due,paidToday);
    return sum+due;
  },0);
  const room = previous===null ? null : trip.localPlan.budgetYen-previous-reserved;
  return { remainingDays, reserved, previous, recordedToday, discretionaryToday:recordedToday-coveredToday,
    coveredToday, room, allowance:room===null ? null : Math.floor(room/remainingDays) };
}
