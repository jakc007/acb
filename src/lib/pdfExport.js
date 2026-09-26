import { formatNumber, safeDivisor, toNumber } from "./calculations.js";

const fmt = formatNumber;

export async function exportPdf({
  mode,
  selectedPeople,
  computedRows,
  receivedMap,
  personOpts,
  invPrefix,
  invCounter,
  origRatio,
  myRatio,
  shippingCNY,
  metrics,
}) {
  if (!selectedPeople.length) throw new Error("Izberi vsaj eno osebo za izvoz.");

  const { jsPDF } = await import("jspdf");
  const html2canvas = (await import("html2canvas")).default;
  const pdf = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });

  if (mode === "interno") {
    await renderInternalSummary({
      pdf,
      html2canvas,
      selectedPeople,
      computedRows,
      receivedMap,
      origRatio,
      myRatio,
      shippingCNY,
      metrics,
    });
  } else {
    await renderCustomerInvoices({
      pdf,
      html2canvas,
      selectedPeople,
      computedRows,
      personOpts,
      invPrefix,
      invCounter,
      metrics,
    });
  }

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  pdf.save(`acb_${mode}_${timestamp}.pdf`);
  return mode === "stranka" ? invCounter + selectedPeople.length : invCounter;
}

async function renderInternalSummary({
  pdf,
  html2canvas,
  selectedPeople,
  computedRows,
  receivedMap,
  origRatio,
  myRatio,
  shippingCNY,
  metrics,
}) {
  const printable = createPrintable();
  printable.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:22px;">
      <div>
        <div style="font-size:11px;font-weight:800;letter-spacing:.16em;color:#0f766e;text-transform:uppercase;">ACB · interni pregled</div>
        <div style="font-size:26px;font-weight:800;margin-top:6px;color:#0f172a;">Povzetek pošiljke</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">Ustvarjeno ${escapeHtml(new Date().toLocaleString("sl-SI"))}</div>
      </div>
      <div style="font-size:11px;line-height:1.65;text-align:right;color:#475569;">
        <div><b>Originalni tečaj:</b> ${fmt(origRatio)}</div>
        <div><b>Moj tečaj:</b> ${fmt(myRatio)}</div>
        <div><b>USD/EUR:</b> ${fmt(metrics.usdPerEur)}</div>
        <div><b>Poštnina:</b> ${fmt(shippingCNY)} CNY · ${fmt(metrics.shippingEUR)} EUR</div>
      </div>
    </div>`;

  selectedPeople.forEach((who) => {
    const rows = computedRows.filter((row) => (row.who || "").trim() === who);
    const person = metrics.summaryByPerson.find((entry) => entry.who === who);
    const subtotal = person?.charge ?? rows.reduce((total, row) => total + row.together, 0);
    const cost = rows.reduce((total, row) => total + row.regular, 0);
    const received = toNumber(receivedMap[who]);
    const section = document.createElement("section");
    section.style.marginBottom = "24px";
    section.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#f0fdfa;border-radius:10px 10px 0 0;border:1px solid #ccfbf1;">
        <div style="font-size:15px;font-weight:800;color:#134e4a;">${escapeHtml(who)}</div>
        <div style="font-size:12px;color:#0f766e;">${rows.length} postavk</div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:10px;border:1px solid #e2e8f0;border-top:0;">
        <thead><tr style="background:#f8fafc;color:#64748b;">
          ${["Artikel", "Kol.", "Teža", "CNY", "EUR", "Poštnina", "Skupaj", "Redna", "Razlika"].map((label) => `<th style="padding:7px;text-align:${label === "Artikel" ? "left" : "right"};border-bottom:1px solid #e2e8f0;">${label}</th>`).join("")}
        </tr></thead>
        <tbody>${rows.map((row) => `
          <tr>
            <td style="padding:7px;border-bottom:1px solid #f1f5f9;">${escapeHtml(row.artikel || "Artikel")}</td>
            ${[row.qty, row.weightTotal, row.cnyTotal, row.eur, row.shipPart, row.together, row.regular, row.profit].map((value) => `<td style="padding:7px;text-align:right;border-bottom:1px solid #f1f5f9;">${fmt(value)}</td>`).join("")}
          </tr>`).join("")}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;gap:18px;padding:9px 2px 0;font-size:11px;color:#475569;">
        <span>Nabava <b>${fmt(cost)} €</b></span>
        <span>Profit <b>${fmt(received - cost)} €</b></span>
        <span>Prejeto <b>${fmt(received)} €</b></span>
        <span>Skupaj <b>${fmt(subtotal)} €</b></span>
        <span>Dolg <b style="color:${subtotal - received > 0 ? "#dc2626" : "#059669"};">${fmt(subtotal - received)} €</b></span>
      </div>`;
    printable.appendChild(section);
  });

  const footer = document.createElement("div");
  footer.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;border-top:2px solid #0f172a;padding-top:14px;margin-top:6px;">
      ${metric("Skupna teža", `${fmt(metrics.totalWeight)} g`)}
      ${metric("Vrednost", `${fmt(metrics.totalCNY)} CNY`)}
      ${metric("Skupaj", `${fmt(metrics.grandTogether)} €`)}
      ${metric("Skupen profit paketa", `${fmt(metrics.totalProfitReceived)} €`)}
    </div>`;
  printable.appendChild(footer);
  await addPrintableToPdf(pdf, html2canvas, printable, false);
}

async function renderCustomerInvoices({
  pdf,
  html2canvas,
  selectedPeople,
  computedRows,
  personOpts,
  invPrefix,
  invCounter,
  metrics,
}) {
  for (let index = 0; index < selectedPeople.length; index += 1) {
    const who = selectedPeople[index];
    const rows = computedRows.filter((row) => (row.who || "").trim() === who);
    const subtotal = rows.reduce((total, row) => total + row.together, 0);
    const options = personOpts[who] || { fee: 1, mode: "eur" };
    const base = options.mode === "redna" ? subtotal / safeDivisor(metrics.usdPerEur) : subtotal;
    const charge = base * (Number(options.fee) || 1);
    const scale = subtotal > 0 ? charge / subtotal : 1;
    const invoiceNumber = `${invPrefix}${String(invCounter + index).padStart(3, "0")}`;
    const printable = createPrintable();

    printable.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:42px;">
        <div>
          <div style="display:inline-block;background:#0f766e;color:white;border-radius:10px;padding:10px 13px;font-size:16px;font-weight:900;letter-spacing:.05em;">ACB</div>
          <div style="font-size:12px;color:#64748b;margin-top:10px;">Pregleden obračun naročila</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:27px;font-weight:800;color:#0f172a;">Račun</div>
          <div style="font-size:12px;color:#475569;margin-top:5px;">${escapeHtml(invoiceNumber)}</div>
          <div style="font-size:12px;color:#475569;">${escapeHtml(new Date().toLocaleDateString("sl-SI"))}</div>
        </div>
      </div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.12em;font-weight:700;">Prejemnik</div>
      <div style="font-size:19px;font-weight:800;color:#0f172a;margin:6px 0 25px;">${escapeHtml(who)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#f1f5f9;color:#475569;">
          <th style="padding:10px;text-align:left;border-bottom:1px solid #cbd5e1;">Artikel</th>
          <th style="padding:10px;text-align:right;border-bottom:1px solid #cbd5e1;">Količina</th>
          <th style="padding:10px;text-align:right;border-bottom:1px solid #cbd5e1;">Cena/kos</th>
          <th style="padding:10px;text-align:right;border-bottom:1px solid #cbd5e1;">Skupaj</th>
        </tr></thead>
        <tbody>${rows.map((row) => {
          const qty = toNumber(row.qty) || 1;
          const rowTotal = row.together * scale;
          return `<tr>
            <td style="padding:10px;border-bottom:1px solid #e2e8f0;">${escapeHtml(row.artikel || "Artikel")}</td>
            <td style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;">${fmt(qty)}</td>
            <td style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;">${fmt(rowTotal / qty)} €</td>
            <td style="padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;font-weight:700;">${fmt(rowTotal)} €</td>
          </tr>`;
        }).join("")}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:20px;">
        <div style="width:270px;background:#0f172a;color:white;border-radius:12px;padding:17px 19px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:12px;color:#cbd5e1;">ZA PLAČILO</span>
          <strong style="font-size:20px;">${fmt(charge)} €</strong>
        </div>
      </div>
      <div style="font-size:10px;color:#64748b;margin-top:24px;">V znesku je vključena proporcionalna poštnina.</div>`;

    await addPrintableToPdf(pdf, html2canvas, printable, index > 0);
  }
}

function createPrintable() {
  const node = document.createElement("div");
  Object.assign(node.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "794px",
    padding: "42px",
    background: "#ffffff",
    color: "#0f172a",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
    boxSizing: "border-box",
  });
  return node;
}

async function addPrintableToPdf(pdf, html2canvas, node, startNewPage) {
  document.body.appendChild(node);
  let canvas;
  try {
    canvas = await html2canvas(node, { scale: 2, backgroundColor: "#ffffff", logging: false });
  } finally {
    node.remove();
  }

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pixelsPerPage = Math.floor((canvas.width * pageHeight) / pageWidth);
  if (startNewPage) pdf.addPage();

  for (let offset = 0; offset < canvas.height; offset += pixelsPerPage) {
    if (offset > 0) pdf.addPage();
    const sliceHeight = Math.min(pixelsPerPage, canvas.height - offset);
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = sliceHeight;
    slice.getContext("2d").drawImage(canvas, 0, offset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
    const renderedHeight = (sliceHeight * pageWidth) / canvas.width;
    pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, pageWidth, renderedHeight);
  }
}

function metric(label, value) {
  return `<div><div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">${label}</div><div style="font-size:14px;font-weight:800;color:#0f172a;margin-top:3px;">${value}</div></div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
