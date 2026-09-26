import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Database,
  Download,
  FileDown,
  FileJson,
  FileText,
  History,
  PackageOpen,
  PencilLine,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Weight,
  X,
} from "lucide-react";
import {
  calculatePackage,
  createEmptyItem,
  createId,
  formatNumber,
  hydratePackage,
  toNumber,
} from "./lib/calculations.js";
import {
  createBackup,
  importPackages,
  listPackages,
  migrateLegacyPackages,
  parseBackup,
  readDraft,
  removePackage,
  replacePackages,
  savePackage as persistPackage,
  writeDraft,
} from "./lib/storage.js";
import { exportPdf } from "./lib/pdfExport.js";
import { snapshotWorkspace } from "./lib/cloudSync.js";
import { useCloudSync } from "./lib/useCloudSync.js";

const fmt = formatNumber;

export default function RealApp({ auth = {} }) {
  const ownerId = auth.userId || "local";
  const initialDraft = useRef(null);
  if (!initialDraft.current) initialDraft.current = readDraft(ownerId, createDefaultDraft(auth.invoiceSettings));

  const [items, setItems] = useState(initialDraft.current.items);
  const [people, setPeople] = useState(initialDraft.current.people);
  const [origRatio, setOrigRatio] = useState(initialDraft.current.origRatio);
  const [myRatio, setMyRatio] = useState(initialDraft.current.myRatio);
  const [shippingCNY, setShippingCNY] = useState(initialDraft.current.shippingCNY);
  const [receivedMap, setReceivedMap] = useState(initialDraft.current.receivedMap);
  const [personOpts, setPersonOpts] = useState(initialDraft.current.personOpts);
  const [invPrefix, setInvPrefix] = useState(initialDraft.current.invPrefix);
  const [invCounter, setInvCounter] = useState(initialDraft.current.invCounter);
  const [exportMode, setExportMode] = useState(initialDraft.current.exportMode);
  const [exportSelection, setExportSelection] = useState({ all: true, who: [] });

  const [packages, setPackages] = useState([]);
  const [storageState, setStorageState] = useState("loading");
  const [draftState, setDraftState] = useState("saved");
  const [lastSaved, setLastSaved] = useState(null);
  const [packageName, setPackageName] = useState(initialDraft.current.packageName || "");
  const [editingPackageId, setEditingPackageId] = useState(initialDraft.current.editingPackageId || null);
  const [isSavingPackage, setIsSavingPackage] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [showHistory, setShowHistory] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [previewPackage, setPreviewPackage] = useState(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [toast, setToast] = useState(null);
  const importInputRef = useRef(null);

  const draft = useMemo(() => ({
    items,
    people,
    origRatio,
    myRatio,
    shippingCNY,
    receivedMap,
    personOpts,
    invPrefix,
    invCounter,
    exportMode,
    packageName,
    editingPackageId,
  }), [items, people, origRatio, myRatio, shippingCNY, receivedMap, personOpts, invPrefix, invCounter, exportMode, packageName, editingPackageId]);

  const snapshot = useMemo(() => snapshotWorkspace(packages, draft), [packages, draft]);
  const cloud = useCloudSync({
    auth, localReady: storageState === "ready", snapshot,
    onData: (data) => {
      setPackages(data.packages.map(hydratePackage));
      applyDraft(data.draft);
      void replacePackages(ownerId, data.packages).catch(() => showNotice("Lokalna kopija zgodovine ni uspela; podatki ostajajo v oblaku.", "error"));
    },
  });

  const namedPeople = useMemo(
    () => [...new Set(people.map((person) => person.trim()).filter(Boolean))],
    [people],
  );
  const metrics = useMemo(() => calculatePackage(draft), [draft]);
  const unassignedCount = useMemo(
    () => items.filter((item) => item.artikel?.trim() && !item.who?.trim()).length,
    [items],
  );

  useEffect(() => {
    let active = true;
    async function initializeStorage() {
      setStorageState("loading");
      try {
        const migrated = await migrateLegacyPackages(ownerId, auth.legacyPackages);
        const storedPackages = await listPackages(ownerId);
        if (!active) return;
        setPackages(storedPackages);
        setStorageState("ready");
        if (migrated > 0) showNotice(`${migrated} ${migrated === 1 ? "paket je bil prenesen" : "paketi so bili preneseni"} v novo shrambo.`, "success");
      } catch (error) {
        console.error(error);
        if (active) {
          setStorageState("error");
          showNotice("Lokalne baze ni bilo mogoče odpreti. Preveri dovoljenja brskalnika.", "error");
        }
      }
    }
    initializeStorage();
    return () => { active = false; };
  }, [ownerId]);

  useEffect(() => {
    setDraftState("saving");
    const timer = window.setTimeout(() => {
      const didSave = writeDraft(ownerId, draft);
      setDraftState(didSave ? "saved" : "error");
      if (didSave) setLastSaved(new Date());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [ownerId, draft]);

  useEffect(() => {
    if (!editingPackageId || !cloud.ready || storageState !== "ready") return;
    const previous = packages.find((pkg) => pkg.id === editingPackageId);
    if (!previous) return;
    const fields = { items, people, origRatio, myRatio, shippingCNY, receivedMap, personOpts, name: packageName.trim() || previous.name };
    if (Object.entries(fields).every(([key, value]) => JSON.stringify(previous[key]) === JSON.stringify(value))) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      const payload = hydratePackage({ ...previous, ...fields, updatedAt: new Date().toISOString() });
      try {
        await persistPackage(ownerId, payload);
        if (active) setPackages((current) => current.map((pkg) => pkg.id === payload.id ? payload : pkg));
      } catch { if (active) showNotice("Posodobitev lokalne zgodovine ni uspela. Osnutek je ohranjen.", "error"); }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [ownerId, draft, packages, cloud.ready, storageState]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSavePackage();
      }
      if (event.key === "Escape") {
        setShowHistory(false);
        setShowCatalog(false);
        setPreviewPackage(null);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const catalogItems = useMemo(() => {
    const sourceItems = [...items, ...packages.flatMap((pkg) => pkg.items || [])];
    const catalog = new Map();
    sourceItems.forEach((item) => {
      const name = (item.artikel || "").trim();
      if (!name) return;
      const key = name.toLocaleLowerCase("sl-SI");
      const current = catalog.get(key) || { name, occurrences: 0, totalQty: 0, totalCny: 0, totalUnitWeight: 0 };
      const qty = Math.max(1, toNumber(item.qty) || 1);
      current.occurrences += 1;
      current.totalQty += qty;
      current.totalCny += toNumber(item.cny);
      current.totalUnitWeight += toNumber(item.weight) / qty;
      catalog.set(key, current);
    });
    return [...catalog.values()]
      .map((entry) => ({
        name: entry.name,
        avgCny: entry.totalCny / entry.occurrences,
        avgWeight: entry.totalUnitWeight / entry.occurrences,
        totalQty: entry.totalQty,
        orderCount: entry.occurrences,
      }))
      .sort((a, b) => b.totalQty - a.totalQty);
  }, [items, packages]);

  const filteredPackages = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase("sl-SI");
    if (!query) return packages;
    return packages.filter((pkg) => [pkg.name, ...(pkg.items || []).map((item) => item.artikel)]
      .some((value) => String(value || "").toLocaleLowerCase("sl-SI").includes(query)));
  }, [historyQuery, packages]);

  const filteredCatalog = useMemo(() => {
    const query = catalogQuery.trim().toLocaleLowerCase("sl-SI");
    return query
      ? catalogItems.filter((item) => item.name.toLocaleLowerCase("sl-SI").includes(query))
      : catalogItems;
  }, [catalogItems, catalogQuery]);

  function showNotice(message, type = "success") {
    setToast({ id: Date.now(), message, type });
  }

  function addRow(template = {}) {
    setItems((current) => [...current, { ...createEmptyItem(namedPeople[0]), ...template, id: createId() }]);
  }

  function updateRow(id, key, value) {
    setItems((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function deleteRow(id) {
    setItems((current) => current.filter((row) => row.id !== id));
  }

  function duplicateRow(row) {
    const index = items.findIndex((item) => item.id === row.id);
    const duplicate = { ...row, id: createId() };
    setItems((current) => [...current.slice(0, index + 1), duplicate, ...current.slice(index + 1)]);
  }

  function addFromCatalog(catalogItem) {
    addRow({
      artikel: catalogItem.name,
      cny: catalogItem.avgCny.toFixed(2),
      weight: catalogItem.avgWeight.toFixed(0),
      qty: 1,
    });
    setShowCatalog(false);
    showNotice(`${catalogItem.name} je dodan v osnutek.`);
  }

  function renamePerson(index, nextName) {
    const previousName = people[index];
    setPeople((current) => current.map((person, personIndex) => (personIndex === index ? nextName : person)));
    if (!previousName || previousName === nextName) return;
    setItems((current) => current.map((row) => (row.who === previousName ? { ...row, who: nextName } : row)));
    setReceivedMap((current) => moveObjectKey(current, previousName, nextName));
    setPersonOpts((current) => moveObjectKey(current, previousName, nextName));
  }

  function deletePerson(index) {
    const name = people[index];
    setPeople((current) => current.filter((_, personIndex) => personIndex !== index));
    setItems((current) => current.map((row) => (row.who === name ? { ...row, who: "" } : row)));
    setReceivedMap((current) => omitObjectKey(current, name));
    setPersonOpts((current) => omitObjectKey(current, name));
  }

  async function handleSavePackage() {
    if (storageState !== "ready" || !cloud.ready || isSavingPackage) return;
    const meaningfulItems = items.filter((item) => item.artikel?.trim() || toNumber(item.cny) || toNumber(item.weight));
    if (!meaningfulItems.length) {
      showNotice("Pred shranjevanjem dodaj vsaj en artikel.", "error");
      return;
    }

    const duplicatePeople = findDuplicates(people.map((person) => person.trim()).filter(Boolean));
    if (duplicatePeople.length) {
      showNotice(`Ime osebe mora biti enolično: ${duplicatePeople.join(", ")}.`, "error");
      return;
    }

    const now = new Date().toISOString();
    const previous = packages.find((pkg) => pkg.id === editingPackageId);
    const payload = hydratePackage({
      id: editingPackageId || createId(),
      name: packageName.trim() || previous?.name || `Pošiljka ${new Date().toLocaleDateString("sl-SI")}`,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
      items: meaningfulItems,
      people,
      origRatio,
      myRatio,
      shippingCNY,
      receivedMap,
      personOpts,
    });

    setIsSavingPackage(true);
    try {
      await persistPackage(ownerId, payload);
      setPackages((current) => [payload, ...current.filter((pkg) => pkg.id !== payload.id)]);
      setEditingPackageId(payload.id);
      setPackageName(payload.name);
      showNotice(cloud.enabled ? "Paket je dodan v zgodovino; stanje oblaka je prikazano na vrhu." : previous ? "Paket je posodobljen lokalno." : "Paket je shranjen lokalno.");
    } catch (error) {
      console.error(error);
      showNotice("Shranjevanje ni uspelo. Poskusi znova ali izvozi varnostno kopijo.", "error");
    } finally {
      setIsSavingPackage(false);
    }
  }

  async function handleDeletePackage(pkg) {
    if (!window.confirm(`Izbrišem paket »${pkg.name}«?`)) return;
    try {
      await removePackage(ownerId, pkg.id);
      setPackages((current) => current.filter((item) => item.id !== pkg.id));
      if (editingPackageId === pkg.id) {
        setEditingPackageId(null);
        setPackageName("");
      }
      setPreviewPackage(null);
      showNotice("Paket je izbrisan.");
    } catch (error) {
      console.error(error);
      showNotice("Paketa ni bilo mogoče izbrisati.", "error");
    }
  }

  function loadPackage(pkg, asCopy = false) {
    const hydrated = hydratePackage(pkg);
    setItems(hydrated.items.length ? hydrated.items : [createEmptyItem()]);
    setPeople(hydrated.people);
    setOrigRatio(hydrated.origRatio);
    setMyRatio(hydrated.myRatio);
    setShippingCNY(hydrated.shippingCNY);
    setReceivedMap(hydrated.receivedMap);
    setPersonOpts(hydrated.personOpts);
    setEditingPackageId(asCopy ? null : hydrated.id);
    setPackageName(asCopy ? `${hydrated.name} – kopija` : hydrated.name);
    setPreviewPackage(null);
    setShowHistory(false);
    showNotice(asCopy ? "Kopija je pripravljena kot nov osnutek." : "Paket je naložen in pripravljen za urejanje.");
  }

  function startNewDraft() {
    const hasData = items.some((item) => item.artikel?.trim() || toNumber(item.cny) || toNumber(item.weight));
    if (hasData && !window.confirm("Začnem nov osnutek? Trenutni osnutek bo zamenjan.")) return;
    setItems([createEmptyItem(namedPeople[0])]);
    setReceivedMap({});
    setEditingPackageId(null);
    setPackageName("");
    showNotice("Nov osnutek je pripravljen.");
  }

  async function handlePdfExport() {
    const selectedPeople = exportSelection.all ? namedPeople : exportSelection.who;
    setIsExporting(true);
    try {
      const nextCounter = await exportPdf({
        mode: exportMode,
        selectedPeople,
        computedRows: metrics.rows,
        receivedMap,
        personOpts,
        invPrefix,
        invCounter,
        origRatio,
        myRatio,
        shippingCNY,
        metrics,
      });
      setInvCounter(nextCounter);
      showNotice("PDF je ustvarjen in prenesen.");
    } catch (error) {
      console.error(error);
      showNotice(error.message || "PDF-ja ni bilo mogoče ustvariti.", "error");
    } finally {
      setIsExporting(false);
    }
  }

  function exportBackup() {
    const backup = createBackup(packages, draft);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `acb-varnostna-kopija-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showNotice("Varnostna kopija je prenesena.");
  }

  async function handleBackupImport(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const restored = parseBackup(await file.text());
      const nextPackages = await importPackages(ownerId, restored.packages);
      setPackages(nextPackages);
      if (restored.draft && window.confirm("Datoteka vsebuje tudi osnutek. Ga želiš obnoviti?")) {
        applyDraft(restored.draft);
      }
      showNotice(`Uvoženih je ${restored.packages.length} paketov.`);
    } catch (error) {
      console.error(error);
      showNotice(error.message || "Varnostne kopije ni bilo mogoče uvoziti.", "error");
    }
  }

  function applyDraft(restored) {
    const fallback = createDefaultDraft(auth.invoiceSettings);
    const next = { ...fallback, ...restored };
    setItems(Array.isArray(next.items) && next.items.length ? next.items : [createEmptyItem()]);
    setPeople(Array.isArray(next.people) ? next.people : fallback.people);
    setOrigRatio(next.origRatio);
    setMyRatio(next.myRatio);
    setShippingCNY(next.shippingCNY);
    setReceivedMap(next.receivedMap || {});
    setPersonOpts(next.personOpts || {});
    setInvPrefix(next.invPrefix);
    setInvCounter(next.invCounter);
    setExportMode(next.exportMode);
    setEditingPackageId(next.editingPackageId || null);
    setPackageName(next.packageName || "");
  }

  return (
    <div className="min-h-screen bg-[#f4f5f2] text-slate-950">
      <div className="relative z-40 mx-auto max-w-[1500px] px-4 pt-3" role="status" aria-live="polite">
        <div className={`rounded-xl border p-3 text-sm ${cloud.status === "saved" ? "border-teal-200 bg-teal-50" : "border-amber-200 bg-amber-50"}`}>
          <strong>{({ local: "Oblak še ni nastavljen — podatki so samo na tej napravi.", loading: "Povezujem z oblakom …", saved: "Shranjeno v oblaku · samodejna sinhronizacija", pending: "Spremembe čakajo na shranjevanje v oblak …", saving: "Shranjujem v oblak …", error: "Sinhronizacija ni uspela — spremembe še niso potrjene v oblaku.", conflict: "Druga naprava je shranila nove spremembe. Tvoja različica je ohranjena na tej napravi." })[cloud.status]}</strong>
          {cloud.error && <p className="mt-1">{cloud.error}</p>}
          {!cloud.ready && auth.userControl && <div className="mt-2 flex items-center gap-2">{auth.userControl}<span>Račun in ponovna prijava</span></div>}
          {cloud.status === "error" && <button type="button" className="button-secondary ml-3" onClick={cloud.retry}>Poskusi znova</button>}
          {cloud.status === "conflict" && <><p className="mt-1">Najprej izvozi svojo različico. Nato naloži oblak in po potrebi uvozi posamezne spremembe iz kopije.</p><button type="button" className="button-secondary mt-2" onClick={exportBackup}>Izvozi mojo različico</button><button type="button" className="button-secondary ml-2 mt-2" onClick={() => { if (window.confirm("Si izvozil svojo različico? Lokalni prikaz bo zamenjan s podatki iz oblaka.")) void cloud.useCloud(); }}>Naloži različico iz oblaka</button></>}
        </div>
      </div>
      <fieldset disabled={!cloud.ready} className="min-w-0 border-0 p-0">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.16),transparent_42%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_32%)]" />
      <div className="relative mx-auto max-w-[1500px] px-4 pb-16 pt-4 sm:px-6 lg:px-8">
        <header className="sticky top-3 z-30 rounded-[24px] border border-white/70 bg-white/90 px-4 py-3 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-teal-700 text-sm font-black tracking-[0.12em] text-white shadow-lg shadow-teal-900/15">ACB</div>
              <div>
                <h1 className="text-lg font-black tracking-tight sm:text-xl">Kalkulator pošiljk</h1>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <StatusLabel state={draftState} lastSaved={lastSaved} />
                  <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:block" />
                  <span>{auth.isSignedIn ? "Zasebna shramba tega računa" : "Lokalni način"}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <ActionButton icon={RotateCcw} label="Nov osnutek" onClick={startNewDraft} subtle />
              <ActionButton icon={BookOpen} label="Katalog" onClick={() => setShowCatalog(true)} subtle />
              <ActionButton icon={History} label={`Zgodovina (${packages.length})`} onClick={() => setShowHistory(true)} subtle />
              <ActionButton icon={Plus} label="Dodaj artikel" onClick={() => addRow()} primary />
              {auth.userControl}
            </div>
          </div>
        </header>

        <main>
          <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={CircleDollarSign} label="Skupaj za obračun" value={`${fmt(metrics.grandTogether)} €`} detail={`${fmt(metrics.totalCNY)} CNY vrednosti`} tone="teal" />
            <MetricCard icon={FileDown} label="Poštnina" value={`${fmt(metrics.shippingEUR)} €`} detail={`${fmt(shippingCNY)} CNY · po teži`} tone="amber" />
            <MetricCard icon={Weight} label="Skupna teža" value={`${fmt(metrics.totalWeight)} g`} detail={`${items.length} ${items.length === 1 ? "postavka" : "postavk"}`} tone="slate" />
            <MetricCard icon={Users} label="Razdelitev" value={`${namedPeople.length} ${namedPeople.length === 1 ? "oseba" : "osebe"}`} detail={unassignedCount ? `${unassignedCount} brez prejemnika` : "Vse postavke so dodeljene"} tone={unassignedCount ? "rose" : "teal"} />
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="space-y-5">
              <Panel title="Parametri" eyebrow="Osnova izračuna" icon={Sparkles}>
                <div className="grid gap-4">
                  <NumberField label="Originalni tečaj" hint="CNY / USD" value={origRatio} onChange={setOrigRatio} />
                  <NumberField label="Moj tečaj" hint="CNY / EUR" value={myRatio} onChange={setMyRatio} />
                  <NumberField label="Poštnina" hint="CNY" value={shippingCNY} onChange={setShippingCNY} min="0" />
                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-950 p-3 text-white">
                    <MiniStat label="USD / EUR" value={fmt(metrics.usdPerEur)} />
                    <MiniStat label="Razlika" value={`${fmt(metrics.rateProfit)} €`} />
                  </div>
                </div>
              </Panel>

              <Panel title="Osebe" eyebrow="Prejemniki" icon={Users}>
                <div className="space-y-2">
                  {people.map((person, index) => (
                    <div className="group flex items-center gap-2" key={index}>
                      <input className="field h-10 min-w-0 flex-1" value={person} onChange={(event) => renamePerson(index, event.target.value)} placeholder={`Oseba ${index + 1}`} aria-label={`Oseba ${index + 1}`} />
                      <IconButton icon={Trash2} label={`Izbriši osebo ${person || index + 1}`} onClick={() => deletePerson(index)} danger />
                    </div>
                  ))}
                  <button type="button" onClick={() => setPeople((current) => [...current, ""])} className="mt-1 inline-flex items-center gap-2 text-sm font-bold text-teal-700 transition hover:text-teal-900">
                    <Plus className="h-4 w-4" /> Dodaj osebo
                  </button>
                </div>
              </Panel>

              <Panel title="Številčenje" eyebrow="Računi za stranke" icon={FileText}>
                <div className="space-y-3">
                  <TextField label="Predpona" value={invPrefix} onChange={setInvPrefix} placeholder="RAC-2026-" />
                  <NumberField label="Naslednja številka" value={invCounter} onChange={(value) => setInvCounter(Math.max(1, value || 1))} min="1" />
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    Naslednji račun <strong className="ml-1 text-slate-800">{invPrefix}{String(invCounter).padStart(3, "0")}</strong>
                  </div>
                </div>
              </Panel>
            </aside>

            <div className="min-w-0 space-y-6">
              <section className="overflow-hidden rounded-[26px] border border-white bg-white shadow-[0_18px_50px_rgba(15,23,42,0.07)]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
                  <div>
                    <p className="eyebrow">Aktivni osnutek</p>
                    <h2 className="mt-1 text-lg font-black tracking-tight">Artikli in stroški</h2>
                  </div>
                  <button type="button" onClick={() => addRow()} className="button-secondary"><Plus className="h-4 w-4" /> Nova vrstica</button>
                </div>

                <div className="hidden overflow-x-auto lg:block">
                  <table className="w-full min-w-[1050px] text-sm">
                    <thead className="bg-slate-50/80 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                      <tr>
                        <TableHead>Artikel</TableHead>
                        <TableHead align="right">Kol.</TableHead>
                        <TableHead align="right">Teža</TableHead>
                        <TableHead align="right">CNY / kos</TableHead>
                        <TableHead align="right">Poštnina</TableHead>
                        <TableHead align="right">Skupaj</TableHead>
                        <TableHead>Prejemnik</TableHead>
                        <TableHead><span className="sr-only">Dejanja</span></TableHead>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {metrics.rows.map((row) => (
                        <tr className="group transition hover:bg-teal-50/30" key={row.id}>
                          <TableCell><input className="table-field min-w-[220px] text-left font-semibold" value={row.artikel} onChange={(event) => updateRow(row.id, "artikel", event.target.value)} placeholder="Ime artikla" aria-label="Ime artikla" /></TableCell>
                          <TableCell align="right"><input type="number" min="1" step="1" className="table-field w-16" value={row.qty} onChange={(event) => updateRow(row.id, "qty", event.target.value)} aria-label="Količina" /></TableCell>
                          <TableCell align="right">
                            <input type="number" min="0" inputMode="decimal" className="table-field w-24" value={row.weight} onChange={(event) => updateRow(row.id, "weight", event.target.value)} aria-label="Teža v gramih" />
                            <div className="mt-1 text-[10px] text-slate-400">{fmt(row.weightPct)} %</div>
                          </TableCell>
                          <TableCell align="right"><input type="number" min="0" inputMode="decimal" className="table-field w-24" value={row.cny} onChange={(event) => updateRow(row.id, "cny", event.target.value)} aria-label="Cena v CNY" /></TableCell>
                          <TableCell align="right"><span className="font-semibold text-amber-700">{fmt(row.shipPart)} €</span></TableCell>
                          <TableCell align="right"><strong className="text-base text-slate-950">{fmt(row.together)} €</strong><div className="mt-0.5 text-[10px] text-slate-400">redna {fmt(row.regular)} €</div></TableCell>
                          <TableCell><select className="table-field w-32 text-left" value={row.who || ""} onChange={(event) => updateRow(row.id, "who", event.target.value)} aria-label="Prejemnik"><option value="">— brez —</option>{namedPeople.map((person) => <option key={person} value={person}>{person}</option>)}</select></TableCell>
                          <TableCell><div className="flex justify-end gap-1"><IconButton icon={Copy} label="Podvoji vrstico" onClick={() => duplicateRow(row)} /><IconButton icon={Trash2} label="Izbriši vrstico" onClick={() => deleteRow(row.id)} danger /></div></TableCell>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-slate-100 lg:hidden">
                  {metrics.rows.map((row, index) => (
                    <div className="space-y-3 p-4" key={row.id}>
                      <div className="flex items-start gap-2">
                        <span className="mt-2 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[10px] font-black text-slate-500">{index + 1}</span>
                        <input className="field flex-1 font-semibold" value={row.artikel} onChange={(event) => updateRow(row.id, "artikel", event.target.value)} placeholder="Ime artikla" />
                        <IconButton icon={Trash2} label="Izbriši vrstico" onClick={() => deleteRow(row.id)} danger />
                      </div>
                      <div className="grid grid-cols-3 gap-2"><CompactNumber label="Količina" value={row.qty} onChange={(value) => updateRow(row.id, "qty", value)} /><CompactNumber label="Teža (g)" value={row.weight} onChange={(value) => updateRow(row.id, "weight", value)} /><CompactNumber label="CNY / kos" value={row.cny} onChange={(value) => updateRow(row.id, "cny", value)} /></div>
                      <div className="flex items-end justify-between gap-3 rounded-2xl bg-slate-50 p-3">
                        <label className="min-w-0 flex-1 text-xs font-bold text-slate-500">Prejemnik<select className="field mt-1 h-9 w-full text-sm" value={row.who || ""} onChange={(event) => updateRow(row.id, "who", event.target.value)}><option value="">— brez —</option>{namedPeople.map((person) => <option key={person} value={person}>{person}</option>)}</select></label>
                        <div className="text-right"><div className="text-[10px] uppercase tracking-wide text-slate-400">Skupaj</div><strong>{fmt(row.together)} €</strong></div>
                      </div>
                    </div>
                  ))}
                </div>

                {metrics.rows.length === 0 && <EmptyState icon={PackageOpen} title="Osnutek je prazen" text="Dodaj prvi artikel in izračun se bo osvežil samodejno." action="Dodaj artikel" onAction={() => addRow()} />}
                <div className="grid gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-3">
                  <TotalStrip label="Vrednost artiklov" value={`${fmt(metrics.totalCNY)} CNY`} />
                  <TotalStrip label="Poštnina" value={`${fmt(metrics.shippingEUR)} €`} />
                  <TotalStrip label="Končni seštevek" value={`${fmt(metrics.grandTogether)} €`} emphasized />
                </div>
              </section>

              <section className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_380px]">
                <Panel title="Povzetek po osebi" eyebrow="Plačila in marža" icon={Users} roomy>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead className="text-[10px] uppercase tracking-[0.08em] text-slate-400"><tr><TableHead>Oseba</TableHead><TableHead align="right">Osnova</TableHead><TableHead>Obračun</TableHead><TableHead align="right">Faktor</TableHead><TableHead align="right">Končna cena</TableHead><TableHead align="right">Prejeto</TableHead><TableHead align="right">Preostane</TableHead><TableHead align="right">Profit</TableHead></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {metrics.summaryByPerson.map((row) => {
                          const options = personOpts[row.who] || { fee: 1, mode: "eur" };
                          return (
                            <tr key={row.who}>
                              <TableCell><strong>{row.who}</strong><div className="text-[10px] text-slate-400">nabava {fmt(row.cost)} €</div></TableCell>
                              <TableCell align="right">{fmt(row.eur)} €</TableCell>
                              <TableCell><select className="table-field w-24 text-left" value={options.mode || "eur"} onChange={(event) => setPersonOpts((current) => ({ ...current, [row.who]: { ...options, mode: event.target.value } }))}><option value="eur">Skupaj</option><option value="redna">Redna</option></select></TableCell>
                              <TableCell align="right"><input type="number" min="0" step="0.01" className="table-field w-20" value={options.fee ?? 1} onChange={(event) => setPersonOpts((current) => ({ ...current, [row.who]: { ...options, fee: event.target.value } }))} /></TableCell>
                              <TableCell align="right"><strong>{fmt(row.charge)} €</strong></TableCell>
                              <TableCell align="right"><input type="number" min="0" inputMode="decimal" className="table-field w-24 border-teal-200 bg-teal-50/60" value={receivedMap[row.who] ?? ""} onChange={(event) => setReceivedMap((current) => ({ ...current, [row.who]: event.target.value }))} placeholder="0,00" /></TableCell>
                              <TableCell align="right"><span className={`font-black ${row.due > 0.005 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(row.due)} €</span></TableCell>
                              <TableCell align="right"><strong className={row.profitReceived < 0 ? "text-rose-600" : "text-emerald-700"}>{fmt(row.profitReceived)} €</strong><div className="text-[10px] text-slate-400">načrtovan {fmt(row.profitPlanned)} €</div></TableCell>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
                    <PreviewStat label="Nabavni strošek paketa" value={`${fmt(metrics.totalCost)} €`} />
                    <PreviewStat label="Skupaj prejeto" value={`${fmt(metrics.totalReceived)} €`} />
                    <PreviewStat label="Skupen profit paketa" value={`${fmt(metrics.totalProfitReceived)} €`} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Profit = prejeto − nabava s poštnino po originalnem tečaju. Načrtovan profit paketa: {fmt(metrics.totalProfitPlanned)} €. Neplačani in nedodeljeni artikli so vključeni v strošek paketa.</p>
                  {!metrics.summaryByPerson.length && <p className="py-8 text-center text-sm text-slate-400">Dodaj osebo, da se prikaže razdelitev.</p>}
                </Panel>

                <div className="space-y-6">
                  <Panel title="Shrani paket" eyebrow={editingPackageId ? "Urejaš shranjen zapis" : "Nova točka v zgodovini"} icon={Database}>
                    <TextField label="Ime paketa" value={packageName} onChange={setPackageName} placeholder={`Pošiljka ${new Date().toLocaleDateString("sl-SI")}`} />
                    <button type="button" data-testid="save-package" onClick={handleSavePackage} disabled={storageState !== "ready" || isSavingPackage} className="button-primary mt-3 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50">
                      {isSavingPackage ? <Spinner /> : editingPackageId ? <PencilLine className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                      {isSavingPackage ? "Shranjujem …" : editingPackageId ? "Posodobi paket" : "Shrani paket"}
                    </button>
                    <div className="mt-3 flex items-start gap-2 rounded-xl bg-teal-50 p-3 text-xs leading-relaxed text-teal-900"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>{cloud.enabled ? "Osnutek in zgodovina se samodejno shranjujeta v oblak. Gumb shrani poimenovan paket v zgodovino. Na drugi napravi se prijavi z istim računom; podatki se osvežijo najpozneje v 15 sekundah." : "Oblak še ni nastavljen. Osnutek in zgodovina se shranjujeta samo lokalno. Za nastavitev sledi navodilom v repozitoriju."}</span></div>
                  </Panel>

                  <Panel title="PDF izvoz" eyebrow="Povzetek ali računi" icon={FileDown}>
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                      <ModeButton active={exportMode === "interno"} onClick={() => setExportMode("interno")}>Interno</ModeButton>
                      <ModeButton active={exportMode === "stranka"} onClick={() => setExportMode("stranka")}>Za stranko</ModeButton>
                    </div>
                    <label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600" checked={exportSelection.all} onChange={(event) => setExportSelection((current) => ({ ...current, all: event.target.checked }))} /> Vse osebe</label>
                    {!exportSelection.all && <div className="mt-2 flex flex-wrap gap-2">{namedPeople.map((person) => <label key={person} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs"><input type="checkbox" className="mr-1.5" checked={exportSelection.who.includes(person)} onChange={(event) => setExportSelection((current) => ({ ...current, who: event.target.checked ? [...current.who, person] : current.who.filter((name) => name !== person) }))} />{person}</label>)}</div>}
                    <button type="button" onClick={handlePdfExport} disabled={isExporting} className="button-secondary mt-4 w-full justify-center disabled:opacity-50">{isExporting ? <Spinner dark /> : <Download className="h-4 w-4" />}{isExporting ? "Ustvarjam PDF …" : "Prenesi PDF"}</button>
                  </Panel>
                </div>
              </section>
            </div>
          </section>
        </main>

        <footer className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-200/80 py-6 text-xs text-slate-500 sm:flex-row">
          <span>ACB · pregledno upravljanje pošiljk</span>
          <span className="flex items-center gap-2"><Database className="h-3.5 w-3.5" /> {storageState === "ready" ? `${packages.length} shranjenih paketov` : storageState === "loading" ? "Odpiram shrambo …" : "Shramba ni na voljo"}</span>
        </footer>
      </div>

      {showCatalog && (
        <Drawer title="Katalog artiklov" subtitle="Povprečne vrednosti iz osnutka in shranjene zgodovine" icon={BookOpen} onClose={() => setShowCatalog(false)}>
          <SearchField value={catalogQuery} onChange={setCatalogQuery} placeholder="Poišči artikel …" />
          <div className="mt-4 space-y-3">
            {filteredCatalog.map((item) => (
              <article key={item.name.toLocaleLowerCase("sl-SI")} className="rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-md">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div><h3 className="font-black capitalize">{item.name}</h3><p className="mt-1 text-xs text-slate-500">{fmt(item.totalQty, 0)} kosov · {item.orderCount} vnosov</p></div>
                  <div className="flex gap-5 text-right text-xs"><div><span className="block text-slate-400">Povp. cena</span><strong className="text-sm">{fmt(item.avgCny)} CNY</strong></div><div><span className="block text-slate-400">Povp. teža</span><strong className="text-sm">{fmt(item.avgWeight)} g</strong></div></div>
                  <button type="button" onClick={() => addFromCatalog(item)} className="button-secondary"><Plus className="h-4 w-4" /> V osnutek</button>
                </div>
              </article>
            ))}
            {!filteredCatalog.length && <EmptyState icon={BookOpen} title="Ni zadetkov" text="Katalog se gradi samodejno iz shranjenih artiklov." />}
          </div>
        </Drawer>
      )}

      {showHistory && (
        <Drawer title="Shranjeni paketi" subtitle={`${packages.length} zapisov v lokalni bazi`} icon={Archive} onClose={() => setShowHistory(false)} wide>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <SearchField value={historyQuery} onChange={setHistoryQuery} placeholder="Poišči paket ali artikel …" />
            <button type="button" onClick={exportBackup} className="button-secondary justify-center"><ArrowDownToLine className="h-4 w-4" /> Varnostna kopija</button>
            <button type="button" onClick={() => importInputRef.current?.click()} className="button-secondary justify-center"><Upload className="h-4 w-4" /> Uvozi</button>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleBackupImport} />
          </div>
          <div className="mt-4 space-y-3">
            {filteredPackages.map((pkg) => (
              <article key={pkg.id} className={`rounded-2xl border bg-white p-4 transition ${editingPackageId === pkg.id ? "border-teal-400 ring-2 ring-teal-100" : "border-slate-200 hover:border-slate-300"}`}>
                <div className="flex items-start justify-between gap-4">
                  <button type="button" onClick={() => setPreviewPackage(pkg)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2"><h3 className="truncate font-black">{pkg.name}</h3>{editingPackageId === pkg.id && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-teal-800">v urejanju</span>}</div>
                    <p className="mt-1 text-xs text-slate-500">{new Date(pkg.updatedAt || pkg.createdAt).toLocaleString("sl-SI")}</p>
                  </button>
                  <div className="flex gap-1"><IconButton icon={Copy} label="Odpri kot kopijo" onClick={() => loadPackage(pkg, true)} /><IconButton icon={Trash2} label="Izbriši paket" onClick={() => handleDeletePackage(pkg)} danger /></div>
                </div>
                <button type="button" onClick={() => setPreviewPackage(pkg)} className="mt-4 grid w-full grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-left">
                  <MiniStat label="Skupaj" value={`${fmt(pkg.derived.grandTogether)} €`} dark />
                  <MiniStat label="Teža" value={`${fmt(pkg.derived.totalWeight)} g`} dark />
                  <MiniStat label="Artikli" value={String(pkg.items.length)} dark />
                </button>
              </article>
            ))}
            {!filteredPackages.length && <EmptyState icon={FileJson} title={packages.length ? "Ni zadetkov" : "Zgodovina je prazna"} text={packages.length ? "Poskusi z drugim iskalnim nizom." : "Ko shraniš prvi paket, se bo pojavil tukaj."} />}
          </div>
        </Drawer>
      )}

      {previewPackage && <PackagePreview pkg={previewPackage} onClose={() => setPreviewPackage(null)} onLoad={() => loadPackage(previewPackage)} onCopy={() => loadPackage(previewPackage, true)} />}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
      </fieldset>
    </div>
  );
}

function createDefaultDraft(invoiceSettings = {}) {
  return {
    items: [createEmptyItem()],
    people: ["Miha", "Živa", "Andreja"],
    origRatio: Number((800 / 101.37).toFixed(6)),
    myRatio: 6.5,
    shippingCNY: 256.2,
    receivedMap: {},
    personOpts: {},
    invPrefix: invoiceSettings?.prefix || `RAC-${new Date().getFullYear()}-`,
    invCounter: Number(invoiceSettings?.counter) || 1,
    exportMode: "interno",
  };
}

function Panel({ title, eyebrow, icon: Icon, children, roomy = false }) {
  return <section className={`rounded-[24px] border border-white bg-white shadow-[0_14px_42px_rgba(15,23,42,0.055)] ${roomy ? "p-5 sm:p-6" : "p-5"}`}><div className="mb-5 flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-50 text-teal-700"><Icon className="h-[18px] w-[18px]" /></span><div><p className="eyebrow">{eyebrow}</p><h2 className="mt-0.5 font-black tracking-tight">{title}</h2></div></div>{children}</section>;
}

function MetricCard({ icon: Icon, label, value, detail, tone }) {
  const tones = { teal: "bg-teal-700 text-white", amber: "bg-amber-50 text-amber-950", slate: "bg-slate-950 text-white", rose: "bg-rose-50 text-rose-950" };
  return <article className={`relative overflow-hidden rounded-[24px] p-5 shadow-[0_14px_36px_rgba(15,23,42,0.07)] ${tones[tone] || tones.slate}`}><Icon className="absolute -bottom-3 -right-2 h-20 w-20 opacity-[0.08]" /><div className="relative"><div className="text-xs font-bold opacity-65">{label}</div><div className="mt-2 text-2xl font-black tracking-tight">{value}</div><div className="mt-1 text-xs opacity-65">{detail}</div></div></article>;
}

function ActionButton({ icon: Icon, label, onClick, primary, subtle }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} className={`${primary ? "button-primary" : "button-secondary"} ${subtle ? "px-2.5 sm:px-3.5" : ""}`}><Icon className="h-4 w-4" /><span className={subtle ? "hidden sm:inline" : ""}>{label}</span></button>;
}

function NumberField({ label, hint, value, onChange, min }) {
  return <label className="block"><span className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-600"><span>{label}</span>{hint && <span className="font-medium text-slate-400">{hint}</span>}</span><input type="number" min={min} inputMode="decimal" className="field w-full" value={value} onChange={(event) => onChange(toNumber(event.target.value))} /></label>;
}

function TextField({ label, value, onChange, placeholder }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span><input className="field w-full" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function CompactNumber({ label, value, onChange }) {
  return <label className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}<input type="number" min="0" className="field mt-1 h-9 w-full text-right text-sm normal-case tracking-normal text-slate-900" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function MiniStat({ label, value, dark = false }) {
  return <div><div className={`text-[10px] font-bold uppercase tracking-[0.08em] ${dark ? "text-slate-400" : "text-white/55"}`}>{label}</div><div className={`mt-1 text-sm font-black ${dark ? "text-slate-900" : "text-white"}`}>{value}</div></div>;
}

function TableHead({ children, align = "left" }) {
  return <th className={`px-4 py-3 font-bold ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}

function TableCell({ children, align = "left" }) {
  return <td className={`px-4 py-3 align-middle ${align === "right" ? "text-right tabular-nums" : "text-left"}`}>{children}</td>;
}

function TotalStrip({ label, value, emphasized }) {
  return <div className={`px-5 py-4 ${emphasized ? "bg-teal-700 text-white" : "bg-white"}`}><div className={`text-[10px] font-bold uppercase tracking-[0.08em] ${emphasized ? "text-teal-100" : "text-slate-400"}`}>{label}</div><div className="mt-1 text-lg font-black">{value}</div></div>;
}

function IconButton({ icon: Icon, label, onClick, danger = false }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl transition ${danger ? "text-slate-400 hover:bg-rose-50 hover:text-rose-600" : "text-slate-400 hover:bg-slate-100 hover:text-slate-900"}`}><Icon className="h-4 w-4" /></button>;
}

function ModeButton({ active, onClick, children }) {
  return <button type="button" onClick={onClick} className={`rounded-lg px-3 py-2 text-xs font-black transition ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{children}</button>;
}

function SearchField({ value, onChange, placeholder }) {
  return <label className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" className="field h-11 w-full pl-10" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function StatusLabel({ state, lastSaved }) {
  if (state === "saving") return <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />Shranjujem osnutek …</span>;
  if (state === "error") return <span className="flex items-center gap-1.5 text-rose-600"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />Osnutek ni shranjen</span>;
  return <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Lokalna kopija osnutka{lastSaved ? ` ob ${lastSaved.toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>;
}

function Drawer({ title, subtitle, icon: Icon, onClose, children, wide = false }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" className={`h-full w-full overflow-y-auto bg-[#f7f8f5] shadow-2xl ${wide ? "max-w-3xl" : "max-w-2xl"}`}><header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur-xl sm:px-6"><div className="flex gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><Icon className="h-5 w-5" /></span><div><h2 className="text-lg font-black">{title}</h2><p className="text-xs text-slate-500">{subtitle}</p></div></div><IconButton icon={X} label="Zapri" onClick={onClose} /></header><div className="p-4 sm:p-6">{children}</div></section></div>;
}

function PackagePreview({ pkg, onClose, onLoad, onCopy }) {
  const rows = pkg.derived.rows;
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/50 p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[26px] bg-white shadow-2xl"><header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6"><div><p className="eyebrow">{new Date(pkg.updatedAt || pkg.createdAt).toLocaleString("sl-SI")}</p><h2 className="mt-1 text-xl font-black">{pkg.name}</h2></div><div className="flex gap-2"><button type="button" onClick={onCopy} className="button-secondary"><Copy className="h-4 w-4" /> Kot kopijo</button><button type="button" onClick={onLoad} className="button-primary"><PencilLine className="h-4 w-4" /> Uredi</button><IconButton icon={X} label="Zapri" onClick={onClose} /></div></header><div className="overflow-y-auto p-5 sm:p-6"><div className="mb-5 grid gap-3 sm:grid-cols-4"><PreviewStat label="Skupaj" value={`${fmt(pkg.derived.grandTogether)} €`} /><PreviewStat label="Vrednost" value={`${fmt(pkg.derived.totalCNY)} CNY`} /><PreviewStat label="Teža" value={`${fmt(pkg.derived.totalWeight)} g`} /><PreviewStat label="Profit paketa" value={`${fmt(pkg.derived.totalProfitReceived)} €`} /></div><div className="overflow-x-auto rounded-2xl border border-slate-200"><table className="w-full min-w-[720px] text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><TableHead>Artikel</TableHead><TableHead align="right">Količina</TableHead><TableHead align="right">Teža</TableHead><TableHead align="right">CNY</TableHead><TableHead align="right">Poštnina</TableHead><TableHead align="right">Skupaj</TableHead><TableHead>Oseba</TableHead></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><TableCell><strong>{row.artikel}</strong></TableCell><TableCell align="right">{fmt(row.qty)}</TableCell><TableCell align="right">{fmt(row.weightTotal)} g</TableCell><TableCell align="right">{fmt(row.cnyTotal)}</TableCell><TableCell align="right">{fmt(row.shipPart)} €</TableCell><TableCell align="right"><strong>{fmt(row.together)} €</strong></TableCell><TableCell>{row.who || "—"}</TableCell></tr>)}</tbody></table></div></div></section></div>;
}

function PreviewStat({ label, value }) {
  return <div className="rounded-2xl bg-slate-950 p-4 text-white"><div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-lg font-black">{value}</div></div>;
}

function EmptyState({ icon: Icon, title, text, action, onAction }) {
  return <div className="grid place-items-center px-6 py-12 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Icon className="h-5 w-5" /></span><h3 className="mt-3 font-black">{title}</h3><p className="mt-1 max-w-sm text-sm text-slate-500">{text}</p>{action && <button type="button" onClick={onAction} className="button-secondary mt-4">{action}<ChevronRight className="h-4 w-4" /></button>}</div>;
}

function Toast({ toast, onClose }) {
  const isError = toast.type === "error";
  return <div role="status" className={`fixed bottom-5 left-1/2 z-[80] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl ${isError ? "border-rose-200 bg-rose-950 text-white" : "border-teal-200 bg-slate-950 text-white"}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${isError ? "bg-rose-500" : "bg-teal-600"}`}>{isError ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}</span><p className="flex-1 text-sm font-semibold">{toast.message}</p><button type="button" onClick={onClose} aria-label="Zapri obvestilo" className="text-white/60 hover:text-white"><X className="h-4 w-4" /></button></div>;
}

function Spinner({ dark = false }) {
  return <span className={`h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${dark ? "border-slate-600" : "border-white"}`} />;
}

function moveObjectKey(object, previousKey, nextKey) {
  if (!Object.prototype.hasOwnProperty.call(object, previousKey)) return object;
  const next = { ...object, [nextKey]: object[previousKey] };
  delete next[previousKey];
  return next;
}

function omitObjectKey(object, key) {
  const next = { ...object };
  delete next[key];
  return next;
}

function findDuplicates(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase("sl-SI");
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}
