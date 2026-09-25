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
  if (ext === "zip") return "ZIP";
  if (ext === "docx") return "DOCX";
  if (ext === "eml") return "EML";
  if (ext === "json") return "JSON";
  if (["html", "htm"].includes(ext)) return "HTML";
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

const decodeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// ZIP-Archiv → einzelne Dateien (nutzt den ZIP-Leser von SheetJS)
export async function unzip(file) {
  const X = await getXlsx();
  const cfb = X.CFB.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  return cfb.FileIndex
    .map((e, i) => ({ e, path: cfb.FullPaths[i] }))
    .filter(({ e, path }) => e.type === 2 && e.content?.length && !/(^|\/)(__MACOSX|\.|\x01)/.test(path.replace(/^Root Entry\//, "")))
    .map(({ e, path }) => new File([e.content], path.split("/").pop(), { lastModified: Date.now() }))
    .filter((f) => fileKind(f.name) !== "ZIP" && !/^truth\.json$/i.test(f.name));
}

// DOCX: Absaetze als Textzeilen, Tabellen als eigene Tabellen (erste Zeile = Kopf)
async function parseDocx(buf) {
  const X = await getXlsx();
  const cfb = X.CFB.read(new Uint8Array(buf), { type: "array" });
  const entry = X.CFB.find(cfb, "/word/document.xml");
  if (!entry) throw new Error("word/document.xml fehlt");
  const xml = new TextDecoder().decode(entry.content);
  const text = (frag) => decodeXml([...frag.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
  const sheets = [];
  const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows = (tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map((tr) => (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(text));
    if (rows.length) sheets.push({ name: `Tabelle ${sheets.length + 1}`, header: rows[0].map((h, i) => h.trim() || `Spalte ${i + 1}`), rows: rows.slice(1).filter((r) => r.some((c) => c.trim())) });
    return "";
  });
  const lines = (body.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(text);
  return { lines, sheets };
}

// E-Mail (.eml): Kopfzeilen als Metadaten, Text-Teil als Zeilen
function parseEml(raw) {
  const [head, ...rest] = raw.split(/\r?\n\r?\n/);
  const hdr = {};
  head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach((l) => { const m = /^([\w-]+):\s*(.*)$/.exec(l); if (m) hdr[m[1].toLowerCase()] = m[2]; });
  let body = rest.join("\n\n");
  const boundary = /boundary="?([^";]+)"?/i.exec(hdr["content-type"] || "")?.[1];
  let enc = hdr["content-transfer-encoding"] || "";
  if (boundary) {
    const part = body.split("--" + boundary).find((p) => /content-type:\s*text\/plain/i.test(p)) || "";
    const [ph, ...pb] = part.split(/\r?\n\r?\n/);
    enc = /content-transfer-encoding:\s*(\S+)/i.exec(ph)?.[1] || "";
    body = pb.join("\n\n");
  }
  if (/quoted-printable/i.test(enc)) body = new TextDecoder().decode(new Uint8Array([...body.replace(/=\r?\n/g, "").matchAll(/=([0-9A-F]{2})|[\s\S]/gi)].map((m) => (m[1] ? parseInt(m[1], 16) : m[0].charCodeAt(0)))));
  else if (/base64/i.test(enc)) body = new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
  const d = hdr.date ? new Date(hdr.date) : null;
  const clean = (s) => (s || "").replace(/.*<([^>]+)>.*/, "$1").trim();
  const meta = { von: clean(hdr.from), an: clean(hdr.to), betreff: hdr.subject || "", date: d && !isNaN(d) ? d : null };
  return { lines: [`Betreff: ${meta.betreff}`, ...body.split(/\r?\n/)], meta };
}

// JSON: Liste von Objekten (auch verschachtelt unter einem Schluessel) → Tabelle
function parseJson(raw) {
  let data = JSON.parse(raw);
  if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray) || [data];
  const flat = data.map((o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === "object" ? JSON.stringify(v) : v])) : { wert: o }));
  const header = [...new Set(flat.flatMap(Object.keys))];
  return [{ name: "daten", header, rows: flat.map((o) => header.map((h) => o[h] ?? "")) }];
}

function htmlToLines(raw) {
  const doc = new DOMParser().parseFromString(raw, "text/html");
  doc.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
  doc.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,br,td,th").forEach((n) => n.append("\n"));
  return doc.body.textContent.split(/\n/).map((l) => l.replace(/\s+/g, " ").trim());
}

export async function parseFile(file, onStatus) {
  const kind = fileKind(file.name);
  const buf = await file.arrayBuffer();
  const txt = () => new TextDecoder().decode(buf);
  if (kind === "TXT") return { kind, pages: [{ page: 1, lines: txt().split(/\r?\n/) }], buf };
  if (kind === "DOCX") { const d = await parseDocx(buf); return { kind, pages: [{ page: 1, lines: d.lines }], sheets: d.sheets, buf }; }
  if (kind === "HTML") return { kind, pages: [{ page: 1, lines: htmlToLines(txt()) }], buf };
  if (kind === "EML") { const { lines, meta } = parseEml(txt()); return { kind, pages: [{ page: 1, lines }], meta, buf }; }
  if (kind === "JSON") return { kind, sheets: parseJson(txt()), buf };
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
  const wb = kind === "CSV" ? X.read(new TextDecoder().decode(buf), { type: "string", raw: true }) : X.read(buf, { cellDates: true });
  const sheets = wb.SheetNames.map((name) => {
    const aoa = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    const header = (aoa[0] || []).map((h, i) => String(h || `Spalte ${i + 1}`).trim());
    return { name, header, rows: aoa.slice(1).filter((r) => r.some((c) => c !== "")) };
  });
  return { kind, sheets, buf };
}
