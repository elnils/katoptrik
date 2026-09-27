// Lasttest: importiert einen grossen Ordner (z. B. tools/generate_grosslage.py --scale 20 --out .stress)
// ueber das Dateifeld und misst Import-, Analyse- und Renderzeiten im Browser.
// Aufruf: STRESS_DIR=.stress node tests/stress.mjs   (Server auf :8765 muss laufen)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const dir = process.env.STRESS_DIR || ".stress";
const files = fs.readdirSync(dir).filter((f) => f !== "truth.json" && fs.statSync(path.join(dir, f)).isFile()).map((f) => path.join(dir, f));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await page.goto(process.env.BASE_URL || "http://localhost:8765/");
await page.evaluate(() => indexedDB.deleteDatabase("katoptrik"));
await page.reload();
await page.click("#btnImport");
const t0 = Date.now();
await page.setInputFiles("#files", files);
await page.waitForFunction(() => /Zeilen in [\d.]+ s/.test(document.querySelector("#progress")?.textContent || ""), null, { timeout: 900000 });
const importMs = Date.now() - t0;
await page.click("[data-close-modal]");
const m = await page.evaluate(async () => {
  const { app } = await import("./js/ctx.js");
  const { runLagebild } = await import("./js/analysis.js");
  const s = app.state;
  let t = performance.now();
  const a = runLagebild(s, { terms: [] });
  const lagebildMs = performance.now() - t;
  app.commit();
  const views = {};
  for (const v of ["canvas", "tables", "timeline", "corrections", "analyses", "audit"]) {
    t = performance.now();
    document.querySelector(`.nav[data-view=${v}]`).click();
    views[v] = Math.round(performance.now() - t);
  }
  t = performance.now();
  const json = JSON.stringify(s);
  return {
    quellen: s.sources.length, zeilen: s.rows.length, segmente: s.segments.length, vorschlaege: s.links.length,
    ereignisse: a.result.events.length, gestuetzt: a.result.events.filter((e) => e.sources.length >= 2).length,
    lagebild_ms: Math.round(lagebildMs), render_ms: views, workspace_mb: +(json.length / 1e6).toFixed(1), serialisieren_ms: Math.round(performance.now() - t),
    heap_mb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
});
console.log(JSON.stringify({ dateien: files.length, import_s: +(importMs / 1000).toFixed(1), ...m, fehler: errors }, null, 1));
await browser.close();
