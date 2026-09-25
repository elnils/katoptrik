// Tabellen, Analysen, Zeitlinie, Quellen, Korrekturen, Audit und die Detailansicht (Inspector).
import { app, find, obsTableId, srcColor, srcName } from "./ctx.js";
import { esc, fold, linkIds, nextId, now } from "./util.js";
import { OBS_COLUMNS } from "./extract.js";
import { RULES } from "./normalize.js";

const idref = (id) => `<a href="#" class="idref" data-id="${id}">${id}</a>`;
const fmt = (v) => (v == null ? "" : typeof v === "number" ? v.toLocaleString("de-DE") : String(v));
const PAGE = 200;
const clip = (t, n = 12000) => (t.length > n ? t.slice(0, n) + `\n… (${t.length - n} Zeichen gekürzt – vollständig im JSON-Export)` : t);
// Filter + Seitenweise Anzeige, damit auch zehntausende Zeilen fluessig bleiben
function page(items, textOf) {
  const q = fold(app.sel.tfilter || "");
  const hit = q ? items.filter((x) => fold(textOf(x)).includes(q)) : items;
  const pages = Math.max(1, Math.ceil(hit.length / PAGE));
  const p = Math.min(app.sel.page || 0, pages - 1);
  return { list: hit.slice(p * PAGE, (p + 1) * PAGE), total: hit.length, all: items.length, p, pages };
}
function pager(pg) {
  return `<input class="filter" data-filter placeholder="Filtern …" value="${esc(app.sel.tfilter || "")}"><span class="small muted">${pg.total === pg.all ? pg.all : `${pg.total} von ${pg.all}`} Einträge</span>${pg.pages > 1 ? `<button class="btn sm" data-pg="${pg.p - 1}" ${pg.p ? "" : "disabled"}>‹</button><span class="small">Seite ${pg.p + 1}/${pg.pages}</span><button class="btn sm" data-pg="${pg.p + 1}" ${pg.p + 1 < pg.pages ? "" : "disabled"}>›</button>` : ""}`;
}
function wirePager(root, rerender) {
  const f = root.querySelector("[data-filter]");
  if (f) {
    f.addEventListener("input", () => { app.sel.tfilter = f.value; app.sel.page = 0; clearTimeout(f._t); f._t = setTimeout(() => { rerender(root); const g = root.querySelector("[data-filter]"); g.focus(); g.setSelectionRange(g.value.length, g.value.length); }, 200); });
  }
  root.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => { app.sel.page = +b.dataset.pg; rerender(root); const tw = root.querySelector(".tw"); if (tw) tw.scrollTop = 0; else root.scrollTop = 0; }));
}
const ts = (iso) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });

// ---------- Tabellen ----------
export function renderTables(root) {
  const s = app.state;
  const tabs = [
    ...s.tables.map((t) => ({ id: t.id, label: t.kind === "observations" ? `Beobachtungen` : t.name, n: s.rows.filter((r) => r.table_id === t.id).length })),
    { id: "segments", label: "Textsegmente", n: s.segments.length },
    { id: "entities", label: "Entitäten", n: s.entities.length },
    { id: "links", label: "Verbindungen", n: s.links.length },
    { id: "calcs", label: "Rechenschritte", n: s.calcs.length },
  ];
  const cur = app.sel.table && tabs.some((t) => t.id === app.sel.table) ? app.sel.table : tabs[0]?.id;
  let head = [], body = "", pg = { total: 0, all: 0, p: 0, pages: 1 };
  if (cur === "segments") {
    head = ["SEG-ID", "Quelle", "Fundstelle", "Text", "→ Zeilen"];
    pg = page(s.segments, (g) => g.id + " " + g.text);
    const bySeg = new Map();
    s.rows.forEach((r) => r.seg_id && (bySeg.get(r.seg_id) || bySeg.set(r.seg_id, []).get(r.seg_id)).push(r.id));
    body = pg.list.map((g) => `<tr><td>${idref(g.id)}</td><td>${idref(g.source_id)}</td><td>${g.loc}</td><td class="wrap">${esc(g.text)}</td><td>${(bySeg.get(g.id) || []).map(idref).join(" ")}</td></tr>`).join("");
  } else if (cur === "entities") {
    head = ["ENT-ID", "Typ", "Name", "Koordinaten", "Erwähnungen"];
    pg = page(s.entities, (e) => e.id + " " + e.type + " " + e.name);
    body = pg.list.map((e) => `<tr><td>${idref(e.id)}</td><td>${e.type}</td><td>${esc(e.name)}</td><td>${e.lat != null ? `${e.lat}, ${e.lon}` : ""}</td><td class="wrap">${e.mentions.map(idref).join(" ")}</td></tr>`).join("");
  } else if (cur === "links") {
    head = ["LNK-ID", "Von", "Nach", "Bezeichnung", "Art", "Status", "Begründung", "Score"];
    pg = page(s.links, (l) => [l.id, l.from, l.to, l.label, l.kind, l.status, l.reason].join(" "));
    body = pg.list.map((l) => `<tr><td>${idref(l.id)}</td><td>${idref(l.from)}</td><td>${idref(l.to)}</td><td>${esc(l.label)}</td><td>${l.kind}</td><td>${l.status}</td><td class="wrap">${esc(l.reason || "")}</td><td>${l.score ?? ""}</td></tr>`).join("");
  } else if (cur === "calcs") {
    head = ["CALC-ID", "Analyse", "Schritt", "Operation", "Titel", "Inputs"];
    pg = page(s.calcs, (c) => [c.id, c.analysis_id, c.op, c.title].join(" "));
    body = pg.list.map((c) => `<tr><td>${idref(c.id)}</td><td>${idref(c.analysis_id)}</td><td>${c.step}</td><td class="mono">${c.op}</td><td>${esc(c.title)}</td><td>${c.inputs.length}</td></tr>`).join("");
  } else if (cur) {
    const t = s.tables.find((x) => x.id === cur);
    const cols = t.kind === "observations" ? OBS_COLUMNS : t.columns;
    head = ["ROW-ID", "Quelle", "Fundstelle", ...cols, "Konf.", "Methode", "Rev"];
    pg = page(s.rows.filter((r) => r.table_id === cur), (r) => r.id + " " + r.source_id + " " + Object.values(r.data).join(" "));
    body = pg.list.map((r) => {
      const fixed = new Set(r.corrections.map((c) => (c.field === "lat/lon" ? ["lat", "lon"] : [c.field])).flat());
      const origin = r.seg_id ? idref(r.seg_id) : r.loc;
      return `<tr><td>${idref(r.id)}</td><td>${idref(r.source_id)}</td><td>${r.seg_id ? origin + " " : ""}${esc(r.loc)}</td>${cols.map((c) => {
        const fx = fixed.has(c) || [...fixed].some((f) => c.startsWith(f + " ") || c === f + " (norm)");
        const corr = r.corrections.filter((k) => k.field === c || (k.field === "lat/lon" && (c === "lat" || c === "lon")) || c === k.field + " (norm)");
        return `<td class="${c === "text" ? "wrap" : ""} ${fx ? "fixed" : ""} edit" data-row="${r.id}" data-col="${esc(c)}" title="${esc(corr.map((k) => `${k.rule}: ${k.from} → ${k.to} (${k.note || RULES[k.rule] || ""})`).join("\n") || "Doppelklick zum Korrigieren")}">${esc(fmt(r.data[c]))}</td>`;
      }).join("")}<td>${r.confidence}</td><td>${r.method}</td><td>${r.rev}</td></tr>`;
    }).join("");
  }
  root.innerHTML = `<div class="bar"><b>Tabellen</b><div class="tabs">${tabs.map((t) => `<span class="tab ${t.id === cur ? "active" : ""}" data-tab="${t.id}">${esc(t.label)} · ${t.n}</span>`).join("")}</div><div class="sp"></div>${pager(pg)}<span class="small muted" title="Gelb = normalisierter/korrigierter Wert (Tooltip zeigt Regel und Rohwert). Doppelklick auf eine Zelle erzeugt eine manuelle Korrektur als neue Revision – betroffene Analysen werden als veraltet markiert.">ⓘ gelb = korrigiert · Doppelklick = korrigieren</span><button class="btn sm" data-act="csv">CSV</button></div>
  ${cur ? `<div class="tw"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${head.length}" class="muted">Keine Einträge.</td></tr>`}</tbody></table></div>` : `<div class="empty">Noch keine Tabellen.</div>`}`;
  root.querySelectorAll("[data-tab]").forEach((t) => t.addEventListener("click", () => { app.sel.table = t.dataset.tab; app.sel.page = 0; renderTables(root); }));
  wirePager(root, renderTables);
  root.querySelector("[data-act=csv]")?.addEventListener("click", () => {
    const rows = [...root.querySelectorAll("table tr")].map((tr) => [...tr.children].map((td) => `"${td.textContent.replace(/"/g, '""')}"`).join(";"));
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + rows.join("\n")], { type: "text/csv" })), download: `${cur}.csv` });
    a.click();
  });
  root.querySelectorAll("td.edit").forEach((td) => td.addEventListener("dblclick", () => correctCell(td.dataset.row, td.dataset.col)));
}

export function correctCell(rowId, col) {
  const s = app.state, r = find(s, rowId);
  const old = r.data[col];
  const v = prompt(`Manuelle Korrektur ${rowId} · ${col}\nAlter Wert: ${fmt(old)}\nNeuer Wert:`, fmt(old));
  if (v == null || v === fmt(old)) return;
  const reason = prompt("Begründung (wird im Audit-Trail gespeichert):", "") || "ohne Begründung";
  const val = ["lat", "lon", "anzahl", "betrag"].includes(col) && v !== "" && !isNaN(+v.replace(",", ".")) ? +v.replace(",", ".") : v;
  r.data[col] = val;
  r.rev++;
  r.corrections.push({ field: col, from: fmt(old), to: fmt(val), rule: "M1", note: reason, confidence: 1, at: now() });
  s.audit.push({ id: nextId(s, "EVT"), ts: now(), action: "KORREKTUR", detail: `${rowId}.${col}: „${fmt(old)}“ → „${fmt(val)}“ (${reason}), Revision ${r.rev}`, refs: [rowId] });
  app.commit({ restale: true });
}

// ---------- Analysen ----------
export function renderAnalyses(root) {
  const s = app.state;
  const list = s.analyses.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!list.length) {
    root.innerHTML = `<div class="empty"><h2>Noch keine Analysen</h2><p>Stelle rechts eine Frage (z. B. „Erstelle ein Lagebild“) oder starte direkt:</p>
      <button class="primary" data-run="lagebild">Lagebild berechnen</button><button class="btn" data-run="netzwerk">Netzwerkanalyse</button><button class="btn" data-run="termine">Termin-/Verzugsanalyse</button></div>`;
    root.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => app.run(b.dataset.run)));
    return;
  }
  const cur = find(s, app.sel.analysis || "") || list.find((a) => a.status !== "superseded") || list[0];
  const steps = cur.calc_ids.map((id) => find(s, id));
  const statusPill = cur.status === "stale" ? `<span class="pill warn">⚠ veraltet</span>` : cur.status === "superseded" ? `<span class="pill">ersetzt</span>` : `<span class="pill ok">✓ aktuell</span>`;
  root.innerHTML = `<div class="cols"><div class="list">
    <div class="bar"><b>Analysen</b><div class="sp"></div><button class="btn sm" data-run="lagebild">+ Lagebild</button></div>
    ${list.map((a) => `<div class="li ${a.id === cur.id ? "active" : ""}" data-anl="${a.id}"><div><b>${esc(a.title)}</b> <span class="muted small">v${a.version}</span></div><div class="small muted">${a.id} · ${ts(a.created_at)} · ${a.status === "stale" ? "⚠ veraltet" : a.status === "superseded" ? "ersetzt" : "aktuell"}</div></div>`).join("")}
  </div><div class="pad">
    <h2>${esc(cur.title)} <span class="muted small">v${cur.version}</span> ${statusPill}</h2>
    <div class="kv"><div>ID</div><div>${idref(cur.id)} ${cur.prev ? `· Vorversion ${idref(cur.prev)}` : ""}</div><div>Berechnet</div><div>${ts(cur.created_at)}</div><div>Eingangszeilen</div><div>${cur.input_rows.length} · Fingerprint <span class="mono">${cur.fingerprint}</span></div><div>Suchbegriffe</div><div>${esc((cur.scope.terms || []).join(", ") || "alle Daten")}</div></div>
    ${cur.status === "stale" ? `<div class="panel" style="background:var(--warns)"><b>Neue Informationen betreffen dieses Ergebnis:</b> ${cur.stale_info.map(idref).join(" ")}<div class="foot" style="justify-content:flex-start"><button class="primary sm" data-rerun="${cur.id}">Neu berechnen (v${cur.version + 1})</button></div></div>` : ""}
    ${cur.diff ? `<div class="panel"><b>Änderungen gegenüber v${cur.version - 1}</b><ul class="diff">${cur.diff.map((d) => `<li>${linkIds(esc(d))}</li>`).join("")}</ul></div>` : ""}
    <div class="panel"><b>Ergebnis</b><ul class="summary">${cur.result.summary.map((l) => `<li>${linkIds(esc(l))}</li>`).join("")}</ul></div>
    ${resultTable(cur)}
    <h3>Rechenweg (${steps.length} Schritte)</h3>
    ${steps.map((c) => `<details class="step"><summary><span class="idref">${c.id}</span><b>${c.step}. ${esc(c.title)}</b><span class="pill mono">${c.op}</span><span class="muted small">${c.inputs.length} Inputs</span></summary><pre>${linkIds(esc(clip(`Formel: ${c.formula}\nParameter: ${JSON.stringify(c.params, null, 1)}\nInputs (${c.inputs.length}): ${c.inputs.slice(0, 200).join(", ")}${c.inputs.length > 200 ? " …" : ""}\nOutput: ${JSON.stringify(c.output, null, 1)}`)))}</pre></details>`).join("")}
    <div class="foot" style="justify-content:flex-start"><button class="btn sm" data-md="${cur.id}">Als Markdown exportieren</button><button class="btn sm" data-rerun="${cur.id}">Neu berechnen</button></div>
  </div></div>`;
  root.querySelectorAll("[data-anl]").forEach((x) => x.addEventListener("click", () => { app.sel.analysis = x.dataset.anl; renderAnalyses(root); }));
  root.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => app.run(b.dataset.run)));
  root.querySelectorAll("[data-rerun]").forEach((b) => b.addEventListener("click", () => app.rerun(b.dataset.rerun)));
  root.querySelector("[data-md]")?.addEventListener("click", () => exportMarkdown(cur));
}

function resultTable(a) {
  const s = app.state;
  if (a.type === "lagebild" && a.result.events.length) {
    return `<div class="panel tw"><b>Ereignisse</b><table><thead><tr><th>ID</th><th>Zeitraum</th><th>Ort</th><th>Anzahl</th><th>Quellen</th><th>Bestätigung</th><th>Widersprüche</th><th>Belege</th></tr></thead><tbody>${a.result.events.slice(0, 300).map((e) => {
      const t = (m) => { const d = new Date(m * 60000).toISOString(); return `${d.slice(8, 10)}.${d.slice(5, 7)}. ${d.slice(11, 16)}`; };
      return `<tr><td>${idref(e.id)}</td><td>${t(e.start)}–${t(e.end)}</td><td>${esc(e.places.join(", ") || (e.lat != null ? `${e.lat}, ${e.lon}` : "—"))}</td><td>${e.anzahl_max != null ? `${e.anzahl_min}–${e.anzahl_max}` : "—"}</td><td>${e.sources.map(idref).join(" ")}</td><td>${e.confidence}${e.sources.length < 2 ? ' <span class="pill">Einzelmeldung</span>' : ""}</td><td class="wrap">${esc(e.conflicts.join("; "))}</td><td class="wrap">${e.members.slice(0, 40).map(idref).join(" ")}${e.members.length > 40 ? ` … (+${e.members.length - 40})` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  if (a.type === "netzwerk") {
    return `<div class="panel tw"><b>Zentralität</b><table><thead><tr><th>Akteur</th><th>Grad</th><th>ein</th><th>aus</th><th>Betrag ein</th><th>Betrag aus</th><th>Belege</th></tr></thead><tbody>${a.result.ranking.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.gesamt}</td><td>${d.ein}</td><td>${d.aus}</td><td>${fmt(d.betrag_ein)}</td><td>${fmt(d.betrag_aus)}</td><td class="wrap">${[...new Set(d.rows)].map(idref).join(" ")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  if (a.type === "termine") {
    return `<div class="panel tw"><b>Aufträge</b><table><thead><tr><th>Auftrag</th><th>Lieferant</th><th>Soll</th><th>Ist</th><th>Status</th><th>Verzug (Tage)</th><th>Wert €</th><th>Belege</th></tr></thead><tbody>${a.result.orders.map((o) => `<tr><td>${esc(o.key)}</td><td>${esc(o.lieferant)}</td><td>${esc(o.soll)}</td><td>${esc(o.ist || "—")}</td><td>${esc(o.status)}</td><td>${o.verzug_tage ?? ""}</td><td>${fmt(o.wert)}</td><td>${[o.row, ...o.signale].map(idref).join(" ")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  return "";
}

function exportMarkdown(a) {
  const s = app.state;
  const lines = [`# ${a.title} (v${a.version})`, "", `- ID: ${a.id}`, `- Berechnet: ${a.created_at}`, `- Status: ${a.status}`, `- Eingangszeilen: ${a.input_rows.length} (Fingerprint ${a.fingerprint})`, "", "## Ergebnis", ...a.result.summary.map((l) => `- ${l}`)];
  if (a.diff) lines.push("", `## Änderungen gegenüber v${a.version - 1}`, ...a.diff.map((d) => `- ${d}`));
  lines.push("", "## Rechenweg");
  a.calc_ids.map((id) => find(s, id)).forEach((c) => lines.push(`### ${c.step}. ${c.title} (${c.id}, ${c.op})`, `Formel: ${c.formula}`, "", "```json", JSON.stringify({ params: c.params, inputs: c.inputs, output: c.output }, null, 2), "```"));
  lines.push("", "## Quellen", ...s.sources.map((q) => `- ${q.id}: ${q.name} (SHA-256 ${q.sha256.slice(0, 16)}…)`));
  const el = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown" })), download: `${a.id}-v${a.version}.md` });
  el.click();
}

// ---------- Zeitlinie ----------
export function renderTimeline(root) {
  const s = app.state, oid = obsTableId(s);
  const all = s.rows.filter((r) => r.table_id === oid && (r.data.zeit || r.data.datum)).sort((a, b) => `${a.data.datum || ""} ${a.data.zeit || ""}`.localeCompare(`${b.data.datum || ""} ${b.data.zeit || ""}`));
  const pg = page(all, (r) => [r.id, r.data.datum, r.data.zeit, r.data.text, srcName(s, r.source_id)].join(" "));
  const rows = pg.list;
  let lastDay = "";
  root.innerHTML = `<div class="bar"><b>Zeitlinie</b><span class="pill warn">✎ = normalisiert/korrigiert</span><div class="sp"></div>${pager(pg)}</div><div class="pad"><div class="tl">${rows.map((r) => {
    const day = r.data.datum || "";
    const dayHead = day !== lastDay ? `<h3 style="margin-left:-16px">${day ? new Date(day).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }) : "ohne Datum"}</h3>` : "";
    lastDay = day;
    const fixes = r.corrections.filter((c) => c.field === "zeit" || c.field === "datum");
    return `${dayHead}<div class="tle" style="--c:${srcColor(s, r.source_id)}"><span class="when">${r.data.zeit || "—"}</span>${idref(r.id)} <span class="muted small">${esc(srcName(s, r.source_id))} · ${esc(r.loc)}</span>${fixes.length ? ` <span class="pill warn" title="${esc(fixes.map((c) => `${c.rule}: ${c.from} → ${c.to}`).join("\n"))}">✎ ${esc(fixes.map((c) => `${c.from} → ${c.to}`).join(", "))}</span>` : ""}<div>${esc(r.data.text)}</div></div>`;
  }).join("")}</div></div>`;
  wirePager(root, renderTimeline);
}

// ---------- Quellen ----------
export function renderSources(root) {
  const s = app.state;
  root.innerHTML = `<div class="bar"><b>Quellen</b><span class="pill">append-only · SHA-256</span></div><div class="tw"><table><thead><tr><th>ID</th><th>Datei</th><th>Typ</th><th>Importiert</th><th>SHA-256</th><th>Kontext</th><th>Segmente</th><th>Zeilen</th><th>Extraktion</th><th></th></tr></thead><tbody>${s.sources.map((q) => `<tr><td>${idref(q.id)}</td><td>${esc(q.name)}</td><td>${q.type}${q.ocr ? " · OCR" : ""}</td><td>${ts(q.imported_at)}</td><td class="mono" title="${q.sha256}">${q.sha256.slice(0, 12)}…</td><td class="small">${q.context?.date || ""}${q.context?.utc ? " · UTC" : ""}</td><td>${s.segments.filter((g) => g.source_id === q.id).length}</td><td>${s.rows.filter((r) => r.source_id === q.id).length}</td><td>${esc(q.extraction || "regel")}</td><td>${q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener">Original</a>` : ""}</td></tr>`).join("") || `<tr><td colspan="10" class="muted">Keine Quellen.</td></tr>`}</tbody></table></div>`;
}

// ---------- Korrekturen ----------
export function renderCorrections(root) {
  const s = app.state;
  const all = s.rows.flatMap((r) => r.corrections.map((c) => ({ r, c })));
  const pg = page(all, ({ r, c }) => [r.id, r.source_id, c.field, c.from, c.to, c.rule, c.note].join(" "));
  const byRule = {};
  all.forEach(({ c }) => (byRule[c.rule] = (byRule[c.rule] || 0) + 1));
  root.innerHTML = `<div class="bar"><b>Korrekturen & Normalisierungen</b>${Object.entries(byRule).sort().map(([k, n]) => `<span class="pill" title="${esc(RULES[k] || "")}">${k} · ${n}</span>`).join("")}<div class="sp"></div>${pager(pg)}</div><div class="tw"><table><thead><tr><th>Zeile</th><th>Quelle</th><th>Feld</th><th>Rohwert</th><th>Normwert</th><th>Regel</th><th>Erläuterung</th><th>Konfidenz</th></tr></thead><tbody>${pg.list.map(({ r, c }) => `<tr><td>${idref(r.id)}</td><td>${idref(r.source_id)}</td><td>${esc(c.field)}</td><td><mark>${esc(c.from)}</mark></td><td><b>${esc(c.to)}</b></td><td class="mono" title="${esc(RULES[c.rule] || "")}">${c.rule}</td><td class="wrap">${esc(c.note || RULES[c.rule] || "")}</td><td>${c.confidence}</td></tr>`).join("")}</tbody></table><div class="pad small muted">Regeln: ${Object.entries(RULES).map(([k, v]) => `<b>${k}</b> ${esc(v)}`).join(" · ")}</div></div>`;
  wirePager(root, renderCorrections);
}

// ---------- Audit ----------
export function renderAudit(root) {
  const s = app.state;
  const pg = page(s.audit.slice().reverse(), (e) => [e.id, e.action, e.detail, ...(e.refs || [])].join(" "));
  root.innerHTML = `<div class="bar"><b>Audit-Trail</b><div class="sp"></div>${pager(pg)}</div><div class="tw"><table><thead><tr><th>ID</th><th>Zeit</th><th>Aktion</th><th>Details</th><th>Bezüge</th></tr></thead><tbody>${pg.list.map((e) => `<tr><td class="mono">${e.id}</td><td>${ts(e.ts)}</td><td>${e.action}</td><td class="wrap">${esc(e.detail)}</td><td class="wrap">${(e.refs || []).slice(0, 30).map(idref).join(" ")}${(e.refs || []).length > 30 ? " …" : ""}</td></tr>`).join("")}</tbody></table></div>`;
  wirePager(root, renderAudit);
}

// ---------- Inspector ----------
export function inspectorHtml(id) {
  const s = app.state, x = find(s, id);
  if (!x) return `<div class="ib muted">${esc(id)} nicht gefunden.</div>`;
  const pre = id.split("-")[0];
  const uses = (rid) => s.analyses.filter((a) => a.input_rows.some((k) => k.startsWith(rid + "@")));
  const linksOf = (rid) => s.links.filter((l) => (l.from === rid || l.to === rid) && l.status !== "rejected");
  let title = id, body = "";
  if (pre === "ROW") {
    const seg = x.seg_id ? find(s, x.seg_id) : null;
    const src = find(s, x.source_id);
    let segText = seg ? esc(seg.text) : "";
    for (const c of x.corrections) if (c.from && seg) segText = segText.replace(esc(c.from), `<mark title="${esc(c.rule)}">${esc(c.from)}</mark>`);
    title = `${id} · Zeile in ${esc(find(s, x.table_id)?.name || x.table_id)}`;
    body = `<div class="kv"><div>Quelle</div><div>${idref(src.id)} ${esc(src.name)} · ${esc(x.loc)}</div><div>Herkunft</div><div>${x.seg_id ? idref(x.seg_id) : "—"} · Methode ${x.method} · Konfidenz ${x.confidence} · Revision ${x.rev}</div></div>
      ${seg ? `<h3>Originaltext</h3><div class="seg">${segText}</div>` : ""}
      <h3>Strukturierte Werte</h3><div class="kv">${Object.entries(x.data).filter(([k]) => k !== "text").map(([k, v]) => `<div>${esc(k)}</div><div>${esc(fmt(v))} <button class="ghost small" data-fix="${id}" data-col="${esc(k)}">korrigieren</button></div>`).join("")}</div>
      ${x.corrections.length ? `<h3>Korrekturen (${x.corrections.length})</h3><ul>${x.corrections.map((c) => `<li><b>${esc(c.field)}</b>: <mark>${esc(c.from)}</mark> → <b>${esc(c.to)}</b> <span class="mono small">${c.rule}</span> <span class="muted small">${esc(c.note || RULES[c.rule] || "")} · Konf. ${c.confidence}</span></li>`).join("")}</ul>` : ""}
      <h3>Verbindungen</h3>${linksOf(id).map((l) => `<div>${idref(l.id)} ${idref(l.from === id ? l.to : l.from)} · ${esc(l.label)} <span class="muted small">${l.kind}/${l.status}${l.reason ? " · " + esc(l.reason) : ""}</span></div>`).join("") || '<span class="muted small">keine</span>'}
      <h3>Verwendet in</h3>${uses(id).map((a) => `<div>${idref(a.id)} ${esc(a.title)} v${a.version} <span class="muted small">${a.status}</span></div>`).join("") || '<span class="muted small">noch in keiner Analyse</span>'}`;
  } else if (pre === "SRC") {
    title = `${id} · ${esc(x.name)}`;
    body = `<div class="kv"><div>Typ</div><div>${x.type}${x.ocr ? " (OCR)" : ""}</div><div>Größe</div><div>${fmt(x.size)} Byte</div><div>SHA-256</div><div class="mono small">${x.sha256}</div><div>Importiert</div><div>${ts(x.imported_at)}</div><div>Kontext</div><div>${esc(JSON.stringify(x.context || {}))}</div><div>Extraktion</div><div>${esc(x.extraction || "regel")}</div></div>
      ${x.url ? `<p><a href="${esc(x.url)}" target="_blank" rel="noopener">Originaldatei öffnen</a></p>` : ""}
      <h3>Zeilen</h3>${s.rows.filter((r) => r.source_id === id).map((r) => idref(r.id)).join(" ")}`;
  } else if (pre === "SEG") {
    body = `<div class="seg">${esc(x.text)}</div><p>${idref(x.source_id)} · ${esc(x.loc)}</p><h3>Abgeleitete Zeilen</h3>${s.rows.filter((r) => r.seg_id === id).map((r) => idref(r.id)).join(" ") || "—"}`;
  } else if (pre === "LNK") {
    title = `${id} · Verbindung`;
    body = `<div class="kv"><div>Von</div><div>${idref(x.from)}</div><div>Nach</div><div>${idref(x.to)}</div><div>Bezeichnung</div><div>${esc(x.label)}</div><div>Art</div><div>${x.kind === "ai" ? "KI-Vorschlag" : x.kind === "auto" ? "Regel-Vorschlag" : "manuell"}</div><div>Status</div><div>${x.status}</div><div>Begründung</div><div>${esc(x.reason || "")}</div><div>Score</div><div>${x.score ?? "—"}</div></div>
      <div class="foot" style="justify-content:flex-start">${x.status !== "accepted" ? `<button class="primary sm" data-link-act="accepted" data-link="${id}">Bestätigen</button>` : ""}${x.status !== "rejected" ? `<button class="btn sm" data-link-act="rejected" data-link="${id}">Verwerfen</button>` : ""}</div>`;
  } else if (pre === "CALC") {
    title = `${id} · Schritt ${x.step}: ${esc(x.title)}`;
    body = `<div class="kv"><div>Analyse</div><div>${idref(x.analysis_id)}</div><div>Operation</div><div class="mono">${x.op}</div><div>Formel</div><div>${esc(x.formula)}</div></div><h3>Inputs (${x.inputs.length})</h3><div>${x.inputs.slice(0, 300).map(idref).join(" ")}${x.inputs.length > 300 ? " …" : ""}</div><h3>Output</h3><pre class="seg">${linkIds(esc(clip(JSON.stringify(x.output, null, 1))))}</pre>`;
  } else if (pre === "ANL") {
    title = `${id} · ${esc(x.title)} v${x.version}`;
    body = `<p>Status: <b>${x.status}</b>${x.status === "stale" ? ` – betroffen durch ${x.stale_info.map(idref).join(" ")}` : ""}</p><ul>${x.result.summary.map((l) => `<li>${linkIds(esc(l))}</li>`).join("")}</ul><p>Schritte: ${x.calc_ids.map(idref).join(" ")}</p><button class="btn sm" data-open-anl="${id}">In Analyse-Ansicht öffnen</button>`;
  } else if (pre === "CL") {
    title = `${id} · Ereignis aus ${x.analysis.id}`;
    body = `<div class="kv"><div>Orte</div><div>${esc(x.places.join(", ") || "—")}</div><div>Schwerpunkt</div><div>${x.lat != null ? `${x.lat}, ${x.lon}` : "—"}</div><div>Anzahl</div><div>${x.anzahl_max != null ? `${x.anzahl_min}–${x.anzahl_max}` : "—"} (${x.anzahl_belege.map((b) => `${b.n}× ${b.row}`).join(", ")})</div><div>Quellen</div><div>${x.sources.map(idref).join(" ")}</div><div>Bestätigung</div><div>${x.confidence}</div><div>Widersprüche</div><div>${esc(x.conflicts.join("; ") || "—")}</div><div>Beteiligte</div><div>${esc(x.actors.concat(x.refs).join(", ") || "—")}</div></div>${linkIds("")}<h3>Belege</h3>${x.members.map(idref).join(" ")}`;
  } else if (pre === "ENT") {
    title = `${id} · ${x.type}: ${esc(x.name)}`;
    body = `${x.lat != null ? `<p>Koordinaten ${x.lat}, ${x.lon}</p>` : ""}<h3>Erwähnungen</h3>${x.mentions.map(idref).join(" ")}`;
  } else if (pre === "TBL") {
    body = `<p>${esc(x.name)} · ${s.rows.filter((r) => r.table_id === id).length} Zeilen</p><p>Spalten: ${esc(x.columns.join(", "))}</p>`;
  }
  return `<div class="ih"><b>${title}</b><button class="x" data-close>×</button></div><div class="ib">${body}</div>`;
}

export function setLinkStatus(id, status) {
  const s = app.state, l = find(s, id);
  l.status = status;
  s.audit.push({ id: nextId(s, "EVT"), ts: now(), action: status === "accepted" ? "BESTÄTIGT" : "VERWORFEN", detail: `${l.id}: ${l.from} ↔ ${l.to} (${l.label})`, refs: [l.id, l.from, l.to] });
  app.commit();
}
