// Gemeinsamer Anwendungskontext fuer alle Ansichten.
export const app = {
  state: null,
  view: "canvas",
  sel: {},        // Auswahl je Ansicht (z. B. Tabelle, Analyse)
  commit: null,   // speichern + neu zeichnen
  inspect: null,  // Detailansicht fuer beliebige ID
  toast: null,
};

export function find(state, id) {
  const p = id.split("-")[0];
  const coll = { SRC: "sources", SEG: "segments", TBL: "tables", ROW: "rows", ENT: "entities", LNK: "links", CALC: "calcs", ANL: "analyses", EVT: "audit" }[p];
  if (coll) return state[coll].find((x) => x.id === id);
  if (p === "CL") {
    for (const a of state.analyses) {
      const e = a.result?.events?.find((x) => x.id === id);
      if (e) return { ...e, analysis: a };
    }
  }
  return null;
}

export const srcName = (state, id) => state.sources.find((s) => s.id === id)?.name || id;
export const obsTableId = (state) => state.tables.find((t) => t.kind === "observations")?.id;
export const latest = (state, type) => state.analyses.filter((a) => (!type || a.type === type) && a.status !== "superseded").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

const PALETTE = ["#2457d6", "#177550", "#b4541a", "#7541bd", "#b3261e", "#0f7b8a", "#8a6d00", "#5b6470"];
export const srcColor = (state, id) => PALETTE[Math.max(0, state.sources.findIndex((s) => s.id === id)) % PALETTE.length];
