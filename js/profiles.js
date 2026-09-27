// Anwendungsprofile. Die Pipeline ist generisch; ein Profil liefert nur Vokabular,
// Ortsverzeichnis und Parameter fuer Berechnungen. Die Ontologie kommt spaeter hinzu.

const GAZ_OSTSEE = {
  "Fehmarn": [54.45, 11.19], "Fehmarnbelt": [54.58, 11.30], "Puttgarden": [54.50, 11.23], "Heiligenhafen": [54.37, 10.98],
  "Staberhuk": [54.40, 11.31], "Lolland": [54.75, 11.45], "Kiel": [54.32, 10.14], "Rostock": [54.09, 12.10],
  "Warnemuende": [54.18, 12.08], "Ruegen": [54.42, 13.40], "Luebeck": [53.87, 10.69], "Travemuende": [53.96, 10.87],
  "Sassnitz": [54.51, 13.64], "Ostsee": [54.60, 12.00],
};
const GAZ_HAEFEN = {
  "Ningbo": [29.87, 121.55], "Shanghai": [31.23, 121.47], "Gdansk": [54.35, 18.65], "Danzig": [54.35, 18.65],
  "Rotterdam": [51.92, 4.48], "Hamburg": [53.55, 9.99], "Bremerhaven": [53.54, 8.58], "Duisburg": [51.43, 6.76],
  "Goeteborg": [57.71, 11.97], "Riga": [56.95, 24.11],
};

export const PROFILES = {
  lagebild: {
    label: "Lagebild (z. B. Drohnen)",
    objects: ["Drohne", "Drohnen", "Flugobjekt", "Flugobjekte", "Objekt", "Objekte", "Lichter", "Licht", "UAV", "Ballon", "Kleinziel", "Kleinziele", "Rotorgeraeusch", "Hubschrauber"],
    gazetteer: GAZ_OSTSEE,
    cluster: { windowMin: 30, radiusKm: 30, maxSpanMin: 120 },
    questions: ["Erstelle ein Lagebild zum Drohnenüberflug über der Ostsee", "Welche Zeitangaben wurden korrigiert?", "Wie viele Objekte wurden gesehen?", "Was hat sich durch neue Dateien geändert?"],
  },
  lieferkette: {
    label: "Lieferketten-Monitoring",
    objects: ["Container", "Lieferung", "Bestellung", "Charge", "Ausschuss", "Verzug", "Verzoegerung", "Streik"],
    gazetteer: GAZ_HAEFEN,
    cluster: { windowMin: 60 * 24 * 7, radiusKm: 5000 },
    questions: ["Welche Lieferungen sind verspätet und wie viel Wert ist betroffen?", "Welche Lieferanten sind kritisch?", "Was hat sich durch neue Dateien geändert?"],
  },
  netzwerk: {
    label: "Netzwerkanalyse",
    objects: ["Ueberweisung", "Anruf", "Treffen", "E-Mail", "Rechnung", "Zahlung", "Kontakt"],
    gazetteer: GAZ_HAEFEN,
    cluster: { windowMin: 60 * 24 * 3, radiusKm: 5000 },
    questions: ["Analysiere das Netzwerk: wer ist zentral?", "Gibt es Zahlungskreisläufe?", "Zeige alle Verbindungen von K. Brandt"],
  },
  generisch: {
    label: "Generisch",
    objects: ["Ereignis", "Meldung", "Objekt"],
    gazetteer: { ...GAZ_OSTSEE, ...GAZ_HAEFEN },
    cluster: { windowMin: 60, radiusKm: 50 },
    questions: ["Erstelle ein Lagebild aus allen Quellen", "Zeige die Zeitlinie", "Welche Werte wurden korrigiert?"],
  },
};

export const profileOf = (state) => PROFILES[state.workspace.profile] || PROFILES.generisch;
