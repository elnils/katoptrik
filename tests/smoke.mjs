// End-to-End-Test: laedt die App, spielt das Drohnen-Szenario samt Nachtrag ein
// und prueft Extraktion, Korrekturen, Analyse-Versionierung und Veraltet-Markierung.
// Aufruf: npx http-server -p 8765 . & node tests/smoke.mjs
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:8765/";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("dialog", (d) => d.accept());
const fail = (msg) => { console.error("FEHLER:", msg); process.exitCode = 1; };

await page.goto(BASE);
await page.click("#btnDemo");
await page.click('[data-scen="drohnen-ostsee"]');
await page.waitForFunction(() => document.querySelector("#progress")?.textContent.includes("Fertig"), null, { timeout: 180000 });
const s1 = await page.evaluate(async () => (await import("./js/ctx.js")).app.state);
const obs = s1.rows.filter((r) => r.table_id === s1.tables.find((t) => t.kind === "observations").id);
console.log(`Quellen ${s1.sources.length}, Zeilen ${s1.rows.length}, Beobachtungen ${obs.length}, Segmente ${s1.segments.length}, Vorschläge ${s1.links.length}`);
const find = (re) => obs.find((r) => re.test(r.data.text));
const check = (name, row, field, want) => {
  const got = row?.data[field];
  console.log(`${got === want ? "ok " : "XX "} ${name}: ${field}=${got} (erwartet ${want})`);
  if (got !== want) fail(name);
};
check("OCR-Notiz 2,5h", find(/2[,.]5\s*h/i), "zeit", "02:30");
check("Anruf 0240 uhr", find(/0240/), "zeit", "02:40");
check("Anruf halb drei", find(/halb drei/), "zeit", "02:30");
check("Nachtrag gegen 3 Uhr", find(/gegen 3 Uhr/), "zeit", "03:00");
check("Tippfehler drohen", find(/drohen/), "objekt", "Drohnen");
check("Radar UTC", find(/T-01 00:31/), "zeit", "02:31");
check("Excel 2,75h", find(/2,75h/), "zeit", "02:45");
const a1 = s1.analyses[0];
console.log("Lagebild v1:", a1.result.summary.join("\n  "));

await page.click('[data-later="drohnen-ostsee"]');
await page.waitForFunction(() => /Analyse\(n\) als veraltet|Keine Analyse betroffen/.test(document.querySelector("#progress")?.textContent || ""), null, { timeout: 60000 });
const stale = await page.evaluate(async () => (await import("./js/ctx.js")).app.state.analyses.filter((a) => a.status === "stale").length);
console.log(`${stale ? "ok " : "XX "} Nachtrag markiert ${stale} Analyse(n) als veraltet`);
if (!stale) fail("veraltet");
await page.click("[data-close-modal]");
await page.click("#banner [data-rerun]");
const s2 = await page.evaluate(async () => (await import("./js/ctx.js")).app.state);
const v2 = s2.analyses.find((a) => a.version === 2);
console.log("Lagebild v2 Diff:", v2?.diff?.join("\n  "));
if (!v2?.diff?.some((d) => /Baltic Star/.test(d))) fail("Diff nennt neu beteiligten Frachter nicht");

await page.fill("#prompt", "Welche Zeitangaben wurden korrigiert?");
await page.click("#btnSend");
await page.waitForTimeout(400);
for (const v of ["canvas", "tables", "timeline", "sources", "corrections", "audit", "analyses"]) {
  await page.click(`.nav[data-view=${v}]`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${process.env.SHOT_DIR || "/tmp"}/katoptrik-${v}.png` });
}
await page.click(".idref");
await page.waitForSelector("#inspector.show");
if (errors.length) fail("Konsolenfehler: " + errors.join(" | "));
console.log(errors.length ? errors : "keine Konsolenfehler");
await browser.close();
