"""Erzeugt synthetische Testdateien (PDF, XLSX, TXT, PNG-Scan) fuer Katoptrik.

Aufruf:  pip install reportlab openpyxl pillow && python tools/generate_samples.py
Alle Inhalte sind frei erfunden und dienen nur dem Test der Pipeline.
"""
import json
import os
import random
from datetime import datetime

from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = os.path.join(os.path.dirname(__file__), "..", "samples")
STYLES = getSampleStyleSheet()
random.seed(7)


def pdf(path, title, paragraphs, table=None, note=None):
    doc = SimpleDocTemplate(path, pagesize=A4, title=title, author="Synthetische Testdaten")
    story = [Paragraph(title, STYLES["Title"]), Spacer(1, 8)]
    for p in paragraphs:
        story += [Paragraph(p, STYLES["BodyText"]), Spacer(1, 6)]
    if table:
        t = Table(table, repeatRows=1)
        t.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8ecf2")),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
        ]))
        story += [Spacer(1, 6), t]
    if note:
        story += [Spacer(1, 10), Paragraph(note, STYLES["Italic"])]
    doc.build(story)


def xlsx(path, sheets):
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    wb.save(path)


def scan(path, lines):
    """Simuliert eine eingescannte Handnotiz (leicht schief, Rauschen)."""
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 34)
    img = Image.new("L", (1400, 120 + 70 * len(lines)), 246)
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((70 + random.randint(-6, 6), 60 + i * 70), line, fill=35, font=font)
    for _ in range(2500):
        x, y = random.randrange(img.width), random.randrange(img.height)
        img.putpixel((x, y), random.randint(150, 230))
    img = img.rotate(-1.2, fillcolor=246, expand=True).filter(ImageFilter.GaussianBlur(0.6))
    img.save(path)


def text(path, body):
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)


def drohnen(base):
    os.makedirs(base, exist_ok=True)
    scan(os.path.join(base, "01_handnotiz_wache_scan.png"), [
        "Notiz Wachdienst Hafen Heiligenhafen",
        "24.09.  ca. 2,5h  Lichter ueber dem Wasser",
        "Richtung Fehmarnbelt, 3 Objekte, sehr leise",
        "Hoehe geschaetzt 100-150m, Kurs Ost",
        "gez. Petersen",
    ])
    pdf(os.path.join(base, "02_lagemeldung_wsp_kiel.pdf"), "Lagemeldung Wasserschutzpolizei Kiel", [
        "Az. WSP-2026-0924-117 &middot; Datum: 24.09.2026 &middot; Einstufung: VS-NfD (synthetisch)",
        "02:34 Uhr: Meldung ueber 3 Drohnen noerdlich Fehmarn, Position 54.52 N, 11.28 E.",
        "02:41 Uhr: Streife Heiligenhafen bestaetigt Lichter, Flugrichtung Ost, Hoehe ca. 150 m.",
        "02:58 Uhr: Kontakt verloren nahe Puttgarden.",
        "Einschaetzung: Mehrere unbemannte Flugobjekte, Herkunft unbekannt. Keine Schaeden gemeldet.",
    ])
    text(os.path.join(base, "03_anrufnotizen_leitstelle.txt"),
         "Anrufnotizen Leitstelle Ostholstein - 24.09.2026\n\n"
         "Anruf 1 - 24.9. 0240 uhr - Hr. Jensen (Fischer, Kutter SH-12) sieht 2 drohen ueber Fehmarnbelt, blinkend rot\n"
         "Anruf 2 - 24.09.26 um halb drei - Anwohnerin Puttgarden: Summen, 4 Lichter Richtung Lolland\n"
         "Anruf 3 - 24.09. 14.30 - Nachtrag Faehrpersonal Scandlines: 1 Objekt bei Puttgarden gegen 3 Uhr nachts\n"
         "Anruf 4 - 24.09. 02:47 - Segler vor Staberhuk: 3 Lichter in Formation, Kurs Ost\n")
    pdf(os.path.join(base, "04_radar_auswertung.pdf"), "Radar-Auswertung Kuestenstation (synthetisch)", [
        "Auswertung vom 24.09.2026. <b>Alle Zeiten in UTC</b> (MESZ = UTC+2).",
        "Erfasst wurden drei langsame Kleinziele (Tracks T-01 bis T-03) ueber dem Fehmarnbelt.",
    ], table=[
        ["Track", "Zeit UTC", "Breite", "Laenge", "Geschw. kn", "Hoehe m"],
        ["T-01", "00:31", "54.51", "11.24", "38", "140"],
        ["T-01", "00:44", "54.53", "11.40", "41", "150"],
        ["T-02", "00:33", "54.49", "11.26", "35", "120"],
        ["T-03", "00:36", "54.50", "11.22", "36", "130"],
        ["T-03", "00:57", "54.56", "11.52", "40", "135"],
    ], note="Hinweis: Tracks T-02/T-03 zeitweise ueberlagert.")
    xlsx(os.path.join(base, "05_sensorliste.xlsx"), {
        "Detektionen": [
            ["Zeitstempel", "Sensor", "Breite", "Länge", "Typ", "Anzahl", "Konfidenz"],
            ["24.09.2026 02:32", "RF-Fehmarn-Nord", 54.52, 11.25, "Drohne (RF 2.4 GHz)", 3, 0.82],
            ["2:35", "RF-Fehmarn-Nord", 54.52, 11.29, "Drohne (RF 2.4 GHz)", 3, 0.77],
            ["02.38 Uhr", "Akustik-Staberhuk", 54.41, 11.30, "Rotorgeraeusch", 1, 0.64],
            [datetime(2026, 9, 24, 2, 44), "RF-Puttgarden", 54.50, 11.22, "Drohne (RF 5.8 GHz)", 2, 0.71],
            ["2,75h", "RF-Puttgarden", 54.51, 11.21, "Drohne (RF 5.8 GHz)", 1, 0.58],
            ["23.09.2026 18:10", "RF-Kiel-Hafen", 54.32, 10.14, "Modellflug angemeldet", 1, 0.95],
        ],
        "Sensoren": [
            ["Sensor", "Breite", "Länge", "Betreiber"],
            ["RF-Fehmarn-Nord", 54.53, 11.20, "Kuestenwache"],
            ["Akustik-Staberhuk", 54.40, 11.31, "Bundespolizei See"],
            ["RF-Puttgarden", 54.50, 11.22, "Kuestenwache"],
            ["RF-Kiel-Hafen", 54.32, 10.14, "Hafenbehoerde"],
        ],
    })


def drohnen_nachtrag(base):
    os.makedirs(base, exist_ok=True)
    pdf(os.path.join(base, "06_nachmeldung_marine.pdf"), "Nachmeldung Marinekommando (spaeter eingegangen)", [
        "Datum: 24.09.2026, 09:15 Uhr. Bezug: WSP-2026-0924-117.",
        "Die Auswertung bestaetigt 4 Objekte (nicht 3). Ein Objekt landete um 03:05 Uhr auf dem Frachter "
        "Baltic Star (IMO 9387421) nahe Position 54.60 N, 11.45 E.",
        "Die Baltic Star lief um 04:10 Uhr Richtung Rostock weiter. Weitere Klaerung durch Bundespolizei See.",
    ])


def lieferkette(base):
    os.makedirs(base, exist_ok=True)
    xlsx(os.path.join(base, "01_lieferanten_bestellungen.xlsx"), {
        "Bestellungen": [
            ["Bestellung", "Lieferant", "Land", "Hafen", "Teil", "Bestellt", "Zugesagt", "Geliefert", "Menge", "Wert EUR"],
            ["PO-4471", "Ningbo Precision", "China", "Ningbo", "Getriebegehaeuse", "01.08.2026", "06.10.2026", "", 1200, 184000],
            ["PO-4472", "Baltic Metals", "Polen", "Gdansk", "Stahlblech 2mm", "05.08.2026", "10.09.2026", "12.09.2026", 40000, 96000],
            ["PO-4473", "Rhein Elektronik", "Deutschland", "Duisburg", "Steuerplatine", "10.08.2026", "15.09.2026", "15.09.2026", 800, 64000],
            ["PO-4474", "Ningbo Precision", "China", "Ningbo", "Lagerbuchse", "12.08.2026", "13.10.2026", "", 5000, 22500],
            ["PO-4475", "Nordic Polymer", "Schweden", "Goeteborg", "Dichtungsring", "20.08.2026", "20.09.2026", "29.09.2026", 20000, 8000],
        ],
    })
    text(os.path.join(base, "02_mail_verzug.txt"),
         "Von: logistik@ningbo-precision.example\nBetreff: Verzug PO-4471 / PO-4474\n\n"
         "Hallo, der Container MSKU1234567 fuer Bestellung PO-4471 steht noch im Hafen Ningbo. "
         "Wir rechnen mit einer Verzoegerung von ca 2,5 Wochen, Lieferung KW 44 statt KW 41. "
         "PO-4474 ist ebenfalls betroffen (Verzug 10 Tage).\nGruesse, Li Wei\n")
    pdf(os.path.join(base, "03_qualitaetsbericht.pdf"), "Qualitaetsbericht Wareneingang", [
        "Wareneingang 12.09.2026, Charge 7781 von Baltic Metals (PO-4472): 3,2 % Ausschuss wegen Kantenrissen.",
        "Wareneingang 29.09.2026, Nordic Polymer (PO-4475): Lieferung vollstaendig, 9 Tage verspaetet.",
        "Empfehlung: Baltic Metals auf erhoehte Pruefstufe setzen.",
    ])


def lieferkette_nachtrag(base):
    os.makedirs(base, exist_ok=True)
    pdf(os.path.join(base, "04_streikmeldung_hafen.pdf"), "Meldung: Streik Hafen Gdansk", [
        "Ab 01.10.2026 wird im Hafen Gdansk fuer voraussichtlich 5 Tage gestreikt.",
        "Betroffen sind alle Containerterminals. Baltic Metals meldet Verzug fuer Folgeauftraege.",
    ])


def netzwerk(base):
    os.makedirs(base, exist_ok=True)
    xlsx(os.path.join(base, "01_kontakte.xlsx"), {
        "Kontakte": [
            ["Von", "An", "Art", "Datum", "Betrag EUR"],
            ["Nordwind Handels GmbH", "K. Brandt", "Ueberweisung", "03.09.2026", 25000],
            ["K. Brandt", "M. Sorensen", "Anruf", "04.09.2026", ""],
            ["M. Sorensen", "Baltic Shell Ltd", "Ueberweisung", "06.09.2026", 24000],
            ["Baltic Shell Ltd", "Nordwind Handels GmbH", "Rechnung", "10.09.2026", 23500],
            ["K. Brandt", "A. Petrov", "Treffen", "12.09.2026", ""],
            ["A. Petrov", "Baltic Shell Ltd", "E-Mail", "13.09.2026", ""],
        ],
    })
    pdf(os.path.join(base, "02_ermittlungsbericht.pdf"), "Ermittlungsbericht (synthetisch)", [
        "K. Brandt ist Geschaeftsfuehrer der Nordwind Handels GmbH und steht in regelmaessigem Kontakt zu M. Sorensen.",
        "Die Baltic Shell Ltd hat ihren Sitz in Riga; A. Petrov ist dort als Direktor eingetragen.",
        "Zahlungen laufen im Kreis: Nordwind Handels GmbH - K. Brandt - M. Sorensen - Baltic Shell Ltd.",
    ])


if __name__ == "__main__":
    drohnen(os.path.join(ROOT, "drohnen-ostsee"))
    drohnen_nachtrag(os.path.join(ROOT, "drohnen-ostsee", "nachtrag"))
    lieferkette(os.path.join(ROOT, "lieferkette"))
    lieferkette_nachtrag(os.path.join(ROOT, "lieferkette", "nachtrag"))
    netzwerk(os.path.join(ROOT, "netzwerk"))
    manifest = {"scenarios": []}
    for sid, title, profile in [
        ("drohnen-ostsee", "Drohnenueberflug Ostsee", "lagebild"),
        ("lieferkette", "Lieferketten-Monitoring", "lieferkette"),
        ("netzwerk", "Netzwerkanalyse", "netzwerk"),
    ]:
        base = os.path.join(ROOT, sid)
        files = sorted(f for f in os.listdir(base) if os.path.isfile(os.path.join(base, f)))
        later = os.path.join(base, "nachtrag")
        late = sorted(os.listdir(later)) if os.path.isdir(later) else []
        manifest["scenarios"].append({
            "id": sid, "title": title, "profile": profile,
            "files": [f"{sid}/{f}" for f in files],
            "later": [f"{sid}/nachtrag/{f}" for f in late],
        })
    with open(os.path.join(ROOT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print("Beispieldaten erzeugt in", os.path.abspath(ROOT))
