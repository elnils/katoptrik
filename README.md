# Katoptrik – Evidence Workspace

Statische Web-App (läuft komplett auf GitHub Pages, ohne Server), die Informationen aus
mehreren unstrukturierten Quellen in **Tabellen mit eindeutigen IDs** überführt,
**schrittweise und nachvollziehbar** berechnet und die Einzelergebnisse auf einem
**Canvas** verknüpfbar macht. Rechts steht ein **Chat** für Fragen in natürlicher Sprache.

Der Ansatz ist generisch: dieselbe Pipeline trägt ein Lagebild (z. B. Drohnenüberflug
Ostsee), Lieferketten-Monitoring oder Netzwerkanalyse. Das Anwendungsprofil liefert nur
Vokabular, Ortsverzeichnis und Parameter; eine Ontologie kann später darauf aufsetzen.

## Datenfluss

```
Datei ──SHA-256──▶ SRC ──▶ Textsegmente SEG / Excel-Rohtabellen ROW
                              │
                              ▼  Normalisierung (Regel-ID je Korrektur, Rohwert bleibt erhalten)
                        Beobachtungen ROW  ──▶ Entitäten ENT
                              │                     │
                              ▼                     ▼
                  Rechenschritte CALC ──▶ Analyse ANL (versioniert, Fingerprint der Eingangszeilen)
                              ▲
                  Verbindungen LNK (manuell · Regel-Vorschlag · KI-Vorschlag)
```

- **Eindeutige IDs:** Jede Quelle, jedes Segment, jede Tabellenzeile, jede Verbindung,
  jeder Rechenschritt und jede Analyse hat eine fortlaufende ID (`SRC-0001`, `ROW-00012`, …).
  IDs werden nie wiederverwendet; Quellen sind per SHA-256 identifiziert (Duplikate werden erkannt).
- **Append-only:** Zeilen werden nicht überschrieben. Manuelle Korrekturen erzeugen eine neue
  Revision mit Begründung im Audit-Trail.
- **Neue Dateien verändern Ergebnisse:** Jede Analyse speichert den Fingerprint ihrer
  Eingangszeilen (`ID@Revision`). Kommen passende neue Zeilen hinzu oder wird eine Zeile
  korrigiert, wird die Analyse als **veraltet** markiert. „Neu berechnen“ erzeugt v2, v3, …
  mit einer Änderungsliste gegenüber der Vorversion.
- **Nachvollziehbare Korrekturen:** z. B. `2,5h → 02:30` (Regel T3), `0240 uhr → 02:40` (T2),
  `halb drei → 02:30` (T4), `00:31 UTC → 02:31` (T6), `drohen → Drohnen` (S1). Die Liste
  aller Regeln steht in der Ansicht „Korrekturen“.
- **KI optional:** Ohne API-Schlüssel läuft alles lokal (Regel-Extraktion, lokaler Chat).
  Mit Anthropic-API-Schlüssel (⚙) extrahiert Claude Beobachtungen, beantwortet Fragen mit
  Zeilen-Belegen und schlägt Verbindungen vor. **Gerechnet wird immer in der protokollierten
  Engine**, nicht im Sprachmodell. Der Schlüssel bleibt im `localStorage` des Browsers und
  wird nie exportiert; für geteilte Nutzung besser einen eigenen Proxy verwenden.

## Ansichten

| Ansicht | Inhalt |
|---|---|
| Canvas | Bahn = Quelle, x = Zeit. Kästchen verschieben, mit ⊕ verbinden; gestrichelt = Vorschläge (anklicken → bestätigen/verwerfen). Ereignisse und Analysen darunter. |
| Tabellen | Beobachtungen, Excel-Rohtabellen, Textsegmente, Entitäten, Verbindungen, Rechenschritte. Gelb = korrigiert; Doppelklick = manuell korrigieren; CSV-Export. |
| Lagebild & Analysen | Ergebnis mit Belegen, Änderungen zur Vorversion, vollständiger Rechenweg, Markdown-Export. |
| Zeitlinie / Quellen / Korrekturen / Audit-Trail | Herkunft und Historie jeder Information. |

Analysetypen: **Lagebild** (zeitlich-räumliche Ereignisbildung, Bestätigungsgrad, Widersprüche),
**Netzwerk** (Grad-Zentralität, Kreisläufe), **Termine/Verzug** (Soll/Ist, Verzugs-Signale aus Texten).

## Testen mit echten oder synthetischen Dateien

„Beispieldaten“ lädt erfundene Testdateien aus [`samples/`](samples/):

- `drohnen-ostsee/`: gescannte Handnotiz (PNG, OCR) mit „2,5h“, Lagemeldung (PDF), Anrufnotizen
  (TXT, Tippfehler, „halb drei“), Radar-Auswertung (PDF-Tabelle in UTC), Sensorliste (XLSX mit
  gemischten Zeitformaten). **Nachtrag:** Nachmeldung der Marine (PDF) → Lagebild wird veraltet, v2 zeigt die Änderungen.
- `lieferkette/`: Bestellungen (XLSX), Verzugs-Mail (TXT), Qualitätsbericht (PDF); Nachtrag: Hafenstreik.
- `netzwerk/`: Kontakte/Zahlungen (XLSX), Ermittlungsbericht (PDF).

Eigene Dateien einfach über „＋ Daten“ hineinziehen (PDF, auch gescannt; TXT; XLSX/CSV; Bilder).
Alles wird nur im Browser verarbeitet (IndexedDB); über „Export (JSON)“ lässt sich ein Workspace sichern
und z. B. im Repository ablegen.

Testdaten neu erzeugen: `pip install reportlab openpyxl pillow && npm run samples`

## Lokal starten und testen

```bash
npm install
npm start          # http://localhost:8765
npm test           # End-to-End-Test mit Playwright (Drohnen-Szenario inkl. Nachtrag)
```

Der Workflow `.github/workflows/test.yml` führt den Test bei jedem Push aus;
`.github/workflows/pages.yml` veröffentlicht `main` auf GitHub Pages
(Repository → Settings → Pages → Source: „GitHub Actions“).

## Aufbau

```
index.html, css/app.css
js/app.js         Import-Pipeline, Verdrahtung, Dialoge
js/parsers.js     PDF (pdf.js, OCR-Fallback), Excel (SheetJS), Bilder (Tesseract)
js/normalize.js   Zeit-/Datums-/Koordinaten-/Zahl-Normalisierung mit Regel-IDs
js/extract.js     Quelle → Segmente, Rohtabellen, Beobachtungen, Entitäten
js/analysis.js    Rechenschritte, Analysen, Versionierung, Veraltet-Erkennung, Vorschläge
js/ai.js          optionale Claude-Anbindung (offizielles SDK, JSON-Schema-Ausgaben)
js/canvas.js, js/views.js, js/chat.js
vendor/           lokal gebündelte Bibliotheken (keine externen CDNs nötig)
samples/          synthetische Testdateien, tools/generate_samples.py erzeugt sie
```

Bibliotheken in `vendor/` stehen unter ihren eigenen Lizenzen (pdf.js: Apache-2.0,
SheetJS CE: Apache-2.0, Tesseract.js: Apache-2.0, Anthropic SDK: MIT; Lizenzdateien liegen bei).
