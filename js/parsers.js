// Datei → Rohinhalt. Bibliotheken liegen lokal unter /vendor und werden erst bei Bedarf geladen.

const base = new URL("../vendor/", import.meta.url).href;
let pdfjs, XLSX, tess;

async function getPdf() {
  if (!pdfjs) {
    pdfjs = await import(base + "pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = base + "pdfjs/pdf.worker.min.mjs";
  }
  return pdfjs;
}
async function getXlsx() { return (XLSX ||= await import(base + "xlsx/xlsx.mjs")); }
function getTesseract() {
  if (tess) return tess;
  tess = new Promise((res, rej) => {
    const s = Object.assign(document.createElement("script"), { src: base + "tesseract/tesseract.min.js" });
    s.onload = () => res(window.Tesseract);
    s.onerror = () => rej(new Error("Tesseract konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
  return tess;
}

export async function ocrImage(image, onStatus) {
  const T = await getTesseract();
  onStatus?.("OCR läuft (Tesseract, deutsch) …");
  const worker = await T.createWorker("deu", 1, {
    workerPath: base + "tesseract/worker.min.js",
    corePath: base + "tesseract/core",
    langPath: base + "tesseract/lang",
    gzip: true,
  });
  const { data } = await worker.recognize(image);
  await worker.terminate();
  return { text: data.text, confidence: data.confidence / 100 };
}

export function fileKind(name) {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "pdf") return "PDF";
  if (["xlsx", "xls", "xlsm", "ods"].includes(ext)) return "XLSX";
  if (ext === "csv") return "CSV";
  if (["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"].includes(ext)) return "IMG";
  return "TXT";
}

// Zeilen aus pdf.js-Textelementen rekonstruieren (gleiche y-Position = gleiche Zeile).
function itemsToLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.transform[5]), x = it.transform[4];
    let row = rows.find((r) => Math.abs(r.y - y) <= 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: it.str });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim());
}

export async function parseFile(file, onStatus) {
  const kind = fileKind(file.name);
  const buf = await file.arrayBuffer();
  if (kind === "TXT") return { kind, pages: [{ page: 1, lines: new TextDecoder().decode(buf).split(/\r?\n/) }], buf };
  if (kind === "IMG") {
    const { text, confidence } = await ocrImage(new Blob([buf]), onStatus);
    return { kind, pages: [{ page: 1, lines: text.split(/\r?\n/) }], ocr: true, ocrConfidence: confidence, buf };
  }
  if (kind === "PDF") {
    const lib = await getPdf();
    const doc = await lib.getDocument({ data: buf.slice(0) }).promise;
    const pages = [];
    let ocr = false;
    for (let p = 1; p <= doc.numPages; p++) {
      onStatus?.(`PDF Seite ${p}/${doc.numPages} …`);
      const page = await doc.getPage(p);
      let lines = itemsToLines((await page.getTextContent()).items);
      if (lines.join("").trim().length < 20) {
        // Gescanntes PDF ohne Textebene → Seite rendern und OCR
        const vp = page.getViewport({ scale: 2 });
        const canvas = Object.assign(document.createElement("canvas"), { width: vp.width, height: vp.height });
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        lines = (await ocrImage(canvas, onStatus)).text.split(/\r?\n/);
        ocr = true;
      }
      pages.push({ page: p, lines });
    }
    return { kind, pages, ocr, buf };
  }
  // XLSX / CSV
  const X = await getXlsx();
  const wb = kind === "CSV" ? X.read(new TextDecoder().decode(buf), { type: "string", cellDates: true }) : X.read(buf, { cellDates: true });
  const sheets = wb.SheetNames.map((name) => {
    const aoa = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    const header = (aoa[0] || []).map((h, i) => String(h || `Spalte ${i + 1}`).trim());
    return { name, header, rows: aoa.slice(1).filter((r) => r.some((c) => c !== "")) };
  });
  return { kind, sheets, buf };
}
