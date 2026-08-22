import test from "node:test";
import assert from "node:assert/strict";
import { calculatePackage, computeRows, formatNumber, hydratePackage } from "../src/lib/calculations.js";

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
