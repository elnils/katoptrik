// Deterministische Normalisierer. Jeder Treffer liefert Rohwert, Normwert, Regel-ID
// und Konfidenz, damit jede Korrektur spaeter nachvollziehbar ist.
import { fold, levenshtein } from "./util.js";

const WORDNUM = { ein: 1, eine: 1, einem: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, zwoelf: 12 };
const HOURWORD = { eins: 1, ein: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12 };

export const RULES = {
  T1: "Uhrzeit HH:MM / HH.MM",
  T2: "Vierstellige Uhrzeit (0240 → 02:40)",
  T3: "Dezimalstunden als Uhrzeit gedeutet (2,5h → 02:30)",
  T4: "Umgangssprachliche Uhrzeit (halb drei → 02:30)",
  T5: "Ungefähre Stundenangabe (gegen 3 Uhr → 03:00)",
  T6: "UTC in Lokalzeit umgerechnet",
  T7: "Excel-Zeitwert umgerechnet",
  T8: "Meldezeit ≠ Ereigniszeit (Nachtrag)",
  T9: "12-Stunden-Angabe im Nachtkontext als Abend gedeutet",
  D4: "Nachtkontext: Zeit nach Mitternacht → Folgetag",
  D5: "Ereignisdatum aus Bezugszeile statt Meldedatum",
  D1: "Datum TT.MM.JJJJ",
  D2: "Datum aus Dokumentkontext ergänzt",
  D3: "Zweistelliges Jahr ergänzt",
  G1: "Koordinaten mit Himmelsrichtung",
  G2: "Ort aus Ortsverzeichnis geokodiert",
  G3: "Spaltenpaar Breite/Länge",
  G4: "Dezimalpaar als Koordinate gedeutet",
  S1: "Tippfehler korrigiert (Levenshtein ≤ 1)",
  N1: "Zahlwort in Zahl umgewandelt",
  M1: "Manuelle Korrektur",
  A1: "KI-Extraktion",
};

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (h, m) => `${pad(h)}:${pad(m)}`;

// Liefert alle Uhrzeit-Kandidaten eines Textes.
export function findTimes(text) {
  const t = fold(text), out = [];
  const push = (i, raw, h, m, rule, conf, note) => {
    if (h > 23 || m > 59) return;
    out.push({ index: i, raw, value: hhmm(h, m), rule, confidence: conf, note });
  };
  let r;
  const reDec = /\b(\d{1,2}),(\d{1,2})\s*h\b/g;
  while ((r = reDec.exec(t))) {
    const dec = parseFloat(`${r[1]}.${r[2]}`), h = Math.floor(dec), m = Math.round((dec - h) * 60);
    push(r.index, r[0], h, m, "T3", 0.6, `"${r[0]}" ist als Dauer formuliert; als Uhrzeit ${hhmm(h, m)} gedeutet`);
  }
  const reHM = /(?<![\d.,:T-])([01]?\d|2[0-3])([:.])([0-5]\d)(?::[0-5]\d)?(?![\d])(\s*uhr)?/g;
  const pair = findDecimalPair(t);
  while ((r = reHM.exec(t))) {
    const rest = t.slice(r.index + r[0].length);
    if (r[2] === ".") {
      if (rest.startsWith(".")) continue; // "23.09." ist ein Datum
      if (/^\.\d/.test(rest) || /^\.?\s?\d{2,4}\b/.test(rest.slice(0, 1) === "." ? rest : "")) continue; // Datum 12.09.2026
      if (!r[4]) {
        if (/^\s*°|^\s*[nsoew]\b/.test(rest)) continue; // Koordinate 11.28 E
        if (pair && pair.raw.split(" ").some((n) => parseFloat(n) === parseFloat(`${r[1]}.${r[3]}`) && +r[1] < 35)) continue; // Teil eines Koordinatenpaars
      }
    }
    push(r.index, r[0].trim(), +r[1], +r[3], "T1", r[2] === "." && !r[4] ? 0.8 : 0.95);
  }
  const re4 = /\b([01]\d|2[0-3])([0-5]\d)\s*uhr\b/g;
  while ((r = re4.exec(t))) push(r.index, r[0], +r[1], +r[2], "T2", 0.85);
  const reHalb = /\b(halb|viertel nach|viertel vor|dreiviertel)\s+(\w+)/g;
  while ((r = reHalb.exec(t))) {
    const hw = HOURWORD[r[2]] ?? (/^\d+$/.test(r[2]) ? +r[2] : null);
    if (hw == null) continue;
    const map = { halb: [hw - 1, 30], "viertel nach": [hw, 15], "viertel vor": [hw - 1, 45], dreiviertel: [hw - 1, 45] };
    const [h, m] = map[r[1]];
    push(r.index, r[0], (h + 24) % 24, m, "T4", 0.7, "nachts angenommen, wenn Kontext Nacht nahelegt");
  }
  const reGegen = /\b(gegen|um|ca\.?)\s+(\d{1,2})\s*uhr\b/g;
  while ((r = reGegen.exec(t))) push(r.index, r[0], +r[2], 0, "T5", 0.6);
  // Duplikate an gleicher Stelle entfernen (bestes zuerst)
  out.sort((a, b) => a.index - b.index || b.confidence - a.confidence);
  return out.filter((c, i) => !out.slice(0, i).some((o) => Math.abs(o.index - c.index) < 3));
}

// Waehlt die Ereigniszeit, wenn mehrere Zeiten in einem Text stehen.
// Qualifizierte Angaben ("gegen 3 Uhr nachts") schlagen die Meldezeit eines Nachtrags.
export function pickEventTime(text, times) {
  if (!times.length) return null;
  const t = fold(text);
  const night = /nacht|nachts/.test(t);
  if (times.length > 1 && /nachtrag|nachmeldung/.test(t)) {
    const qual = times.find((x) => x.rule === "T5" || x.rule === "T4");
    if (qual) {
      const report = times.find((x) => x !== qual);
      return { ...qual, rule: qual.rule, note: `Ereigniszeit ${qual.value}; ${report.value} ist Meldezeit (${RULES.T8})`, reportTime: report.value };
    }
  }
  const best = times[0];
  if (night && best.rule === "T4") {
    const [h, m] = best.value.split(":").map(Number);
    if (h >= 12) return { ...best, value: hhmm(h - 12, m) };
  }
  return best;
}

export function applyUtc(time, offset) {
  const [h, m] = time.split(":").map(Number);
  return hhmm((h + offset + 24) % 24, m);
}

// UTC-Datum+Zeit in Lokalzeit, inkl. Datumswechsel ueber Mitternacht
export function utcToLocal(date, time, offset) {
  const d = new Date(`${date}T${time}:00Z`);
  if (isNaN(d)) return { date, time: applyUtc(time, offset) };
  const l = new Date(d.getTime() + offset * 3600000).toISOString();
  return { date: l.slice(0, 10), time: l.slice(11, 16), dayShift: l.slice(0, 10) !== date };
}

// ISO-Zeitstempel "2026-09-24T00:31:00Z" / "+02:00"
export function parseIso(s, offset) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(s).trim());
  if (!m) return null;
  if (!m[3]) return { date: m[1], time: m[2], rule: "D1" };
  const tzm = m[3] === "Z" ? 0 : (m[3][0] === "-" ? -1 : 1) * (+m[3].slice(1, 3) * 60 + +m[3].slice(-2));
  const loc = new Date(Date.parse(`${m[1]}T${m[2]}:00Z`) - tzm * 60000 + offset * 3600000).toISOString();
  return { date: loc.slice(0, 10), time: loc.slice(11, 16), rule: tzm === offset * 60 ? "D1" : "T6", note: `${m[3] === "Z" ? "UTC" : "UTC" + m[3]} → UTC+${offset}` };
}

// Datum: 24.09.2026, 24.9., 24.09.26, 2026-09-24
export function findDate(text, ctxYear) {
  const t = String(text);
  let r = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (r) return { raw: r[0], value: `${r[1]}-${r[2]}-${r[3]}`, rule: "D1", confidence: 0.95 };
  r = /\b(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)/.exec(t);
  if (!r) return null;
  const d = +r[1], mo = +r[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y = r[3], rule = "D1", conf = 0.95;
  if (!y) { if (!ctxYear) return { raw: r[0], partial: true, day: d, month: mo }; y = ctxYear; rule = "D2"; conf = 0.8; }
  else if (y.length === 2) { y = "20" + y; rule = "D3"; conf = 0.85; }
  return { raw: r[0], value: `${y}-${pad(mo)}-${pad(d)}`, rule, confidence: conf };
}

export function parseDateCell(v) {
  if (v instanceof Date && !isNaN(v)) return { value: `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`, time: v.getHours() || v.getMinutes() ? hhmm(v.getHours(), v.getMinutes()) : null, rule: "T7" };
  return null;
}

// Koordinaten: "54.52 N, 11.28 E" oder "54,52°N 11,28°O"
export function findCoords(text) {
  const t = String(text);
  const r = /(\d{1,2}[.,]\d+)\s*°?\s*([NS])\b[\s,;]*(\d{1,3}[.,]\d+)\s*°?\s*([EOW])\b/i.exec(t);
  if (!r) return null;
  let lat = parseFloat(r[1].replace(",", ".")), lon = parseFloat(r[3].replace(",", "."));
  if (/s/i.test(r[2])) lat = -lat;
  if (/w/i.test(r[4])) lon = -lon;
  return { raw: r[0], lat, lon, rule: "G1", confidence: 0.95 };
}

// Zwei Dezimalzahlen, die als Breite/Laenge plausibel sind (z. B. Tabellenzeile im PDF).
export function findDecimalPair(text) {
  const nums = [...String(text).matchAll(/(?<![\d:])(\d{1,3}\.\d{2,6})(?![\d:])/g)].map((m) => parseFloat(m[1]));
  for (let i = 0; i + 1 < nums.length; i++) {
    const [a, b] = [nums[i], nums[i + 1]];
    if (a >= 35 && a <= 72 && b >= -30 && b <= 45) return { raw: `${a} ${b}`, lat: a, lon: b, rule: "G4", confidence: 0.7 };
  }
  return null;
}

export function findPlaces(text, gazetteer) {
  const t = fold(text), out = [];
  for (const [name, [lat, lon]] of Object.entries(gazetteer)) {
    const k = fold(name);
    const i = t.search(new RegExp(`\\b${k}`));
    if (i >= 0) out.push({ name, lat, lon, index: i });
  }
  // spezifischster Ort (laengster Name) zuerst, "Ostsee" nur als Rueckfall
  return out.sort((a, b) => (a.name === "Ostsee") - (b.name === "Ostsee") || b.name.length - a.name.length);
}

// Anzahl + Objekt, inkl. Tippfehlerkorrektur gegen das Profilvokabular ("drohen" → "Drohnen").
export function findCountObject(text, objects) {
  const t = fold(text);
  const vocab = objects.map((o) => ({ o, f: fold(o) }));
  const re = /(?<![\d:.,])\b(\d{1,4}|ein|eine|einem|einen|zwei|drei|vier|fuenf|sechs|sieben|acht|neun|zehn|zwoelf)\s+([a-z-]{3,})(?:\s+([a-z-]{3,}))?/g;
  let r;
  while ((r = re.exec(t))) {
    if (/^(uhr|min|minuten|std|stunden|tage?|wochen?|km|kn|m)$/.test(r[2])) { re.lastIndex = r.index + r[1].length + 1; continue; }
    for (const word of [r[2], r[3]].filter(Boolean)) {
      let hit = vocab.find((v) => v.f === word), fixed = null;
      if (!hit) {
        hit = vocab.find((v) => v.f.length > 4 && levenshtein(v.f, word) === 1);
        if (hit) fixed = { from: word, to: hit.o, rule: "S1" };
      }
      if (!hit) continue;
      const isWord = !/^\d/.test(r[1]);
      return { raw: r[0], count: isWord ? WORDNUM[r[1]] : +r[1], object: hit.o, numRule: isWord ? "N1" : null, fixed };
    }
    re.lastIndex = r.index + r[1].length + 1;
  }
  return null;
}

export function findRefs(text) {
  const t = String(text), out = new Set();
  for (const m of t.matchAll(/\b[A-Z]{1,5}-\d{2,}(?:-\d+)*\b/g)) out.add(m[0]);
  for (const m of t.matchAll(/\bIMO\s?\d{7}\b/g)) out.add(m[0].replace(/\s/, " "));
  for (const m of t.matchAll(/\b[A-Z]{4}\d{7}\b/g)) out.add(m[0]);
  return [...out];
}

export function findActors(text) {
  const t = String(text), out = new Set();
  for (const m of t.matchAll(/\b(?:Hr\.|Fr\.|Herr|Frau)\s+[A-ZÄÖÜ][a-zäöüß]+/g)) out.add(m[0]);
  for (const m of t.matchAll(/\b[A-Z]\.\s[A-ZÄÖÜ][a-zäöüß]+\b/g)) out.add(m[0]);
  for (const m of t.matchAll(/\b(?:[A-ZÄÖÜ][\wäöüß-]+\s){0,3}[A-ZÄÖÜ][\wäöüß-]+\s(?:GmbH|AG|Ltd|KG|SE|Inc)\b/g)) out.add(m[0]);
  for (const m of t.matchAll(/\b(?:Frachter|Schiff|Kutter|MS|MV)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g)) out.add(m[1]);
  return [...out].map((a) => a.replace(/^(?:Die|Der|Das|Den|Dem|Des)\s+/, ""));
}

// Betraege/Mengen mit Einheit
export function findAmounts(text) {
  const t = String(text), out = [];
  const re = /(\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?|\d+(?:[.,]\d+)?)\s*(€|EUR|Euro|%|kn|km\/h|km|m\b|Tage?n?|Wochen?|Stueck|Stück)/gi;
  let r;
  while ((r = re.exec(t))) {
    const num = parseFloat(r[1].replace(/[.\s](?=\d{3}\b)/g, "").replace(",", "."));
    let unit = r[2].toLowerCase();
    if (unit === "eur" || unit === "euro") unit = "€";
    if (/^tag/.test(unit)) unit = "Tage";
    if (/^woche/.test(unit)) unit = "Wochen";
    out.push({ raw: r[0], value: num, unit });
  }
  return out;
}
