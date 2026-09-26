import { hydratePackage } from "./calculations.js";

const DB_NAME = "acb-local-storage";
const DB_VERSION = 1;
const PACKAGE_STORE = "packages";
const DRAFT_PREFIX = "ACB_DRAFT_V2";

let databasePromise;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("IndexedDB ni na voljo."));
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PACKAGE_STORE)) {
        const store = database.createObjectStore(PACKAGE_STORE, { keyPath: "storageKey" });
        store.createIndex("ownerId", "ownerId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Lokalne baze ni bilo mogoče odpreti."));
  });

  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Operacija shranjevanja ni uspela."));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Operacija shranjevanja ni uspela."));
    transaction.onabort = () => reject(transaction.error || new Error("Operacija shranjevanja je bila prekinjena."));
  });
}

function asRecord(ownerId, pkg) {
  const hydrated = hydratePackage(pkg);
  const { derived: _derived, ...snapshot } = hydrated;
  return { ...snapshot, ownerId, storageKey: `${ownerId}::${hydrated.id}` };
}

function withoutStorageFields(record) {
  const { ownerId: _ownerId, storageKey: _storageKey, ...pkg } = record;
  return pkg;
}

export async function listPackages(ownerId) {
  const database = await openDatabase();
  const transaction = database.transaction(PACKAGE_STORE, "readonly");
  const records = await requestResult(transaction.objectStore(PACKAGE_STORE).index("ownerId").getAll(ownerId));
  return records
    .map((record) => hydratePackage(withoutStorageFields(record)))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

export async function savePackage(ownerId, pkg) {
  const database = await openDatabase();
  const transaction = database.transaction(PACKAGE_STORE, "readwrite");
  transaction.objectStore(PACKAGE_STORE).put(asRecord(ownerId, pkg));
  await transactionDone(transaction);
  return hydratePackage(pkg);
}

export async function removePackage(ownerId, id) {
  const database = await openDatabase();
  const transaction = database.transaction(PACKAGE_STORE, "readwrite");
  transaction.objectStore(PACKAGE_STORE).delete(`${ownerId}::${id}`);
  await transactionDone(transaction);
}

export async function importPackages(ownerId, packages) {
  const database = await openDatabase();
  const transaction = database.transaction(PACKAGE_STORE, "readwrite");
  const store = transaction.objectStore(PACKAGE_STORE);
  packages.forEach((pkg) => store.put(asRecord(ownerId, pkg)));
  await transactionDone(transaction);
  return listPackages(ownerId);
}

export async function replacePackages(ownerId, packages) {
  const database = await openDatabase();
  const transaction = database.transaction(PACKAGE_STORE, "readwrite");
  const store = transaction.objectStore(PACKAGE_STORE);
  const done = transactionDone(transaction);
  const request = store.index("ownerId").openCursor(ownerId);
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) { cursor.delete(); cursor.continue(); }
    else packages.forEach((pkg) => store.put(asRecord(ownerId, pkg)));
  };
  await done;
}

export async function migrateLegacyPackages(ownerId, cloudPackages = []) {
  const localPackages = readJson("RACUN_PACKAGES", []);
  const candidates = [
    ...(Array.isArray(localPackages) ? localPackages : []),
    ...(Array.isArray(cloudPackages) ? cloudPackages : []),
  ];
  if (!candidates.length) return 0;

  const existing = await listPackages(ownerId);
  const knownIds = new Set(existing.map((pkg) => pkg.id));
  const uniqueCandidates = candidates.filter((pkg) => {
    if (!pkg || typeof pkg !== "object" || !pkg.id || knownIds.has(pkg.id)) return false;
    knownIds.add(pkg.id);
    return true;
  });

  if (uniqueCandidates.length) await importPackages(ownerId, uniqueCandidates);
  try {
    localStorage.removeItem("RACUN_PACKAGES");
  } catch {
    // Brskalnik lahko blokira localStorage; migracija v IndexedDB je vseeno uspela.
  }
  return uniqueCandidates.length;
}

export function readDraft(ownerId, defaults) {
  const current = readJson(`${DRAFT_PREFIX}:${ownerId}`, null);
  if (current && typeof current === "object") return { ...defaults, ...current };

  const legacyItems = readJson("RACUN_DRAFT_ITEMS", null);
  const legacyPeople = readJson("RACUN_DRAFT_PEOPLE", null);
  return {
    ...defaults,
    ...(Array.isArray(legacyItems) ? { items: legacyItems } : {}),
    ...(Array.isArray(legacyPeople) ? { people: legacyPeople } : {}),
    origRatio: readNumber("RACUN_DRAFT_ORIGRATIO", defaults.origRatio),
    myRatio: readNumber("RACUN_DRAFT_MYRATIO", defaults.myRatio),
    shippingCNY: readNumber("RACUN_DRAFT_SHIPCNY", defaults.shippingCNY),
    receivedMap: readJson("RACUN_DRAFT_RECEIVED", defaults.receivedMap),
    personOpts: readJson("RACUN_PERSON_OPTS", defaults.personOpts),
    invPrefix: readText("RACUN_INV_PREFIX", defaults.invPrefix),
    invCounter: readNumber("RACUN_INV_COUNTER", defaults.invCounter),
    exportMode: readText("RACUN_EXPORTMODE", defaults.exportMode),
  };
}

export function writeDraft(ownerId, draft) {
  try {
    localStorage.setItem(`${DRAFT_PREFIX}:${ownerId}`, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function createBackup(packages, draft) {
  return {
    format: "acb-backup",
    version: 2,
    exportedAt: new Date().toISOString(),
    packages: packages.map((pkg) => {
      const { derived: _derived, ...snapshot } = hydratePackage(pkg);
      return snapshot;
    }),
    draft,
  };
}

export function parseBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Datoteka ni veljaven JSON.");
  }

  const packages = Array.isArray(parsed) ? parsed : parsed?.packages;
  if (!Array.isArray(packages)) throw new Error("Datoteka ne vsebuje veljavne ACB zgodovine.");
  return {
    packages: packages.map(hydratePackage),
    draft: parsed?.draft && typeof parsed.draft === "object" ? parsed.draft : null,
  };
}

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readNumber(key, fallback) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && localStorage.getItem(key) !== null ? value : fallback;
  } catch {
    return fallback;
  }
}

function readText(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
