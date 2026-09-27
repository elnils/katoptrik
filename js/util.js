// Kleine Helfer: IDs, Hashes, Escaping, Textnormalisierung.

export const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

// Umlaute/Akzente falten, damit "ueber" == "über" und "Laenge" == "Länge".
export function fold(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const PAD = { SRC: 4, SEG: 5, TBL: 3, ROW: 5, ENT: 4, LNK: 4, CALC: 4, ANL: 4, EVT: 5, CL: 3 };

// Fortlaufende, menschenlesbare IDs je Typ. Werden nie wiederverwendet.
export function nextId(state, prefix) {
  state.counters[prefix] = (state.counters[prefix] || 0) + 1;
  return `${prefix}-${String(state.counters[prefix]).padStart(PAD[prefix] || 4, "0")}`;
}

export async function sha256(buf) {
  const data = typeof buf === "string" ? new TextEncoder().encode(buf) : buf;
  const h = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Synchroner, stabiler Kurz-Hash (FNV-1a) fuer Fingerprints von Analyse-Inputs.
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const now = () => new Date().toISOString();

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const uniq = (arr) => [...new Set(arr)];
export const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// Macht IDs in Text klickbar (ROW-00012, SRC-0003, ...).
export function linkIds(html) {
  return html.replace(/\b(SRC|SEG|TBL|ROW|ENT|LNK|CALC|ANL|CL)-\d{3,6}\b/g, (id) => `<a href="#" class="idref" data-id="${id}">${id}</a>`);
}
