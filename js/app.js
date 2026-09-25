// Einstieg: Zustand laden, Ansichten verdrahten, Import-Pipeline steuern.
import { app, find, obsTableId } from "./ctx.js";
import { emptyState, exportJson, load, save } from "./store.js";
import { esc, nextId, now, sha256 } from "./util.js";
import { PROFILES, profileOf } from "./profiles.js";
import { parseFile, fileKind } from "./parsers.js";
import { addAiRows, ingest, rebuildEntities } from "./extract.js";
import { RUNNERS, checkStale, suggestLinks } from "./analysis.js";
import { aiEnabled, aiExtract, aiLinks, getSettings, setSettings, DEFAULT_MODEL } from "./ai.js";
import { renderCanvas } from "./canvas.js";
import { correctCell, inspectorHtml, renderAnalyses, renderAudit, renderCorrections, renderSources, renderTables, renderTimeline, setLinkStatus } from "./views.js";
import { ask, renderChat } from "./chat.js";

const $ = (id) => document.getElementById(id);
const VIEWS = { canvas: renderCanvas, tables: renderTables, analyses: renderAnalyses, timeline: renderTimeline, sources: renderSources, corrections: renderCorrections, audit: renderAudit };

app.toast = (msg, ms = 3200) => {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), ms);
};

app.commit = (opts = {}) => {
  const s = app.state;
  if (opts.restale) {
    rebuildEntities(s);
    const st = checkStale(s);
    if (st.length) app.toast(`⚠ ${st.length} Analyse(n) veraltet – neue Informationen betreffen das Ergebnis`);
  }
  save(s);
  render();
};

app.inspect = (id) => {
  const el = $("inspector");
  el.innerHTML = inspectorHtml(id);
  el.classList.add("show");
};

app.run = (type, scope = { terms: [] }) => {
  const a = RUNNERS[type](app.state, scope);
  app.sel.analysis = a.id;
  app.view = "analyses";
  app.commit();
  app.toast(`${a.title} ${a.id} v${a.version} berechnet – ${a.calc_ids.length} protokollierte Schritte`);
};

app.rerun = (id) => {
  const a = find(app.state, id);
  app.run(a.type, a.scope);
};

function render() {
  const s = app.state;
  document.querySelectorAll(".nav[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === app.view));
  const oid = obsTableId(s);
  $("c-rows").textContent = s.rows.length || "";
  $("c-src").textContent = s.sources.length || "";
  $("c-anl").textContent = s.analyses.filter((a) => a.status !== "superseded").length || "";
  $("c-links").textContent = s.links.filter((l) => l.status === "suggested").length ? `${s.links.filter((l) => l.status === "suggested").length} ✦` : "";
  $("c-corr").textContent = s.rows.reduce((n, r) => n + r.corrections.length, 0) || "";
  $("wsName").value = s.workspace.name;
  $("profile").value = s.workspace.profile;
  $("aiStatus").innerHTML = aiEnabled() ? `<span style="color:var(--ok)">● KI aktiv</span>` : `<span>● lokal</span>`;
  const stale = s.analyses.filter((a) => a.status === "stale");
  $("banner").innerHTML = stale.length ? `<div class="stale"><b>⚠ Neue Informationen verändern Ergebnisse:</b>${stale.map((a) => `<span>${a.id} ${esc(a.title)} v${a.version} (${a.stale_info.length} neue/geänderte Zeilen)</span><button class="btn sm" data-rerun="${a.id}">Neu berechnen</button>`).join("")}</div>` : "";
  const root = $("view");
  const same = root.dataset.view === app.view;
  const scroll = [root.scrollLeft, root.scrollTop, root.querySelector(".tw")?.scrollTop || 0];
  root.dataset.view = app.view;
  root.className = "view" + (["tables", "sources", "corrections", "audit"].includes(app.view) ? " fill" : "");
  VIEWS[app.view](root);
  if (same) { [root.scrollLeft, root.scrollTop] = scroll; const tw = root.querySelector(".tw"); if (tw) tw.scrollTop = scroll[2]; }
  else root.scrollTop = 0;
  renderChat();
  void oid;
}

// ---------- Import ----------
async function importFiles(files, meta = {}) {
  const s = app.state;
  const log = (m) => { const p = $("progress"); if (p) { p.insertAdjacentHTML("beforeend", `<div>${m}</div>`); p.scrollTop = p.scrollHeight; } };
  let newRows = 0, newSrc = 0;
  for (const file of files) {
    const buf = await file.arrayBuffer();
    const hash = await sha256(buf);
    const dup = s.sources.find((x) => x.sha256 === hash);
    if (dup) { log(`↺ ${esc(file.name)}: identisch mit ${dup.id} – übersprungen`); continue; }
    log(`… ${esc(file.name)} wird gelesen`);
    let parsed;
    try {
      parsed = await parseFile(file, (m) => log(`&nbsp;&nbsp;${esc(m)}`));
    } catch (e) {
      log(`✕ ${esc(file.name)}: ${esc(e.message || e)}`);
      continue;
    }
    const src = { id: nextId(s, "SRC"), name: file.name, type: fileKind(file.name), size: file.size, sha256: hash, imported_at: now(), ocr: !!parsed.ocr, url: meta.urls?.[file.name] || null, extraction: "regel" };
    s.sources.push(src);
    const before = s.rows.length;
    const useAi = aiEnabled() && getSettings().extract && parsed.pages;
    const made = ingest(s, src, parsed, { skipTextObs: useAi });
    if (useAi) {
      try {
        log(`&nbsp;&nbsp;KI-Extraktion (${esc(getSettings().model)}) …`);
        const segs = s.segments.filter((g) => g.source_id === src.id);
        let n = 0, model = "";
        for (let i = 0; i < segs.length; i += 80) {
          const res = await aiExtract(segs.slice(i, i + 80), profileOf(s).label, src.context || {});
          model = res.model;
          n += addAiRows(s, src, res.data.beobachtungen, res.model);
        }
        src.extraction = `ki (${model})`;
        log(`&nbsp;&nbsp;KI: ${n} Beobachtungen`);
      } catch (e) {
        log(`&nbsp;&nbsp;KI-Extraktion fehlgeschlagen (${esc(e.message || e)}) – Regel-Extraktion`);
        const tmp = { ...parsed, sheets: null };
        const segCount = s.segments.length;
        ingest(s, src, tmp);
        // doppelte Segmente der Wiederholung verwerfen, Beobachtungen auf Original-Segmente umhaengen
        const dupSegs = s.segments.splice(segCount);
        const orig = s.segments.filter((g) => g.source_id === src.id);
        s.rows.filter((r) => r.source_id === src.id && dupSegs.some((d) => d.id === r.seg_id)).forEach((r) => { r.seg_id = orig.find((g) => g.loc === r.loc)?.id || r.seg_id; });
      }
    }
    const added = s.rows.length - before;
    newRows += added; newSrc++;
    s.audit.push({ id: nextId(s, "EVT"), ts: now(), action: "IMPORT", detail: `${src.name} (${src.type}${src.ocr ? ", OCR" : ""}) → ${made.segments} Segmente, ${added} Zeilen${made.tables.length ? `, Tabellen ${made.tables.join(", ")}` : ""}`, refs: [src.id, ...made.tables] });
    log(`✓ ${esc(file.name)} → ${src.id}: ${made.segments} Segmente, ${added} Zeilen`);
  }
  rebuildEntities(s);
  const sug = suggestLinks(s);
  const stale = checkStale(s);
  app.commit();
  app.toast(`${newSrc} Quelle(n), ${newRows} neue Zeilen, ${sug.length} Verbindungsvorschläge${stale.length ? ` · ⚠ ${stale.length} Analyse(n) veraltet` : ""}`, 5000);
  return { newRows, stale };
}

function openModal(html) { $("modalCard").innerHTML = html; $("modal").classList.add("show"); }
function closeModal() { $("modal").classList.remove("show"); }

function openImport() {
  openModal(`<h2>Daten importieren</h2><p class="muted small">Text (.txt), PDF (auch gescannt → OCR), Excel/CSV, Bilder (OCR). Jede Datei wird unverändert per SHA-256 registriert; daraus entstehen Tabellen mit eindeutigen IDs. Bestehende Zeilen werden nie überschrieben.</p>
  <input id="files" type="file" multiple accept=".pdf,.txt,.md,.csv,.xlsx,.xls,.ods,.png,.jpg,.jpeg,.webp,.tif,.tiff" hidden>
  <div class="drop" id="drop">Dateien hierher ziehen oder <b>auswählen</b><br><small>mehrere Dateien möglich · ${aiEnabled() ? "KI-Extraktion aktiv" : "Regel-Extraktion (ohne KI)"}</small></div>
  <div class="progress" id="progress"></div>
  <div class="foot"><button class="btn" data-close-modal>Schließen</button></div>`);
  const drop = $("drop"), inp = $("files");
  drop.onclick = () => inp.click();
  inp.onchange = () => importFiles([...inp.files]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); importFiles([...e.dataTransfer.files]); };
}

async function fetchFiles(paths) {
  const files = [], urls = {};
  for (const p of paths) {
    const url = new URL(`samples/${p}`, location.href).href;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    const name = p.split("/").pop();
    files.push(new File([await r.blob()], name));
    urls[name] = url;
  }
  return { files, urls };
}

async function openDemo() {
  let man;
  try { man = await (await fetch("samples/manifest.json")).json(); }
  catch { app.toast("samples/manifest.json nicht gefunden"); return; }
  openModal(`<h2>Beispieldaten (synthetisch)</h2><p class="muted small">Erfundene Testdateien aus <span class="mono">samples/</span> im Repository. „Nachtrag“ spielt eine später eingehende Datei ein – so siehst du, wie neue Informationen bestehende Analysen verändern.</p>
  ${man.scenarios.map((sc) => `<div class="scen"><b>${esc(sc.title)}</b> <span class="pill">${esc(PROFILES[sc.profile]?.label || sc.profile)}</span><div class="files">${sc.files.map((f) => `<a href="samples/${esc(f)}" target="_blank">${esc(f.split("/").pop())}</a>`).join(" · ")}${sc.later.length ? `<br>Nachtrag: ${sc.later.map((f) => `<a href="samples/${esc(f)}" target="_blank">${esc(f.split("/").pop())}</a>`).join(" · ")}` : ""}</div>
  <button class="primary sm" data-scen="${sc.id}">In neuem Workspace laden</button> ${sc.later.length ? `<button class="btn sm" data-later="${sc.id}">Nachtrag einspielen</button>` : ""}</div>`).join("")}
  <div class="progress" id="progress"></div>
  <div class="foot"><button class="btn" data-close-modal>Schließen</button></div>`);
  document.querySelectorAll("[data-scen]").forEach((b) => b.addEventListener("click", async () => {
    const sc = man.scenarios.find((x) => x.id === b.dataset.scen);
    if (app.state.sources.length && !confirm("Aktuellen Workspace verwerfen und Szenario laden? (Vorher ggf. exportieren)")) return;
    app.state = emptyState(sc.profile);
    app.state.workspace.name = sc.title;
    app.state.audit.push({ id: nextId(app.state, "EVT"), ts: now(), action: "WORKSPACE", detail: `Szenario „${sc.title}“ geladen (Profil ${sc.profile})`, refs: [] });
    const { files, urls } = await fetchFiles(sc.files);
    await importFiles(files, { urls });
    RUNNERS[sc.profile === "lieferkette" ? "termine" : sc.profile === "netzwerk" ? "netzwerk" : "lagebild"](app.state, { terms: [] });
    app.view = "canvas";
    app.commit();
    $("progress")?.insertAdjacentHTML("beforeend", `<div><b>Fertig.</b> Erste Analyse berechnet. Tipp: jetzt „Nachtrag einspielen“.</div>`);
  }));
  document.querySelectorAll("[data-later]").forEach((b) => b.addEventListener("click", async () => {
    const sc = man.scenarios.find((x) => x.id === b.dataset.later);
    const { files, urls } = await fetchFiles(sc.later);
    const { stale } = await importFiles(files, { urls });
    $("progress")?.insertAdjacentHTML("beforeend", `<div><b>${stale.length ? `⚠ ${stale.length} Analyse(n) als veraltet markiert` : "Keine Analyse betroffen"}.</b> Über das Banner „Neu berechnen“ entsteht eine neue Version mit Änderungsliste.</div>`);
  }));
}

function openSettings() {
  const st = getSettings();
  openModal(`<h2>Einstellungen</h2>
  <label class="field"><span>Anthropic API-Schlüssel (optional – bleibt nur in diesem Browser, wird nie exportiert)</span><input id="setKey" type="password" value="${esc(st.apiKey || "")}" placeholder="sk-ant-…" autocomplete="off"></label>
  <label class="field"><span>Modell</span><input id="setModel" value="${esc(st.model || DEFAULT_MODEL)}"></label>
  <label class="field"><input type="checkbox" id="setExtract" ${st.extract ? "checked" : ""}> KI-Extraktion beim Import von Texten/PDFs/Scans (sonst Regeln)</label>
  <label class="field"><span>Zeitzone: Abstand Lokalzeit zu UTC in Stunden (für UTC-Angaben in Dokumenten)</span><input id="setTz" type="number" value="${app.state.workspace.tz_offset_utc ?? 2}"></label>
  <p class="small muted">Ohne Schlüssel läuft alles lokal im Browser: Regel-Extraktion, deterministische Berechnungen, lokaler Chat. Mit Schlüssel ruft der Browser die Claude API direkt auf; die KI extrahiert und formuliert, gerechnet wird weiterhin protokolliert in der Engine. Für geteilte oder produktive Nutzung einen eigenen Proxy/Server verwenden, statt Schlüssel im Browser zu halten.</p>
  <div class="foot"><button class="btn" data-close-modal>Abbrechen</button><button class="primary" id="setSave">Speichern</button></div>`);
  $("setSave").onclick = () => {
    setSettings({ apiKey: $("setKey").value.trim(), model: $("setModel").value.trim() || DEFAULT_MODEL, extract: $("setExtract").checked });
    app.state.workspace.tz_offset_utc = +$("setTz").value || 0;
    closeModal();
    app.commit();
  };
}

async function suggestAi() {
  const s = app.state;
  if (!aiEnabled()) {
    const n = suggestLinks(s).length;
    app.commit();
    app.toast(n ? `${n} neue Regel-Vorschläge (Zeit/Ort/Referenz/Akteur)` : "Keine weiteren Regel-Vorschläge. Mit API-Schlüssel schlägt die KI zusätzliche Verbindungen vor.");
    return;
  }
  app.toast("KI sucht Verbindungen …", 8000);
  try {
    const oid = obsTableId(s);
    const tsv = s.rows.filter((r) => r.table_id === oid).map((r) => `${r.id}\t${r.source_id}\t${r.data.datum || ""} ${r.data.zeit || ""}\t${(r.data.text || "").slice(0, 200)}`).join("\n");
    const { data, model } = await aiLinks(tsv);
    const exists = new Set(s.links.map((l) => [l.from, l.to].sort().join("|")));
    let n = 0;
    for (const v of data.verbindungen) {
      if (!find(s, v.von) || !find(s, v.nach) || v.von === v.nach || exists.has([v.von, v.nach].sort().join("|"))) continue;
      s.links.push({ id: nextId(s, "LNK"), from: v.von, to: v.nach, label: v.label, kind: "ai", status: "suggested", reason: `${v.begruendung} (${model})`, score: v.score, created_at: now() });
      n++;
    }
    s.audit.push({ id: nextId(s, "EVT"), ts: now(), action: "KI-VORSCHLAG", detail: `${n} Verbindungen vorgeschlagen (${model})`, refs: [] });
    app.commit();
    app.toast(`${n} KI-Verbindungsvorschläge`);
  } catch (e) { app.toast("KI-Fehler: " + (e.message || e)); }
}

// ---------- Verdrahtung ----------
document.addEventListener("click", (e) => {
  const t = e.target;
  const ref = t.closest(".idref");
  if (ref) { e.preventDefault(); app.inspect(ref.dataset.id); return; }
  if (t.closest("[data-close]")) { $("inspector").classList.remove("show"); app.sel.node = null; return; }
  if (t.closest("[data-close-modal]") || t.id === "modal") { closeModal(); return; }
  const rr = t.closest("[data-rerun]");
  if (rr) { app.rerun(rr.dataset.rerun); return; }
  const la = t.closest("[data-link-act]");
  if (la) { setLinkStatus(la.dataset.link, la.dataset.linkAct); app.inspect(la.dataset.link); return; }
  const fx = t.closest("[data-fix]");
  if (fx) { correctCell(fx.dataset.fix, fx.dataset.col); app.inspect(fx.dataset.fix); return; }
  const oa = t.closest("[data-open-anl]");
  if (oa) { app.sel.analysis = oa.dataset.openAnl; app.view = "analyses"; render(); return; }
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "import") openImport();
  if (act === "demo") openDemo();
  if (act === "suggest") suggestAi();
  const chip = t.closest(".chip");
  if (chip) ask(chip.textContent);
});

document.querySelectorAll(".nav[data-view]").forEach((n) => n.addEventListener("click", () => { app.view = n.dataset.view; $("inspector").classList.remove("show"); render(); }));
$("btnImport").onclick = openImport;
$("btnDemo").onclick = openDemo;
$("btnSettings").onclick = openSettings;
$("btnExport").onclick = () => exportJson(app.state);
$("importJson").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const st = JSON.parse(await f.text());
    if (!st.rows || !st.sources) throw new Error("kein Katoptrik-Workspace");
    app.state = st;
    app.commit();
    app.toast(`Workspace „${st.workspace.name}“ geladen`);
  } catch (err) { app.toast("Import fehlgeschlagen: " + err.message); }
};
$("btnReset").onclick = () => {
  if (!confirm("Workspace wirklich leeren? (Vorher ggf. als JSON exportieren)")) return;
  app.state = emptyState(app.state.workspace.profile);
  app.view = "canvas";
  app.commit();
};
$("wsName").onchange = (e) => { app.state.workspace.name = e.target.value; app.commit(); };
$("profile").innerHTML = Object.entries(PROFILES).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join("");
$("profile").onchange = (e) => { app.state.workspace.profile = e.target.value; app.commit(); };
$("btnSend").onclick = () => { ask($("prompt").value); $("prompt").value = ""; };
$("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnSend").click(); } });
$("btnMobileChat").onclick = () => $("chatPanel").classList.add("open");
$("btnCloseChat").onclick = () => $("chatPanel").classList.remove("open");

app.state = (await load()) || emptyState();
if (!app.state.schema || app.state.schema < 2) app.state = emptyState();
render();
