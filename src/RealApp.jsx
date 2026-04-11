import React, { useMemo, useRef, useState, useEffect } from "react";
import { Download, Plus, Trash2, Save, History, FileDown, Users, Settings, PackageSearch, Eye, FileText, BookOpen, ShoppingBag, PlusCircle } from "lucide-react";
import { useUser } from "@clerk/clerk-react";

export default function RealApp() {
  const { isLoaded, isSignedIn, user } = useUser();

  // ==== Core state ====
  const [items, setItems] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_ITEMS");
    return saved ? JSON.parse(saved) : [{ id: uid(), artikel: "", cny: "", qty: 1, weight: "", who: "" }];
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

  const [receivedMap, setReceivedMap] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_RECEIVED");
    return saved ? JSON.parse(saved) : {};
  });
  const [personOpts, setPersonOpts] = useState(() => {
    const saved = localStorage.getItem("RACUN_PERSON_OPTS");
    return saved ? JSON.parse(saved) : {}; 
  });
  useEffect(() => { localStorage.setItem("RACUN_PERSON_OPTS", JSON.stringify(personOpts)); }, [personOpts]);

  const defaultPrefix = `RAC-${new Date().getFullYear()}-`;
  const [invPrefix, setInvPrefix] = useState(() => localStorage.getItem("RACUN_INV_PREFIX") || defaultPrefix);
  const [invCounter, setInvCounter] = useState(() => Number(localStorage.getItem("RACUN_INV_COUNTER")) || 1);

  const [exportMode, setExportMode] = useState(() => localStorage.getItem("RACUN_EXPORTMODE") || "interno");

  const [packages, setPackages] = useState(() => {
    const saved = localStorage.getItem("RACUN_PACKAGES");
    return saved ? JSON.parse(saved) : [];
  });
  const [pkgName, setPkgName] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false); // NOVO: State za katalog
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

  // === Clerk cloud load (ob prijavi) - POPRAVLJENO ===
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    
    // Naložimo nastavitve za račune
    const invCloud = user?.unsafeMetadata?.invoice;
    if (invCloud && typeof invCloud === "object") {
      if (typeof invCloud.prefix === "string") setInvPrefix(invCloud.prefix);
      if (Number.isFinite(invCloud.counter)) setInvCounter(Number(invCloud.counter));
    }

    // Naložimo in pametno ZDRUŽIMO pakete iz oblaka in lokalnega pomnilnika
    const cloudPkgs = user?.unsafeMetadata?.packages;
    
    setPackages((prevLocal) => {
      if (!Array.isArray(cloudPkgs)) return prevLocal;
      
      // Združimo pakete po ID-ju, tako da oblak ne povozi novih lokalnih paketov
      const map = new Map();
      [...cloudPkgs, ...prevLocal].forEach(p => {
        if (!map.has(p.id)) map.set(p.id, p);
      });
      
      // Sortiramo po datumu (novejši zgoraj)
      const merged = Array.from(map.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      // Posodobimo še localStorage, da sta usklajena
      localStorage.setItem("RACUN_PACKAGES", JSON.stringify(merged));
      return merged;
    });

  }, [isLoaded, isSignedIn, user]);

  // === Cloud autosave za invoice settings (debounce) - OSTANE ISTO ===
  useEffect(() => {
    if (!isSignedIn) return;
    const t = setTimeout(() => {
      user.update({
        unsafeMetadata: { ...(user.unsafeMetadata || {}), invoice: { prefix: invPrefix, counter: invCounter } },
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [isSignedIn, user, invPrefix, invCounter]);

  // ==== NOVO: Izračun kataloga ====
  const catalogItems = useMemo(() => {
    const allItems = [...items];
    packages.forEach((p) => {
      if (p.items) allItems.push(...p.items);
    });

    const map = new Map();
    allItems.forEach((it) => {
      const name = (it.artikel || "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      
      if (!map.has(key)) {
        map.set(key, { originalName: name, count: 0, totalQty: 0, sumCny: 0, sumWeight: 0 });
      }
      const entry = map.get(key);
      entry.count += 1;
      entry.totalQty += (num(it.qty) || 1);
      
      // Seštevamo cene in teže za povprečje (gledamo ceno na kos in težo za to vrstico)
      const qty = num(it.qty) || 1;
      entry.sumCny += num(it.cny); 
      // Če je vnešena teža totalna za vrstico, za povprečje na kos delimo s qty
      entry.sumWeight += (num(it.weight) / qty); 
    });

    return Array.from(map.values()).map(e => ({
      name: e.originalName,
      avgCny: e.count > 0 ? e.sumCny / e.count : 0,
      avgWeight: e.count > 0 ? e.sumWeight / e.count : 0,
      totalQty: e.totalQty,
      orderCount: e.count
    })).sort((a, b) => b.totalQty - a.totalQty);
  }, [items, packages]);

  // ==== Derived numbers ====
  const totalWeight = useMemo(() => sum(items.map((r) => num(r.weight))), [items]);
  const totalCNY = useMemo(() => sum(items.map((r) => num(r.cny) * (num(r.qty) || 1))), [items]);
  const shippingEUR = useMemo(() => (shippingCNY ? shippingCNY / safe(myRatio) : 0), [shippingCNY, myRatio]);
  const usdPerEur = useMemo(() => safe(origRatio) / safe(myRatio), [origRatio, myRatio]);
  const rateProfit = useMemo(() => {
    const eurAll = totalCNY / safe(myRatio);
    const usdAll = totalCNY / safe(origRatio);
    return eurAll - usdAll;
  }, [totalCNY, myRatio, origRatio]);

  const computedRows = useMemo(
    () => computeRows({ items, myRatio, shippingCNY, origRatio }),
    [items, myRatio, shippingCNY, origRatio]
  );

  const summaryByPerson = useMemo(() => {
    return people.map((p) => {
      const rows = computedRows.filter((r) => (r.who?.trim() || "") === p);
      const eur = rows.reduce((a, r) => a + num(r.together), 0);
      const minimum = eur / safe(usdPerEur);
      const opts = personOpts[p] || { fee: 1, mode: "eur" };
      const base = opts.mode === "redna" ? minimum : eur;
      const feeMul = Number(opts.fee) || 1;
      const charge = base * feeMul;
      const received = num(receivedMap[p]);
      const due = charge - received;
      const profitReceived = received - minimum;
      const profitPlanned = charge - minimum;

      return { who: p, eur, minimum, charge, received, due, profitReceived, profitPlanned };
    });
  }, [people, computedRows, usdPerEur, receivedMap, personOpts]);

  const grandTogether = useMemo(() => sum(computedRows.map((r) => r.together)), [computedRows]);

  // === UI helpers ===
  const addRow = () => setItems((s) => [...s, { id: uid(), artikel: "", cny: "", qty: 1, weight: "", who: people[0] || "" }]);
  const addFromCatalog = (catItem) => {
    setItems((s) => [
      ...s, 
      { 
        id: uid(), 
        artikel: catItem.name, 
        cny: catItem.avgCny.toFixed(2), 
        qty: 1, 
        weight: catItem.avgWeight.toFixed(0), 
        who: people[0] || "" 
      }
    ]);
    setShowCatalog(false); // Zapri katalog po dodajanju
  };

  const delRow = (id) => setItems((s) => s.filter((r) => r.id !== id));
  const updateRow = (id, k, v) => setItems((s) => s.map((r) => (r.id === id ? { ...r, [k]: v } : r)));

  const addPerson = () => setPeople((s) => [...s, ""]);
  const delPerson = (idx) => {
    const name = people[idx];
    setPeople((s) => s.filter((_, i) => i !== idx));
    setItems((s) => s.map((r) => (r.who === name ? { ...r, who: "" } : r)));
    setReceivedMap((m) => { const n = { ...m }; delete n[name]; return n; });
  };

  const savePackage = async () => {
    const name = pkgName?.trim() || `Paket ${new Date().toLocaleString()}`;
    const payload = {
      id: uid(), name, createdAt: new Date().toISOString(), items, people, origRatio, myRatio, shippingCNY,
      derived: { totalWeight, totalCNY, shippingEUR, usdPerEur, rateProfit, grandTogether, summaryByPerson },
    };
    
    const next = [payload, ...packages];
    
    // 1. Shrani lokalno takoj (da so podatki varni na računalniku)
    setPackages(next);
    localStorage.setItem("RACUN_PACKAGES", JSON.stringify(next));
    setPkgName("");
    setShowHistory(true);

    // 2. Shrani v oblak
    if (isSignedIn) {
      try { 
        await user.update({ 
          unsafeMetadata: { ...(user.unsafeMetadata || {}), packages: next } 
        }); 
      } catch (e) {
        console.error("Napaka pri shranjevanju v Clerk oblak:", e);
        // Tukaj ti bo sedaj aplikacija povedala, če si presegel tistih 8 KB!
        alert("Paket je bil shranjen lokalno na ta računalnik, vendar shranjevanje v oblak (Clerk) ni uspelo. Morda je v oblaku zmanjkalo prostora (omejitev 8 KB).");
      }
    }
  };

  const deletePackage = async (id) => {
    if (!confirm("Želite izbrisati shranjeni paket?")) return;
    const next = packages.filter((p) => p.id !== id);
    setPackages(next);
    localStorage.setItem("RACUN_PACKAGES", JSON.stringify(next));
    if (isSignedIn) {
      try { await user.update({ unsafeMetadata: { ...(user.unsafeMetadata || {}), packages: next } }); } catch (e) {}
    }
  };

  const loadPackageToDraft = (p) => {
    setItems(p.items || []); setPeople(p.people || []); setReceivedMap({});
    setOrigRatio(p.origRatio); setMyRatio(p.myRatio); setShippingCNY(p.shippingCNY);
    setShowHistory(false); setPreviewPkg(null);
  };

  const [exportSelection, setExportSelection] = useState({ all: true, who: [] });
  const printRef = useRef(null);

  const handleExportPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const html2canvas = (await import("html2canvas")).default;

    const selectedWho = exportSelection.all ? people.filter(Boolean) : exportSelection.who;
    if (!selectedWho.length) { alert("Izberi vsaj eno osebo ali ALL"); return; }

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
          <div><div style="font-size:20px;font-weight:700;">Povzetek (interno)</div><div style="font-size:12px;opacity:0.8;">Ustvarjeno: ${new Date().toLocaleString()}</div></div>
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
                <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Kol.</th>
                <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">CNY (skupaj)</th>
                <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">EUR</th>
                <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Teža (g)</th>
                <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Poštnina</th>
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
          <div><div><b>Skupna teža:</b> ${fmt(totalWeight)} g</div><div><b>Skupaj CNY:</b> ${fmt(totalCNY)}</div></div>
          <div style="text-align:right;"><div><b>Skupaj EUR:</b> ${fmt(grandTogether)} EUR</div><div><b>Zaslužek:</b> ${fmt(rateProfit)}</div></div>
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
                <tr><td style="padding:6px;border-top:1px solid #000;">Skupaj</td><td style="padding:6px;border-top:1px solid #000;text-align:right;">${fmt(charge)} EUR</td></tr>
                <tr><td style="padding:6px;font-weight:700;border-top:1px solid #000;">Za plačilo</td><td style="padding:6px;font-weight:700;border-top:1px solid #000;text-align:right;">${fmt(charge)} EUR</td></tr>
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
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-12 font-sans">
      <div className="mx-auto max-w-[1400px] p-4 md:p-8">
        
        {/* HEADER Z IZBOLJŠANIM UI */}
        <header className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2">
              <ShoppingBag className="text-blue-600 h-8 w-8" />
              ACB Kalkulator
            </h1>
            <p className="text-sm text-slate-500 mt-1">Sistem za sledenje pošiljkam, izračun tečajev in delitev stroškov.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowCatalog(true)} className="inline-flex items-center gap-2 rounded-xl bg-slate-100 text-slate-700 font-medium px-4 py-2 hover:bg-slate-200 transition-colors">
              <BookOpen className="h-4 w-4"/>Katalog
            </button>
            <button onClick={() => setShowHistory((v) => !v)} className="inline-flex items-center gap-2 rounded-xl bg-slate-100 text-slate-700 font-medium px-4 py-2 hover:bg-slate-200 transition-colors">
              <History className="h-4 w-4"/>Zgodovina
            </button>
            <button onClick={addRow} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 text-white font-medium px-4 py-2 shadow-md hover:bg-blue-700 transition-colors">
              <PlusCircle className="h-4 w-4"/>Dodaj artikel
            </button>
          </div>
        </header>

        {/* Settings */}
        <section className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 font-bold text-slate-700 mb-4 border-b pb-2"><Settings className="h-5 w-5 text-indigo-500"/>Tečaji</div>
            <div className="space-y-3">
              <LabelInput label="Original razmerje (B35, CNY/USD)" value={origRatio} onChange={(v) => setOrigRatio(num(v))} />
              <LabelInput label="Moj tečaj (E35, CNY/EUR)" value={myRatio} onChange={(v) => setMyRatio(num(v))} />
              <div className="p-3 bg-indigo-50 rounded-xl text-sm text-indigo-900 font-medium">G35 (USD/EUR): {fmt(usdPerEur)}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 font-bold text-slate-700 mb-4 border-b pb-2"><PackageSearch className="h-5 w-5 text-emerald-500"/>Poštnina</div>
            <div className="space-y-3">
              <LabelInput label="Poštnina (CNY)" value={shippingCNY} onChange={(v) => setShippingCNY(num(v))} />
              <div className="p-3 bg-emerald-50 rounded-xl text-sm text-emerald-900 font-medium">Poštnina EUR: {fmt(shippingEUR)}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 font-bold text-slate-700 mb-4 border-b pb-2"><Users className="h-5 w-5 text-amber-500"/>Osebe</div>
            <div className="space-y-2 max-h-[160px] overflow-y-auto pr-2">
              {people.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="flex-1 rounded-lg border-slate-200 border px-3 py-1.5 text-sm focus:border-blue-400 focus:ring focus:ring-blue-100 transition-all" value={p} onChange={(e) => setPeople((s) => s.map((v, idx) => (idx === i ? e.target.value : v)))} placeholder={`oseba #${i + 1}`} />
                  <button className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" onClick={() => delPerson(i)}><Trash2 className="h-4 w-4"/></button>
                </div>
              ))}
            </div>
            <button onClick={addPerson} className="mt-3 text-sm font-medium text-amber-600 hover:text-amber-700 flex items-center gap-1">+ Dodaj osebo</button>
          </div>
        </section>

        {/* Številčenje računov */}
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
          <div className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2 border-b pb-2">
            <FileText className="h-5 w-5 text-slate-400"/> Nastavitve računov
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <label className="text-sm block">
              <span className="text-slate-600 font-medium mb-1 block">Prefix računa</span>
              <input className="w-full rounded-xl border-slate-200 border px-3 py-2 focus:border-blue-400 focus:ring focus:ring-blue-100" value={invPrefix} onChange={(e) => setInvPrefix(e.target.value)} placeholder="RAC-2025-" />
            </label>
            <label className="text-sm block">
              <span className="text-slate-600 font-medium mb-1 block">Naslednja številka</span>
              <input type="number" className="w-full rounded-xl border-slate-200 border px-3 py-2 focus:border-blue-400 focus:ring focus:ring-blue-100" value={invCounter} onChange={(e) => setInvCounter(Number(e.target.value) || 1)} />
            </label>
            <div className="text-sm p-3 bg-slate-50 rounded-xl border border-slate-100">
              Naslednji izpis: <b className="ml-1 text-slate-800">{invPrefix}{String(invCounter).padStart(3, "0")}</b>
            </div>
          </div>
        </section>

        {/* Items table */}
        <section className="mt-6 rounded-2xl bg-white shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
             <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <Th className="w-[280px]">Artikel</Th>
                  <Th className="w-20 text-right">Kol.</Th>
                  <Th className="w-24 text-right">CNY/kos</Th>
                  <Th className="w-24 text-right">EUR</Th>
                  <Th className="w-24 text-right">Teža (g)</Th>
                  <Th className="w-20 text-right">Teža (%)</Th>
                  <Th className="w-28 text-right text-emerald-600">Poštnina</Th>
                  <Th className="w-28 text-right font-bold text-slate-800">Skupaj EUR</Th>
                  <Th className="w-24 text-right">Redna</Th>
                  <Th className="w-20 text-right text-indigo-600">Profit</Th>
                  <Th className="w-32">Kdo</Th>
                  <Th className="w-12"></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {computedRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition-colors group">
                    <Td>
                      <input className="w-full min-w-[200px] rounded-lg border-transparent hover:border-slate-300 focus:border-blue-400 focus:ring focus:ring-blue-100 px-2 py-1.5 transition-all bg-transparent" value={r.artikel} onChange={(e) => updateRow(r.id, "artikel", e.target.value)} placeholder="Vnesi ime..." />
                    </Td>
                    <Td className="text-right">
                      <input type="number" min="1" step="1" className="w-16 rounded-lg border-transparent hover:border-slate-300 focus:border-blue-400 focus:ring focus:ring-blue-100 px-2 py-1.5 text-right transition-all bg-transparent" value={r.qty} onChange={(e) => updateRow(r.id, "qty", e.target.value)} />
                    </Td>
                    <Td className="text-right">
                      <input type="number" inputMode="decimal" className="w-20 rounded-lg border-transparent hover:border-slate-300 focus:border-blue-400 focus:ring focus:ring-blue-100 px-2 py-1.5 text-right transition-all bg-transparent" value={r.cny} onChange={(e) => updateRow(r.id, "cny", e.target.value)} />
                    </Td>
                    <Td className="text-right tabular-nums py-3 text-slate-500">{fmt(r.eur)}</Td>
                    <Td className="text-right">
                      <input type="number" inputMode="decimal" className="w-20 rounded-lg border-transparent hover:border-slate-300 focus:border-blue-400 focus:ring focus:ring-blue-100 px-2 py-1.5 text-right transition-all bg-transparent" value={r.weight} onChange={(e) => updateRow(r.id, "weight", e.target.value)} />
                    </Td>
                    <Td className="text-right tabular-nums py-3 text-slate-400 text-xs">{fmt(r.weightPct)}%</Td>
                    <Td className="text-right tabular-nums py-3 text-emerald-600 font-medium">{fmt(r.shipPart)}</Td>
                    <Td className="text-right font-bold tabular-nums py-3 text-slate-800">{fmt(r.together)}</Td>
                    <Td className="text-right tabular-nums py-3 text-slate-500">{fmt(r.regular)}</Td>
                    <Td className="text-right tabular-nums py-3 text-indigo-600 font-medium">{fmt(r.profit)}</Td>
                    <Td>
                      <select className="w-full rounded-lg border-transparent hover:border-slate-300 focus:border-blue-400 focus:ring focus:ring-blue-100 px-2 py-1.5 bg-transparent" value={r.who || ""} onChange={(e) => updateRow(r.id, "who", e.target.value)}>
                        <option value="">—</option>
                        {people.filter(Boolean).map((p) => (<option key={p} value={p}>{p}</option>))}
                      </select>
                    </Td>
                    <Td className="text-center align-middle">
                      <button onClick={() => delRow(r.id)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>
                    </Td>
                  </tr>
                ))}
                {computedRows.length === 0 && (
                  <tr>
                    <td colSpan={12} className="text-center py-8 text-slate-400">
                      Ni še dodanih artiklov. Klikni "Dodaj artikel" zgoraj.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-4 p-4 text-sm text-slate-700 bg-slate-50 border-t border-slate-200">
            <span className="bg-white px-3 py-1 rounded-full border border-slate-200">Teža: <b>{fmt(totalWeight)} g</b></span>
            <span className="bg-white px-3 py-1 rounded-full border border-slate-200">CNY: <b>{fmt(totalCNY)}</b></span>
            <span className="bg-emerald-50 text-emerald-800 px-3 py-1 rounded-full border border-emerald-100">Poštnina: <b>{fmt(shippingEUR)} €</b></span>
            <span className="bg-blue-50 text-blue-800 px-3 py-1 rounded-full border border-blue-100">Skupaj: <b>{fmt(grandTogether)} €</b></span>
            <span className="bg-indigo-50 text-indigo-800 px-3 py-1 rounded-full border border-indigo-100">Zaslužek (razlika): <b>{fmt(rateProfit)} €</b></span>
          </div>
        </section>

        {/* Summary per person */}
        <section className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 rounded-2xl bg-white p-5 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4 border-b pb-2">
              <div className="flex items-center gap-2 font-bold text-slate-700"><Users className="h-5 w-5 text-blue-500" />Povzetek po osebi</div>
              <div className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded">Minimum = EUR / G35</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <Th>Kdo</Th>
                    <Th className="text-right">Skupaj EUR</Th>
                    <Th className="text-right">Minimum</Th>
                    <Th className="text-right">Obračun</Th>
                    <Th className="text-right">Faktor</Th>
                    <Th className="text-right font-bold text-slate-800">Končna</Th>
                    <Th className="text-right">Prejeto €</Th>
                    <Th className="text-right">Dolžan</Th>
                    <Th className="text-right text-indigo-600">Profit</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summaryByPerson.map((r) => {
                    const opts = personOpts[r.who] || { fee: 1, mode: "eur" };
                    const base = opts.mode === "redna" ? r.minimum : r.eur;
                    const fee = Number(opts.fee) || 1;
                    const finalCharge = base * fee;
                    const received = num(receivedMap[r.who]);
                    const due = finalCharge - received;
                    const profit = received - r.minimum;

                    return (
                      <tr key={r.who} className="hover:bg-slate-50 transition-colors">
                        <Td className="font-bold text-slate-700 py-3">{r.who}</Td>
                        <Td className="text-right tabular-nums py-3">{fmt(r.eur)}</Td>
                        <Td className="text-right tabular-nums py-3 text-slate-500">{fmt(r.minimum)}</Td>
                        <Td className="text-right">
                          <select className="w-24 rounded-lg border-slate-200 border px-2 py-1 text-xs focus:ring focus:ring-blue-100" value={opts.mode || "eur"} onChange={(e) => setPersonOpts(m => ({ ...m, [r.who]: { ...(m[r.who] || { fee: 1 }), mode: e.target.value } }))}>
                            <option value="eur">Skupaj</option>
                            <option value="redna">Redna</option>
                          </select>
                        </Td>
                        <Td className="text-right">
                          <input type="number" step="0.01" className="w-16 rounded-lg border-slate-200 border px-2 py-1 text-xs text-right focus:ring focus:ring-blue-100" value={opts.fee ?? 1} onChange={(e) => setPersonOpts(m => ({ ...m, [r.who]: { ...(m[r.who] || { mode: "eur" }), fee: e.target.value } }))} />
                        </Td>
                        <Td className="text-right font-bold text-slate-800 tabular-nums py-3">{fmt(finalCharge)}</Td>
                        <Td className="text-right">
                          <input type="number" inputMode="decimal" className="w-24 rounded-lg border-emerald-200 bg-emerald-50 px-2 py-1.5 text-right font-medium text-emerald-800 focus:ring focus:ring-emerald-100" value={receivedMap[r.who] ?? ""} onChange={(e) => setReceivedMap(m => ({ ...m, [r.who]: e.target.value }))} placeholder="0.00" />
                        </Td>
                        <Td className={`text-right font-bold tabular-nums py-3 ${due > 0 ? "text-red-500" : due < 0 ? "text-emerald-500" : "text-slate-400"}`}>{fmt(due)}</Td>
                        <Td className="text-right font-medium tabular-nums text-indigo-600 py-3">{fmt(profit)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Export + Save */}
          <div className="lg:col-span-4 rounded-2xl bg-white p-5 shadow-sm border border-slate-100 flex flex-col gap-4">
            <div className="font-bold text-slate-700 mb-2 border-b pb-2 flex items-center gap-2"><FileDown className="h-5 w-5 text-slate-400" />Izvoz in Shranjevanje</div>
            
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2"><FileText className="h-4 w-4" />PDF Računi</div>
              
              <div className="space-y-3 mb-4">
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="mode" className="text-blue-600 focus:ring-blue-500" checked={exportMode === "interno"} onChange={() => setExportMode("interno")} /> Interno zbirno</label>
                  <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="radio" name="mode" className="text-blue-600 focus:ring-blue-500" checked={exportMode === "stranka"} onChange={() => setExportMode("stranka")} /> Za stranko</label>
                </div>
                
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <label className="flex items-center gap-2 text-sm font-medium mb-2 border-b pb-1"><input type="checkbox" className="rounded text-blue-600 focus:ring-blue-500" checked={exportSelection.all} onChange={(e) => setExportSelection((s) => ({ ...s, all: e.target.checked }))} /> Izvozi vse osebe</label>
                  {!exportSelection.all && (
                    <div className="flex flex-wrap gap-2">
                      {people.filter(Boolean).map((p) => (
                        <label key={p} className="inline-flex items-center gap-1.5 bg-slate-100 rounded px-2 py-1 text-xs cursor-pointer hover:bg-slate-200"><input type="checkbox" className="rounded text-blue-600" checked={exportSelection.who.includes(p)} onChange={(e) => setExportSelection((s) => ({ ...s, who: e.target.checked ? [...s.who, p] : s.who.filter((x) => x !== p) }))} /> {p}</label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <button onClick={handleExportPDF} className="w-full flex justify-center items-center gap-2 rounded-xl bg-slate-800 text-white font-medium px-4 py-2 hover:bg-slate-700 transition-colors">
                <Download className="h-4 w-4" /> Generiraj PDF
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mt-auto">
              <div className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><Save className="h-4 w-4" />Shrani zgodovino</div>
              <input className="w-full rounded-lg border-slate-200 border px-3 py-2 text-sm mb-2 focus:border-blue-400 focus:ring focus:ring-blue-100" placeholder="Ime paketa (npr. Avgust #1)" value={pkgName} onChange={(e) => setPkgName(e.target.value)} />
              <button onClick={savePackage} className="w-full flex justify-center items-center gap-2 rounded-xl bg-white border border-slate-200 text-slate-700 font-medium px-4 py-2 hover:bg-slate-100 transition-colors">
                Shrani paket v oblak
              </button>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* NOVO: KATALOG (CENIK) DRAWER */}
        {/* ========================================================= */}
        {showCatalog && (
          <section className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex justify-end z-[60]" onClick={() => setShowCatalog(false)}>
            <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col transform transition-transform" onClick={(e) => e.stopPropagation()}>
              
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div>
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><BookOpen className="text-blue-600 h-5 w-5"/> Cenik & Katalog</h2>
                  <p className="text-xs text-slate-500 mt-1">Združeni artikli iz vseh tvojih preteklih in trenutnih pošiljk.</p>
                </div>
                <button className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-100" onClick={() => setShowCatalog(false)}>Zapri</button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-5">
                {catalogItems.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">Ni še nobenih podatkov za katalog.</div>
                ) : (
                  <div className="grid gap-3">
                    {catalogItems.map((cat, idx) => (
                      <div key={idx} className="border border-slate-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between hover:shadow-md transition-shadow bg-white gap-4">
                        <div>
                          <h3 className="font-bold text-slate-800 text-lg capitalize">{cat.name}</h3>
                          <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                            <span className="flex items-center gap-1 bg-slate-100 px-2 py-0.5 rounded text-xs">Naročeno: <b className="text-slate-700">{cat.totalQty}x</b> ({cat.orderCount} pošiljk)</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 bg-slate-50 px-4 py-2 rounded-lg border border-slate-100">
                          <div className="text-right">
                            <div className="text-xs text-slate-400 uppercase tracking-wide">Povp. Cena</div>
                            <div className="font-bold text-slate-700">{fmt(cat.avgCny)} CNY</div>
                          </div>
                          <div className="w-px h-8 bg-slate-200"></div>
                          <div className="text-right">
                            <div className="text-xs text-slate-400 uppercase tracking-wide">Povp. Teža</div>
                            <div className="font-bold text-slate-700">{fmt(cat.avgWeight)} g</div>
                          </div>
                        </div>
                        <button 
                          onClick={() => addFromCatalog(cat)}
                          className="bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm flex items-center justify-center gap-2"
                        >
                          <Plus className="h-4 w-4"/> V osnutek
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* History Drawer */}
        {showHistory && (
          <section className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex justify-end z-[50]" onClick={() => setShowHistory(false)}>
            <div className="w-full max-w-xl bg-white h-full flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="font-bold text-slate-800 text-lg flex items-center gap-2"><History className="h-5 w-5 text-blue-600" />Shranjeni paketi</div>
                <button className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 text-sm font-medium" onClick={() => setShowHistory(false)}>Zapri</button>
              </div>
              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                {packages.length === 0 && <div className="text-center py-10 text-slate-500 text-sm">Ni še shranjenih paketov.</div>}
                {packages.map((p) => (
                  <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-blue-300 transition-colors shadow-sm">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-bold text-slate-800 text-base">{p.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{new Date(p.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-1" onClick={() => setPreviewPkg(p)}><Eye className="h-3.5 w-3.5" />Odpri</button>
                        <button className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" onClick={() => deletePackage(p.id)}><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <div><span className="text-slate-500">Skupaj:</span> <b className="text-slate-800">{fmt(p.derived.grandTogether)} €</b></div>
                      <div><span className="text-slate-500">Teža:</span> <b className="text-slate-800">{fmt(p.derived.totalWeight)} g</b></div>
                      <div><span className="text-slate-500">Poštnina:</span> <b className="text-slate-800">{fmt(p.derived.shippingEUR)} €</b></div>
                      <div><span className="text-slate-500">Profit:</span> <b className="text-indigo-600">{fmt(p.derived.rateProfit)} €</b></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* PREVIEW OVERLAY */}
        {previewPkg && (
          <section className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] flex justify-center items-center p-4 md:p-8" onClick={() => setPreviewPkg(null)}>
            <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full max-h-full flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div>
                  <div className="font-bold text-xl text-slate-800">{previewPkg.name}</div>
                  <div className="text-sm text-slate-500">{new Date(previewPkg.createdAt).toLocaleString()}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button className="rounded-xl bg-blue-600 text-white font-medium px-4 py-2 hover:bg-blue-700 shadow-sm" onClick={() => { loadPackageToDraft(previewPkg); }}>Naloži v osnutek (Uredi)</button>
                  <button className="rounded-xl bg-white border border-slate-200 text-slate-700 font-medium px-4 py-2 hover:bg-slate-100" onClick={() => setPreviewPkg(null)}>Zapri</button>
                </div>
              </div>
              <div className="overflow-y-auto p-5 bg-white">
                {/* Tukaj ostane obstoječi preview design... */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="font-bold text-slate-700 mb-2 border-b pb-1">Parametri paketa</div>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                      <div>Orig(B35): <b>{fmt(previewPkg.origRatio)}</b></div>
                      <div>Moj(E35): <b>{fmt(previewPkg.myRatio)}</b></div>
                      <div>USD/EUR: <b>{fmt(previewPkg.derived.usdPerEur)}</b></div>
                      <div>Poštnina: <b>{fmt(previewPkg.shippingCNY)} CNY</b></div>
                    </div>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <div className="font-bold text-slate-700 mb-2 border-b pb-1">Skupni seštevki</div>
                    <div className="grid grid-cols-2 gap-y-2 text-sm">
                      <div>Skupaj EUR: <b className="text-blue-700">{fmt(previewPkg.derived.grandTogether)} €</b></div>
                      <div>Skupna teža: <b>{fmt(previewPkg.derived.totalWeight)} g</b></div>
                      <div>Skupaj CNY: <b>{fmt(previewPkg.derived.totalCNY)}</b></div>
                      <div>Profit: <b className="text-indigo-600">{fmt(previewPkg.derived.rateProfit)} €</b></div>
                    </div>
                  </div>
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                      <tr>
                        <Th>Artikel</Th>
                        <Th className="text-right">Količina</Th>
                        <Th className="text-right">CNY</Th>
                        <Th className="text-right">EUR</Th>
                        <Th className="text-right">Teža</Th>
                        <Th className="text-right text-emerald-600">Poštnina</Th>
                        <Th className="text-right font-bold text-slate-800">Skupaj</Th>
                        <Th>Kdo</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {computeRows({ items: previewPkg.items, myRatio: previewPkg.myRatio, shippingCNY: previewPkg.shippingCNY, origRatio: previewPkg.origRatio }).map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50">
                          <Td className="font-medium text-slate-700">{r.artikel}</Td>
                          <Td className="text-right">{fmt(r.qty)}</Td>
                          <Td className="text-right">{fmt(r.cny)}</Td>
                          <Td className="text-right text-slate-500">{fmt(r.eur)}</Td>
                          <Td className="text-right">{fmt(r.weightTotal)}</Td>
                          <Td className="text-right text-emerald-600">{fmt(r.shipPart)}</Td>
                          <Td className="text-right font-bold text-slate-800">{fmt(r.together)} €</Td>
                          <Td><span className="bg-slate-200 px-2 py-0.5 rounded text-xs">{r.who}</span></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>
        )}

        <footer className="mt-12 text-center text-sm text-slate-400 font-medium">
          ACB Kalkulator • Katalog pošiljk • PDF Izvoz
        </footer>
      </div>
      <div ref={printRef} className="hidden" />
    </div>
  );
}

// ===== Small UI helpers =====
function Th({ children, className = "" }) {
  return <th className={`px-4 py-3 text-left text-xs font-bold uppercase tracking-wider ${className}`}>{children}</th>;
}
function Td({ children, className = "" }) {
  return <td className={`px-4 py-2 align-middle ${className}`}>{children}</td>;
}
function LabelInput({ label, value, onChange }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600 font-medium mb-1 block">{label}</span>
      <input type="number" inputMode="decimal" className="w-full rounded-xl border-slate-200 border px-3 py-2 focus:border-blue-400 focus:ring focus:ring-blue-100 transition-all shadow-sm" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ===== Utils =====
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function safe(v) { const n = Number(v); return !n || !Number.isFinite(n) ? 1 : n; }
function sum(arr) { return arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0); }
function fmt(n) { return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function uid() { return Math.random().toString(36).slice(2, 10); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function computeRows({ items, myRatio, shippingCNY, origRatio }) {
  const wTotal = items.reduce((acc, r) => acc + num(r.weight), 0) || 1;
  const shippingEUR = shippingCNY ? shippingCNY / safe(myRatio) : 0;
  const usdPerEur = safe(origRatio) / safe(myRatio);

  return items.map((r) => {
    const unitCNY = num(r.cny);
    const qty = Math.max(1, Math.floor(num(r.qty) || 1));
    const weightTot = num(r.weight);
    const cnyTotal = unitCNY * qty;
    const eur = cnyTotal / safe(myRatio);
    const shipPart = (weightTot / wTotal) * shippingEUR;
    const together = eur + shipPart;
    const regular = together / safe(usdPerEur);
    const profit = together - regular;
    const weightPct = (weightTot / wTotal) * 100;
    return { ...r, qty, eur, shipPart, together, regular, profit, weightPct, weightTotal: weightTot, cnyTotal };
  });
}
