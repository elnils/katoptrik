// Auswertung gegen Ground Truth: laedt das grosse synthetische Szenario im Browser
// und misst Importzeit, Zeitnormalisierung je Zeile und Erkennung der Vorfaelle.
// Aufruf: npx http-server -p 8765 . & node tests/eval.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:8765/";
const MIN = { zeit_genau: 0.85, zeit_toleranz: 0.9, vorfaelle_erkannt: 7 / 8 };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await page.goto(BASE);
await page.click("#btnDemo");
await page.click('[data-scen="grosslage-ostsee"]');
await page.waitForFunction(() => document.querySelector("#progress")?.textContent.includes("Fertig"), null, { timeout: 600000 });

const r = await page.evaluate(async () => {
  const { app } = await import("./js/ctx.js");
  const s = app.state;
  const truth = await (await fetch("samples/grosslage-ostsee/truth.json")).json();
  const lauf = s.audit.find((e) => e.action === "IMPORT-LAUF")?.detail;
  const src = Object.fromEntries(s.sources.map((q) => [q.name, q.id]));
  const obsT = s.tables.find((t) => t.kind === "observations").id;
  const byLoc = new Map(s.rows.filter((x) => x.table_id === obsT).map((x) => [`${x.source_id}|${x.loc}`, x]));
  const toMin = (d, t) => Date.parse(`${d}T${t}:00Z`) / 60000;
  let exact = 0, tol = 0, found = 0;
  const fehler = [];
  for (const z of truth.zeilen) {
    const row = byLoc.get(`${src[z.file]}|${z.loc}`);
    if (!row) { fehler.push(`fehlt: ${z.file} ${z.loc}`); continue; }
    found++;
    const d = row.data.datum && row.data.zeit ? Math.abs(toMin(row.data.datum, row.data.zeit) - toMin(z.date, z.time)) : Infinity;
    if (d === 0) exact++;
    if (d <= Math.max(z.tolerance_min, 1)) tol++; else fehler.push(`${z.file} ${z.loc}: ${row.data.datum} ${row.data.zeit} statt ${z.date} ${z.time} („${row.data.text.slice(0, 60)}“)`);
  }
  const a = s.analyses.find((x) => x.type === "lagebild" && x.status !== "superseded");
  const strong = a.result.events.filter((e) => e.sources.length >= 2);
  const hits = truth.vorfaelle.map((v) => {
    const t0 = Date.parse(v.start.replace(" ", "T") + ":00Z") / 60000;
    const e = strong.find((e) => e.start <= t0 + v.dauer_min + 10 && e.end >= t0 - 10 && (e.lat == null || Math.hypot(e.lat - v.lat, (e.lon - v.lon) * 0.6) < 0.5));
    return { id: v.id, ort: v.ort, anzahl: v.anzahl, ereignis: e?.id, quellen: e?.sources.length, gemeldet: e ? `${e.anzahl_min}–${e.anzahl_max} (Modus ${e.anzahl_modus})` : "" };
  });
  const matched = new Set(hits.map((h) => h.ereignis).filter(Boolean));
  return {
    lauf, quellen: s.sources.length, zeilen: s.rows.length, beobachtungen: byLoc.size, vorschlaege: s.links.length,
    zeilen_mit_truth: truth.zeilen.length, gefunden: found, zeit_genau: exact / truth.zeilen.length, zeit_toleranz: tol / truth.zeilen.length,
    vorfaelle: hits, vorfaelle_erkannt: hits.filter((h) => h.ereignis).length / hits.length,
    gestuetzte_ereignisse: strong.length, davon_ohne_vorfall: strong.filter((e) => !matched.has(e.id)).map((e) => `${e.id} ${e.places[0] || ""} ${new Date(e.start * 60000).toISOString().slice(5, 16)} (${e.sources.length} Q.)`),
    einzelmeldungen: a.result.events.length - strong.length, fehler: fehler.slice(0, 15), fehler_gesamt: fehler.length,
  };
});
console.log(JSON.stringify(r, null, 1));
for (const [k, v] of Object.entries(MIN)) if (r[k] < v) { console.error(`FEHLER: ${k} = ${r[k].toFixed(3)} < ${v}`); process.exitCode = 1; }
if (errors.length) { console.error("Konsolenfehler:", errors); process.exitCode = 1; }
await browser.close();
