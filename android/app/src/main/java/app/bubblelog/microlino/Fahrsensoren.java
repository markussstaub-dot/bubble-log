package app.bubblelog.microlino;

import android.Manifest;
import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.PowerManager;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.WindowManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.localbroadcastmanager.content.LocalBroadcastManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Barometer und Beschleunigung während einer Fahrt. Nativ gelesen, weil der WebView im Hintergrund
// keine devicemotion-Ereignisse bekommt. Die App holt bei jedem Streckenpunkt (25 m) eine Zusammenfassung ab;
// Rohdaten werden nicht gespeichert. Läuft nur zwischen start() und stop(); im Entwicklermodus auch beim Warten.
// Dazu (SPEC-gps-abbruch.md, Stufe 2): Lebenszeichen des GPS-Dienstes, Energiesparmodus, Zustand von Akku und Standort.
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

    // Lebenszeichen: Der Dienst von background-geolocation schickt jede Position als lokalen Broadcast. Hier wird nur
    // die Zeit des letzten Punkts gemerkt und jede Minute geprüft; JavaScript-Timer taugen dafür nicht (gedrosselt).
    private static final String GPS_BROADCAST = "com.equimaps.capacitor_background_geolocation.broadcast";
    private static final String GPS_DIENST = "com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService";
    private static final long PRUEF_MS = 60_000;      // so oft prüfen
    private static final long AUSFALL_MS = 90_000;    // in "fahrt" kommt jede Sekunde ein Punkt; so lange keiner = Ausfall
    private static final String KANAL = "gps-ausfall";
    private static final int MELDUNG_ID = 4711;
    private String gpsModus = "aus";
    private long letzterPunkt, modusSeit;
    private boolean ausfallGemeldet, dienstLief;
    private HandlerThread pruefThread;
    private Handler pruefer;
    private final BroadcastReceiver gpsEmpfaenger = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            synchronized (Fahrsensoren.this) {
                letzterPunkt = System.currentTimeMillis();
                if (ausfallGemeldet) { ausfallGemeldet = false; meldungWeg(); ereignis("gpsZurueck", null); }
            }
        }
    };
    private final Runnable pruefen = new Runnable() {
        @Override
        public void run() {
            lebenszeichenPruefen();
            Handler h = pruefer;
            if (h != null) h.postDelayed(this, PRUEF_MS);
        }
    };
    // Energiesparmodus und Doze an/aus: nur fürs Log, damit ein Ausfall sich selbst erklärt
    private final BroadcastReceiver energieEmpfaenger = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent i) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            JSObject d = new JSObject();
            if (PowerManager.ACTION_POWER_SAVE_MODE_CHANGED.equals(i.getAction())) d.put("energiesparen", pm.isPowerSaveMode());
            else d.put("doze", pm.isDeviceIdleMode());
            ereignis("energie", d);
        }
    };

    @Override
    public void load() {
        sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        LocalBroadcastManager.getInstance(getContext()).registerReceiver(gpsEmpfaenger, new IntentFilter(GPS_BROADCAST));
        IntentFilter energie = new IntentFilter(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
        energie.addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED);
        ContextCompat.registerReceiver(getContext(), energieEmpfaenger, energie, ContextCompat.RECEIVER_NOT_EXPORTED);
        pruefThread = new HandlerThread("Lebenszeichen");
        pruefThread.start();
        pruefer = new Handler(pruefThread.getLooper());
        pruefer.postDelayed(pruefen, PRUEF_MS);
    }

    // Die App meldet jeden GPS-Modus (aus, warten, fahrt); nur in "fahrt" kommen sicher laufend Punkte
    @PluginMethod
    public synchronized void lebenszeichen(PluginCall call) {
        String neu = call.getString("modus", "aus");
        if (!neu.equals(gpsModus)) { gpsModus = neu; modusSeit = System.currentTimeMillis(); }
        if (!"fahrt".equals(neu) && ausfallGemeldet) { ausfallGemeldet = false; meldungWeg(); }
        call.resolve();
    }

    private synchronized void lebenszeichenPruefen() {
        long jetzt = System.currentTimeMillis();
        boolean dienst = dienstLaeuft();
        if (dienstLief && !dienst && !"aus".equals(gpsModus)) {   // Dienst weg, obwohl die App GPS will
            JSObject d = new JSObject();
            d.put("modus", gpsModus); d.put("dienst", false); d.put("letzterPunkt", letzterPunkt);
            ereignis("dienstWeg", d);
        }
        dienstLief = dienst;
        if (!"fahrt".equals(gpsModus) || ausfallGemeldet) return;   // beim Warten kommen im Stand kaum Punkte
        long seit = Math.max(letzterPunkt, modusSeit);
        if (jetzt - seit < AUSFALL_MS) return;
        ausfallGemeldet = true;
        JSObject d = new JSObject();
        d.put("modus", gpsModus); d.put("dienst", dienst); d.put("letzterPunkt", letzterPunkt); d.put("luecke", jetzt - seit);
        ereignis("gpsAusfall", d);
        meldungZeigen();
    }

    @SuppressWarnings("deprecation")
    private boolean dienstLaeuft() {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        // getRunningServices liefert seit Android 8 nur noch die eigenen Dienste, genau das reicht hier
        for (ActivityManager.RunningServiceInfo s : am.getRunningServices(50))
            if (GPS_DIENST.equals(s.service.getClassName())) return s.foreground;
        return false;
    }

    private void ereignis(String name, JSObject d) {
        JSObject x = d != null ? d : new JSObject();
        x.put("t", System.currentTimeMillis());
        notifyListeners(name, x, true);   // ohne Zuhörer (App lädt noch) aufheben bis zum ersten addListener
    }

    private void meldungZeigen() {
        Context c = getContext();
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(KANAL) == null)
            nm.createNotificationChannel(new NotificationChannel(KANAL, "GPS-Ausfall", NotificationManager.IMPORTANCE_HIGH));
        Intent oeffnen = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent pi = PendingIntent.getActivity(c, MELDUNG_ID, oeffnen, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        nm.notify(MELDUNG_ID, new NotificationCompat.Builder(c, KANAL)
            .setSmallIcon(c.getApplicationInfo().icon)
            .setContentTitle("Fahrtaufzeichnung unterbrochen")
            .setContentText("Tippen zum Fortsetzen")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pi).setAutoCancel(true).build());
    }

    private void meldungWeg() {
        ((NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE)).cancel(MELDUNG_ID);
    }

    // Für die Einstellungen: { akkuEingeschraenkt, energiesparen, standort: "immer" | "nutzung" | "nein" }
    // Tempolimit-Schild (SPEC-tempolimit.md): Display während der Fahrt anlassen. Das Flag gilt nur, solange die App
    // sichtbar ist; im Hintergrund schaltet Android das Display wie gewohnt ab.
    @PluginMethod
    public void bildschirmWach(PluginCall call) {
        final boolean an = Boolean.TRUE.equals(call.getBoolean("an", false));
        getActivity().runOnUiThread(() -> {
            if (an) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context c = getContext();
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        boolean erlaubt = ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean immer = Build.VERSION.SDK_INT < 29 ? erlaubt
            : ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        JSObject r = new JSObject();
        r.put("akkuEingeschraenkt", !pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        r.put("energiesparen", pm.isPowerSaveMode());
        r.put("standort", immer ? "immer" : erlaubt ? "nutzung" : "nein");
        call.resolve(r);
    }

    // App-Infos von Bubble Log: dort stehen Akku („Nicht eingeschränkt“) und Berechtigungen (Standort)
    @PluginMethod
    public void appInfos(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
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
        LocalBroadcastManager.getInstance(getContext()).unregisterReceiver(gpsEmpfaenger);
        try { getContext().unregisterReceiver(energieEmpfaenger); } catch (IllegalArgumentException e) { /* nie angemeldet */ }
        Handler h = pruefer; pruefer = null;
        if (h != null) h.removeCallbacksAndMessages(null);
        if (pruefThread != null) { pruefThread.quitSafely(); pruefThread = null; }
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
