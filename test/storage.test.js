import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createBackup,
  listPackages,
  migrateLegacyPackages,
  parseBackup,
  removePackage,
  replacePackages,
  savePackage,
} from "../src/lib/storage.js";

globalThis.localStorage = createLocalStorage();

test("cloud refresh replaces only the active owner's cached packages including deletions", async () => {
  await savePackage("replace-a", { id: "old", name: "Old" });
  await savePackage("replace-b", { id: "private", name: "Private" });
  await replacePackages("replace-a", [{ id: "new", name: "New" }]);
  assert.deepEqual((await listPackages("replace-a")).map((pkg) => pkg.id), ["new"]);
  assert.deepEqual((await listPackages("replace-b")).map((pkg) => pkg.id), ["private"]);
  await replacePackages("replace-a", []);
  assert.deepEqual(await listPackages("replace-a"), []);
});

const basePackage = {
  id: "package-1",
  name: "Avgust",
  createdAt: "2026-08-22T10:00:00.000Z",
  items: [{ id: "item-1", artikel: "Majica", cny: 65, qty: 1, weight: 200, who: "Miha" }],
  people: ["Miha"],
  origRatio: 8,
  myRatio: 6.5,
  shippingCNY: 13,
  receivedMap: {},
  personOpts: {},
};

test("IndexedDB packages are isolated by owner and can be deleted", async () => {
  await savePackage("owner-a", basePackage);
  await savePackage("owner-b", { ...basePackage, name: "Drug račun" });

  const ownerA = await listPackages("owner-a");
  const ownerB = await listPackages("owner-b");
  assert.equal(ownerA.length, 1);
  assert.equal(ownerA[0].name, "Avgust");
  assert.equal(ownerB.length, 1);
  assert.equal(ownerB[0].name, "Drug račun");
  assert.equal(ownerA[0].derived.grandTogether, 12);

  await removePackage("owner-a", basePackage.id);
  assert.equal((await listPackages("owner-a")).length, 0);
  assert.equal((await listPackages("owner-b")).length, 1);
});

test("legacy localStorage history migrates once without duplicates", async () => {
  localStorage.setItem("RACUN_PACKAGES", JSON.stringify([{ ...basePackage, id: "legacy-package" }]));
  assert.equal(await migrateLegacyPackages("legacy-owner"), 1);
  assert.equal(await migrateLegacyPackages("legacy-owner", [{ ...basePackage, id: "legacy-package" }]), 0);
  assert.equal((await listPackages("legacy-owner")).length, 1);
});

test("backup round-trip keeps packages and draft", () => {
  const draft = { items: basePackage.items, people: basePackage.people };
  const backup = createBackup([basePackage], draft);
  const restored = parseBackup(JSON.stringify(backup));
  assert.equal(restored.packages[0].name, "Avgust");
  assert.equal(restored.draft.people[0], "Miha");
});

function createLocalStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); },
  };
}
