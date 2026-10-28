package app.bubblelog.microlino;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.os.SystemClock;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Barometer und Beschleunigung während einer Fahrt. Nativ gelesen, weil der WebView im Hintergrund
// keine devicemotion-Ereignisse bekommt. Die App holt bei jedem Streckenpunkt (25 m) eine Zusammenfassung ab;
// Rohdaten werden nicht gespeichert. Läuft nur zwischen start() und stop(); im Entwicklermodus auch beim Warten.
@CapacitorPlugin(name = "Fahrsensoren")
public class Fahrsensoren extends Plugin implements SensorEventListener {
    private static final float G = SensorManager.GRAVITY_EARTH;
    private static final float STARK = 0.3f * G;      // waagrechter Ausschlag ab hier: starkes Bremsen, Anfahren oder Kurve
    private static final float RUHIG = 0.2f * G;      // darunter ist der Ausschlag vorbei
    private static final float GLAETTUNG = 0.075f;    // ≈ 0,25 s bei 50 Hz, damit einzelne Stöße nicht zählen
    private static final float SCHWER_TIEFPASS = 0.01f;   // ≈ 2 s, nur ohne Schwerkraft-Sensor des Handys
    private static final long FENSTER_NS = 5_000_000_000L;   // Messfenster für den Entwicklermodus: 5 s
    private static final int FENSTER_MAX = 2000;              // ≈ 2,8 h, falls die App so lange nicht abholt

    private SensorManager sm;
    private HandlerThread thread;
    private PowerManager.WakeLock wakeLock;

    // Lage des Handys: Richtung der Schwerkraft im Handy-Koordinatensystem. Das Handy sitzt fest im Halter,
    // also trennt sie Stöße von unten (senkrecht) von Bremsen, Anfahren und Kurven (waagrecht).
    private final float[] schwer = new float[3];
    private boolean schwerOk;

    // Zusammenfassung seit dem letzten Abholen
    private double druckSumme, vertQuadrat;
    private int druckN, vertN;
    private float stossMax, waagGlatt, spitze;
    private long spitzeT;
    private boolean imAusschlag;
    private JSArray ausschlaege = new JSArray();

    // Messfenster (Entwicklermodus): unabhängig vom Abholen pro Streckenpunkt, auch im Stand. Zum Abstimmen von
    // Stillstand/Fahrt per Vibration und der Schwelle für starkes Bremsen. Nur Kennzahlen, keine Rohdaten.
    private long fensterStart;
    private double fVertQ, fWaagQ;
    private int fN;
    private float fVertMax, fWaagMax;
    private JSArray fenster = new JSArray();

    @Override
    public void load() {
        sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
    }

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (thread == null) {
            thread = new HandlerThread("Fahrsensoren");
            thread.start();
            Handler h = new Handler(thread.getLooper());
            Sensor druck = sm.getDefaultSensor(Sensor.TYPE_PRESSURE);
            Sensor linear = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION);
            Sensor schwerkraft = sm.getDefaultSensor(Sensor.TYPE_GRAVITY);
            if (druck != null) sm.registerListener(this, druck, 200000, h);   // 5 Hz reicht für die Höhe
            if (linear != null && schwerkraft != null) {
                sm.registerListener(this, linear, SensorManager.SENSOR_DELAY_GAME, h);
                sm.registerListener(this, schwerkraft, SensorManager.SENSOR_DELAY_GAME, h);
            } else {
                Sensor acc = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
                if (acc != null) sm.registerListener(this, acc, SensorManager.SENSOR_DELAY_GAME, h);
            }
            // Ohne Wake-Lock schläft die CPU bei dunklem Bildschirm ein und die Sensorwerte gehen verloren.
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BubbleLog:Fahrt");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(4 * 3600 * 1000L);
            schwerOk = false;
            fensterStart = 0; fVertQ = 0; fWaagQ = 0; fN = 0; fVertMax = 0; fWaagMax = 0;
        }
        zuruecksetzen();
        JSObject r = new JSObject();
        r.put("barometer", sm.getDefaultSensor(Sensor.TYPE_PRESSURE) != null);
        r.put("beschleunigung", sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        beenden();
        call.resolve();
    }

    @PluginMethod
    public synchronized void abholen(PluginCall call) {
        JSObject r = new JSObject();
        if (druckN > 0) {
            float druck = (float) (druckSumme / druckN);
            r.put("druck", druck);
            r.put("hoehe", SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, druck));
        }
        if (vertN > 0) {
            r.put("rau", Math.sqrt(vertQuadrat / vertN));   // Effektivwert des senkrechten Rüttelns in m/s²
            r.put("stoss", stossMax);
        }
        r.put("ausschlaege", ausschlaege);
        zuruecksetzen();
        call.resolve(r);
    }

    // Fertige 5-s-Fenster seit dem letzten Aufruf: [{ t, n, rau, waag, waagMax, stoss }] (m/s², waagMax geglättet in g)
    @PluginMethod
    public synchronized void messfenster(PluginCall call) {
        JSObject r = new JSObject();
        r.put("fenster", fenster);
        fenster = new JSArray();
        call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        beenden();
    }

    private synchronized void beenden() {
        if (thread == null) return;
        sm.unregisterListener(this);
        thread.quitSafely();
        thread = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    private void zuruecksetzen() {
        druckSumme = 0; druckN = 0; vertQuadrat = 0; vertN = 0; stossMax = 0;
        ausschlaege = new JSArray();
    }

    @Override
    public synchronized void onSensorChanged(SensorEvent e) {
        float[] v = e.values;
        switch (e.sensor.getType()) {
            case Sensor.TYPE_PRESSURE:
                druckSumme += v[0]; druckN++;
                break;
            case Sensor.TYPE_GRAVITY:
                System.arraycopy(v, 0, schwer, 0, 3); schwerOk = true;
                break;
            case Sensor.TYPE_LINEAR_ACCELERATION:
                bewegung(v[0], v[1], v[2], e.timestamp);
                break;
            case Sensor.TYPE_ACCELEROMETER:   // Ersatz: Schwerkraft mit einem langsamen Tiefpass selbst herausfiltern
                for (int i = 0; i < 3; i++) schwer[i] = schwerOk ? schwer[i] + SCHWER_TIEFPASS * (v[i] - schwer[i]) : v[i];
                schwerOk = true;
                bewegung(v[0] - schwer[0], v[1] - schwer[1], v[2] - schwer[2], e.timestamp);
                break;
        }
    }

    // a: Beschleunigung ohne Schwerkraft im Handy-Koordinatensystem
    private void bewegung(float ax, float ay, float az, long ts) {
        if (!schwerOk) return;
        float g = (float) Math.sqrt(schwer[0] * schwer[0] + schwer[1] * schwer[1] + schwer[2] * schwer[2]);
        if (g < 1) return;
        float vert = (ax * schwer[0] + ay * schwer[1] + az * schwer[2]) / g;
        float waag = (float) Math.sqrt(Math.max(0, ax * ax + ay * ay + az * az - vert * vert));
        vertQuadrat += vert * vert; vertN++;
        stossMax = Math.max(stossMax, Math.abs(vert));
        fensterZaehlen(vert, waag, ts);

        waagGlatt += GLAETTUNG * (waag - waagGlatt);
        if (!imAusschlag && waagGlatt >= STARK) { imAusschlag = true; spitze = 0; }
        if (imAusschlag) {
            if (waagGlatt > spitze) { spitze = waagGlatt; spitzeT = ts; }
            if (waagGlatt < RUHIG) {
                imAusschlag = false;
                JSObject a = new JSObject();
                // Sensorzeit (seit Systemstart) in Uhrzeit umrechnen, damit die App sie mit den GPS-Zeiten vergleichen kann
                a.put("t", System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - spitzeT) / 1000000L);
                a.put("g", spitze / G);
                ausschlaege.put(a);
            }
        }
    }

    private void fensterZaehlen(float vert, float waag, long ts) {
        if (fensterStart == 0) fensterStart = ts;
        fVertQ += vert * vert; fWaagQ += waag * waag; fN++;
        fVertMax = Math.max(fVertMax, Math.abs(vert));
        fWaagMax = Math.max(fWaagMax, waagGlatt);
        if (ts - fensterStart < FENSTER_NS) return;
        if (fenster.length() < FENSTER_MAX) {
            JSObject f = new JSObject();
            f.put("t", System.currentTimeMillis() - (SystemClock.elapsedRealtimeNanos() - ts) / 1000000L);
            f.put("n", fN);
            f.put("rau", Math.round(Math.sqrt(fVertQ / fN) * 1000) / 1000.0);
            f.put("waag", Math.round(Math.sqrt(fWaagQ / fN) * 1000) / 1000.0);
            f.put("waagMax", Math.round(fWaagMax / G * 1000) / 1000.0);
            f.put("stoss", Math.round(fVertMax * 100) / 100.0);
            fenster.put(f);
        }
        fensterStart = ts; fVertQ = 0; fWaagQ = 0; fN = 0; fVertMax = 0; fWaagMax = 0;
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}
}
