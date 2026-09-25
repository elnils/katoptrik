"""Grosses synthetisches Szenario mit vielen Eingabequellen und Ground Truth.

Mehrere Drohnen-Vorfaelle an der Ostseekueste ueber vier Naechte, dazu Stoerquellen
(Modellflug, Vogelschwarm, Faehrbeleuchtung). Jede Quelle ist absichtlich unsauber:
gemischte Zeitformate, UTC, Tippfehler, OCR-Rauschen, fehlende Datumsangaben.

Ausgabe: samples/grosslage-ostsee/ (+ nachtrag/) und truth.json mit den wahren
Vorfaellen sowie der wahren Zeit je Tabellen-/Textzeile fuer die Auswertung.

Aufruf:  python tools/generate_grosslage.py [--scale N]
  --scale vervielfacht die Sensor-/AIS-Datenmenge (Lasttest), Standard 1.
"""
import argparse
import json
import math
import os
import random
from datetime import datetime, timedelta, timezone

from docx import Document
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as pdfcanvas

from generate_samples import pdf

OUT = os.path.join(os.path.dirname(__file__), "..", "samples", "grosslage-ostsee")
LOCAL = timezone(timedelta(hours=2))  # MESZ
PLACES = {
    "Kiel": (54.32, 10.14), "Warnemuende": (54.18, 12.08), "Ruegen": (54.42, 13.40),
    "Fehmarnbelt": (54.58, 11.30), "Rostock": (54.09, 12.10), "Travemuende": (53.96, 10.87),
    "Heiligenhafen": (54.37, 10.98), "Puttgarden": (54.50, 11.23), "Luebeck": (53.87, 10.69),
}
INCIDENTS = [
    ("I1", "2026-09-22 23:40", 30, "Kiel", 2, None),
    ("I2", "2026-09-23 02:10", 35, "Warnemuende", 3, None),
    ("I3", "2026-09-23 21:15", 25, "Ruegen", 1, None),
    ("I4", "2026-09-24 02:30", 35, "Fehmarnbelt", 4, "Baltic Star"),
    ("I5", "2026-09-24 04:20", 30, "Rostock", 2, "Baltic Star"),
    ("I6", "2026-09-24 22:50", 30, "Travemuende", 3, None),
    ("I7", "2026-09-25 01:40", 30, "Heiligenhafen", 2, None),
    ("I8", "2026-09-25 03:30", 25, "Kiel", 3, None),
]
DISTRACTORS = [
    ("D1", "2026-09-22 18:10", "Kiel", "Modellflug angemeldet"),
    ("D2", "2026-09-23 17:30", "Luebeck", "Modellflug angemeldet"),
    ("D3", "2026-09-24 05:40", "Ruegen", "Vogelschwarm (Radar)"),
    ("D4", "2026-09-24 23:55", "Puttgarden", "Faehrbeleuchtung"),
]
OBJ_WORDS = ["Drohnen", "Drohne", "drohen", "Drohnenn", "Flugobjekte", "Flugobjeckt", "Lichter", "UAV", "Objekte"]
NUMWORDS = {1: "ein", 2: "zwei", 3: "drei", 4: "vier", 5: "fuenf"}
HOURWORDS = {1: "eins", 2: "zwei", 3: "drei", 4: "vier", 5: "fuenf", 6: "sechs", 9: "neun", 10: "zehn", 11: "elf", 12: "zwoelf"}
R = random.Random(42)


def parse(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=LOCAL)


def jitter(latlon, km=4):
    lat, lon = latlon
    return round(lat + R.uniform(-km, km) / 111, 3), round(lon + R.uniform(-km, km) / 70, 3)


class Truth:
    def __init__(self):
        self.records = []

    def add(self, file, loc, t, incident, tol=0):
        self.records.append({"file": file, "loc": loc, "date": t.strftime("%Y-%m-%d"), "time": t.strftime("%H:%M"), "incident": incident, "tolerance_min": tol})


def spoken_time(t):
    """Zeit in einer zufaelligen, teils fehlerhaften Schreibweise + Toleranz fuer die Auswertung."""
    h, m = t.hour, t.minute
    opts = [(f"{h:02d}:{m:02d} Uhr", 0), (f"{h:02d}{m:02d} uhr", 0), (f"{h}.{m:02d}", 0), (f"{h:02d}:{m:02d}", 0)]
    if m in (0, 15, 30, 45) and h < 10:
        opts.append((f"ca. {h},{ {0: '0', 15: '25', 30: '5', 45: '75'}[m]}h", 0))
    if 25 <= m <= 35 and (h + 1) % 12 in HOURWORDS:
        opts.append((f"um halb {HOURWORDS[(h + 1) % 12 or 12]}", 5))
    if 10 <= m <= 20 and h % 12 in HOURWORDS:
        opts.append((f"viertel nach {HOURWORDS[h % 12 or 12]}", 5))
    if m >= 50 or m <= 8:
        hh = h + 1 if m >= 50 else h
        opts.append((f"gegen {hh % 24} Uhr", 12))
    return R.choice(opts)


def count_text(n):
    return R.choice([str(n), NUMWORDS.get(n, str(n))])


# ---------------------------------------------------------------- Quellen

def call_notes(truth, nights):
    for night, events in nights.items():
        name = f"anrufnotizen_leitstelle_{night.replace('.', '')}.txt"
        lines = [f"Anrufnotizen Leitstelle - Nacht {night}2026", ""]
        k = 1
        for inc, t, place, n, desc in events:
            tt = t + timedelta(minutes=R.randint(-3, 8))
            tstr, tol = spoken_time(tt)
            day = R.choice([f"{tt.day}.{tt.month}.", f"{tt.day:02d}.{tt.month:02d}.", f"{tt.day:02d}.{tt.month:02d}.26", ""])
            who = R.choice(["Anwohner", "Anwohnerin", "Hr. Jensen (Fischer)", "Segler", "Faehrpersonal", "Wachdienst Hafen", "Taxifahrer", "Fr. Olsen"])
            obj = desc or f"{count_text(n)} {R.choice(OBJ_WORDS)}"
            if R.random() < 0.15 and not desc:
                # Nachtrag: Meldezeit am Tag, Ereignis in der Nacht
                rep = f"{R.randint(9, 16)}.{R.choice(['10', '30', '45'])}"
                text = f"Anruf {k} - {day} {rep} - Nachtrag {who}: {obj} bei {place} gegen {(tt.hour + (1 if tt.minute > 30 else 0)) % 24} Uhr nachts"
                tol = 35
                tt_truth = tt.replace(minute=0) + (timedelta(hours=1) if tt.minute > 30 else timedelta())
            else:
                text = f"Anruf {k} - {day} {tstr} - {who}: {obj} ueber {place}, {R.choice(['blinkend rot', 'sehr leise', 'Summen', 'Richtung Ost', 'Richtung See', 'tief fliegend'])}"
                tt_truth = tt
            lines.append(text)
            truth.add(name, f"Z.{len(lines)}", tt_truth, inc, tol)
            k += 1
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")


def police_reports():
    for inc, start, dur, place, n, ship in INCIDENTS:
        if R.random() > 0.85:
            continue
        t0 = parse(start)
        lat, lon = jitter(PLACES[place], 3)
        paras = [f"Az. WSP-{t0:%Y-%m%d}-{R.randint(100, 999)} &middot; Datum: {t0:%d.%m.%Y}"]
        paras.append(f"{t0 + timedelta(minutes=R.randint(0, 5)):%H:%M} Uhr: Meldung ueber {n} Drohnen im Raum {place}, Position {lat} N, {lon} E.")
        paras.append(f"{t0 + timedelta(minutes=R.randint(8, 15)):%H:%M} Uhr: Streife bestaetigt Lichter, Flugrichtung {R.choice(['Ost', 'Nordost', 'See'])}, Hoehe ca. {R.choice([80, 120, 150])} m.")
        if ship:
            paras.append(f"Ein Objekt naeherte sich dem Frachter {ship}.")
        paras.append(f"{t0 + timedelta(minutes=dur):%H:%M} Uhr: Kontakt verloren.")
        pdf(os.path.join(OUT, f"lagemeldung_wsp_{inc.lower()}_{place.lower()}.pdf"), f"Lagemeldung Wasserschutzpolizei {place}", paras)


def radar_reports():
    nights = {}
    for inc, start, dur, place, n, _ in INCIDENTS:
        nights.setdefault(parse(start).strftime("%d.%m."), []).append((inc, parse(start), dur, place, n))
    for night, evs in nights.items():
        rows = [["Track", "Zeit UTC", "Breite", "Laenge", "Geschw. kn", "Hoehe m"]]
        tno = 1
        for inc, t0, dur, place, n in evs:
            for _ in range(min(n, 3)):
                for step in range(0, dur, R.choice([9, 12, 15])):
                    tu = (t0 + timedelta(minutes=step)).astimezone(timezone.utc)
                    lat, lon = jitter(PLACES[place], 6)
                    rows.append([f"T-{tno:02d}", tu.strftime("%H:%M"), f"{lat:.2f}", f"{lon:.2f}", str(R.randint(30, 45)), str(R.choice([110, 130, 150]))])
                tno += 1
        if night == "24.09.":
            tu = parse("2026-09-24 05:40").astimezone(timezone.utc)
            lat, lon = jitter(PLACES["Ruegen"], 4)
            rows.append([f"T-{tno:02d}", tu.strftime("%H:%M"), f"{lat:.2f}", f"{lon:.2f}", "22", "60"])
        from generate_samples import pdf as mkpdf
        mkpdf(os.path.join(OUT, f"radar_auswertung_{night.replace('.', '')}.pdf"), f"Radar-Auswertung Kuestenstationen {night}2026",
              [f"Auswertung vom {night}2026. <b>Alle Zeiten in UTC</b> (MESZ = UTC+2).", "Langsame Kleinziele ueber See."], table=rows)


def sensor_logs(truth, scale):
    stations = {"RF-Fehmarn-Nord": (54.53, 11.20), "RF-Kiel-Hafen": (54.32, 10.14), "RF-Warnemuende": (54.18, 12.08), "Akustik-Staberhuk": (54.40, 11.31)}
    for st, pos in stations.items():
        name = f"sensor_{st.lower()}.xlsx"
        det = []
        for inc, start, dur, place, n, _ in INCIDENTS:
            if math.dist(pos, PLACES[place]) > 0.55:
                continue
            t0 = parse(start)
            for step in range(0, dur, R.choice([3, 4, 5])):
                det.append((t0 + timedelta(minutes=step), inc, "Drohne (RF 2.4 GHz)" if st.startswith("RF") else "Rotorgeraeusch", R.randint(max(1, n - 1), n), round(R.uniform(0.6, 0.93), 2), jitter(PLACES[place], 5)))
        for _ in range(int(60 * scale)):
            t = parse("2026-09-22 18:00") + timedelta(minutes=R.randint(0, 3.5 * 24 * 60))
            det.append((t, None, R.choice(["Stoersignal", "WLAN", "unbekannt"]), 1, round(R.uniform(0.15, 0.45), 2), jitter(pos, 2)))
        if st == "RF-Kiel-Hafen":
            det.append((parse("2026-09-22 18:10"), None, "Modellflug angemeldet", 1, 0.95, pos))
        det.sort(key=lambda d: d[0])
        wb = Workbook()
        ws = wb.active
        ws.title = "Detektionen"
        ws.append(["Zeitstempel", "Sensor", "Breite", "Länge", "Typ", "Anzahl", "Konfidenz"])
        prev_day = None
        for t, inc, typ, n, conf, (lat, lon) in det:
            r = R.random()
            if r < 0.7:
                val = t.replace(tzinfo=None)
            elif r < 0.8:
                val = t.strftime("%d.%m.%Y %H:%M")
            elif r < 0.9 and prev_day == t.date():
                val = f"{t.hour}:{t.minute:02d}"  # Datum fehlt -> aus Vorzeile
            elif r < 0.95:
                val = t.strftime("%d.%m.%Y %H.%M Uhr")
            else:
                val = t.strftime("%d.%m.%y %H:%M")
            prev_day = t.date()
            ws.append([val, st, lat, lon, typ, n, conf])
            truth.add(name, f"Detektionen!Z.{ws.max_row}", t, inc)
        wb.save(os.path.join(OUT, name))


def ais_export(truth, scale):
    name = "ais_export_schiffe.csv"
    ships = {"Baltic Star": ("219876543", [("2026-09-24 01:30", "Fehmarnbelt"), ("2026-09-24 05:00", "Rostock")]),
             "Nordlys": ("257123456", [("2026-09-22 22:30", "Kiel"), ("2026-09-23 03:00", "Warnemuende")]),
             "Skandia": ("265998877", [("2026-09-24 21:00", "Puttgarden"), ("2026-09-25 02:00", "Kiel")])}
    lines = ["MMSI,Name,Zeit (UTC),Breite,Länge,SOG kn"]
    rows = []
    for ship, (mmsi, legs) in ships.items():
        (ta, pa), (tb, pb) = legs
        ta, tb = parse(ta), parse(tb)
        steps = int((tb - ta).total_seconds() / 60 / (15 / scale))
        for i in range(steps + 1):
            f = i / steps
            t = ta + (tb - ta) * f
            lat = PLACES[pa][0] + (PLACES[pb][0] - PLACES[pa][0]) * f
            lon = PLACES[pa][1] + (PLACES[pb][1] - PLACES[pa][1]) * f
            rows.append((t, f"{mmsi},{ship},{t.astimezone(timezone.utc):%Y-%m-%dT%H:%M:00Z},{lat:.4f},{lon:.4f},{R.uniform(9, 14):.1f}"))
    rows.sort()
    for t, line in rows:
        lines.append(line)
        truth.add(name, f"Sheet1!Z.{len(lines)}", t.replace(second=0, microsecond=0), None)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def json_feed(truth):
    name = "detektionssystem_export.json"
    items = []
    for inc, start, dur, place, n, _ in INCIDENTS:
        if R.random() < 0.3:
            continue
        t0 = parse(start)
        for step in range(0, dur, 10):
            t = t0 + timedelta(minutes=step + R.randint(0, 3))
            lat, lon = jitter(PLACES[place], 4)
            items.append((t, inc, {"id": f"DET-{len(items) + 1:04d}", "ts": t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "sensor": "DroneShield-Mobil", "lat": lat, "lon": lon, "klasse": "UAV", "anzahl": n, "score": round(R.uniform(0.7, 0.97), 2)}))
    items.sort(key=lambda x: x[0])
    for i, (t, inc, _) in enumerate(items):
        truth.add(name, f"daten!Z.{i + 2}", t, inc)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        json.dump({"system": "Detektionssystem (synthetisch)", "exportiert": "2026-09-25T08:00:00Z", "detektionen": [x[2] for x in items]}, f, ensure_ascii=False, indent=1)


def emails():
    mails = [
        ("lagezentrum@bpol.example", "wsp-kiel@polizei.example", "2026-09-23 07:40", "Drohnen Kiel und Warnemuende", ["Guten Morgen,", "heute Nacht gegen 23:40 Uhr (22.09.) meldeten mehrere Anrufer 2 Drohnen ueber dem Kieler Hafen.", "Zusaetzlich um 02:10 Uhr drei Flugobjekte bei Warnemuende, Radar bestaetigt.", "Bitte Abgleich mit AIS.", "Gruss, Lagezentrum"]),
        ("wsp-kiel@polizei.example", "lagezentrum@bpol.example", "2026-09-23 08:15", "AW: Drohnen Kiel und Warnemuende", ["AIS zeigt MS Nordlys auf dem Weg von Kiel nach Warnemuende im betreffenden Zeitraum.", "Ob ein Zusammenhang besteht, ist offen."]),
        ("marine-lage@bundeswehr.example", "lagezentrum@bpol.example", "2026-09-24 06:05", "Fehmarnbelt 24.09.", ["Um 02:30 Uhr wurden ueber dem Fehmarnbelt mehrere UAV erfasst (54.55 N, 11.29 E).", "Der Frachter Baltic Star (IMO 9387421) befand sich in unmittelbarer Naehe.", "Gegen 04:20 Uhr erneut 2 Drohnen bei Rostock, als die Baltic Star einlief."]),
        ("hafen-rostock@hafen.example", "lagezentrum@bpol.example", "2026-09-24 09:30", "Einlaufen Baltic Star", ["Die Baltic Star hat um 05:10 Uhr festgemacht. Besatzung meldet keine Auffaelligkeiten."]),
        ("lagezentrum@bpol.example", "bsi-lage@bsi.example", "2026-09-25 07:20", "Serie von Ueberfluegen 22.-25.09.", ["Seit dem 22.09. registrieren wir eine Serie von Ueberfluegen an der Kueste (Kiel, Warnemuende, Ruegen, Fehmarnbelt, Rostock, Travemuende, Heiligenhafen).", "Zuletzt heute um 03:30 Uhr 5 Drohnen ueber Kiel.", "Bitte um Einschaetzung zu Funkprotokollen."]),
        ("presse@polizei.example", "lagezentrum@bpol.example", "2026-09-25 10:00", "Presseanfrage Travemuende", ["Anfrage NDR zu Lichtern ueber Travemuende am 24.09. gegen 23 Uhr."]),
    ]
    for i, (fr, to, date, subj, body) in enumerate(mails, 1):
        d = parse(date)
        msg = [f"From: {fr}", f"To: {to}", f"Date: {d.strftime('%a, %d %b %Y %H:%M:00 +0200')}", f"Subject: {subj}", "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", *body, ""]
        with open(os.path.join(OUT, f"mail_{i:02d}_{d:%m%d}.eml"), "w", encoding="utf-8") as f:
            f.write("\r\n".join(msg))


def docx_memo():
    doc = Document()
    doc.add_heading("Lagevermerk Bundespolizei See (synthetisch)", 1)
    doc.add_paragraph("Stand: 25.09.2026, 08:00 Uhr. Zusammenfassung der gemeldeten Ueberfluege.")
    t = doc.add_table(rows=1, cols=5)
    for c, h in zip(t.rows[0].cells, ["Datum", "Zeit", "Ort", "Anzahl", "Bemerkung"]):
        c.text = h
    for inc, start, dur, place, n, ship in INCIDENTS:
        d = parse(start)
        zeit = f"{d:%H:%M}"
        if inc == "I4":
            zeit = "2,5h"  # Formatfehler wie in der Handnotiz
        anzahl = n + (2 if inc == "I8" else 0)  # absichtlich falsche Anzahl
        for c, v in zip(t.add_row().cells, [f"{d:%d.%m.%Y}", zeit, place, str(anzahl), ship or ""]):
            c.text = v
    doc.add_paragraph("Bewertung: koordiniertes Vorgehen wahrscheinlich; Bezug zur Baltic Star pruefen.")
    doc.save(os.path.join(OUT, "lagevermerk_bpol_see.docx"))


def html_press():
    body = "".join(f"<p>{p}</p>" for p in [
        "Polizeidirektion (synthetisch) &ndash; Pressemitteilung vom 25.09.2026",
        "In den vergangenen Naechten wurden an der Ostseekueste wiederholt Drohnen beobachtet, zuletzt am 25.09. gegen 01:40 Uhr bei Heiligenhafen (2 Objekte).",
        "Die Ermittlungen dauern an. Hinweise nimmt jede Polizeidienststelle entgegen.",
    ])
    with open(os.path.join(OUT, "pressemitteilung.html"), "w", encoding="utf-8") as f:
        f.write(f"<!doctype html><html lang=de><head><meta charset=utf-8><title>Pressemitteilung</title></head><body><h1>Drohnen an der Kueste</h1>{body}</body></html>")


def handwriting(path, lines, font_size=34):
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
    img = Image.new("L", (1400, 120 + 70 * len(lines)), 246)
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((70 + R.randint(-8, 8), 60 + i * 70), line, fill=35, font=font)
    for _ in range(2500):
        img.putpixel((R.randrange(img.width), R.randrange(img.height)), R.randint(150, 230))
    return img.rotate(R.uniform(-1.8, 1.8), fillcolor=246, expand=True).filter(ImageFilter.GaussianBlur(0.6))


def scans():
    for inc, start, dur, place, n, _ in R.sample(INCIDENTS, 4):
        t = parse(start) + timedelta(minutes=R.randint(0, 10))
        tstr, _ = spoken_time(t)
        img = handwriting(None, [f"Notiz Wache {place}", f"{t:%d.%m.}  {tstr}  Lichter ueber Wasser", f"{count_text(n)} Objekte, {R.choice(['sehr leise', 'Kurs Ost', 'blinkend'])}", "gez. " + R.choice(["Petersen", "Hansen", "Moeller"])])
        img.save(os.path.join(OUT, f"handnotiz_{inc.lower()}_scan.png"))
    # gescanntes Fax ohne Textebene (OCR-Fallback im PDF)
    img = handwriting(None, ["FAX Hafenbehoerde Rostock", "24.09.2026 04:25 Uhr", "2 Drohnen ueber Liegeplatz 12", "Frachter Baltic Star laeuft ein"], 30)
    path = os.path.join(OUT, "fax_hafenbehoerde_rostock_scan.pdf")
    c = pdfcanvas.Canvas(path, pagesize=A4)
    w, h = A4
    c.drawImage(ImageReader(img.convert("RGB")), 30, h - 30 - img.height * (w - 60) / img.width, width=w - 60, height=img.height * (w - 60) / img.width)
    c.save()


def nachtrag(truth):
    base = os.path.join(OUT, "nachtrag")
    os.makedirs(base, exist_ok=True)
    pdf(os.path.join(base, "nachmeldung_marine_baltic_star.pdf"), "Nachmeldung Marinekommando", [
        "Datum: 25.09.2026, 11:00 Uhr. Bezug: Fehmarnbelt 24.09.",
        "Die Auswertung bestaetigt 4 Objekte. Ein Objekt landete um 03:05 Uhr auf dem Frachter Baltic Star (IMO 9387421) nahe Position 54.60 N, 11.45 E.",
        "Die Baltic Star lief um 04:10 Uhr Richtung Rostock weiter.",
    ])
    with open(os.path.join(base, "mail_korrektur_kiel.eml"), "w", encoding="utf-8") as f:
        f.write("\r\n".join(["From: wsp-kiel@polizei.example", "To: lagezentrum@bpol.example", "Date: Fri, 25 Sep 2026 12:30:00 +0200", "Subject: Korrektur Kiel 25.09.", "", "Korrektur zur Meldung von 03:30 Uhr ueber Kiel: nach Videoauswertung waren es 3 Drohnen, nicht 5.", ""]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--out", default=None, help="Zielordner (Standard: samples/grosslage-ostsee)")
    args = ap.parse_args()
    global OUT
    if args.out:
        OUT = args.out
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        p = os.path.join(OUT, f)
        if os.path.isfile(p):
            os.remove(p)
    truth = Truth()
    nights = {}
    for inc, start, dur, place, n, _ in INCIDENTS:
        t0 = parse(start)
        night = (t0 - timedelta(hours=12)).strftime("%d.%m.")
        for _ in range(R.randint(2, 4)):
            nights.setdefault(night, []).append((inc, t0 + timedelta(minutes=R.randint(0, dur)), place, n, None))
    for did, start, place, desc in DISTRACTORS:
        t0 = parse(start)
        if "Faehr" in desc:
            nights.setdefault((t0 - timedelta(hours=12)).strftime("%d.%m."), []).append((None, t0, place, 0, "Lichter, vermutlich Drohnen"))
    for k in nights:
        nights[k].sort(key=lambda e: e[1])
    call_notes(truth, nights)
    police_reports()
    radar_reports()
    sensor_logs(truth, args.scale)
    ais_export(truth, args.scale)
    json_feed(truth)
    emails()
    docx_memo()
    html_press()
    scans()
    nachtrag(truth)
    inc = [{"id": i, "start": s, "dauer_min": d, "ort": p, "lat": PLACES[p][0], "lon": PLACES[p][1], "anzahl": n, "schiff": sh} for i, s, d, p, n, sh in INCIDENTS]
    dis = [{"id": i, "zeit": s, "ort": p, "art": a} for i, s, p, a in DISTRACTORS]
    with open(os.path.join(OUT, "truth.json"), "w", encoding="utf-8") as f:
        json.dump({"hinweis": "Ground Truth fuer die Auswertung – nicht importieren", "vorfaelle": inc, "stoerquellen": dis, "zeilen": truth.records}, f, ensure_ascii=False, indent=1)
    files = sorted(os.listdir(OUT))
    print(f"{len(files) - 2} Dateien + Nachtrag, {len(truth.records)} Zeilen mit Ground Truth → {os.path.abspath(OUT)}")


if __name__ == "__main__":
    main()
