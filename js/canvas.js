// Canvas: Quellen als Bahnen, Beobachtungen als Kaestchen entlang der Zeit,
// Ereignisse/Analysen darunter. Kaestchen verschiebbar; Verbinden per ⊕.
import { app, find, latest, obsTableId, srcColor } from "./ctx.js";
import { esc, fold, nextId, now } from "./util.js";

const NW = 176, NH = 66, LANE_X = 170, LANE_PAD = 14, MAX_ROWS = 250;
let zoom = 1, connectFrom = null;
const opts = { sug: true, events: true, ents: null, filter: "" };
const showEnts = (state) => opts.ents ?? state.workspace.profile === "netzwerk";

function minutes(r) {
  if (!r.data.zeit && !r.data.datum) return null;
  const d = r.data.datum ? Date.parse(r.data.datum + "T00:00:00Z") / 60000 : 0;
  const [h, m] = (r.data.zeit || "12:00").split(":").map(Number);
  return d + h * 60 + m;
}

// Welche Zeilen als Kaestchen erscheinen: alle (klein), gefilterte oder die des gewaehlten Ereignisses (gross)
function visibleRows(state) {
  const all = state.rows.filter((r) => r.table_id === obsTableId(state));
  const q = fold(opts.filter);
  if (q) return { rows: all.filter((r) => fold(r.id + " " + Object.values(r.data).join(" ")).includes(q)).slice(0, MAX_ROWS), big: all.length > MAX_ROWS, total: all.length };
  if (all.length <= MAX_ROWS) return { rows: all, big: false, total: all.length };
  const ev = app.sel.event && find(state, app.sel.event);
  return { rows: ev ? all.filter((r) => ev.members.includes(r.id)).slice(0, MAX_ROWS) : [], big: true, total: all.length };
}

function autoLayout(state, vis) {
  const obs = vis.rows;
  const ts = obs.map(minutes).filter((x) => x != null).sort((a, b) => a - b);
  // robuste Skala: Ausreisser (anderer Tag) nicht die Achse dominieren lassen
  const lo = ts[Math.floor(ts.length * 0.1)] ?? 0, hi = ts[Math.ceil(ts.length * 0.9) - 1] ?? 1;
  const span = Math.max(hi - lo, 1), W = Math.max(900, obs.length * 55);
  const x = (t) => LANE_X + 30 + Math.min(Math.max((t - lo) / span, 0), 1.08) * W;
  const pos = {}, lanes = [];
  let y = 40;
  const a = latest(state, "lagebild");
  if (vis.big && a) {
    // Ereignis-Uebersicht als Raster oben, zeitlich sortiert; gestuetzte Ereignisse zuerst sichtbar
    const evs = a.result.events.slice().sort((p, q) => p.start - q.start).filter((e) => e.sources.length >= 2 || opts.filter);
    evs.slice(0, 120).forEach((e, i) => (pos[e.id] = { x: LANE_X + 30 + (i % 4) * 232, y: y + Math.floor(i / 4) * 84 }));
    y += Math.ceil(Math.min(evs.length, 120) / 4) * 84 + 30;
    pos[a.id] = { x: LANE_X + 30 + 4 * 232, y: 40 };
  }
  const axisTop = y - 30;
  const srcIds = new Set(obs.map((r) => r.source_id));
  for (const s of state.sources.filter((q) => !vis.big || srcIds.has(q.id))) {
    const rows = obs.filter((r) => r.source_id === s.id).sort((a, b) => (minutes(a) ?? 1e12) - (minutes(b) ?? 1e12));
    if (!rows.length) { lanes.push({ id: s.id, y, h: 60 }); y += 72; continue; }
    const slots = [];
    let noTime = LANE_X + 60 + W + 120;
    for (const r of rows) {
      const t = minutes(r);
      let px = t == null ? (noTime += 0) : x(t);
      if (t == null) noTime += NW + 12;
      let lvl = 0;
      while (slots.some((sl) => sl.lvl === lvl && Math.abs(sl.x - px) < NW + 8)) lvl++;
      slots.push({ x: px, lvl });
      pos[r.id] = { x: px, y: y + LANE_PAD + lvl * (NH + 10) };
    }
    const h = LANE_PAD * 2 + (Math.max(...slots.map((s) => s.lvl)) + 1) * (NH + 10);
    lanes.push({ id: s.id, y, h });
    y += h + 8;
  }
  if (a && !vis.big) {
    const lvl = [];
    for (const e of a.result.events) {
      const ex = Math.max(LANE_X + 30, x(e.start));
      let l = 0;
      while (lvl.some((q) => q.l === l && Math.abs(q.x - ex) < 220)) l++;
      lvl.push({ x: ex, l });
      pos[e.id] = { x: ex, y: y + 40 + l * 84 };
    }
    y += Math.max(0, ...lvl.map((q) => q.l)) * 84;
  }
  state.analyses.filter((x) => x.status !== "superseded").forEach((an, i) => (pos[an.id] ||= { x: LANE_X + 30 + i * 250, y: y + 170 }));
  let height = y + 320;
  if (state.workspace.profile === "netzwerk") {
    // Akteure im Kreis unterhalb der Bahnen, Analysen daneben
    const actors = state.entities.filter((e) => e.type === "AKTEUR").slice(0, 24);
    const R = Math.max(170, actors.length * 32), cx = LANE_X + 60 + R, cy = y + 60 + R;
    actors.forEach((e, i) => { const a = (i / actors.length) * 2 * Math.PI - Math.PI / 2; pos[e.id] = { x: cx + R * Math.cos(a) - 75, y: cy + R * Math.sin(a) - 25 }; });
    state.analyses.filter((x) => x.status !== "superseded").forEach((an, i) => (pos[an.id] = { x: cx + R + 200, y: y + 60 + i * 110 }));
    state.entities.filter((e) => e.type !== "AKTEUR").slice(0, 16).forEach((e, i) => (pos[e.id] = { x: cx + R + 200 + (i % 2) * 165, y: y + 300 + Math.floor(i / 2) * 56 }));
    height = cy + R + 120;
  } else {
    state.entities.slice(0, 40).forEach((e, i) => (pos[e.id] = { x: LANE_X + 60 + W + 360 + (i % 2) * 165, y: 40 + Math.floor(i / 2) * 50 }));
  }
  return { pos, lanes, axis: { lo, hi, x, W, top: Math.max(0, axisTop) }, height };
}

function nodeHtml(state, id, p, sel) {
  const pre = id.split("-")[0];
  const style = `left:${p.x}px;top:${p.y}px`;
  if (pre === "ROW") {
    const r = find(state, id);
    const d = r.data;
    const title = [d.zeit, d.anzahl != null ? `${d.anzahl}×` : "", d.objekt || d.ort || d.referenzen || ""].filter(Boolean).join(" · ") || (d.text || "").slice(0, 30);
    const corr = r.corrections.length ? `<span class="corr" title="${r.corrections.length} Korrektur(en)">✎${r.corrections.length}</span>` : "";
    return `<div class="node ${r.method === "ki" ? "ki" : ""} ${sel ? "sel" : ""}" data-id="${id}" style="${style};border-left:3px solid ${srcColor(state, r.source_id)}"><div class="nid">${id} ${corr}${r.method === "ki" ? ' <span class="pill ai">KI</span>' : ""}</div><div class="nt">${esc(title)}</div><div class="meta">${esc(d.text || "")}</div><span class="port" data-port="${id}">⊕</span></div>`;
  }
  if (pre === "CL") {
    const e = find(state, id);
    return `<div class="node cluster ${sel ? "sel" : ""}" data-id="${id}" style="${style}"><div class="nid">${id} · Ereignis</div><div class="nt">${esc((e.places[0] || "Ereignis") + (e.anzahl_max != null ? ` · ${e.anzahl_min === e.anzahl_max ? e.anzahl_max : e.anzahl_min + "–" + e.anzahl_max} ${e.objects[0] || ""}` : ""))}</div><div class="meta">${e.members.length} Zeilen · ${e.sources.length} Quellen · Bestätigung ${e.confidence}</div><span class="port" data-port="${id}">⊕</span></div>`;
  }
  if (pre === "ANL") {
    const a = find(state, id);
    return `<div class="node anl ${a.status === "stale" ? "stale" : ""} ${sel ? "sel" : ""}" data-id="${id}" style="${style}"><div class="nid">${id} · v${a.version} ${a.status === "stale" ? "⚠ veraltet" : "✓ aktuell"}</div><div class="nt">${esc(a.title)}</div><div class="meta">${a.calc_ids.length} Rechenschritte · ${a.input_rows.length} Eingangszeilen</div><span class="port" data-port="${id}">⊕</span></div>`;
  }
  if (pre === "ENT") {
    const e = find(state, id);
    return `<div class="node ent ${sel ? "sel" : ""}" data-id="${id}" style="${style}"><div class="nid">${id} · ${e.type}</div><div class="nt">${esc(e.name)}</div><div class="meta">${e.mentions.length} Erwähnungen</div><span class="port" data-port="${id}">⊕</span></div>`;
  }
  return "";
}

export function renderCanvas(root) {
  const state = app.state;
  if (!state.sources.length) {
    root.innerHTML = `<div class="empty"><h2>Noch keine Daten</h2><p>Importiere Text, PDF, Excel oder Scans – oder lade ein Beispielszenario mit synthetischen Dateien.</p><button class="primary" data-act="import">＋ Dateien importieren</button><button class="btn" data-act="demo">Beispieldaten laden</button></div>`;
    return;
  }
  const shown = visibleRows(state);
  const L = autoLayout(state, shown);
  const pos = { ...L.pos };
  for (const [id, p] of Object.entries(state.layout)) if (pos[id]) pos[id] = p;
  const ids = Object.keys(pos).filter((id) => {
    const p = id.split("-")[0];
    if (p === "CL") return opts.events;
    if (p === "ENT") return showEnts(state);
    if (p === "ANL") return opts.events;
    return true;
  });
  const width = Math.max(900, ...ids.map((id) => pos[id].x)) + 320;
  const height = Math.max(L.height, ...ids.map((id) => pos[id].y + 120));
  const hint = shown.big ? `<div class="bighint">${shown.total} Beobachtungen – zu viele für Einzelkästchen. ${opts.filter ? `Filter zeigt ${shown.rows.length}.` : app.sel.event ? `Zeige Belege von ${app.sel.event}.` : "Ereignis anklicken, um seine Belege aufzuklappen, oder oben filtern."}</div>` : "";
  const center = (id) => ({ x: pos[id].x + NW / 2, y: pos[id].y + NH / 2 });
  const vis = new Set(ids);
  let edges = "";
  const curve = (a, b) => { const dx = Math.max(40, Math.abs(b.x - a.x) / 2); return `M${a.x} ${a.y}C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`; };
  const la = latest(state, "lagebild");
  if (opts.events && la) {
    for (const e of la.result.events) {
      if (!vis.has(e.id)) continue;
      for (const m of e.members) if (vis.has(m)) edges += `<path class="edge member" d="${curve(center(m), center(e.id))}"/>`;
      edges += `<path class="edge member" d="${curve(center(e.id), center(la.id))}"/>`;
    }
  }
  if (showEnts(state)) {
    const net = state.workspace.profile === "netzwerk";
    const byName = new Map(state.entities.filter((e) => e.type === "AKTEUR").map((e) => [fold(e.name), e.id]));
    for (const e of state.entities) if (vis.has(e.id) && !net) for (const m of e.mentions) if (vis.has(m)) edges += `<path class="edge member" d="${curve(center(m), center(e.id))}"/>`;
    // Beziehungen Akteur → Akteur aus Zeilen mit von/an
    for (const r of state.rows) {
      if (!r.data.von || !r.data.an) continue;
      const a = byName.get(fold(r.data.von)), b = byName.get(fold(r.data.an));
      if (!a || !b || !vis.has(a) || !vis.has(b)) continue;
      const pa = center(a), pb = center(b), mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
      edges += `<path class="edge man" d="M${pa.x} ${pa.y}L${pb.x} ${pb.y}" marker-end="url(#arr)"><title>${esc(`${r.id}: ${r.data.von} → ${r.data.an} (${r.data.objekt || ""})`)}</title></path><text x="${mx}" y="${my - 4}" class="elabel">${esc((r.data.objekt || "") + (r.data.betrag ? ` ${r.data.betrag.toLocaleString("de-DE")} €` : ""))}</text>`;
    }
  }
  for (const l of state.links) {
    if (l.status === "rejected" || !vis.has(l.from) || !vis.has(l.to)) continue;
    if (l.status === "suggested" && !opts.sug) continue;
    const cls = l.status === "suggested" ? "sug" : l.kind === "manual" ? "man" : "";
    edges += `<path class="edge ${cls}" data-link="${l.id}" d="${curve(center(l.from), center(l.to))}"><title>${esc(l.id + " · " + l.label + (l.reason ? " · " + l.reason : ""))}</title></path>`;
  }
  // Zeitachse
  let axis = "";
  const { lo, hi, x } = L.axis;
  if (hi > lo) {
    const step = hi - lo > 2880 ? 1440 : hi - lo > 600 ? 60 : hi - lo > 120 ? 15 : 5;
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
      const d = new Date(t * 60000).toISOString();
      axis += `<div class="axis" style="left:${x(t)}px;top:${L.axis.top}px;height:calc(100% - ${L.axis.top}px)">${step >= 1440 ? d.slice(8, 10) + "." + d.slice(5, 7) + "." : d.slice(11, 16)}</div>`;
    }
  }
  const lanes = L.lanes.map((ln) => {
    const s = state.sources.find((x) => x.id === ln.id);
    return `<div class="lane" style="top:${ln.y}px"></div><div class="lanelabel" data-id="${s.id}" style="top:${ln.y + 8}px;border-left:3px solid ${srcColor(state, s.id)}"><b title="${esc(s.name)}">${esc(s.name)}</b>${s.id} · ${s.type}${s.ocr ? " · OCR" : ""}</div>`;
  }).join("");
  const nSug = state.links.filter((l) => l.status === "suggested").length;
  root.innerHTML = `
  <div class="bar">
    <b>Canvas</b><span class="pill">x = Zeit</span><span class="pill">Bahn = Quelle</span>
    <div class="legend"><span><i></i>bestätigt</span><span><i class="man"></i>manuell</span><span><i class="sug"></i>Vorschlag (${nSug})</span></div>
    <div class="sp"></div>
    <label class="small"><input type="checkbox" data-opt="sug" ${opts.sug ? "checked" : ""}> Vorschläge</label>
    <label class="small"><input type="checkbox" data-opt="events" ${opts.events ? "checked" : ""}> Ereignisse</label>
    <label class="small"><input type="checkbox" data-opt="ents" ${showEnts(state) ? "checked" : ""}> Entitäten</label>
    <input class="filter" data-cfilter placeholder="Kästchen filtern …" value="${esc(opts.filter)}">
    <button class="btn sm" data-act="suggest" title="Verbindungen vorschlagen (Regeln bzw. KI)">✦ Verbindungen vorschlagen</button>
    <button class="btn sm" data-act="relayout">Auto-Layout</button>
    <button class="btn sm" data-act="zout">−</button><button class="btn sm" data-act="zin">+</button>
  </div>
  ${hint}<div class="canvas ${connectFrom ? "connecting" : ""}" style="width:${width * zoom}px;height:${height * zoom}px">
    <div class="graph" style="width:${width}px;height:${height}px;transform:scale(${zoom})">
      ${axis}${lanes}
      <svg width="${width}" height="${height}"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--b)"/></marker></defs>${edges}</svg>
      ${ids.map((id) => nodeHtml(state, id, pos[id], app.sel.node === id || connectFrom === id)).join("")}
    </div>
  </div>`;
  wire(root, pos);
}

function wire(root, pos) {
  const state = app.state;
  const cf = root.querySelector("[data-cfilter]");
  cf?.addEventListener("input", () => { clearTimeout(cf._t); cf._t = setTimeout(() => { opts.filter = cf.value; renderCanvas(root); const g = root.querySelector("[data-cfilter]"); g.focus(); g.setSelectionRange(g.value.length, g.value.length); }, 250); });
  root.querySelectorAll("[data-opt]").forEach((cb) => cb.addEventListener("change", () => { opts[cb.dataset.opt] = cb.checked; renderCanvas(root); }));
  root.querySelector("[data-act=relayout]")?.addEventListener("click", () => { state.layout = {}; app.commit(); });
  root.querySelector("[data-act=zin]")?.addEventListener("click", () => { zoom = Math.min(1.6, zoom + 0.15); renderCanvas(root); });
  root.querySelector("[data-act=zout]")?.addEventListener("click", () => { zoom = Math.max(0.4, zoom - 0.15); renderCanvas(root); });
  root.querySelectorAll("[data-link]").forEach((p) => p.addEventListener("click", (ev) => { ev.stopPropagation(); app.inspect(p.dataset.link); }));
  root.querySelectorAll(".lanelabel").forEach((l) => l.addEventListener("click", () => app.inspect(l.dataset.id)));
  root.querySelectorAll(".port").forEach((p) => p.addEventListener("mousedown", (ev) => ev.stopPropagation()));
  root.querySelectorAll(".port").forEach((p) => p.addEventListener("click", (ev) => {
    ev.stopPropagation();
    connectFrom = p.dataset.port;
    app.toast("Verbinden: Ziel-Kästchen anklicken (Esc bricht ab)");
    renderCanvas(root);
  }));
  root.querySelectorAll(".node").forEach((n) => {
    let start = null, moved = false;
    n.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".port")) return;
      start = { x: ev.clientX, y: ev.clientY, px: pos[n.dataset.id].x, py: pos[n.dataset.id].y };
      moved = false;
      n.setPointerCapture(ev.pointerId);
    });
    n.addEventListener("pointermove", (ev) => {
      if (!start) return;
      const dx = (ev.clientX - start.x) / zoom, dy = (ev.clientY - start.y) / zoom;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      if (moved) { n.style.left = start.px + dx + "px"; n.style.top = start.py + dy + "px"; }
    });
    n.addEventListener("pointerup", (ev) => {
      if (!start) return;
      const id = n.dataset.id;
      if (moved) {
        state.layout[id] = { x: parseFloat(n.style.left), y: parseFloat(n.style.top) };
        start = null;
        app.commit();
        return;
      }
      start = null;
      if (connectFrom && connectFrom !== id) {
        const label = prompt(`Verbindung ${connectFrom} → ${id}\nBezeichnung:`, "gehört zu");
        if (label != null) {
          const l = { id: nextId(state, "LNK"), from: connectFrom, to: id, label: label || "verknüpft", kind: "manual", status: "accepted", reason: "manuell gesetzt", created_at: now() };
          state.links.push(l);
          state.audit.push({ id: nextId(state, "EVT"), ts: now(), action: "VERKNÜPFT", detail: `${l.from} → ${l.to} (${l.label})`, refs: [l.id, l.from, l.to] });
        }
        connectFrom = null;
        app.commit();
        return;
      }
      connectFrom = null;
      app.sel.node = id;
      if (id.startsWith("CL-") && app.sel.event !== id && state.rows.length > MAX_ROWS) { app.sel.event = id; app.inspect(id); renderCanvas(root); return; }
      app.inspect(id);
      root.querySelectorAll(".node.sel").forEach((x) => x.classList.remove("sel"));
      n.classList.add("sel");
    });
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && connectFrom) { connectFrom = null; app.commit(); }
});
