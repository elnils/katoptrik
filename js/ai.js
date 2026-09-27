// Optionale KI-Anbindung (Claude API, offizielles SDK, direkt aus dem Browser).
// Der API-Schluessel bleibt im localStorage dieses Browsers und wird nie exportiert.
// Grundsatz: Die KI extrahiert, interpretiert und schlaegt vor. Rechnen tut die
// deterministische Engine, damit jedes Ergebnis nachvollziehbar bleibt.

const SKEY = "katoptrik_ai_settings";
export const DEFAULT_MODEL = "claude-opus-5";

export function getSettings() {
  try { return { model: DEFAULT_MODEL, extract: true, ...JSON.parse(localStorage.getItem(SKEY) || "{}") }; }
  catch { return { model: DEFAULT_MODEL, extract: true }; }
}
export function setSettings(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch {} }
export const aiEnabled = () => !!getSettings().apiKey;

let Anthropic;
async function client() {
  const s = getSettings();
  if (!s.apiKey) throw new Error("Kein API-Schlüssel hinterlegt");
  Anthropic ||= (await import(new URL("../vendor/anthropic-sdk.mjs", import.meta.url).href)).default;
  return { c: new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true }), model: s.model || DEFAULT_MODEL };
}

// Ein Aufruf mit JSON-Schema-Ausgabe. Server-seitige Fallbacks bei Ablehnung sind aktiv.
async function callJson(system, user, schema, effort = "medium") {
  const { c, model } = await client();
  const body = {
    model, max_tokens: 16000, system,
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: { type: "json_schema", schema } },
  };
  let res;
  try {
    res = await c.beta.messages.create({ ...body, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (e) {
    if (e?.status !== 400) throw e;
    res = await c.messages.create(body); // Modell ohne Fallback-Unterstuetzung
  }
  if (res.stop_reason === "refusal") throw new Error("Anfrage wurde vom Modell abgelehnt" + (res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : ""));
  if (res.stop_reason === "max_tokens") throw new Error("Antwort abgeschnitten (max_tokens)");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: JSON.parse(text), model: res.model };
}

const str = { type: "string" }, num = { type: ["number", "null"] }, nstr = { type: ["string", "null"] };

export async function aiExtract(segments, profileLabel, ctx) {
  const schema = {
    type: "object", additionalProperties: false, required: ["beobachtungen"],
    properties: {
      beobachtungen: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["seg_id", "datum", "zeit", "zeit_roh", "ort", "lat", "lon", "anzahl", "objekt", "akteure", "referenzen", "betrag", "einheit", "von", "an", "korrekturen", "konfidenz"],
          properties: {
            seg_id: str, datum: nstr, zeit: nstr, zeit_roh: nstr, ort: nstr, lat: num, lon: num, anzahl: num, objekt: nstr,
            akteure: nstr, referenzen: nstr, betrag: num, einheit: nstr, von: nstr, an: nstr, konfidenz: { type: "number" },
            korrekturen: { type: "array", items: { type: "object", additionalProperties: false, required: ["feld", "von", "nach", "begruendung"], properties: { feld: str, von: str, nach: str, begruendung: str } } },
          },
        },
      },
    },
  };
  const system = `Du extrahierst strukturierte Beobachtungen aus unstrukturierten Quellen für ein Analyse-Werkzeug (Anwendungsfall: ${profileLabel}).
Regeln:
- Eine Beobachtung je Textsegment mit Informationsgehalt; seg_id muss exakt einer der gegebenen IDs entsprechen.
- datum als YYYY-MM-DD, zeit als HH:MM in Lokalzeit (Europe/Berlin). Dokumentdatum: ${ctx.date || "unbekannt"}.${ctx.utc ? " Das Dokument nennt UTC-Zeiten: in Lokalzeit umrechnen." : ""}
- Korrigiere offensichtliche Schreib- und Formatfehler (z. B. "2,5h" als Uhrzeit 02:30, "drohen" → "Drohnen", "0240 uhr" → 02:40) und dokumentiere JEDE Korrektur in korrekturen mit Begründung.
- Erfinde nichts: Unbekanntes ist null. Mehrere Akteure/Referenzen mit "; " trennen.`;
  const user = "Segmente:\n" + segments.map((s) => `[${s.id}] ${s.text}`).join("\n");
  return callJson(system, user, schema, "low");
}

export async function aiChat(question, contextTsv, analysesText, history) {
  const schema = {
    type: "object", additionalProperties: false, required: ["antwort", "belege", "aktion", "suchbegriffe"],
    properties: {
      antwort: str,
      belege: { type: "array", items: str },
      aktion: { type: "string", enum: ["keine", "lagebild", "netzwerk", "termine"] },
      suchbegriffe: { type: "array", items: str },
    },
  };
  const system = `Du bist Analyst in einem nachvollziehbaren Datenpool. Beantworte Fragen NUR auf Basis der gelieferten Zeilen.
- Belege jede Aussage mit Zeilen-IDs in eckigen Klammern, z. B. [ROW-00012]. Nenne Unsicherheiten und Widersprüche.
- Wenn für die Frage eine Berechnung nötig ist (Lagebild/Ereignisbildung, Netzwerk/Zentralität, Termine/Verzug), setze aktion entsprechend; die Berechnung führt dann eine deterministische Engine protokolliert aus.
- suchbegriffe: wenige Begriffe, die den Datenumfang eingrenzen (leer = alle Daten).
Antworte auf Deutsch.`;
  const user = `Bisheriger Verlauf:\n${history}\n\nAnalysen:\n${analysesText || "—"}\n\nDatenpool (TSV):\n${contextTsv}\n\nFrage: ${question}`;
  return callJson(system, user, schema, "medium");
}

export async function aiLinks(contextTsv) {
  const schema = {
    type: "object", additionalProperties: false, required: ["verbindungen"],
    properties: { verbindungen: { type: "array", items: { type: "object", additionalProperties: false, required: ["von", "nach", "label", "begruendung", "score"], properties: { von: str, nach: str, label: str, begruendung: str, score: { type: "number" } } } } },
  };
  const system = "Finde sinnvolle Verbindungen zwischen Zeilen verschiedener Quellen (gleiches Ereignis, gleicher Akteur, Ursache/Wirkung, Widerspruch). Nur IDs aus den Daten verwenden. Maximal 15 Verbindungen, score 0–1.";
  return callJson(system, contextTsv, schema, "medium");
}
