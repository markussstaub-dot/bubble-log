"""Dashcam-Clips (Essgoo E72, .ts ohne GPS) -> verortete Standbilder für Mapillary.

Position, Richtung und Zeit kommen aus der GPS-Spur im Bubble-Log-Devlog (1 Hz, Feld "zeit").
Der Clip-Start steht im Dateinamen (20261109082041_0000849F.ts = 09.11.2026 08:20:41, Ortszeit).

  python tools/dashcam.py CLIP.ts LOG.jsonl AUSGABE [--abstand 2] [--versatz 0] [--zuhause LAT,LON --radius 500]

- Bilder im Stand (unter 2 m/s) und ohne GPS-Punkt in der Nähe (> 3 s) fallen weg.
- Mit --zuhause fallen Bilder im Radius darum weg (Privatsphäre, Mapillary ist öffentlich).
- --versatz: Sekunden, um die die Dashcam-Uhr vorgeht (positiv) oder nachgeht.
Braucht ffmpeg im PATH und piexif (pip install piexif).
"""
import argparse, bisect, json, math, os, re, subprocess, sys, time
from datetime import datetime

import piexif


def spur_laden(log):
    pts = []
    with open(log, encoding='utf-8') as f:
        for z in f:
            if '"typ":"gps"' not in z:
                continue
            try:
                d = json.loads(z)
            except ValueError:
                continue
            if d.get('lat') is None:
                continue
            pts.append((d.get('zeit') or d['t'], d['lat'], d['lon'], d.get('tempo') or 0, d.get('kurs'), d.get('hoehe')))
    pts.sort()
    return pts


def an(pts, t):
    """Interpolierte Position zur Zeit t (ms) oder None."""
    ts = [p[0] for p in pts]
    i = bisect.bisect_left(ts, t)
    if i == 0 or i == len(pts):
        return None
    a, b = pts[i - 1], pts[i]
    if b[0] - a[0] > 3000:
        return None
    w = (t - a[0]) / (b[0] - a[0])
    lat = a[1] + w * (b[1] - a[1]); lon = a[2] + w * (b[2] - a[2])
    tempo = a[3] + w * (b[3] - a[3])
    kurs = b[4] if b[4] is not None else a[4]
    hoehe = a[5] if a[5] is not None else b[5]
    return lat, lon, tempo, kurs, hoehe


def meter(lat1, lon1, lat2, lon2):
    k = 111320
    return math.hypot((lat2 - lat1) * k, (lon2 - lon1) * k * math.cos(math.radians(lat1)))


def rational(x, n=1_000_000):
    return (int(round(x * n)), n)


def dms(x):
    x = abs(x); g = int(x); m = int((x - g) * 60); s = (x - g - m / 60) * 3600
    return ((g, 1), (m, 1), rational(s, 1000))


def exif_schreiben(datei, t_ms, lat, lon, kurs, hoehe):
    zeit = datetime.fromtimestamp(t_ms / 1000).strftime('%Y:%m:%d %H:%M:%S')
    gps = {
        piexif.GPSIFD.GPSLatitudeRef: 'N' if lat >= 0 else 'S', piexif.GPSIFD.GPSLatitude: dms(lat),
        piexif.GPSIFD.GPSLongitudeRef: 'E' if lon >= 0 else 'W', piexif.GPSIFD.GPSLongitude: dms(lon),
    }
    if kurs is not None:
        gps[piexif.GPSIFD.GPSImgDirectionRef] = 'T'; gps[piexif.GPSIFD.GPSImgDirection] = rational(kurs % 360, 100)
    if hoehe is not None:
        gps[piexif.GPSIFD.GPSAltitudeRef] = 0; gps[piexif.GPSIFD.GPSAltitude] = rational(max(0, hoehe), 10)
    exif = {'0th': {piexif.ImageIFD.Make: 'ESSGOO', piexif.ImageIFD.Model: 'E72'},
            'Exif': {piexif.ExifIFD.DateTimeOriginal: zeit,
                     piexif.ExifIFD.SubSecTimeOriginal: f'{int(t_ms % 1000):03d}'},
            'GPS': gps}
    piexif.insert(piexif.dump(exif), datei)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('clip'); ap.add_argument('log'); ap.add_argument('aus')
    ap.add_argument('--abstand', type=float, default=2.0)
    ap.add_argument('--versatz', type=float, default=0.0)
    ap.add_argument('--zuhause'); ap.add_argument('--radius', type=float, default=500)
    a = ap.parse_args()

    m = re.search(r'(\d{14})_', os.path.basename(a.clip))
    if not m:
        sys.exit('Startzeit nicht im Dateinamen')
    # Das erste Bild trägt im Stempel 3 s mehr als der Dateiname (09.11.2026 geprüft: 08:20:41 → 08:20:44, über den
    # ganzen Clip gleich). Der Stempel passt auf ≈ 2 s zur GPS-Spur (Abbiegen im Video vs. Richtungswechsel im GPS).
    start = time.mktime(time.strptime(m.group(1), '%Y%m%d%H%M%S')) * 1000 + 3000 - a.versatz * 1000
    pts = spur_laden(a.log)
    heim = tuple(map(float, a.zuhause.split(','))) if a.zuhause else None

    os.makedirs(a.aus, exist_ok=True)
    praefix = os.path.splitext(os.path.basename(a.clip))[0]
    muster = os.path.join(a.aus, praefix + '_%04d.jpg')
    # Bild k zeigt die Zeit (k-1)*abstand ab Clip-Start (fps-Filter mit round=down, start_time 0)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', a.clip, '-map', '0:v:0',
                    '-vf', f'fps=1/{a.abstand}:round=down:start_time=0', '-q:v', '2', muster], check=True)

    zahl = {'behalten': 0, 'stand': 0, 'ohne gps': 0, 'zuhause': 0}
    for name in sorted(os.listdir(a.aus)):
        if not (name.startswith(praefix + '_') and name.endswith('.jpg')):
            continue
        k = int(name[-8:-4]); t = start + (k - 1) * a.abstand * 1000
        p = an(pts, t); datei = os.path.join(a.aus, name)
        grund = None
        if p is None:
            grund = 'ohne gps'
        elif p[2] < 2:
            grund = 'stand'
        elif heim and meter(heim[0], heim[1], p[0], p[1]) < a.radius:
            grund = 'zuhause'
        if grund:
            os.remove(datei); zahl[grund] += 1; continue
        # Richtung aus der Strecke ±1,5 s statt "kurs" vom GPS: der hinkt beim Abbiegen 1–2 s nach
        v, h = an(pts, t - 1500), an(pts, t + 1500)
        kurs = p[3]
        if v and h and meter(v[0], v[1], h[0], h[1]) > 3:
            kurs = math.degrees(math.atan2((h[1] - v[1]) * math.cos(math.radians(p[0])), h[0] - v[0])) % 360
        exif_schreiben(datei, t, p[0], p[1], kurs, p[4]); zahl['behalten'] += 1
    print(praefix, zahl)


if __name__ == '__main__':
    main()
