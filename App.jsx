import React, { useMemo, useRef, useState, useEffect } from "react";
import { Download, Plus, Trash2, Save, History, FileDown, Users, Settings, PackageSearch } from "lucide-react";

export default function App() {
  const [items, setItems] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_ITEMS");
    return saved ? JSON.parse(saved) : [
      { id: uid(), artikel: "", cny: "", weight: "", who: "" },
    ];
  });

  const [people, setPeople] = useState(() => {
    const saved = localStorage.getItem("RACUN_DRAFT_PEOPLE");
    return saved ? JSON.parse(saved) : ["miha", "živa", "andreja"];
  });

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

  const [packages, setPackages] = useState(() => {
    const saved = localStorage.getItem("RACUN_PACKAGES");
    return saved ? JSON.parse(saved) : [];
  });
  const [pkgName, setPkgName] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { localStorage.setItem("RACUN_DRAFT_ITEMS", JSON.stringify(items)); }, [items]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_PEOPLE", JSON.stringify(people)); }, [people]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_ORIGRATIO", String(origRatio)); }, [origRatio]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_MYRATIO", String(myRatio)); }, [myRatio]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_SHIPCNY", String(shippingCNY)); }, [shippingCNY]);
  useEffect(() => { localStorage.setItem("RACUN_DRAFT_RECEIVED", JSON.stringify(receivedMap)); }, [receivedMap]);

  const totalWeight = useMemo(() => sum(items.map((r) => num(r.weight))), [items]);
  const totalCNY = useMemo(() => sum(items.map((r) => num(r.cny))), [items]);
  const shippingEUR = useMemo(() => (shippingCNY ? shippingCNY / safe(myRatio) : 0), [shippingCNY, myRatio]);

  const usdPerEur = useMemo(() => safe(origRatio) / safe(myRatio), [origRatio, myRatio]);

  const rateProfit = useMemo(() => {
    const eurAll = totalCNY / safe(myRatio);
    const usdAll = totalCNY / safe(origRatio);
    return eurAll - usdAll;
  }, [totalCNY, myRatio, origRatio]);

  const computedRows = useMemo(() => {
    const wTotal = totalWeight || 1;
    return items.map((r) => {
      const cny = num(r.cny);
      const weight = num(r.weight);
      const eur = cny / safe(myRatio);
      const shipPart = (weight / wTotal) * shippingEUR;
      const together = eur + shipPart;
      const regular = together / safe(usdPerEur);
      const profit = together - regular;
      const weightPct = wTotal ? (weight / wTotal) * 100 : 0;
      return { ...r, eur, shipPart, together, regular, profit, weightPct };
    });
  }, [items, myRatio, shippingEUR, totalWeight, usdPerEur]);

  const summaryByPerson = useMemo(() => {
    const map = new Map();
    for (const p of people) map.set(p, 0);
    for (const row of computedRows) {
      const key = row.who?.trim();
      if (!key) continue;
      map.set(key, safe(map.get(key)) + row.together);
    }
    const arr = people.map((p) => {
      const eur = safe(map.get(p));
      const minimum = eur / safe(usdPerEur);
      const received = num(receivedMap[p]);
      const due = eur - received;
      return { who: p, eur, minimum, received, due };
    });
    return arr;
  }, [people, computedRows, usdPerEur, receivedMap]);

  const grandTogether = useMemo(() => sum(computedRows.map((r) => r.together)), [computedRows]);

  const addRow = () => setItems((s) => [...s, { id: uid(), artikel: "", cny: "", weight: "", who: people[0] || "" }]);
  const delRow = (id) => setItems((s) => s.filter((r) => r.id !== id));
  const updateRow = (id, k, v) => setItems((s) => s.map((r) => (r.id === id ? { ...r, [k]: v } : r)));

  const addPerson = () => setPeople((s) => [...s, ""]);
  const delPerson = (idx) => {
    const name = people[idx];
    setPeople((s) => s.filter((_, i) => i !== idx));
    setItems((s) => s.map((r) => (r.who === name ? { ...r, who: "" } : r)));
    setReceivedMap((m) => { const n = { ...m }; delete n[name]; return n; });
  };

  const savePackage = () => {
    const name = pkgName?.trim() || `Paket ${new Date().toLocaleString()}`;
    const payload = {
      id: uid(), name, createdAt: new Date().toISOString(),
      items, people, origRatio, myRatio, shippingCNY,
      derived: { totalWeight, totalCNY, shippingEUR, usdPerEur, rateProfit, grandTogether, summaryByPerson },
    };
    const next = [payload, ...packages];
    setPackages(next);
    localStorage.setItem("RACUN_PACKAGES", JSON.stringify(next));
    setPkgName("");
  };

  const deletePackage = (id) => {
    const next = packages.filter((p) => p.id !== id);
    setPackages(next);
    localStorage.setItem("RACUN_PACKAGES", JSON.stringify(next));
  };

  const [exportSelection, setExportSelection] = useState({ all: true, who: [] });
  const printRef = useRef(null);

  const handleExportPDF = async () => {
    const { jsPDF } = await import("jspdf");
    const html2canvas = (await import("html2canvas")).default;

    const selectedWho = exportSelection.all ? people.filter(Boolean) : exportSelection.who;
    if (!selectedWho.length) return alert("Izberi vsaj eno osebo ali ALL");

    const printable = document.createElement("div");
    printable.style.padding = "24px";
    printable.style.width = "794px";
    printable.style.background = "white";
    printable.style.color = "black";

    const header = document.createElement("div");
    header.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <div style="font-size:20px;font-weight:700;">Račun / Povzetek</div>
        <div style="font-size:12px;opacity:0.8;">Ustvarjeno: ${new Date().toLocaleString()}</div>
      </div>
      <div style="text-align:right;font-size:12px;">
        <div><b>Tečaji:</b> Orig(B35)=${fmt(origRatio)} | Moj(E35)=${fmt(myRatio)} | USD/EUR(G35)=${fmt(usdPerEur)}</div>
        <div><b>Poštnina:</b> ${fmt(shippingCNY)} CNY = ${fmt(shippingEUR)} EUR</div>
      </div>
    </div>`;
    printable.appendChild(header);

    for (const who of selectedWho) {
      const rows = computedRows.filter((r) => r.who?.trim() === who);
      const subTotal = rows.reduce((a, r) => a + r.together, 0);
      const received = num(receivedMap[who]);
      const due = subTotal - received;

      const section = document.createElement("div");
      section.style.marginBottom = "24px";
      section.innerHTML = `
        <div style="font-weight:700;font-size:16px;margin:8px 0 4px;">${esc(who)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="border-bottom:1px solid #ddd;text-align:left;padding:6px;">Artikel</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">CNY</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">EUR</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Teža (g)</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Poštnina EUR</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Skupaj EUR</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Redna</th>
              <th style="border-bottom:1px solid #ddd;text-align:right;padding:6px;">Profit</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
                <tr>
                  <td style="border-bottom:1px solid #f0f0f0;padding:6px;">${esc(r.artikel)}</td>
                  <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.cny)}</td>
                  <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.eur)}</td>
                  <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.weight)}</td>
                  <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.shipPart)}</td>
                  <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.together)}</td>
                  <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.regular)}</td>
                  <td style="border-bottom:1px solid #f0f0f0;text-align:right;padding:6px;">${fmt(r.profit)}</td>
                </tr>`).join("")}
          </tbody>
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

    document.body.appendChild(printable);
    const canvas = await html2canvas(printable, { scale: 2 });
    document.body.removeChild(printable);

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let y = 0;
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
        if (y > 0) pdf.addPage();
        pdf.addImage(pageData, "PNG", 0, 0, pageWidth, pageHeight);
        remainingHeight -= pageHeight;
        sY += pxPageHeight;
        y += pageHeight;
      }
    }

    pdf.save(`racun_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.pdf`);
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
            <button onClick={() => setShowHistory(v=>!v)} className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-sm hover:bg-neutral-100"><History className="h-4 w-4"/>Zgodovina</button>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center gap-2 font-semibold mb-2"><Settings className="h-4 w-4"/>Tečaji</div>
            <LabelInput label="Original razmerje (B35, CNY/USD)" value={origRatio} onChange={(v)=> setOrigRatio(num(v))}/>
            <LabelInput label="Moj tečaj (E35, CNY/EUR)" value={myRatio} onChange={(v)=> setMyRatio(num(v))}/>
            <div className="text-sm text-neutral-600 mt-2">G35 (USD/EUR) = B35 / E35 = <b>{fmt(usdPerEur)}</b></div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center gap-2 font-semibold mb-2"><PackageSearch className="h-4 w-4"/>Poštnina</div>
            <LabelInput label="Poštnina (CNY, B41)" value={shippingCNY} onChange={(v)=> setShippingCNY(num(v))}/>
            <div className="text-sm text-neutral-600 mt-2">Poštnina EUR = <b>{fmt(shippingEUR)}</b></div>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center gap-2 font-semibold mb-2"><Users className="h-4 w-4"/>Osebe</div>
            <div className="space-y-2">
              {people.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input className="flex-1 rounded-xl border px-3 py-2" value={p} onChange={(e)=> setPeople((s)=> s.map((v,idx)=> idx===i ? e.target.value : v ))} placeholder={`oseba #${i+1}`}/>
                  <button className="p-2 text-red-600 hover:bg-red-50 rounded-xl" onClick={()=> delPerson(i)}><Trash2 className="h-4 w-4"/></button>
                </div>
              ))}
            </div>
            <button onClick={addPerson} className="mt-2 text-sm text-neutral-700 hover:underline">+ Dodaj osebo</button>
          </div>
        </section>

        <section className="mt-6 rounded-2xl bg-white shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-100 text-neutral-700">
                <tr>
                  <Th>Artikel</Th>
                  <Th className="text-right">CNY</Th>
                  <Th className="text-right">EUR</Th>
                  <Th className="text-right">Teža (g)</Th>
                  <Th className="text-right">Teža (%)</Th>
                  <Th className="text-right">Poštnina EUR</Th>
                  <Th className="text-right">Skupaj EUR</Th>
                  <Th className="text-right">Redna</Th>
                  <Th className="text-right">Profit</Th>
                  <Th>Kdo</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {computedRows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <Td>
                      <input className="w-full rounded-xl border px-3 py-2" value={r.artikel} onChange={(e)=> updateRow(r.id, "artikel", e.target.value)} placeholder="npr. pulover"/>
                    </Td>
                    <Td className="text-right">
                      <input type="number" inputMode="decimal" className="w-28 rounded-xl border px-3 py-2 text-right" value={r.cny} onChange={(e)=> updateRow(r.id, "cny", e.target.value)} placeholder="CNY"/>
                    </Td>
                    <Td className="text-right tabular-nums">{fmt(r.eur)}</Td>
                    <Td className="text-right">
                      <input type="number" inputMode="decimal" className="w-28 rounded-xl border px-3 py-2 text-right" value={r.weight} onChange={(e)=> updateRow(r.id, "weight", e.target.value)} placeholder="g"/>
                    </Td>
                    <Td className="text-right tabular-nums">{fmt(r.weightPct)}%</Td>
                    <Td className="text-right tabular-nums">{fmt(r.shipPart)}</Td>
                    <Td className="text-right font-medium tabular-nums">{fmt(r.together)}</Td>
                    <Td className="text-right tabular-nums">{fmt(r.regular)}</Td>
                    <Td className="text-right tabular-nums">{fmt(r.profit)}</Td>
                    <Td>
                      <select className="w-36 rounded-xl border px-3 py-2" value={r.who || ""} onChange={(e)=> updateRow(r.id, "who", e.target.value)}>
                        <option value="">—</option>
                        {people.filter(Boolean).map((p)=> <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Td>
                    <Td className="text-right">
                      <button onClick={()=> delRow(r.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-xl"><Trash2 className="h-4 w-4"/></button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-4 p-4 text-sm text-neutral-700 bg-neutral-50">
            <span><b>Skupna teža:</b> {fmt(totalWeight)} g</span>
            <span><b>Skupaj CNY:</b> {fmt(totalCNY)}</span>
            <span><b>Poštnina EUR:</b> {fmt(shippingEUR)}</span>
            <span><b>G35 (USD/EUR):</b> {fmt(usdPerEur)}</span>
            <span><b>Skupaj EUR:</b> {fmt(grandTogether)}</span>
            <span><b>"Zaslužek" (tečajna razlika):</b> {fmt(rateProfit)}</span>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4"/>Povzetek po osebi</div>
              <div className="text-sm text-neutral-600">Minimum = EUR / G35</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-neutral-100 text-neutral-700">
                  <tr>
                    <Th>Kdo</Th>
                    <Th className="text-right">EUR (Skupaj)</Th>
                    <Th className="text-right">Minimum</Th>
                    <Th className="text-right">Prejeto</Th>
                    <Th className="text-right">Dolžan</Th>
                  </tr>
                </thead>
                <tbody>
                  {summaryByPerson.map((r) => (
                    <tr key={r.who} className="border-b last:border-0">
                      <Td className="font-medium">{r.who}</Td>
                      <Td className="text-right tabular-nums">{fmt(r.eur)}</Td>
                      <Td className="text-right tabular-nums">{fmt(r.minimum)}</Td>
                      <Td className="text-right">
                        <input type="number" inputMode="decimal" className="w-28 rounded-xl border px-3 py-2 text-right" value={receivedMap[r.who] ?? ""} onChange={(e)=> setReceivedMap((m)=> ({...m, [r.who]: e.target.value}))} placeholder="EUR"/>
                      </Td>
                      <Td className={`text-right tabular-nums ${r.eur - num(receivedMap[r.who]) > 0 ? "text-red-600" : "text-green-700"}`}>{fmt(r.due)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow">
            <div className="font-semibold mb-2 flex items-center gap-2"><FileDown className="h-4 w-4"/>Export & Shrani</div>
            <div className="space-y-3">
              <div className="rounded-xl border p-3">
                <div className="text-sm font-medium mb-2">PDF Export</div>
                <div className="flex items-center gap-4 mb-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={exportSelection.all} onChange={(e)=> setExportSelection((s)=> ({...s, all: e.target.checked}))}/>
                    <span>Vsi</span>
                  </label>
                </div>
                {!exportSelection.all && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {people.filter(Boolean).map((p)=> (
                      <label key={p} className="inline-flex items-center gap-2 border rounded-xl px-2 py-1">
                        <input type="checkbox" checked={exportSelection.who.includes(p)} onChange={(e)=> setExportSelection((s)=> ({...s, who: e.target.checked ? [...s.who, p] : s.who.filter((x)=> x!==p)}))}/>
                        <span>{p}</span>
                      </label>
                    ))}
                  </div>
                )}
                <button onClick={handleExportPDF} className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-sm hover:bg-neutral-100"><Download className="h-4 w-4"/>Export PDF</button>
              </div>

              <div className="rounded-xl border p-3">
                <div className="text-sm font-medium mb-2">Shrani paket</div>
                <div className="flex items-center gap-2">
                  <input className="flex-1 rounded-xl border px-3 py-2" placeholder="ime paketa (npr. avgust-2025)" value={pkgName} onChange={(e)=> setPkgName(e.target.value)}/>
                  <button onClick={savePackage} className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-sm hover:bg-neutral-100"><Save className="h-4 w-4"/>Shrani</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <footer className="mt-10 text-center text-xs text-neutral-500">
          Zgrajeno za Jakoba • Excel-parity izračuni • Lokalno shranjevanje • PDF export (ALL ali po osebah)
        </footer>
      </div>

      <div ref={printRef} className="hidden"/>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (<th className={`px-3 py-2 text-left text-xs font-semibold ${className}`}>{children}</th>);
}
function Td({ children, className = "" }) {
  return (<td className={`px-3 py-2 align-top ${className}`}>{children}</td>);
}
function LabelInput({ label, value, onChange }) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-700">{label}</span>
      <input type="number" inputMode="decimal" className="mt-1 w-full rounded-xl border px-3 py-2" value={value} onChange={(e)=> onChange(e.target.value)} />
    </label>
  );
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function safe(v) { const n = Number(v); return !n || !Number.isFinite(n) ? 1 : n; }
function sum(arr) { return arr.reduce((a,b)=> a + (Number.isFinite(b)? b : 0), 0); }
function fmt(n) { return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function uid() { return Math.random().toString(36).slice(2, 10); }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c)=> ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

export { }
