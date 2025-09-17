import React, { useMemo, useRef, useState, useEffect } from "react";
import { Download, Plus, Trash2, Save, History, FileDown, Users, Settings, PackageSearch, Eye, FileText } from "lucide-react";
import { useUser } from "@clerk/clerk-react";

// RealApp.jsx – Cloud sync prek Clerk (unsafeMetadata)
// NOVO:
// • Popravljen +1 € bug v povzetku
// • Dodana kolona "Količina" (qty) – vpliva na težo, CNY in EUR
// • Poenostavljen "Račun za stranko" header (brez osebnih podatkov)
// • Odstranjena sekcija z ročnim vnosom osebnih podatkov

export default function RealApp() {
  const { isLoaded, isSignedIn, user } = useUser();

  // ==== Core state ====
  const [items, setItems] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_ITEMS");
    return saved
      ? JSON.parse(saved)
      : [
          { id: uid(), artikel: "", cny: "", qty: 1, weight: "", who: "" },
        ];
  });

  const [people, setPeople] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_PEOPLE");
    return saved ? JSON.parse(saved) : ["miha", "živa", "andreja"];
  });

  // Exchange rates & shipping
  const [origRatio, setOrigRatio] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_ORIGRATIO");
    return saved ? Number(saved) : Number((800 / 101.37).toFixed(6));
  });
  const [myRatio, setMyRatio] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_MYRATIO");
    return saved ? Number(saved) : 6.5;
  });
  const [shippingCNY, setShippingCNY] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_SHIPCNY");
    return saved ? Number(saved) : 256.2;
  });

  // Received amounts per person (prejeto)
  const [receivedMap, setReceivedMap] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_RECEIVED");
    return saved ? JSON.parse(saved) : {};
  });
  // nastavitve po osebi: fee (množitelj) in način ("eur" = Skupaj, "redna" = Minimum)
  const [personOpts, setPersonOpts] = useState(() => {
    const saved = localStorage.getItem("RACUN_PERSON_OPTS");
    return saved ? JSON.parse(saved) : {}; // { [ime]: { fee: 1, mode: "eur"|"redna" } }
  });
  useEffect(() => {
    localStorage.setItem("RACUN_PERSON_OPTS", JSON.stringify(personOpts));
  }, [personOpts]);

  // Avtomatsko številčenje računov (brez osebnih podatkov)
  const defaultPrefix = `RAC-${new Date().getFullYear()}-`;
  const [invPrefix, setInvPrefix] = useState(() => localStorage.getItem("RACUN_INV_PREFIX") || defaultPrefix);
  const [invCounter, setInvCounter] = useState(() => Number(localStorage.getItem("RACUN_INV_COUNTER")) || 1);

  // Export mode: "interno" | "stranka"
  const [exportMode, setExportMode] = useState(() => localStorage.getItem("RACUN_EXPORTMODE") || "interno");

  // Package history
  const [packages, setPackages] = useState(() => {
    const saved = localStorage.getItem("RACUN_PACKAGES");
    return saved ? JSON.parse(saved) : [];
  });
  const [pkgName, setPkgName] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [previewPkg, setPreviewPkg] = useState(null);

  // Persist draft
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_ITEMS", JSON.stringify(items)); }, [items]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_PEOPLE", JSON.stringify(people)); }, [people]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_ORIGRATIO", String(origRatio)); }, [origRatio]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_MYRATIO", String(myRatio)); }, [myRatio]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_SHIPCNY", String(shippingCNY)); }, [shippingCNY]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_RECEIVED", JSON.stringify(receivedMap)); }, [receivedMap]);
  useEffect(() => { localStorage.setItem("RACUN_EXPORTMODE", exportMode); }, [exportMode]);
  useEffect(() => { localStorage.setItem("RACUN_INV_PREFIX", invPrefix); }, [invPrefix]);
  useEffect(() => { localStorage.setItem("RACUN_INV_COUNTER", String(invCounter)); }, [invCounter]);

  // === Clerk cloud load (ob prijavi) ===
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const cloudPkgs = user?.unsafeMetadata?.packages;
    if (Array.isArray(cloudPkgs)) setPackages(cloudPkgs);
    const invCloud = user?.unsafeMetadata?.invoice;
    if (invCloud && typeof invCloud === "object") {
      if (typeof invCloud.prefix === "string") setInvPrefix(invCloud.prefix);
      if (Number.isFinite(invCloud.counter)) setInvCounter(Number(invCloud.counter));
    }
  }, [isLoaded, isSignedIn, user]);

  // === Cloud autosave za invoice settings (debounce) ===
  useEffect(() => {
    if (!isSignedIn) return;
    const t = setTimeout(() => {
      user.update({
        unsafeMetadata: { ...(user.unsafeMetadata || {}), invoice: { prefix: invPrefix, counter: invCounter } },
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [isSignedIn, user, invPrefix, invCounter]);

  // ==== Derived numbers (Excel parity) ====
  // skupna teža = vsota vnesenih tež (že total na vrstico), brez množenja s qty
const totalWeight = useMemo(
  () => sum(items.map((r) => num(r.weight))),
  [items]
);
  const totalCNY = useMemo(
    () => sum(items.map((r) => num(r.cny) * (num(r.qty) || 1))),
    [items]
  );
  const shippingEUR = useMemo(() => (shippingCNY ? shippingCNY / safe(myRatio) : 0), [shippingCNY, myRatio]);
  const usdPerEur = useMemo(() => safe(origRatio) / safe(myRatio), [origRatio, myRatio]);
  const rateProfit = useMemo(() => {
    const eurAll = totalCNY / safe(myRatio);
    const usdAll = totalCNY / safe(origRatio);
    return eurAll - usdAll;
  }, [totalCNY, myRatio, origRatio]);

  // Line computations (upošteva qty)
  const computedRows = useMemo(
    () => computeRows({ items, myRatio, shippingCNY, origRatio }),
    [items, myRatio, shippingCNY, origRatio]
  );

  // Povzetek po osebi (brez +1 €)
  const summaryByPerson = useMemo(() => {
  return people.map((p) => {
    const rows = computedRows.filter((r) => (r.who?.trim() || "") === p);

    const eur = rows.reduce((a, r) => a + num(r.together), 0);  // “Skupaj EUR” (artikli + poštnina)
    const minimum = eur / safe(usdPerEur);                      // “redna” (po G35)
    const opts = personOpts[p] || { fee: 1, mode: "eur" };

    const base   = opts.mode === "redna" ? minimum : eur;       // baza za zaračunat
    const feeMul = Number(opts.fee) || 1;
    const charge = base * feeMul;                               // zaračunana vsota (po tvoji izbiri)

    const received        = num(receivedMap[p]);                // dejansko prejeto
    const due             = charge - received;                  // še dolžan
    const profitReceived  = received - minimum;                 // profit po prejetem
    const profitPlanned   = charge - minimum;                   // pričakovani profit, če plača v celoti

    return { who: p, eur, minimum, charge, received, due, profitReceived, profitPlanned };
  });
}, [people, computedRows, usdPerEur, receivedMap, personOpts]);

  const grandTogether = useMemo(
    () => sum(computedRows.map((r) => r.together)),
    [computedRows]
  );

  // === UI helpers ===
  const addRow = () => setItems((s) => [...s, { id: uid(), artikel: "", cny: "", qty: 1, weight: "", who: people[0] || "" }]);
  const delRow = (id) => setItems((s) => s.filter((r) => r.id !== id));
  const updateRow = (id, k, v) =>
    setItems((s) => s.map((r) => (r.id === id ? { ...r, [k]: v } : r)));

  const addPerson = () => setPeople((s) => [...s, ""]);
  const delPerson = (idx) => {
    const name = people[idx];
    setPeople((s) => s.filter((_, i) => i !== idx));
    setItems((s) => s.map((r) => (r.who === name ? { ...r, who: "" } : r)));
    setReceivedMap((m) => {
      const n = { ...m };
      delete n[name];
      return n;
    });
  };

  // === Save current package to history (local + cloud) ===
  const savePackage = async () => {
    const name = pkgName?.trim() || `Paket ${new Date().toLocaleString()}`;
    const payload = {
      id: uid(),
      name,
      createdAt: new Date().toISOString(),
      items,
      people,
      origRatio,
      myRatio,
      shippingCNY,
      derived: {
        totalWeight,
        totalCNY,
        shippingEUR,
        usdPerEur,
        rateProfit,
        grandTogether,
        summaryByPerson,
      },
    };
    const next = [payload, ...packages];
    setPackages(next);
    localStorage.setItem("RACUN_PACKAGES", JSON.stringify(next));
    setPkgName("");
    setShowHistory(true);

    if (isSignedIn) {
      try {
        await user.update({
          unsafeMetadata: { ...(user.unsafeMetadata || {}), packages: next },
        });
      } catch (e) {}
    }
  };

  const deletePackage = async (id) => {
    if (!confirm("Želite izbrisati shranjeni paket?")) return;
    const next = packages.filter((p) => p.id !== id);
    setPackages(next);
    localStorage.setItem("RACUN_PACKAGES", JSON.stringify(next));
    if (isSignedIn) {
      try {
        await user.update({
          unsafeMetadata: { ...(user.unsafeMetadata || {}), packages: next },
        });
      } catch (e) {}
    }
  };

  const loadPackageToDraft = (p) => {
    setItems(p.items || []);
    setPeople(p.people || []);
    setReceivedMap({});
    setOrigRatio(p.origRatio);
    setMyRatio(p.myRatio);
    setShippingCNY(p.shippingCNY);
    setShowHistory(false);
    setPreviewPkg(null);
  };

  // === PDF export ===
  const [exportSelection, setExportSelection] = useState({ all: true, who: [] });
  const printRef = useRef(null);

  // REPLACE od tu ...
const handleExportPDF = async () => {
  const { jsPDF } = await import("jspdf");
  const html2canvas = (await import("html2canvas")).default;

  const selectedWho = exportSelection.all ? people.filter(Boolean) : exportSelection.who;
  if (!selectedWho.length) {
    alert("Izberi vsaj eno osebo ali ALL");
    return;
  }

  async function addPrintableToPdf(pdf, node) {
    document.body.appendChild(node);
    const canvas = await html2canvas(node, { scale: 2 });
    document.body.removeChild(node);

    const imgData = canvas.toDataURL("image/png");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    } else {
      let remainingHeight = imgHeight;
      const pageCanvas = document.createElement("canvas");
      const pageCtx = pageCanvas.getContext("2d");
      const pxPageHeight = Math.floor((canvas.width * pageHeight) / pageWidth);
      pageCanvas.width = canvas.width;
      pageCanvas.height = pxPageHeight;
      let sY = 0;
      while (remainingHeight > 0) {
        pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
        pageCtx.drawImage(canvas, 0, sY, canvas.width, pxPageHeight, 0, 0, pageCanvas.width, pageCanvas.height);
        const pageData = pageCanvas.toDataURL("image/png");
        if (pdf.getNumberOfPages() > 0) pdf.addPage();
        pdf.addImage(pageData, "PNG", 0, 0, pageWidth, pageHeight);
        remainingHeight -= pageHeight;
        sY += pxPageHeight;
      }
    }
  }

  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });

  if (exportMode === "interno") {
    const printable = document.createElement("div");
    printable.style.padding = "24px";
    printable.style.width = "794px";
    printable.style.background = "white";
    printable.style.color = "black";

    const header = document.createElement("div");
    header.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <div>
          <div style="font-size:20px;font-weight:700;">Povzetek (interno)</div>
          <div style="font-size:12px;opacity:0.8;">Ustvarjeno: ${new Date().toLocaleString()}</div>
        </div>
        <div style="text-align:right;font-size:12px;">
          <div><b>Tečaji:</b> Orig(B35)=${fmt(origRatio)} | Moj(E35)=${fmt(myRatio)} | USD/EUR(G35)=${fmt(usdPerEur)}</div>
          <div><b>Poštnina:</b> ${fmt(shippingCNY)} CNY = ${fmt(shippingEUR)} EUR</div>
        </div>
      </div>`;
    printable.appendChild(header);

    for (const who of selectedWho) {
      const rows = computedRows.filter((r) => (r.who || "").trim() === who);
      const subTotal = rows.reduce((a, r) => a + r.together, 0);
      const received = num(receivedMap[who]);
      const due = subTotal - received;

      const section = document.createElement("div");
      section.style.marginBottom = "24px";

      const tbody = rows.map((r) => `
        <tr>
          <td style="border-bottom:1px solid #f0f0f0;padding:6px;">${esc(r.artikel)}</td>
          <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.qty)}</td>
          <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.cnyTotal)}</td>
          <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.eur)}</td>
          <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.weightTotal)}</td>
          <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.shipPart)}</td>
          <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.together)}</td>
          <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.regular)}</td>
          <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.profit)}</td>
        </tr>
      `).join("");

      section.innerHTML = `
        <div style="font-weight:700;font-size:16px;margin:8px 0 4px;">${esc(who)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Artikel</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Količina</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">CNY (skupaj)</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">EUR</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Teža (g)</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Poštnina EUR</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Skupaj EUR</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Redna</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Profit</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
        <div style="display:flex;justify-content:flex-end;gap:16px;margin-top:8px;font-size:12px;">
          <div><b>Prejeto:</b> ${fmt(received)} EUR</div>
          <div><b>Skupaj:</b> ${fmt(subTotal)} EUR</div>
          <div><b>Dolg:</b> ${fmt(due)} EUR</div>
        </div>
      `;
      printable.appendChild(section);
    }

    const footer = document.createElement("div");
    footer.style.fontSize = "12px";
    footer.style.marginTop = "8px";
    footer.innerHTML = `
      <div style="display:flex;justify-content:space-between;border-top:1px solid #eee;padding-top:8px;">
        <div>
          <div><b>Skupna teža:</b> ${fmt(totalWeight)} g</div>
          <div><b>Skupaj CNY:</b> ${fmt(totalCNY)}</div>
        </div>
        <div style="text-align:right;">
          <div><b>Skupaj EUR (artikli+poštnina):</b> ${fmt(grandTogether)} EUR</div>
          <div><b>"Zaslužek" (tečajna razlika):</b> ${fmt(rateProfit)}</div>
        </div>
      </div>`;
    printable.appendChild(footer);

    await addPrintableToPdf(pdf, printable);
  } else {
    let first = true;
    let nextCounter = invCounter;

    for (const who of selectedWho) {
      const rows = computedRows.filter((r) => (r.who || "").trim() === who);
      const subTotal = rows.reduce((a, r) => a + r.together, 0);

      const opts = personOpts[who] || { fee: 1, mode: "eur" };
      const fee = Number(opts.fee) || 1;
      const base = opts.mode === "redna" ? (subTotal / safe(usdPerEur)) : subTotal;
      const charge = base * fee;
      const scale = subTotal > 0 ? (charge / subTotal) : 1;

      const invoiceNo = `${invPrefix}${String(nextCounter).padStart(3, "0")}`;

      const section = document.createElement("div");
      section.style.padding = "24px";
      section.style.width = "794px";
      section.style.background = "white";
      section.style.color = "black";

      const tbody = rows.map((r) => {
        const qty = num(r.qty) || 1;
        const rowTotal = r.together * scale;
        const priceEach = rowTotal / qty;
        return `
          <tr>
            <td style="border-bottom:1px solid #e5e5e5;padding:6px;">${esc(r.artikel || "Artikel")}</td>
            <td style="border-bottom:1px solid #e5e5e5;text-align:right;padding:6px;">${fmt(qty)}</td>
            <td style="border-bottom:1px solid #e5e5e5;text-align:right;padding:6px;">${fmt(priceEach)}</td>
            <td style="border-bottom:1px solid #e5e5e5;text-align:right;padding:6px;">${fmt(rowTotal)}</td>
          </tr>`;
      }).join("");

      section.innerHTML = `
        <div style="margin-bottom:16px;">
          <div style="font-size:18px;font-weight:700;">Račun</div>
          <div style="font-size:12px;opacity:0.8;">Račun št.: ${esc(invoiceNo)}</div>
          <div style="font-size:12px;opacity:0.8;">Datum: ${new Date().toLocaleDateString()}</div>
          <div style="font-size:12px;opacity:0.8;">Kupec: ${esc(who)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="border-bottom:1px solid #000;text-align:left;padding:6px;">Naziv</th>
              <th style="border-bottom:1px solid #000;text-align:right;padding:6px;">Količina</th>
              <th style="border-bottom:1px solid #000;text-align:right;padding:6px;">Cena (EUR)</th>
              <th style="border-bottom:1px solid #000;text-align:right;padding:6px;">Vrednost (EUR)</th>
            </tr>
          </thead>
          <tbody>${tbody}</tbody>
        </table>
        <div style="display:flex;justify-content:flex-end;margin-top:8px;">
          <table style="font-size:12px;min-width:260px;border-collapse:collapse;">
            <tbody>
              <tr>
                <td style="padding:6px;border-top:1px solid #000;">Skupaj</td>
                <td style="padding:6px;border-top:1px solid #000;text-align:right;">${fmt(charge)} EUR</td>
              </tr>
              <tr>
                <td style="padding:6px;font-weight:700;border-top:1px solid #000;">Za plačilo</td>
                <td style="padding:6px;font-weight:700;border-top:1px solid #000;text-align:right;">${fmt(charge)} EUR</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div style="margin-top:8px;font-size:11px;color:#555;">Opomba: v ceno je vključena proporcionalna poštnina.</div>
      `;

      if (!first) pdf.addPage();
      await addPrintableToPdf(pdf, section);
      first = false;
      nextCounter += 1;
    }

    setInvCounter(nextCounter);
  }

  pdf.save(`izvoz_${exportMode}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.pdf`);
};

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-6xl p-4 md:p-8">
        <header className="flex flex-col md:flex-row gap-3 md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Racun – teža, tečaji, delitve & PDF export</h1>
            <p className="text-sm text-neutral-600">Excel parity: CNY→EUR po tvojem tečaju, poštnina proporcionalno teži, Redna = Skupaj/G35, Profit = Skupaj − Redna.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-sm hover:bg-neutral-100"><Plus className="h-4 w-4"/>Dodaj artikel</button>
            <button onClick={() => setShowHistory((v) => !v)} className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-sm hover:bg-neutral-100"><History className="h-4 w-4"/>Zgodovina</button>
          </div>
        </header>

        {/* Settings */}
        <section className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center gap-2 font-semibold mb-2"><Settings className="h-4 w-4"/>Tečaji</div>
            <LabelInput label="Original razmerje (B35, CNY/USD)" value={origRatio} onChange={(v) => setOrigRatio(num(v))} />
            <LabelInput label="Moj tečaj (E35, CNY/EUR)" value={myRatio} onChange={(v) => setMyRatio(num(v))} />
            <div className="text-sm text-neutral-600 mt-2">G35 (USD/EUR) = B35 / E35 = <b>{fmt(usdPerEur)}</b></div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center gap-2 font-semibold mb-2"><PackageSearch className="h-4 w-4"/>Poštnina</div>
            <LabelInput label="Poštnina (CNY, B41)" value={shippingCNY} onChange={(v) => setShippingCNY(num(v))} />
            <div className="text-sm text-neutral-600 mt-2">Poštnina EUR = <b>{fmt(shippingEUR)}</b></div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center gap-2 font-semibold mb-2"><Users className="h-4 w-4"/>Osebe</div>
            <div className="space-y-2">
              {people.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="flex-1 rounded-xl border px-3 py-2" value={p} onChange={(e) => setPeople((s) => s.map((v, idx) => (idx === i ? e.target.value : v)))} placeholder={`oseba #${i + 1}`} />
                  <button className="p-2 text-red-600 hover:bg-red-50 rounded-xl" onClick={() => delPerson(i)}><Trash2 className="h-4 w-4"/></button>
                </div>
              ))}
            </div>
            <button onClick={addPerson} className="mt-2 text-sm text-neutral-700 hover:underline">+ Dodaj osebo</button>
          </div>
        </section>

        {/* Številčenje računov */}
        <section className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white p-4 shadow md:col-span-3">
            <div className="text-sm font-semibold mb-2">Številčenje računov</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-sm">
                <span className="text-neutral-700">Prefix računa</span>
                <input className="mt-1 w-full rounded-xl border px-3 py-2" value={invPrefix} onChange={(e) => setInvPrefix(e.target.value)} placeholder="RAC-2025-" />
              </label>
              <label className="text-sm">
                <span className="text-neutral-700">Naslednja številka</span>
                <input type="number" className="mt-1 w-full rounded-xl border px-3 py-2" value={invCounter} onChange={(e) => setInvCounter(Number(e.target.value) || 1)} />
              </label>
              <div className="text-sm flex items-end">Naslednji račun: <b className="ml-2">{invPrefix}{String(invCounter).padStart(3, "0")}</b></div>
            </div>
          </div>
        </section>

        {/* Items table */}
        <section className="mt-6 rounded-2xl bg-white shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
             <thead className="bg-neutral-100 text-neutral-700">
                <tr>
                  <Th className="w-[320px]">Artikel</Th>
<Th className="w-20 text-right">Količina</Th>
<Th className="w-24 text-right">CNY</Th>
<Th className="w-24 text-right">EUR</Th>
<Th className="w-24 text-right">Teža (g)</Th>
<Th className="w-20 text-right">Teža (%)</Th>
<Th className="w-28 text-right">Poštnina EUR</Th>
<Th className="w-28 text-right">Skupaj EUR</Th>
<Th className="w-24 text-right">Redna</Th>
<Th className="w-20 text-right">Profit</Th>
<Th className="w-28">Kdo</Th>
<Th className="w-10"></Th>

                </tr>
              </thead>
              <tbody>
                {computedRows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <Td>
  <input
    className="w-full min-w-[320px] rounded-xl border px-3 py-2"
    value={r.artikel}
    onChange={(e)=> updateRow(r.id, "artikel", e.target.value)}
    placeholder="npr. pulover"
  />
</Td>

<Td className="text-right">
  <input
    type="number" min="1" step="1"
    className="w-16 rounded-xl border px-3 py-2 text-right"
    value={r.qty}
    onChange={(e)=> updateRow(r.id, "qty", e.target.value)}
  />
</Td>

<Td className="text-right">
  <input
    type="number" inputMode="decimal"
    className="w-20 rounded-xl border px-3 py-2 text-right"
    value={r.cny}
    onChange={(e)=> updateRow(r.id, "cny", e.target.value)}
    placeholder="CNY"
  />
</Td>

<Td className="text-right">
  <input
    type="number" inputMode="decimal"
    className="w-20 rounded-xl border px-3 py-2 text-right"
    value={r.weight}
    onChange={(e)=> updateRow(r.id, "weight", e.target.value)}
    placeholder="g"
  />
</Td>

<Td>
  <select
    className="w-28 rounded-xl border px-3 py-2"
    value={r.who || ""}
    onChange={(e)=> updateRow(r.id, "who", e.target.value)}
  >
    <option value="">—</option>
    {people.filter(Boolean).map((p)=> <option key={p} value={p}>{p}</option>)}
  </select>
</Td>
                    <Td className="text-right">
                      <button onClick={() => delRow(r.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-xl">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-4 p-4 text-sm text-neutral-700 bg-neutral-50">
            <span>
              <b>Skupna teža:</b> {fmt(totalWeight)} g
            </span>
            <span>
              <b>Skupaj CNY:</b> {fmt(totalCNY)}
            </span>
            <span>
              <b>Poštnina EUR:</b> {fmt(shippingEUR)}
            </span>
            <span>
              <b>G35 (USD/EUR):</b> {fmt(usdPerEur)}
            </span>
            <span>
              <b>Skupaj EUR:</b> {fmt(grandTogether)}
            </span>
            <span>
              <b>"Zaslužek" (tečajna razlika):</b> {fmt(rateProfit)}
            </span>
          </div>
        </section>

        {/* Summary per person */}
        <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 font-semibold">
                <Users className="h-4 w-4" />Povzetek po osebi
              </div>
              <div className="text-sm text-neutral-600">Minimum = EUR / G35</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100 text-neutral-700">
  <tr>
    <Th>Kdo</Th>
    <Th className="text-right">EUR (Skupaj)</Th>
    <Th className="text-right">Minimum</Th>
    <Th className="text-right">Način</Th>
    <Th className="text-right">Fee ×</Th>
    <Th className="text-right">Končna</Th>
    <Th className="text-right">Prejeto</Th>
    <Th className="text-right">Dolžan</Th>
    <Th className="text-right">Profit</Th>
  </tr>
</thead>
<tbody>
  {summaryByPerson.map((r) => {
    const opts = personOpts[r.who] || { fee: 1, mode: "eur" }; // iz 3a
    const base = opts.mode === "redna" ? r.minimum : r.eur;     // “redna” = Minimum, sicer Skupaj (EUR)
    const fee  = Number(opts.fee) || 1;
    const finalCharge = base * fee;
    const received = num(receivedMap[r.who]);
    const due = finalCharge - received;
    const profit = received - r.minimum;   // profit glede na dejansko prejeto

    return (
      <tr key={r.who} className="border-b last:border-0">
        <Td className="font-medium">{r.who}</Td>
        <Td className="text-right tabular-nums">{fmt(r.eur)}</Td>
        <Td className="text-right tabular-nums">{fmt(r.minimum)}</Td>
        <Td className="text-right">
          <select
            className="w-28 rounded-xl border px-2 py-1"
            value={opts.mode || "eur"}
            onChange={(e)=> setPersonOpts(m => ({...m, [r.who]: {...(m[r.who]||{fee:1}), mode: e.target.value}}))}
          >
            <option value="eur">Skupaj</option>
            <option value="redna">Redna</option>
          </select>
        </Td>
        <Td className="text-right">
          <input
            type="number" step="0.01"
            className="w-20 rounded-xl border px-2 py-1 text-right"
            value={opts.fee ?? 1}
            onChange={(e)=> setPersonOpts(m => ({...m, [r.who]: {...(m[r.who]||{mode:"eur"}), fee: e.target.value}}))}
          />
        </Td>
        <Td className="text-right tabular-nums">{fmt(finalCharge)}</Td>
        <Td className="text-right">
          <input
            type="number" inputMode="decimal"
            className="w-28 rounded-xl border px-3 py-2 text-right"
            value={receivedMap[r.who] ?? ""}
            onChange={(e)=> setReceivedMap(m => ({...m, [r.who]: e.target.value}))}
            placeholder="EUR"
          />
        </Td>
        <Td className={`text-right tabular-nums ${due > 0 ? "text-red-600" : "text-green-700"}`}>{fmt(due)}</Td>
        <Td className="text-right tabular-nums">{fmt(profit)}</Td>
      </tr>
    );
  })}
</tbody>
              </table>
            </div>
          </div>

          {/* Export + Save */}
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="font-semibold mb-2 flex items-center gap-2">
              <FileDown className="h-4 w-4" />Export & Shrani
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border p-3">
                <div className="text-sm font-medium mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" />PDF Export
                </div>
                <div className="flex flex-wrap items-center gap-4 mb-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={exportSelection.all}
                      onChange={(e) => setExportSelection((s) => ({ ...s, all: e.target.checked }))}
                    />
                    <span>Vsi</span>
                  </label>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-neutral-700">Način:</span>
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="mode" checked={exportMode === "interno"} onChange={() => setExportMode("interno")} />
                      <span>Interno</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input type="radio" name="mode" checked={exportMode === "stranka"} onChange={() => setExportMode("stranka")} />
                      <span>Za stranko</span>
                    </label>
                  </div>
                </div>
                {!exportSelection.all && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {people.filter(Boolean).map((p) => (
                      <label key={p} className="inline-flex items-center gap-2 border rounded-xl px-2 py-1">
                        <input
                          type="checkbox"
                          checked={exportSelection.who.includes(p)}
                          onChange={(e) =>
                            setExportSelection((s) => ({
                              ...s,
                              who: e.target.checked ? [...s.who, p] : s.who.filter((x) => x !== p),
                            }))
                          }
                        />
                        <span>{p}</span>
                      </label>
                    ))}
                  </div>
                )}
                <button onClick={handleExportPDF} className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-sm hover:bg-neutral-100">
                  <Download className="h-4 w-4" />Export PDF
                </button>
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-sm font-medium mb-2">Shrani paket</div>
                <div className="flex items-center gap-2">
                  <input className="flex-1 rounded-xl border px-3 py-2" placeholder="ime paketa (npr. avgust-2025)" value={pkgName} onChange={(e) => setPkgName(e.target.value)} />
                  <button onClick={savePackage} className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-sm hover:bg-neutral-100">
                    <Save className="h-4 w-4" />Shrani
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* History Drawer */}
        {showHistory && (
          <section className="fixed inset-0 bg-black/40 flex justify-end z-50" onClick={() => setShowHistory(false)}>
            <div className="w-full max-w-2xl bg-white h-full p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <div className="font-semibold flex items-center gap-2">
                  <History className="h-4 w-4" />Shranjeni paketi
                </div>
                <button className="rounded-xl border px-3 py-1" onClick={() => setShowHistory(false)}>
                  Zapri
                </button>
              </div>
              <div className="space-y-3">
                {packages.length === 0 && (
                  <div className="text-sm text-neutral-600">Ni shranjenih paketov.</div>
                )}
                {packages.map((p) => (
                  <div key={p.id} className="rounded-xl border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-neutral-600">{new Date(p.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button className="rounded-xl border px-2 py-1 text-sm flex items-center gap-1" onClick={() => setPreviewPkg(p)}>
                          <Eye className="h-4 w-4" />Pregled
                        </button>
                        <button className="rounded-xl border px-2 py-1 text-sm" onClick={() => loadPackageToDraft(p)}>
                          Naloži v osnutek
                        </button>
                        <button className="p-2 text-red-600 hover:bg-red-50 rounded-xl" onClick={() => deletePackage(p.id)}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                      <div>
                        <b>Skupaj EUR:</b> {fmt(p.derived.grandTogether)}
                      </div>
                      <div>
                        <b>Skupna teža:</b> {fmt(p.derived.totalWeight)} g
                      </div>
                      <div>
                        <b>Poštnina EUR:</b> {fmt(p.derived.shippingEUR)}
                      </div>
                      <div>
                        <b>Zaslužek (teč.):</b> {fmt(p.derived.rateProfit)}
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="text-xs text-neutral-600 mb-1">Po osebah (skupaj EUR):</div>
                      <div className="flex flex-wrap gap-2">
                        {p.derived.summaryByPerson.map((row) => (
                          <span key={row.who} className="rounded-full border px-2 py-1 text-xs">
                            {row.who}: {fmt(row.eur)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* PREVIEW OVERLAY */}
        {previewPkg && (
          <section className="fixed inset-0 bg-black/40 z-[60] flex justify-center items-center p-4" onClick={() => setPreviewPkg(null)}>
            <div className="bg-white rounded-2xl shadow max-w-5xl w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 border-b flex items-center justify-between">
                <div>
                  <div className="font-semibold">{previewPkg.name}</div>
                  <div className="text-xs text-neutral-600">{new Date(previewPkg.createdAt).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="rounded-xl border px-3 py-1" onClick={() => { loadPackageToDraft(previewPkg); }}>
                    Naloži v osnutek
                  </button>
                  <button className="rounded-xl border px-3 py-1" onClick={() => setPreviewPkg(null)}>
                    Zapri
                  </button>
                </div>
              </div>
              <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="text-sm">
                  <div className="font-medium mb-1">Parametri</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      Orig(B35): <b>{fmt(previewPkg.origRatio)}</b>
                    </div>
                    <div>
                      Moj(E35): <b>{fmt(previewPkg.myRatio)}</b>
                    </div>
                    <div>
                      USD/EUR (G35): <b>{fmt(previewPkg.derived.usdPerEur)}</b>
                    </div>
                    <div>
                      Poštnina CNY: <b>{fmt(previewPkg.shippingCNY)}</b>
                    </div>
                    <div>
                      Poštnina EUR: <b>{fmt(previewPkg.derived.shippingEUR)}</b>
                    </div>
                  </div>
                </div>
                <div className="text-sm">
                  <div className="font-medium mb-1">Povzetek</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      Skupaj EUR: <b>{fmt(previewPkg.derived.grandTogether)}</b>
                    </div>
                    <div>
                      Skupna teža: <b>{fmt(previewPkg.derived.totalWeight)} g</b>
                    </div>
                    <div>
                      Skupaj CNY: <b>{fmt(previewPkg.derived.totalCNY)}</b>
                    </div>
                    <div>
                      "Zaslužek" (teč.): <b>{fmt(previewPkg.derived.rateProfit)}</b>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-4 pb-4">
                <div className="font-medium mb-2">Postavke</div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-neutral-100 text-neutral-700">
                      <tr>
                        <Th>Artikel</Th>
                        <Th className="text-right">Količina</Th>
                        <Th className="text-right">CNY</Th>
                        <Th className="text-right">EUR</Th>
                        <Th className="text-right">Teža</Th>
                        <Th className="text-right">Poštnina EUR</Th>
                        <Th className="text-right">Skupaj EUR</Th>
                        <Th>Kdo</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {computeRows({ items: previewPkg.items, myRatio: previewPkg.myRatio, shippingCNY: previewPkg.shippingCNY, origRatio: previewPkg.origRatio }).map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <Td>{r.artikel}</Td>
                          <Td className="text-right">{fmt(r.qty)}</Td>
                          <Td className="text-right">{fmt(r.cny)}</Td>
                          <Td className="text-right">{fmt(r.eur)}</Td>
                          <Td className="text-right">{fmt(r.weightTotal)}</Td>
                          <Td className="text-right">{fmt(r.shipPart)}</Td>
                          <Td className="text-right font-medium">{fmt(r.together)}</Td>
                          <Td>{r.who}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}

        <footer className="mt-10 text-center text-xs text-neutral-500">
          Zgrajeno za Jakoba • Excel-parity izračuni • Lokalno + oblak (Clerk) • PDF export (ALL / osebe) • Interno & Za stranko • Pregled zgodovine • Avtomatsko številčenje računov
        </footer>
      </div>

      {/* Hidden ref for potential future print areas */}
      <div ref={printRef} className="hidden" />
    </div>
  );
}

// ===== Small UI helpers =====
function Th({ children, className = "" }) {
  return <th className={`px-3 py-2 text-left text-xs font-semibold ${className}`}>{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
function LabelInput({ label, value, onChange }) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-700">{label}</span>
      <input type="number" inputMode="decimal" className="mt-1 w-full rounded-xl border px-3 py-2" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ===== Utils =====
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function safe(v) {
  const n = Number(v);
  return !n || !Number.isFinite(n) ? 1 : n;
}
function sum(arr) {
  return arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}
function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function computeRows({ items, myRatio, shippingCNY, origRatio }) {
  // wTotal = vsota vnesenih (že total) tež na vrstico
  const wTotal = items.reduce((acc, r) => acc + num(r.weight), 0) || 1;

  const shippingEUR = shippingCNY ? shippingCNY / safe(myRatio) : 0;
  const usdPerEur   = safe(origRatio) / safe(myRatio);

  return items.map((r) => {
    const unitCNY    = num(r.cny);                          // cena za 1 kos
    const qty        = Math.max(1, Math.floor(num(r.qty) || 1)); // default 1
    const weightTot  = num(r.weight);                       // že total teža vrstice (NE množimo z qty)
    const cnyTotal   = unitCNY * qty;                       // skupni CNY za vrstico

    const eur        = cnyTotal / safe(myRatio);            // pretvorba po tvojem tečaju
    const shipPart   = (weightTot / wTotal) * shippingEUR;  // poštnina po teži (proporcionalno)
    const together   = eur + shipPart;                      // skupaj EUR
    const regular    = together / safe(usdPerEur);          // informativno
    const profit     = together - regular;
    const weightPct  = (weightTot / wTotal) * 100;

    return { ...r, qty, eur, shipPart, together, regular, profit, weightPct, weightTotal: weightTot, cnyTotal };
  });
}

