// Persistenz: kompletter Workspace-Zustand in IndexedDB (Fallback: nur im Speicher).
// Alles ist append-only gedacht: Zeilen werden nie geloescht, Korrekturen erzeugen Revisionen.

const DB_NAME = "katoptrik", STORE = "workspace", KEY = "state";

export function emptyState(profile = "lagebild") {
  return {
    schema: 2,
    workspace: { name: "Neuer Workspace", profile, created_at: new Date().toISOString(), tz_offset_utc: 2 },
    counters: {},
    sources: [], segments: [], tables: [], rows: [], entities: [], links: [],
    calcs: [], analyses: [], audit: [], chat: [], layout: {},
  };
}

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function load() {
  try {
    const db = await open();
    return await new Promise((res) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}

let pending = null;
export function save(state) {
  clearTimeout(pending);
  pending = setTimeout(async () => {
    try {
      const db = await open();
      db.transaction(STORE, "readwrite").objectStore(STORE).put(state, KEY); // structured clone, kein JSON-Umweg
    } catch (e) { console.warn("Speichern fehlgeschlagen", e); }
  }, 150);
}

export function exportJson(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `katoptrik-workspace-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
