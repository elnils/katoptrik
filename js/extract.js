// Unstrukturiert → strukturiert. Jede Quelle landet in Tabellen mit eindeutigen Zeilen-IDs:
//   Textsegmente (SEG) · Rohtabellen je Excel-Blatt (ROW) · Beobachtungen (ROW)
// Jede Normalisierung wird als Korrektur mit Regel-ID an der Zeile gespeichert.
import { fold, nextId, now, uniq } from "./util.js";
import * as N from "./normalize.js";
import { profileOf } from "./profiles.js";

export const OBS_COLUMNS = ["datum", "zeit", "zeit_roh", "ort", "lat", "lon", "anzahl", "objekt", "akteure", "referenzen", "betrag", "einheit", "von", "an", "text"];

export function obsTable(state) {
  let t = state.tables.find((x) => x.kind === "observations");
  if (!t) {
    t = { id: nextId(state, "TBL"), name: "Beobachtungen", kind: "observations", columns: OBS_COLUMNS, created_at: now() };
    state.tables.push(t);
  }
  return t;
}

function docContext(allText, state) {
  const t = fold(allText);
  const full = N.findDate(allText);
  let date = full && !full.partial ? full.value : null;
  if (!date) {
    const m = allText.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/);
    if (m) date = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return { date, year: date ? date.slice(0, 4) : String(new Date().getFullYear()), utc: /\butc\b/.test(t), utcOffset: state.workspace.tz_offset_utc ?? 2 };
}

// Kernfunktion: Text → Beobachtungsfelder + Korrekturen
export function analyzeText(text, ctx, profile) {
  const data = { text: text.trim() }, corr = [];
  let conf = 1;
  const times = N.findTimes(text);
  const t = N.pickEventTime(text, times);
  if (t) {
    data.zeit_roh = t.raw;
    let v = t.value, note = t.note;
    if (ctx.utc) {
      const loc = N.applyUtc(v, ctx.utcOffset);
      corr.push({ field: "zeit", from: `${v} UTC`, to: loc, rule: "T6", note: `UTC+${ctx.utcOffset} (Dokument nennt UTC)`, confidence: 0.95 });
      v = loc;
    }
    if (t.rule !== "T1" || note) corr.push({ field: "zeit", from: t.raw, to: t.value, rule: t.rule, note: note || N.RULES[t.rule], confidence: t.confidence });
    if (t.reportTime) data.meldezeit = t.reportTime;
    data.zeit = v;
    conf = Math.min(conf, t.confidence);
  }
  const d = N.findDate(text, ctx.year);
  if (d && !d.partial) {
    data.datum = d.value;
    if (d.rule !== "D1") corr.push({ field: "datum", from: d.raw, to: d.value, rule: d.rule, note: N.RULES[d.rule], confidence: d.confidence });
  } else if (ctx.date && (data.zeit || d?.partial)) {
    data.datum = ctx.date;
    corr.push({ field: "datum", from: d?.raw || "—", to: ctx.date, rule: "D2", note: N.RULES.D2, confidence: 0.8 });
  }
  const c = N.findCoords(text) || N.findDecimalPair(text);
  const places = N.findPlaces(text, profile.gazetteer);
  if (places.length) data.ort = places[0].name;
  if (c) {
    data.lat = c.lat; data.lon = c.lon;
    if (c.rule === "G4") corr.push({ field: "lat/lon", from: c.raw, to: `${c.lat}, ${c.lon}`, rule: "G4", note: N.RULES.G4, confidence: c.confidence });
  } else if (places.length) {
    data.lat = places[0].lat; data.lon = places[0].lon;
    corr.push({ field: "lat/lon", from: places[0].name, to: `${places[0].lat}, ${places[0].lon}`, rule: "G2", note: N.RULES.G2, confidence: 0.5 });
  }
  const co = N.findCountObject(text, profile.objects);
  if (co) {
    data.anzahl = co.count; data.objekt = co.object;
    if (co.fixed) corr.push({ field: "objekt", from: co.fixed.from, to: co.fixed.to, rule: "S1", note: N.RULES.S1, confidence: 0.85 });
    if (co.numRule) corr.push({ field: "anzahl", from: co.raw.split(" ")[0], to: String(co.count), rule: "N1", note: N.RULES.N1, confidence: 0.9 });
  } else {
    const obj = profile.objects.find((o) => new RegExp(`\\b${fold(o)}\\b`).test(fold(text)));
    if (obj) data.objekt = obj;
  }
  const actors = N.findActors(text);
  if (actors.length) data.akteure = actors.join("; ");
  const refs = N.findRefs(text);
  if (refs.length) data.referenzen = refs.join("; ");
  const am = N.findAmounts(text).find((a) => ["€", "%", "Tage", "Wochen"].includes(a.unit));
  if (am) { data.betrag = am.value; data.einheit = am.unit; }
  const salient = data.zeit || c || co || refs.length || am || actors.length || (data.datum && places.length);
  return { data, corr, conf, salient: !!salient };
}

function isHeaderish(line) {
  const l = line.trim();
  return l.length < 6 || /^(von|betreff|an|cc|gruesse|grüße|gez\.|datum|stand)\b/i.test(l);
}

// Spaltenrollen in Excel-Tabellen anhand der Kopfzeile erkennen
function columnRoles(header) {
  const roles = {};
  header.forEach((h, i) => {
    const f = fold(h);
    const set = (k) => { if (roles[k] == null) roles[k] = i; };
    if (/zeitstempel|timestamp|uhrzeit|^zeit/.test(f)) set("zeit");
    if (/^(breite|lat)/.test(f)) set("lat");
    if (/^(laenge|lon|lng)/.test(f)) set("lon");
    if (/anzahl|menge|count|stueck/.test(f)) set("anzahl");
    if (/^(typ|art|objekt|teil|type)/.test(f)) set("objekt");
    if (/^(von|from|absender|sender)$/.test(f)) set("von");
    if (/^(an|to|empfaenger)$/.test(f)) set("an");
    if (/lieferant|firma|person|sensor|betreiber|kunde/.test(f)) set("akteur");
    if (/betrag|wert|eur|preis|summe/.test(f)) set("betrag");
    if (/hafen|^ort|standort|stadt/.test(f)) set("ort");
    if (/bestellung|^po|^id$|^nr|track|aktenzeichen|^az/.test(f)) set("ref");
  });
  // Bezugsdatum einer Zeile: explizites Datum vor Soll-Termin vor Ist-Termin vor Bestelldatum
  for (const re of [/^datum|^date/, /zugesagt|faellig|^soll/, /geliefert|^ist/, /bestellt/]) {
    const i = header.findIndex((h) => re.test(fold(h)));
    if (i >= 0) { roles.datum = i; break; }
  }
  return roles;
}

function cellStr(v) {
  if (v instanceof Date) {
    const d = new Date(v.getTime() + 30000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  return String(v ?? "");
}

function normCell(v, ctx, kind) {
  const corr = [];
  if (v instanceof Date) {
    const s = cellStr(v);
    return { date: s.slice(0, 10), time: kind === "zeit" && s.slice(11) !== "00:00" ? s.slice(11) : null, corr: [{ from: "Excel-Datum", to: s, rule: "T7", note: N.RULES.T7, confidence: 0.99 }] };
  }
  if (typeof v === "number" && kind === "zeit" && v < 1) {
    const mins = Math.round(v * 1440), s = `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    return { time: s, corr: [{ from: String(v), to: s, rule: "T7", note: N.RULES.T7, confidence: 0.95 }] };
  }
  const s = String(v ?? "");
  if (!s.trim()) return {};
  const d = N.findDate(s, ctx.year);
  const ts = kind === "zeit" ? N.findTimes(s) : [];
  const t = ts[0];
  const out = { corr };
  if (d && !d.partial) { out.date = d.value; if (d.rule !== "D1") corr.push({ from: d.raw, to: d.value, rule: d.rule, note: N.RULES[d.rule], confidence: d.confidence }); }
  if (t) { out.time = t.value; if (t.rule !== "T1" || t.raw.includes(".")) corr.push({ from: t.raw, to: t.value, rule: t.rule, note: t.note || N.RULES[t.rule], confidence: t.confidence }); }
  return out;
}

export function ingest(state, source, parsed, opts = {}) {
  const profile = profileOf(state);
  const obs = obsTable(state);
  const made = { segments: 0, rows: 0, obs: 0, tables: [] };
  const baseConf = parsed.ocr ? Math.max(0.4, parsed.ocrConfidence ?? 0.7) : 1;

  const addObs = (seg, loc, a, extra = {}) => {
    const row = {
      id: nextId(state, "ROW"), table_id: obs.id, source_id: source.id, seg_id: seg, loc, rev: 1,
      data: a.data, corrections: a.corr.map((c) => ({ ...c, at: now() })), confidence: Math.round(a.conf * baseConf * 100) / 100,
      method: extra.method || "regel", created_at: now(),
    };
    state.rows.push(row);
    made.obs++;
    return row;
  };

  if (parsed.pages) {
    const allText = parsed.pages.flatMap((p) => p.lines).join("\n");
    const ctx = docContext(allText, state);
    source.context = ctx;
    for (const p of parsed.pages) {
      // Umbrochene Absaetze (PDF/OCR) wieder zu Saetzen zusammenfuegen
      if (source.type !== "TXT") {
        const merged = [];
        for (const l of p.lines.map((x) => x.trim()).filter(Boolean)) {
          const prev = merged[merged.length - 1];
          if (prev && prev.length >= 60 && !/[.:!?]$/.test(prev) && !/^[-•\d]/.test(l)) merged[merged.length - 1] = prev + " " + l;
          else merged.push(l);
        }
        p.lines = merged;
      }
      p.lines.forEach((line, i) => {
        if (!line.trim()) return;
        const loc = parsed.pages.length > 1 || source.type === "PDF" ? `S.${p.page} Z.${i + 1}` : `Z.${i + 1}`;
        const seg = { id: nextId(state, "SEG"), source_id: source.id, loc, text: line.trim() };
        state.segments.push(seg);
        made.segments++;
        if (isHeaderish(line)) return;
        const a = analyzeText(line, ctx, profile);
        if (a.salient && !opts.skipTextObs) addObs(seg.id, loc, a);
      });
    }
  }

  if (parsed.sheets) {
    for (const sh of parsed.sheets) {
      const roles = columnRoles(sh.header);
      const firstDate = sh.rows.map((r) => r[roles.zeit ?? roles.datum]).map((v) => (v instanceof Date ? cellStr(v).slice(0, 10) : N.findDate(String(v ?? ""))?.value)).find(Boolean);
      const ctx = { date: firstDate || null, year: (firstDate || String(new Date().getFullYear())).slice(0, 4) };
      const dateCols = sh.header.map((h, i) => i).filter((i) => i === roles.zeit || /datum|date|zugesagt|bestellt|geliefert|faellig|zeit/.test(fold(sh.header[i])));
      const columns = [...sh.header, ...dateCols.map((i) => `${sh.header[i]} (norm)`)];
      const tbl = { id: nextId(state, "TBL"), name: `${source.name} › ${sh.name}`, kind: "raw", source_id: source.id, columns, roles, created_at: now() };
      state.tables.push(tbl);
      made.tables.push(tbl.id);
      source.context = ctx;
      sh.rows.forEach((r, i) => {
        const loc = `${sh.name}!Z.${i + 2}`;
        const data = {}, corrections = [];
        sh.header.forEach((h, j) => { data[h] = r[j] instanceof Date ? cellStr(r[j]) : r[j]; });
        const norm = {};
        for (const j of dateCols) {
          const n = normCell(r[j], ctx, j === roles.zeit ? "zeit" : "datum");
          let date = n.date, corr = n.corr || [];
          if (!date && n.time && ctx.date) { date = ctx.date; corr = [...corr, { from: "—", to: ctx.date, rule: "D2", note: "Datum aus übrigen Zeilen des Blatts", confidence: 0.75 }]; }
          norm[j] = { date, time: n.time };
          data[`${sh.header[j]} (norm)`] = [date, n.time].filter(Boolean).join(" ") || "";
          corrections.push(...corr.map((c) => ({ ...c, field: sh.header[j], at: now() })));
        }
        const raw = { id: nextId(state, "ROW"), table_id: tbl.id, source_id: source.id, seg_id: null, loc, rev: 1, data, corrections, confidence: 1, method: "import", created_at: now() };
        state.rows.push(raw);
        made.rows++;

        // Beobachtung ableiten, wenn Zeit- oder Datumsbezug vorhanden
        const tj = roles.zeit ?? roles.datum;
        if (tj == null) return;
        const nt = norm[tj] || {};
        if (!nt.date && !nt.time) return;
        const text = sh.header.map((h, j) => `${h}: ${cellStr(r[j])}`).filter((s) => !/:\s*$/.test(s)).join(" · ");
        const od = { text, datum: nt.date, zeit: nt.time || undefined };
        if (nt.time) od.zeit_roh = cellStr(r[tj]);
        const num = (k) => (roles[k] != null && r[roles[k]] !== "" && !isNaN(+r[roles[k]]) ? +r[roles[k]] : undefined);
        od.lat = num("lat"); od.lon = num("lon"); od.anzahl = num("anzahl"); od.betrag = num("betrag");
        if (od.betrag != null) od.einheit = /eur|€/i.test(sh.header[roles.betrag]) ? "€" : "";
        if (roles.objekt != null) od.objekt = cellStr(r[roles.objekt]);
        if (roles.ort != null) od.ort = cellStr(r[roles.ort]);
        if (roles.von != null) od.von = cellStr(r[roles.von]);
        if (roles.an != null) od.an = cellStr(r[roles.an]);
        const acts = [roles.akteur, roles.von, roles.an].filter((x) => x != null).map((j) => cellStr(r[j])).filter(Boolean);
        if (acts.length) od.akteure = uniq(acts).join("; ");
        if (roles.ref != null && r[roles.ref] !== "") od.referenzen = cellStr(r[roles.ref]);
        if (od.lat == null && od.ort) {
          const pl = N.findPlaces(od.ort, profile.gazetteer)[0];
          if (pl) { od.lat = pl.lat; od.lon = pl.lon; corrections.push({ field: "lat/lon", from: od.ort, to: `${pl.lat}, ${pl.lon}`, rule: "G2", note: N.RULES.G2, confidence: 0.5 }); }
        }
        Object.keys(od).forEach((k) => od[k] === undefined && delete od[k]);
        const oc = corrections.filter((c) => c.field === sh.header[tj] || c.field === "lat/lon").map((c) => ({ ...c, field: c.field === "lat/lon" ? c.field : "zeit" }));
        addObs(raw.id, loc, { data: od, corr: oc, conf: Math.min(1, ...oc.map((c) => c.confidence)) }, { method: "tabelle" });
      });
    }
  }
  return made;
}

// Entitaeten (Orte, Objekte, Akteure, Referenzen) aus allen Beobachtungen neu ableiten.
export function rebuildEntities(state) {
  const profile = profileOf(state);
  const map = new Map(state.entities.map((e) => [e.type + ":" + fold(e.name), { ...e, mentions: [] }]));
  const add = (type, name, rowId, geo) => {
    name = String(name).trim();
    if (!name || name.length < 2) return;
    const k = type + ":" + fold(name);
    let e = map.get(k);
    if (!e) { e = { id: nextId(state, "ENT"), type, name, mentions: [] }; map.set(k, e); }
    if (geo && e.lat == null) { e.lat = geo[0]; e.lon = geo[1]; }
    if (!e.mentions.includes(rowId)) e.mentions.push(rowId);
  };
  const obsId = state.tables.find((t) => t.kind === "observations")?.id;
  for (const r of state.rows) {
    if (r.table_id !== obsId) continue;
    const d = r.data;
    if (d.ort) add("ORT", d.ort, r.id, profile.gazetteer[d.ort]);
    if (d.objekt) add("OBJEKT", d.objekt.replace(/\s*\(.*\)$/, ""), r.id);
    String(d.akteure || "").split(";").forEach((a) => add("AKTEUR", a, r.id));
    String(d.referenzen || "").split(";").forEach((a) => add("REFERENZ", a, r.id));
  }
  state.entities = [...map.values()].filter((e) => e.mentions.length);
}

// Von der KI extrahierte Beobachtungen uebernehmen (nur gueltige Segment-IDs).
export function addAiRows(state, source, items, model) {
  const obs = obsTable(state);
  const segs = new Map(state.segments.filter((s) => s.source_id === source.id).map((s) => [s.id, s]));
  let n = 0;
  for (const it of items) {
    const seg = segs.get(it.seg_id);
    if (!seg) continue;
    const data = { text: seg.text };
    for (const k of OBS_COLUMNS) if (k !== "text" && it[k] != null && it[k] !== "") data[k] = it[k];
    const corrections = (it.korrekturen || []).map((c) => ({ field: c.feld, from: c.von, to: c.nach, rule: "A1", note: `${c.begruendung} (${model})`, confidence: it.konfidenz ?? 0.8, at: now() }));
    state.rows.push({ id: nextId(state, "ROW"), table_id: obs.id, source_id: source.id, seg_id: seg.id, loc: seg.loc, rev: 1, data, corrections, confidence: it.konfidenz ?? 0.8, method: "ki", created_at: now() });
    n++;
  }
  return n;
}
