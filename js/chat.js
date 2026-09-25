// Chat in natuerlicher Sprache. Ohne API-Schluessel: lokale Absichtserkennung.
// Mit Schluessel: Claude beantwortet mit Zeilen-Belegen; Berechnungen laufen immer
// in der protokollierten Engine.
import { app, find, latest, obsTableId, srcName } from "./ctx.js";
import { esc, fold, linkIds, now } from "./util.js";
import { RUNNERS, TYPES } from "./analysis.js";
import { aiChat, aiEnabled, getSettings } from "./ai.js";
import { profileOf } from "./profiles.js";
import { RULES } from "./normalize.js";

const list = (arr) => `<ul>${arr.map((l) => `<li>${linkIds(esc(l))}</li>`).join("")}</ul>`;

function explicitScope(q) {
  const quoted = [...q.matchAll(/[„"“']([^"“”'„]+)[”"“']/g)].map((m) => fold(m[1]));
  const nur = /\b(?:nur|filter:?)\s+([\wäöüß.-]+)/i.exec(q);
  return { terms: [...quoted, ...(nur ? [fold(nur[1])] : [])] };
}

function runAndDescribe(type, scope) {
  const a = RUNNERS[type](app.state, scope);
  app.sel.analysis = a.id;
  return { html: `<b>${esc(a.title)} ${a.id} (v${a.version})</b>${list(a.result.summary)}${a.diff ? `<b>Änderungen gegenüber v${a.version - 1}:</b>${list(a.diff)}` : ""}`, trace: `Quellen → ${a.input_rows.length} Zeilen → ${a.calc_ids.length} Rechenschritte (${a.calc_ids[0]} … ${a.calc_ids.at(-1)}) → ${a.id}` };
}

function localAnswer(q) {
  const s = app.state, f = fold(q), scope = explicitScope(q);
  const oid = obsTableId(s);
  const obs = s.rows.filter((r) => r.table_id === oid);
  if (!obs.length) return { html: "Es sind noch keine Daten importiert. Nutze „＋ Daten“ oder „Beispieldaten“." };
  const idm = q.match(/\b(ROW|SRC|SEG|ANL|CALC|CL|LNK|ENT)-\d{3,6}\b/);
  if (idm && /woher|quelle|beleg|warum|herkunft|wie kommt|nachweis|zeige/.test(f)) {
    app.inspect(idm[0]);
    const x = find(s, idm[0]);
    if (x && idm[1] === "ROW") return { html: `${idm[0]} stammt aus ${linkIds(x.source_id)} (${esc(srcName(s, x.source_id))}, ${esc(x.loc)})${x.seg_id ? `, Segment ${linkIds(x.seg_id)}` : ""}. Originaltext: „${esc(x.data.text)}“.${x.corrections.length ? list(x.corrections.map((c) => `${c.field}: ${c.from} → ${c.to} (${c.rule}: ${c.note || RULES[c.rule]})`)) : ""}`, trace: `${x.source_id} → ${x.seg_id || x.loc} → ${x.id}` };
    return { html: `Details zu ${linkIds(idm[0])} sind im Inspektor geöffnet.` };
  }
  if (/geaendert|aenderung|veraltet|neue (datei|info)|was ist neu|diff/.test(f)) {
    const stale = s.analyses.filter((a) => a.status === "stale");
    const withDiff = s.analyses.filter((a) => a.status === "current" && a.diff);
    if (!stale.length && !withDiff.length) return { html: "Keine Analyse ist durch neue Daten betroffen." };
    return { html: `${stale.map((a) => `<b>${a.id} ${esc(a.title)} v${a.version} ist veraltet</b> – betroffen durch ${linkIds(a.stale_info.join(", "))}. <button class="btn sm" data-rerun="${a.id}">Neu berechnen</button>`).join("<br>")}${withDiff.map((a) => `<b>${a.id} ${esc(a.title)} v${a.version}</b> gegenüber v${a.version - 1}:${list(a.diff)}`).join("")}` };
  }
  if (/korrigiert|korrektur|normalis|schreibfehler|tippfehler|zeitangabe|fehler/.test(f)) {
    const onlyTime = /zeit|uhr/.test(f);
    const all = obs.flatMap((r) => r.corrections.filter((c) => c.rule !== "D2" && (!onlyTime || c.field === "zeit")).map((c) => `${r.id}: ${c.field} „${c.from}“ → „${c.to}“ (${c.rule}, Konf. ${c.confidence})`));
    return { html: `${all.length} ${onlyTime ? "Zeitangaben wurden normalisiert bzw. korrigiert" : "Korrekturen/Normalisierungen (ohne ergänzte Datumsangaben)"}:${list(all.slice(0, 25))}${all.length > 25 ? "…" : ""}Vollständig unter „Korrekturen“.`, trace: "Regeln: " + Object.keys(RULES).join(" ") };
  }
  if (/netzwerk|zentral|kreislauf|beziehung|wer kennt|akteur/.test(f)) return runAndDescribe("netzwerk", scope);
  const von = /verbindungen (?:von|zu) ([\wäöüß. -]+)/i.exec(q);
  if (von) {
    const k = fold(von[1].trim().replace(/[?.!]$/, ""));
    const hits = obs.filter((r) => fold(Object.values(r.data).join(" ")).includes(k));
    return { html: `${hits.length} Zeilen erwähnen „${esc(von[1].trim())}“:${list(hits.map((r) => `${r.id}: ${r.data.von ? `${r.data.von} → ${r.data.an} (${r.data.objekt || ""}${r.data.betrag ? ", " + r.data.betrag + " €" : ""})` : r.data.text.slice(0, 120)}`))}` };
  }
  if (/verzug|verspaet|lieferung|termin|kritisch|risiko|ueberfaellig/.test(f)) return runAndDescribe("termine", scope);
  if (/zeitlinie|chronolog|ablauf|timeline|reihenfolge/.test(f)) {
    const t = obs.filter((r) => r.data.zeit || r.data.datum).sort((a, b) => `${a.data.datum} ${a.data.zeit}`.localeCompare(`${b.data.datum} ${b.data.zeit}`));
    return { html: `Chronologie (${t.length} Einträge):${list(t.slice(0, 20).map((r) => `${r.data.datum || ""} ${r.data.zeit || ""} · ${r.id} · ${r.data.text.slice(0, 90)}`))}Ganze Ansicht unter „Zeitlinie“.` };
  }
  if (/lagebild|lage\b|situation|ueberblick|zusammenfass|ereignis|wie viele|anzahl|was ist passiert/.test(f)) {
    const type = s.workspace.profile === "lieferkette" && !/lagebild/.test(f) ? "termine" : s.workspace.profile === "netzwerk" && !/lagebild/.test(f) ? "netzwerk" : "lagebild";
    return runAndDescribe(type, scope);
  }
  // Freitextsuche
  const terms = f.split(/[^a-z0-9-]+/).filter((w) => w.length > 3);
  const scored = obs.map((r) => ({ r, n: terms.filter((t) => fold(Object.values(r.data).join(" ")).includes(t)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n);
  if (!scored.length) return { html: `Keine passenden Zeilen gefunden. Versuche z. B.: ${profileOf(s).questions.map((x) => `„${esc(x)}“`).join(", ")}.` };
  return { html: `${scored.length} passende Zeilen:${list(scored.slice(0, 10).map(({ r }) => `${r.id} (${srcName(s, r.source_id)}): ${r.data.text.slice(0, 120)}`))}` };
}

async function aiAnswer(q) {
  const s = app.state, oid = obsTableId(s);
  const cols = ["id", "quelle", "datum", "zeit", "ort", "lat", "lon", "anzahl", "objekt", "akteure", "referenzen", "betrag", "einheit", "von", "an", "text"];
  const rows = s.rows.filter((r) => r.table_id === oid).slice(0, 600);
  const tsv = [cols.join("\t"), ...rows.map((r) => [r.id, r.source_id, ...cols.slice(2).map((c) => String(r.data[c] ?? "").replace(/\s+/g, " ").slice(0, 220))].join("\t"))].join("\n");
  const anl = s.analyses.filter((a) => a.status !== "superseded").map((a) => `${a.id} ${a.title} v${a.version} (${a.status}): ${a.result.summary.join(" ")}`).join("\n");
  const hist = s.chat.slice(-6).map((m) => `${m.role}: ${m.text.slice(0, 400)}`).join("\n");
  const { data, model } = await aiChat(q, tsv, anl, hist);
  const valid = data.belege.filter((id) => find(s, id));
  let html = linkIds(esc(data.antwort).replace(/\n/g, "<br>"));
  let trace = `KI (${model}) · Belege: ${valid.join(", ") || "—"}`;
  if (data.aktion !== "keine" && RUNNERS[data.aktion]) {
    const r = runAndDescribe(data.aktion, { terms: data.suchbegriffe.map(fold) });
    html += `<hr>${r.html}`;
    trace += ` · Berechnung: ${r.trace}`;
  }
  return { html, trace };
}

export function renderChat() {
  const s = app.state, box = document.getElementById("chat");
  const intro = `<div class="msg"><div class="answer"><b>Willkommen.</b> Frage in natürlicher Sprache über alle importierten Quellen. Jede Antwort verweist auf Zeilen-IDs; Berechnungen werden Schritt für Schritt protokolliert.<div class="trace">QUELLE → SEGMENT → ZEILE → RECHENSCHRITT → ANALYSE</div></div></div>`;
  box.innerHTML = intro + s.chat.map((m) => m.role === "user" ? `<div class="msg user"><div class="bubble">${esc(m.text)}</div></div>` : `<div class="msg"><div class="answer">${m.html}${m.trace ? `<div class="trace">${linkIds(esc(m.trace))}</div>` : ""}</div></div>`).join("");
  box.scrollTop = box.scrollHeight;
  document.getElementById("chips").innerHTML = profileOf(s).questions.map((q) => `<button class="chip">${esc(q)}</button>`).join("");
  document.getElementById("chatMode").textContent = aiEnabled() ? `KI: ${getSettings().model}` : "lokal (ohne KI)";
}

export async function ask(q) {
  const s = app.state;
  q = q.trim();
  if (!q) return;
  s.chat.push({ role: "user", text: q, at: now() });
  renderChat();
  const box = document.getElementById("chat");
  box.insertAdjacentHTML("beforeend", `<div class="msg" id="typing"><div class="answer typing">analysiere …</div></div>`);
  box.scrollTop = box.scrollHeight;
  let res;
  try {
    res = aiEnabled() ? await aiAnswer(q) : localAnswer(q);
  } catch (e) {
    const loc = localAnswer(q);
    res = { html: `<span class="muted small">KI nicht erreichbar (${esc(e.message || e)}) – lokale Auswertung:</span><br>${loc.html}`, trace: loc.trace };
  }
  s.chat.push({ role: "assistant", html: res.html, trace: res.trace || "", text: res.html.replace(/<[^>]+>/g, " "), at: now() });
  app.commit();
}

export { TYPES };
