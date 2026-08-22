export function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function safeDivisor(value) {
  const parsed = Number(value);
  return parsed && Number.isFinite(parsed) ? parsed : 1;
}

export function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function formatNumber(value, maximumFractionDigits = 2) {
  const fractionDigits = Math.max(0, maximumFractionDigits);
  return (Number(value) || 0).toLocaleString("sl-SI", {
    minimumFractionDigits: Math.min(2, fractionDigits),
    maximumFractionDigits: fractionDigits,
  });
}

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyItem(person = "") {
  return { id: createId(), artikel: "", cny: "", qty: 1, weight: "", who: person };
}

export function computeRows({ items = [], myRatio, shippingCNY, origRatio }) {
  const totalWeight = items.reduce((total, row) => total + Math.max(0, toNumber(row.weight)), 0);
  const shippingEUR = Math.max(0, toNumber(shippingCNY)) / safeDivisor(myRatio);
  const usdPerEur = safeDivisor(origRatio) / safeDivisor(myRatio);

  return items.map((row) => {
    const unitCNY = Math.max(0, toNumber(row.cny));
    const qty = Math.max(1, Math.floor(toNumber(row.qty) || 1));
    const weightTotal = Math.max(0, toNumber(row.weight));
    const cnyTotal = unitCNY * qty;
    const eur = cnyTotal / safeDivisor(myRatio);
    const shipPart = totalWeight > 0 ? (weightTotal / totalWeight) * shippingEUR : 0;
    const together = eur + shipPart;
    const regular = together / safeDivisor(usdPerEur);
    const profit = together - regular;
    const weightPct = totalWeight > 0 ? (weightTotal / totalWeight) * 100 : 0;

    return {
      ...row,
      qty,
      cnyTotal,
      eur,
      weightTotal,
      weightPct,
      shipPart,
      together,
      regular,
      profit,
    };
  });
}

export function calculatePackage({
  items = [],
  people = [],
  origRatio,
  myRatio,
  shippingCNY,
  receivedMap = {},
  personOpts = {},
}) {
  const rows = computeRows({ items, myRatio, shippingCNY, origRatio });
  const totalWeight = sum(rows.map((row) => row.weightTotal));
  const totalCNY = sum(rows.map((row) => row.cnyTotal));
  const shippingEUR = Math.max(0, toNumber(shippingCNY)) / safeDivisor(myRatio);
  const usdPerEur = safeDivisor(origRatio) / safeDivisor(myRatio);
  const rateProfit = totalCNY / safeDivisor(myRatio) - totalCNY / safeDivisor(origRatio);
  const grandTogether = sum(rows.map((row) => row.together));
  const namedPeople = [...new Set(people.map((person) => person.trim()).filter(Boolean))];

  const summaryByPerson = namedPeople.map((who) => {
    const personRows = rows.filter((row) => (row.who || "").trim() === who);
    const eur = sum(personRows.map((row) => row.together));
    const minimum = eur / safeDivisor(usdPerEur);
    const options = personOpts[who] || { fee: 1, mode: "eur" };
    const base = options.mode === "redna" ? minimum : eur;
    const charge = base * (Number(options.fee) || 1);
    const received = toNumber(receivedMap[who]);

    return {
      who,
      eur,
      minimum,
      charge,
      received,
      due: charge - received,
      profitReceived: received - minimum,
      profitPlanned: charge - minimum,
    };
  });

  return {
    rows,
    totalWeight,
    totalCNY,
    shippingEUR,
    usdPerEur,
    rateProfit,
    grandTogether,
    summaryByPerson,
  };
}

export function hydratePackage(pkg) {
  const normalized = {
    ...pkg,
    id: pkg?.id || createId(),
    name: String(pkg?.name || "Uvožen paket"),
    createdAt: pkg?.createdAt || new Date().toISOString(),
    updatedAt: pkg?.updatedAt || pkg?.createdAt || new Date().toISOString(),
    items: Array.isArray(pkg?.items) ? pkg.items : [],
    people: Array.isArray(pkg?.people) ? pkg.people : [],
    receivedMap: pkg?.receivedMap && typeof pkg.receivedMap === "object" ? pkg.receivedMap : {},
    personOpts: pkg?.personOpts && typeof pkg.personOpts === "object" ? pkg.personOpts : {},
    origRatio: toNumber(pkg?.origRatio) || Number((800 / 101.37).toFixed(6)),
    myRatio: toNumber(pkg?.myRatio) || 6.5,
    shippingCNY: Math.max(0, toNumber(pkg?.shippingCNY)),
  };

  return {
    ...normalized,
    derived: calculatePackage(normalized),
  };
}
