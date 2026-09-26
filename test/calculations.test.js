import test from "node:test";
import assert from "node:assert/strict";
import { calculatePackage, computeRows, formatNumber, hydratePackage } from "../src/lib/calculations.js";

test("actual profit is received minus acquisition cost, not overpayment", () => {
  const result = calculatePackage({
    items: [{ cny: 180, qty: 1, weight: 100, who: "Jakob" }], people: ["Jakob"],
    origRatio: 1, myRatio: 0.9, shippingCNY: 0, receivedMap: { Jakob: 220 },
  });
  const person = result.summaryByPerson[0];
  assert.equal(person.cost, 180);
  assert.equal(person.charge, 200);
  assert.equal(person.profitReceived, 40);
  assert.equal(person.profitPlanned, 20);
  assert.equal(person.due, -20);
  assert.equal(result.totalProfitReceived, 40);
});

test("total profit includes shipping and unassigned costs, including zero weight", () => {
  const result = calculatePackage({
    items: [{ cny: 180, qty: 1, weight: 0, who: "Jakob" }, { cny: 20, qty: 1, weight: 0, who: "" }],
    people: ["Jakob"], origRatio: 1, myRatio: 0.9, shippingCNY: 10, receivedMap: { Jakob: 220 },
  });
  assert.equal(result.totalCost, 210);
  assert.equal(result.totalProfitReceived, 10);
});

test("partial payments and multiple recipients show actual losses and profits", () => {
  const result = calculatePackage({
    items: [{ cny: 100, qty: 1, weight: 1, who: "A" }, { cny: 100, qty: 1, weight: 3, who: "B" }],
    people: ["A", "B"], origRatio: 1, myRatio: 1, shippingCNY: 40,
    receivedMap: { A: 50, B: 150 }, personOpts: { B: { mode: "redna", fee: 1.2 } },
  });
  assert.equal(result.summaryByPerson[0].profitReceived, -60);
  assert.equal(result.summaryByPerson[1].profitReceived, 20);
  assert.equal(result.totalProfitReceived, -40);
  assert.equal(result.summaryByPerson[1].profitPlanned, 26);
});

test("formatting supports zero decimal places", () => {
  assert.equal(formatNumber(12.6, 0), "13");
});

test("shipping is split proportionally by row weight", () => {
  const rows = computeRows({
    items: [
      { id: "a", artikel: "A", cny: 65, qty: 1, weight: 100, who: "Miha" },
      { id: "b", artikel: "B", cny: 65, qty: 1, weight: 300, who: "Živa" },
    ],
    myRatio: 6.5,
    origRatio: 8,
    shippingCNY: 65,
  });

  assert.equal(rows[0].shipPart, 2.5);
  assert.equal(rows[1].shipPart, 7.5);
  assert.equal(rows[0].together, 12.5);
  assert.equal(rows[1].together, 17.5);
});

test("package summary respects fee mode and received amount", () => {
  const result = calculatePackage({
    items: [{ id: "a", artikel: "A", cny: 65, qty: 1, weight: 100, who: "Miha" }],
    people: ["Miha"],
    myRatio: 6.5,
    origRatio: 6.5,
    shippingCNY: 0,
    personOpts: { Miha: { mode: "eur", fee: 1.2 } },
    receivedMap: { Miha: 5 },
  });

  assert.equal(result.summaryByPerson[0].charge, 12);
  assert.equal(result.summaryByPerson[0].due, 7);
});

test("legacy packages are hydrated with current derived values", () => {
  const pkg = hydratePackage({
    id: "legacy",
    name: "Legacy",
    items: [{ id: "a", artikel: "A", cny: 13, qty: 2, weight: 100, who: "" }],
    people: [],
    myRatio: 6.5,
    origRatio: 8,
    shippingCNY: 0,
  });

  assert.equal(pkg.derived.totalCNY, 26);
  assert.equal(pkg.derived.grandTogether, 4);
  assert.ok(pkg.updatedAt);
});
