// Deterministische, schrittweise Berechnungen. Jeder Schritt wird als CALC mit Inputs,
// Parametern, Formel und Output gespeichert; jede Analyse als versionierte ANL mit
// Fingerprint der Eingangszeilen. Neue oder korrigierte Zeilen machen Analysen "veraltet".
import { fold, fnv, haversineKm, nextId, now, round, uniq } from "./util.js";
import { profileOf } from "./profiles.js";

export const TYPES = { lagebild: "Lagebild", netzwerk: "Netzwerkanalyse", termine: "Termin- & Verzugsanalyse" };

const obsRows = (state) => {
  const t = state.tables.find((x) => x.kind === "observations");
  return t ? state.rows.filter((r) => r.table_id === t.id) : [];
};
const rowText = (r) => fold(Object.values(r.data).join(" "));
const fp = (rows) => fnv(rows.map((r) => `${r.id}@${r.rev}`).sort().join("|"));
const minutes = (r) => {
  if (!r.data.datum && !r.data.zeit) return null;
  const d = r.data.datum ? Date.parse(r.data.datum + "T00:00:00Z") / 60000 : 0;
  const [h, m] = (r.data.zeit || "00:00").split(":").map(Number);
  return d + h * 60 + m;
};
const fmtT = (min) => {
  const d = new Date(min * 60000).toISOString();
  return `${d.slice(8, 10)}.${d.slice(5, 7)}. ${d.slice(11, 16)}`;
};

// --- Scope ---------------------------------------------------------------
const STOP = new Set("erstelle erstell ein eine einen lagebild zum zur zu der die das den dem ueber aus allen alle quellen bitte zeige mir welche was wie viele wer ist sind und oder mit von fuer im in am auf analysiere analyse netzwerk verbindungen lieferungen verspaetet neu neue dateien geaendert zeitlinie".split(" "));
export function scopeFromQuestion(q) {
  return { terms: uniq(fold(q).split(/[^a-z0-9-]+/).filter((w) => w.length > 3 && !STOP.has(w))) };
}
export function selectScope(state, scope, type) {
  let rows = obsRows(state);
  if (type === "netzwerk") rows = rows.filter((r) => (r.data.von && r.data.an) || String(r.data.akteure || "").split(";").filter((s) => s.trim()).length >= 1);
  const terms = (scope.terms || []).filter((t) => rows.some((r) => rowText(r).includes(t)));
  const used = [];
  if (terms.length) {
    // Begriffe, die nur wenige Zeilen treffen, sind Filter; sehr allgemeine werden ignoriert
    const hit = rows.filter((r) => terms.some((t) => rowText(r).includes(t)));
    if (hit.length >= Math.min(3, rows.length)) { rows = hit; used.push(...terms); }
  }
  return { rows, usedTerms: used };
}

// --- Protokoll-Helfer ------------------------------------------------------
function recorder(state, anl) {
  let n = 0;
  return (title, op, inputs, params, output, formula) => {
    const c = { id: nextId(state, "CALC"), analysis_id: anl.id, step: ++n, title, op, inputs: uniq(inputs), params, output, formula, created_at: now() };
    state.calcs.push(c);
    anl.calc_ids.push(c.id);
    return c;
  };
}

function newAnalysis(state, type, scope, title) {
  const key = type + ":" + (scope.terms || []).slice().sort().join(",");
  const prev = state.analyses.filter((a) => a.key === key).sort((a, b) => b.version - a.version)[0];
  const anl = {
    id: nextId(state, "ANL"), key, type, title: title || TYPES[type], version: prev ? prev.version + 1 : 1, prev: prev?.id || null,
    scope, input_rows: [], fingerprint: null, calc_ids: [], result: null, status: "current", created_at: now(),
  };
  return { anl, prev };
}

function finish(state, anl, prev, rows) {
  anl.input_rows = rows.map((r) => `${r.id}@${r.rev}`);
  anl.fingerprint = fp(rows);
  if (prev) {
    prev.status = "superseded";
    anl.diff = diffAnalyses(state, prev, anl);
  }
  state.analyses.push(anl);
  state.audit.push({ id: nextId(state, "EVT"), ts: now(), action: "ANALYSE", detail: `${anl.title} v${anl.version} berechnet (${rows.length} Zeilen, ${anl.calc_ids.length} Schritte)`, refs: [anl.id] });
  return anl;
}

// --- Lagebild: zeitlich-raeumliche Ereignisbildung ------------------------
export function runLagebild(state, scope = { terms: [] }, title) {
  const profile = profileOf(state);
  const { windowMin, radiusKm } = profile.cluster;
  const { anl, prev } = newAnalysis(state, "lagebild", scope, title);
  const step = recorder(state, anl);
  const { rows, usedTerms } = selectScope(state, scope, "lagebild");
  step("Auswahl der Beobachtungen", "SELECT", rows.map((r) => r.id), { suchbegriffe: usedTerms.length ? usedTerms : "alle" }, { anzahl: rows.length, quellen: uniq(rows.map((r) => r.source_id)).length }, "Beobachtungen ∩ Suchbegriffe");

  const corr = rows.flatMap((r) => r.corrections.map((c) => ({ row: r.id, feld: c.field, von: c.from, nach: c.to, regel: c.rule, konfidenz: c.confidence })));
  step("Normalisierung & Korrekturen", "NORMALIZE", corr.map((c) => c.row), { regeln: uniq(corr.map((c) => c.regel)) }, { korrekturen: corr }, "Rohwert → Normwert je Regel");

  let timed = rows.filter((r) => minutes(r) != null && r.data.zeit || (windowMin >= 1440 && r.data.datum));
  const context = rows.filter((r) => !timed.includes(r));
  let excluded = [];
  if (windowMin < 1440) {
    const dates = timed.map((r) => r.data.datum).filter(Boolean);
    const mode = dates.sort((a, b) => dates.filter((x) => x === b).length - dates.filter((x) => x === a).length)[0];
    excluded = timed.filter((r) => r.data.datum && r.data.datum !== mode);
    timed = timed.filter((r) => !excluded.includes(r));
    step("Zeitraum bestimmen", "FILTER", rows.map((r) => r.id), { regel: "häufigstes Datum", datum: mode }, { im_zeitraum: timed.map((r) => r.id), ausgeschlossen: excluded.map((r) => r.id) }, "datum = modus(datum)");
  }

  timed.sort((a, b) => minutes(a) - minutes(b));
  const clusters = [];
  for (const r of timed) {
    const t = minutes(r);
    const c = clusters.find((c) => t - c.last <= windowMin && (r.data.lat == null || c.lat == null || haversineKm(c, r.data) <= radiusKm));
    if (c) {
      c.members.push(r); c.last = Math.max(c.last, t);
      const geo = c.members.filter((m) => m.data.lat != null);
      if (geo.length) { c.lat = geo.reduce((s, m) => s + m.data.lat, 0) / geo.length; c.lon = geo.reduce((s, m) => s + m.data.lon, 0) / geo.length; }
    } else clusters.push({ members: [r], first: t, last: t, lat: r.data.lat ?? null, lon: r.data.lon ?? null });
  }
  step("Ereignisse bilden (Clustering)", "CLUSTER", timed.map((r) => r.id), { zeitfenster_min: windowMin, radius_km: radiusKm }, { ereignisse: clusters.map((c) => c.members.map((m) => m.id)) }, "gleiches Ereignis ⇔ Δt ≤ Fenster ∧ Distanz(Schwerpunkt) ≤ Radius");

  const events = clusters.map((c) => {
    const m = c.members, srcs = uniq(m.map((x) => x.source_id));
    const counts = m.filter((x) => x.data.anzahl != null).map((x) => ({ row: x.id, n: x.data.anzahl, src: x.source_id }));
    const vals = counts.map((x) => x.n);
    const perSrcConf = srcs.map((s) => Math.max(...m.filter((x) => x.source_id === s).map((x) => x.confidence || 0.5)));
    const confidence = round(1 - perSrcConf.reduce((p, c) => p * (1 - c * 0.6), 1), 2);
    const places = uniq(m.map((x) => x.data.ort).filter(Boolean));
    // Singular/Plural zusammenfassen ("Drohne" = "Drohnen"), Zusaetze in Klammern ignorieren
    const stem = (o) => fold(o).replace(/(en|n|e|s)$/, "");
    const objs = m.map((x) => String(x.data.objekt || "").replace(/\s*\(.*\)$/, "")).filter(Boolean);
    const objects = uniq(objs.map(stem)).sort((a, b) => objs.filter((o) => stem(o) === b).length - objs.filter((o) => stem(o) === a).length).map((k) => objs.find((o) => stem(o) === k));
    const modeCount = vals.length ? uniq(vals).sort((a, b) => vals.filter((v) => v === b).length - vals.filter((v) => v === a).length || b - a)[0] : null;
    const actors = uniq(m.flatMap((x) => String(x.data.akteure || "").split(";").map((s) => s.trim())).filter(Boolean));
    const refs = uniq(m.flatMap((x) => String(x.data.referenzen || "").split(";").map((s) => s.trim())).filter(Boolean));
    const conflicts = [];
    if (vals.length && Math.min(...vals) !== Math.max(...vals)) conflicts.push(`Anzahl uneinheitlich (${uniq(vals).sort().join(" / ")})`);
    const lowConf = m.filter((x) => x.corrections.some((k) => k.field === "zeit" && k.confidence < 0.7));
    if (lowConf.length) conflicts.push(`${lowConf.length} Zeitangabe(n) nur unsicher normalisiert`);
    return {
      id: nextId(state, "CL"), members: m.map((x) => x.id), sources: srcs, start: c.first, end: c.last, dauer_min: c.last - c.first,
      lat: c.lat != null ? round(c.lat, 3) : null, lon: c.lon != null ? round(c.lon, 3) : null,
      anzahl_min: vals.length ? Math.min(...vals) : null, anzahl_max: vals.length ? Math.max(...vals) : null, anzahl_modus: modeCount, anzahl_belege: counts,
      confidence, places, objects, actors, refs, conflicts,
    };
  });
  events.forEach((e) => step(`Kennzahlen ${e.id}`, "AGGREGATE", e.members, { quellen: e.sources.length }, {
    zeitraum: `${fmtT(e.start)} – ${fmtT(e.end)}`, dauer_min: e.dauer_min, schwerpunkt: e.lat != null ? `${e.lat}, ${e.lon}` : "—",
    anzahl: e.anzahl_max != null ? `Spanne ${e.anzahl_min}–${e.anzahl_max}, häufigste Meldung ${e.anzahl_modus}` : "—", bestaetigung: e.confidence, widersprueche: e.conflicts,
  }, "Bestätigung = 1 − Π(1 − 0,6·Konfidenz je unabhängiger Quelle); Anzahl = Spanne und Modus der Meldungen"));

  const sname = (id) => state.sources.find((s) => s.id === id)?.name || id;
  const lines = [];
  lines.push(`${rows.length} Beobachtungen aus ${uniq(rows.map((r) => r.source_id)).length} Quellen ausgewertet; ${events.length} Ereignis(se) gebildet.`);
  for (const e of events.sort((a, b) => b.members.length - a.members.length)) {
    const where = e.places.length ? `Raum ${e.places.slice(0, 3).join(", ")}` : e.lat != null ? `Position ${e.lat} N, ${e.lon} E` : "Ort unbekannt";
    const cnt = e.anzahl_max != null ? ` Gemeldete Anzahl ${e.anzahl_min === e.anzahl_max ? e.anzahl_max : `${e.anzahl_min}–${e.anzahl_max}, am häufigsten ${e.anzahl_modus}`} (${e.anzahl_belege.map((b) => `${b.n}× ${b.row}`).join(", ")}); meist als „${e.objects[0] || "Objekt"}“ beschrieben.` : "";
    lines.push(`${e.id}: ${fmtT(e.start)}–${fmtT(e.end).slice(-5)} Uhr, ${where}.${cnt} ${e.sources.length} unabhängige Quelle(n) (${e.sources.map(sname).join(", ")}) → Bestätigung ${e.confidence}.${e.conflicts.length ? " Achtung: " + e.conflicts.join("; ") + "." : ""}${e.actors.length ? " Beteiligte/Objekte: " + e.actors.concat(e.refs).slice(0, 6).join(", ") + "." : ""}`);
  }
  if (excluded.length) lines.push(`Ausgeschlossen (anderer Tag): ${excluded.map((r) => r.id).join(", ")}.`);
  if (context.length) lines.push(`${context.length} Zeile(n) ohne Zeitbezug als Kontext geführt.`);
  step("Lagebild zusammenfassen", "SUMMARIZE", events.flatMap((e) => e.members), {}, { text: lines }, "Vorlage; jede Aussage verweist auf Zeilen-IDs");

  anl.result = { events, context: context.map((r) => r.id), excluded: excluded.map((r) => r.id), summary: lines };
  return finish(state, anl, prev, rows);
}

// --- Netzwerk ------------------------------------------------------------------
export function runNetzwerk(state, scope = { terms: [] }, title) {
  const { anl, prev } = newAnalysis(state, "netzwerk", scope, title);
  const step = recorder(state, anl);
  const { rows } = selectScope(state, scope, "netzwerk");
  step("Auswahl", "SELECT", rows.map((r) => r.id), {}, { anzahl: rows.length }, "Zeilen mit Akteuren");
  const edges = [];
  for (const r of rows) {
    if (r.data.von && r.data.an) edges.push({ from: r.data.von, to: r.data.an, art: r.data.objekt || "", betrag: r.data.betrag || 0, row: r.id, directed: true });
    else {
      const a = uniq(String(r.data.akteure || "").split(";").map((s) => s.trim()).filter(Boolean));
      for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) edges.push({ from: a[i], to: a[j], art: "gemeinsam erwähnt", betrag: 0, row: r.id, directed: false });
    }
  }
  step("Kanten bilden", "EDGES", rows.map((r) => r.id), { regel: "von→an (gerichtet) · gemeinsame Erwähnung (ungerichtet)" }, { kanten: edges.map((e) => `${e.from} → ${e.to} [${e.art}] ${e.row}`) }, "Kante je Zeile");
  const K = (s) => fold(s);
  const names = {};
  edges.forEach((e) => { names[K(e.from)] ||= e.from; names[K(e.to)] ||= e.to; });
  const deg = Object.fromEntries(Object.keys(names).map((k) => [k, { name: names[k], ein: 0, aus: 0, gesamt: 0, betrag_ein: 0, betrag_aus: 0, rows: [] }]));
  for (const e of edges) {
    const a = deg[K(e.from)], b = deg[K(e.to)];
    a.aus++; b.ein++; a.gesamt++; b.gesamt++; a.betrag_aus += e.betrag; b.betrag_ein += e.betrag; a.rows.push(e.row); b.rows.push(e.row);
  }
  const ranking = Object.values(deg).sort((a, b) => b.gesamt - a.gesamt);
  step("Zentralität (Grad)", "DEGREE", edges.map((e) => e.row), {}, { ranking: ranking.map((d) => `${d.name}: ${d.gesamt} (ein ${d.ein}/aus ${d.aus})`) }, "Grad = Anzahl anliegender Kanten");
  // Kreislaeufe in gerichteten Kanten
  const adj = {};
  edges.filter((e) => e.directed).forEach((e) => (adj[K(e.from)] ||= []).push(e));
  const cycles = [], seen = new Set();
  const dfs = (start, node, path) => {
    if (path.length > 6) return;
    for (const e of adj[node] || []) {
      const nk = K(e.to);
      if (nk === start && path.length >= 2) {
        const sig = [...path.map((p) => p.row), e.row].sort().join();
        if (!seen.has(sig)) { seen.add(sig); cycles.push([...path, e]); }
      } else if (!path.some((p) => K(p.from) === nk)) dfs(start, nk, [...path, e]);
    }
  };
  Object.keys(adj).forEach((k) => dfs(k, k, []));
  step("Kreisläufe suchen", "CYCLES", edges.filter((e) => e.directed).map((e) => e.row), { max_laenge: 6 }, { kreislaeufe: cycles.map((c) => c.map((e) => e.from).concat(c[0].from).join(" → ")) }, "Tiefensuche in gerichtetem Graph");
  const summary = [`${Object.keys(deg).length} Akteure, ${edges.length} Verbindungen aus ${rows.length} Zeilen.`];
  ranking.slice(0, 3).forEach((d, i) => summary.push(`${i + 1}. ${d.name}: ${d.gesamt} Verbindungen (Belege ${uniq(d.rows).join(", ")}).`));
  cycles.forEach((c) => {
    const sum = c.reduce((s, e) => s + (e.betrag || 0), 0);
    summary.push(`Kreislauf: ${c.map((e) => e.from).concat(c[0].from).join(" → ")}${sum ? ` (Beträge gesamt ${sum.toLocaleString("de-DE")} €)` : ""} – Belege ${c.map((e) => e.row).join(", ")}.`);
  });
  step("Zusammenfassen", "SUMMARIZE", edges.map((e) => e.row), {}, { text: summary }, "Vorlage");
  anl.result = { edges, ranking, cycles: cycles.map((c) => c.map((e) => e.row)), summary };
  return finish(state, anl, prev, rows);
}

// --- Termine / Verzug (z. B. Lieferketten) ---------------------------------------
export function runTermine(state, scope = { terms: [] }, title) {
  const { anl, prev } = newAnalysis(state, "termine", scope, title);
  const step = recorder(state, anl);
  const day = (s) => (s ? Date.parse(String(s).slice(0, 10) + "T00:00:00Z") / 864e5 : null);
  const orders = [];
  for (const t of state.tables.filter((t) => t.kind === "raw")) {
    const h = (re) => t.columns.find((c) => re.test(fold(c)) && /\(norm\)/.test(c));
    const soll = h(/zugesagt|soll|faellig/), ist = h(/geliefert|^ist/);
    if (!soll) continue;
    const key = t.columns.find((c) => /bestellung|^po|auftrag|^nr/.test(fold(c)));
    const sup = t.columns.find((c) => /lieferant|firma/.test(fold(c)));
    const port = t.columns.find((c) => /hafen|ort/.test(fold(c)) && !/\(norm\)/.test(c));
    const val = t.columns.find((c) => /wert|betrag|eur/.test(fold(c)));
    state.rows.filter((r) => r.table_id === t.id).forEach((r) => orders.push({ row: r.id, key: r.data[key], lieferant: r.data[sup], hafen: r.data[port], wert: +r.data[val] || 0, soll: r.data[soll], ist: r.data[ist] || null }));
  }
  const inputs = orders.map((o) => o.row);
  step("Aufträge mit Soll-Terminen sammeln", "SELECT", inputs, {}, { auftraege: orders.length }, "Tabellen mit Spalte Zugesagt/Soll");
  const obs = obsRows(state);
  const signals = [];
  for (const r of obs) {
    const txt = fold(r.data.text);
    const refs = String(r.data.referenzen || "").split(";").map((s) => s.trim());
    const delayUnit = r.data.einheit === "Wochen" ? 7 : r.data.einheit === "Tage" ? 1 : null;
    for (const o of orders) {
      const byRef = o.key && refs.includes(o.key);
      const byPort = o.hafen && txt.includes(fold(o.hafen)) && /streik|sperrung|stau|verzug/.test(txt);
      const bySupplier = o.lieferant && txt.includes(fold(o.lieferant)) && /verzug|verspaet|ausschuss/.test(txt);
      if (!(byRef || byPort || bySupplier)) continue;
      let tage = null;
      const mRef = new RegExp(`${o.key}[^.]*?verzug\\s*(\\d+)\\s*tag`, "i").exec(r.data.text);
      if (mRef) tage = +mRef[1];
      else if (byRef && delayUnit && r.data.betrag != null) tage = round(r.data.betrag * delayUnit, 1);
      else if (byPort) { const m = /(\d+)\s*tage/i.exec(r.data.text); tage = m ? +m[1] : null; }
      signals.push({ row: r.id, order: o.key, grund: byRef ? "Referenz" : byPort ? "Hafen betroffen" : "Lieferant genannt", tage, text: r.data.text.slice(0, 120) });
    }
  }
  step("Verzugs-Signale aus Texten zuordnen", "MATCH", signals.map((s) => s.row), { regeln: "Referenz (PO) · Hafen + Streik/Stau · Lieferant + Verzug" }, { signale: signals.map((s) => `${s.row} → ${s.order} (${s.grund}${s.tage != null ? `, ${s.tage} Tage` : ""})`) }, "Textzeile ↔ Auftrag");
  const stichtag = day(now());
  const res = orders.map((o) => {
    const s = signals.filter((x) => x.order === o.key);
    const ist = day(o.ist), soll = day(o.soll);
    let verzug = ist != null ? ist - soll : null, status;
    if (ist != null) status = verzug > 0 ? "verspätet geliefert" : "pünktlich";
    else {
      const erw = Math.max(0, ...s.map((x) => x.tage || 0));
      verzug = erw || (stichtag > soll ? stichtag - soll : 0);
      status = erw ? "Verzug erwartet" : s.length ? "Risiko" : stichtag > soll ? "überfällig" : "offen";
    }
    return { ...o, verzug_tage: verzug, status, signale: s.map((x) => x.row) };
  });
  step("Verzug je Auftrag berechnen", "COMPUTE", [...inputs, ...signals.map((s) => s.row)], { stichtag: now().slice(0, 10) }, { auftraege: res.map((o) => `${o.key}: ${o.status}${o.verzug_tage ? `, ${o.verzug_tage} Tage` : ""}`) }, "geliefert: Ist − Soll · offen: max(gemeldeter Verzug) bzw. Stichtag − Soll");
  const bySup = {};
  res.forEach((o) => {
    const b = (bySup[o.lieferant] ||= { lieferant: o.lieferant, auftraege: 0, kritisch: 0, wert_risiko: 0, rows: [] });
    b.auftraege++; b.rows.push(o.row, ...o.signale);
    if (o.status !== "pünktlich" && o.status !== "offen") { b.kritisch++; if (!o.ist) b.wert_risiko += o.wert; }
    signals.filter((x) => x.order === o.key && x.grund === "Hafen betroffen").forEach((x) => { (b.risiken ||= []).push(`${o.hafen}: ${x.text.slice(0, 80)} (${x.row})`); });
  });
  const sup = Object.values(bySup).sort((a, b) => b.wert_risiko - a.wert_risiko || b.kritisch - a.kritisch);
  step("Je Lieferant aggregieren", "AGGREGATE", res.map((o) => o.row), {}, { lieferanten: sup.map((s) => `${s.lieferant}: ${s.kritisch}/${s.auftraege} kritisch, ${s.wert_risiko.toLocaleString("de-DE")} € offen im Risiko`) }, "Summe Wert offener, kritischer Aufträge");
  const summary = [`${res.length} Aufträge geprüft, ${res.filter((o) => !["pünktlich", "offen"].includes(o.status)).length} kritisch; Wert im Risiko ${sup.reduce((s, x) => s + x.wert_risiko, 0).toLocaleString("de-DE")} €.`];
  res.filter((o) => !["pünktlich", "offen"].includes(o.status)).forEach((o) => summary.push(`${o.key} (${o.lieferant}): ${o.status}${o.verzug_tage ? `, ${o.verzug_tage} Tage` : ""} – Belege ${[o.row, ...o.signale].join(", ")}.`));
  sup.filter((x) => x.risiken?.length).forEach((x) => summary.push(`Risiko für Folgeaufträge bei ${x.lieferant}: ${[...new Set(x.risiken)].join("; ")}.`));
  step("Zusammenfassen", "SUMMARIZE", res.map((o) => o.row), {}, { text: summary }, "Vorlage");
  anl.result = { orders: res, suppliers: sup, signals, summary };
  const used = uniq([...inputs, ...signals.map((s) => s.row)]).map((id) => state.rows.find((r) => r.id === id));
  return finish(state, anl, prev, used);
}

export const RUNNERS = { lagebild: runLagebild, netzwerk: runNetzwerk, termine: runTermine };

// --- Versionen vergleichen -------------------------------------------------------
export function diffAnalyses(state, a, b) {
  const ids = (x) => new Set(x.input_rows.map((s) => s.split("@")[0]));
  const A = ids(a), B = ids(b);
  const out = [];
  const added = [...B].filter((x) => !A.has(x)), removed = [...A].filter((x) => !B.has(x));
  const revs = b.input_rows.filter((s) => A.has(s.split("@")[0]) && !a.input_rows.includes(s)).map((s) => s.split("@")[0]);
  if (added.length) out.push(`+${added.length} neue Zeile(n): ${added.join(", ")}`);
  if (removed.length) out.push(`−${removed.length} entfallene Zeile(n): ${removed.join(", ")}`);
  if (revs.length) out.push(`${revs.length} korrigierte Zeile(n): ${revs.join(", ")}`);
  if (a.type === "lagebild") {
    for (const e of b.result.events) {
      const best = a.result.events.map((o) => ({ o, j: e.members.filter((m) => o.members.includes(m)).length / new Set([...e.members, ...o.members]).size })).sort((x, y) => y.j - x.j)[0];
      if (!best || best.j === 0) { out.push(`Neues Ereignis ${e.id}`); continue; }
      const o = best.o;
      if (o.anzahl_modus !== e.anzahl_modus) out.push(`${o.id} → ${e.id}: häufigste gemeldete Anzahl ${o.anzahl_modus ?? "—"} → ${e.anzahl_modus ?? "—"}`);
      if (o.anzahl_max !== e.anzahl_max) out.push(`${o.id} → ${e.id}: Anzahl ${o.anzahl_max ?? "—"} → ${e.anzahl_max ?? "—"}`);
      if (o.end !== e.end || o.start !== e.start) out.push(`${o.id} → ${e.id}: Zeitraum ${fmtT(o.start)}–${fmtT(o.end).slice(-5)} → ${fmtT(e.start)}–${fmtT(e.end).slice(-5)}`);
      if (o.sources.length !== e.sources.length) out.push(`${o.id} → ${e.id}: Quellen ${o.sources.length} → ${e.sources.length}, Bestätigung ${o.confidence} → ${e.confidence}`);
      const newActors = e.actors.concat(e.refs).filter((x) => !o.actors.concat(o.refs).includes(x));
      if (newActors.length) out.push(`${e.id}: neu beteiligt ${newActors.join(", ")}`);
    }
  } else {
    const sa = new Set(a.result.summary), sb = b.result.summary.filter((l) => !sa.has(l));
    sb.forEach((l) => out.push(`Neu/geändert: ${l}`));
  }
  return out.length ? out : ["Keine inhaltliche Änderung."];
}

// Nach jedem Import/Korrektur: betroffene Analysen als veraltet markieren
export function checkStale(state) {
  const changed = [];
  for (const a of state.analyses.filter((x) => x.status === "current")) {
    let rows;
    if (a.type === "termine") {
      const known = new Set(a.input_rows.map((s) => s.split("@")[0]));
      rows = state.rows.filter((r) => known.has(r.id));
      const tmp = { ...state, calcs: [], analyses: [], counters: { ...state.counters }, audit: [] };
      const probe = runTermine(tmp, a.scope);
      rows = probe.input_rows;
      if (fnv(rows.slice().sort().join("|")) === fnv(a.input_rows.slice().sort().join("|"))) continue;
      a.stale_info = rows.filter((s) => !a.input_rows.includes(s)).map((s) => s.split("@")[0]);
    } else {
      const sel = selectScope(state, a.scope, a.type).rows;
      if (fp(sel) === a.fingerprint) continue;
      a.stale_info = sel.filter((r) => !a.input_rows.includes(`${r.id}@${r.rev}`)).map((r) => r.id);
    }
    a.status = "stale";
    changed.push(a);
    state.audit.push({ id: nextId(state, "EVT"), ts: now(), action: "VERALTET", detail: `${a.title} v${a.version}: ${a.stale_info.length} neue/geänderte Zeile(n) betreffen das Ergebnis`, refs: [a.id, ...a.stale_info] });
  }
  return changed;
}

// --- Verbindungsvorschlaege (regelbasiert, ohne KI) ------------------------------
export function suggestLinks(state) {
  const profile = profileOf(state);
  const rows = obsRows(state);
  const exists = new Set(state.links.map((l) => [l.from, l.to].sort().join("|")));
  const made = [];
  const win = Math.min(profile.cluster.windowMin / 2, 20), rad = Math.min(profile.cluster.radiusKm / 2, 15);
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i], cands = [];
    for (let j = i + 1; j < rows.length; j++) {
      const b = rows[j];
      if (a.source_id === b.source_id) continue;
      const reasons = [];
      let score = 0;
      const ra = String(a.data.referenzen || "").split(";").map((s) => s.trim()).filter(Boolean);
      const shared = ra.filter((x) => String(b.data.referenzen || "").split(";").map((s) => s.trim()).includes(x));
      if (shared.length) { reasons.push(`gleiche Referenz ${shared.join(", ")}`); score += 0.5; }
      const ta = minutes(a), tb = minutes(b);
      if (a.data.zeit && b.data.zeit && ta != null && tb != null && Math.abs(ta - tb) <= win) {
        reasons.push(`Δt ${Math.abs(ta - tb)} min`); score += 0.3 * (1 - Math.abs(ta - tb) / (win + 1));
        if (a.data.lat != null && b.data.lat != null) {
          const d = haversineKm(a.data, b.data);
          if (d <= rad) { reasons.push(`Distanz ${round(d, 1)} km`); score += 0.3 * (1 - d / (rad + 1)); } else continue;
        }
      }
      const aa = String(a.data.akteure || "").split(";").map((s) => fold(s.trim())).filter(Boolean);
      const sa = aa.filter((x) => String(b.data.akteure || "").split(";").map((s) => fold(s.trim())).includes(x));
      if (sa.length) { reasons.push("gleicher Akteur"); score += 0.36; }
      if (score >= 0.35) cands.push({ b, score: round(Math.min(score, 0.99), 2), reasons });
    }
    cands.sort((x, y) => y.score - x.score).slice(0, 2).forEach(({ b, score, reasons }) => {
      const k = [a.id, b.id].sort().join("|");
      if (exists.has(k)) return;
      exists.add(k);
      const l = { id: nextId(state, "LNK"), from: a.id, to: b.id, label: "möglicherweise dasselbe Ereignis", kind: "auto", status: "suggested", reason: reasons.join(" · "), score, created_at: now() };
      state.links.push(l);
      made.push(l);
    });
  }
  return made;
}
