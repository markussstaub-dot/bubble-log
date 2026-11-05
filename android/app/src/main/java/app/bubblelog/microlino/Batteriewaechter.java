package app.bubblelog.microlino;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

// BM6-Batteriewächter an der 12-V-Batterie (SPEC-12v.md): suchen, verbinden, Antworten entschlüsseln und puffern,
// bis JavaScript sie abholt (src/bm6.js). Gelesen werden die Antworten in JavaScript (src/bordspannung.js, getestet);
// hier nur Bluetooth und AES. Protokoll laut tarball.ca und github.com/jeffwdh/bm6-battery-monitor:
// Dienst FFF0, Befehle auf FFF3, Antworten als Notification auf FFF4, AES-128-CBC mit IV 0 und festem Schlüssel.
// Verbunden bleibt es zwischen start() und stop(); reißt die Verbindung ab (Handy außer Reichweite), verbindet Android
// von selbst wieder, sobald der BM6 in Reichweite ist (autoConnect).
@CapacitorPlugin(
    name = "Batteriewaechter",
    permissions = { @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetooth") }
)
public class Batteriewaechter extends Plugin {
    private static final UUID DIENST = uuid16("fff0"), SCHREIBEN = uuid16("fff3"), LESEN = uuid16("fff4");
    private static final UUID CCCD = uuid16("2902");   // Schalter für Notifications
    private static final byte[] SCHLUESSEL = { 108, 101, 97, 103, 101, 110, 100, (byte) 255, (byte) 254, 48, 49, 48, 48, 48, 48, 57 };
    private static final byte[] BEFEHL = hexBytes("d1550700000000000000000000000000");   // „Messwerte senden“
    private static final long BEFEHL_MS = 5_000;      // Befehl so oft wiederholen, falls der BM6 nicht von selbst weiterschickt
    private static final int PUFFER_MAX = 20_000;     // ≈ 5,5 h bei einem Wert je Sekunde

    private HandlerThread thread;
    private Handler handler;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic schreiben;
    private boolean laeuft;
    private JSArray puffer = new JSArray();
    private long letzterT;
    private String letzterHex;

    private static UUID uuid16(String k) { return UUID.fromString("0000" + k + "-0000-1000-8000-00805f9b34fb"); }
    // BM6 und Baugleiche: Ancel BM200 (Hersteller-App „com.dc.bm6_ancel“, 05.11.2026), BM2; sonst jedes Gerät mit
    // Namen, das den Dienst FFF0 anbietet. Welches es ist, wählt man in der Liste nach Name und Signal.
    private static boolean istWaechter(String name, ScanResult r) {
        if (name == null) return false;
        String n = name.toUpperCase();
        if (n.startsWith("BM6") || n.startsWith("BM2") || n.contains("ANCEL") || n.contains("BATTERY MONITOR")) return true;
        java.util.List<android.os.ParcelUuid> dienste = r.getScanRecord() != null ? r.getScanRecord().getServiceUuids() : null;
        if (dienste == null) return false;
        for (android.os.ParcelUuid d : dienste) if (DIENST.equals(d.getUuid())) return true;
        return false;
    }

    @Override
    public void load() {
        thread = new HandlerThread("Batteriewaechter");
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    private BluetoothAdapter adapter() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return bm == null ? null : bm.getAdapter();
    }
    // Ab Android 12 eigene Rechte für Bluetooth; davor reicht der Standort, den die App für GPS ohnehin hat
    private boolean rechteFehlen() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }
    private boolean bereit(PluginCall call, String weiter) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("Kein Bluetooth"); return false; }
        if (rechteFehlen()) { requestPermissionForAlias("bluetooth", call, weiter); return false; }
        if (!a.isEnabled()) { call.reject("Bluetooth ist aus"); return false; }
        return true;
    }

    // ---------- Suchen ----------
    @PluginMethod
    public void suchen(PluginCall call) { if (bereit(call, "suchenErlaubt")) suchenJetzt(call); }
    @PermissionCallback
    private void suchenErlaubt(PluginCall call) {
        if (rechteFehlen()) call.reject("Bluetooth nicht erlaubt"); else if (bereit(call, "suchenErlaubt")) suchenJetzt(call);
    }
    @SuppressLint("MissingPermission")
    private void suchenJetzt(PluginCall call) {
        BluetoothLeScanner scanner = adapter().getBluetoothLeScanner();
        if (scanner == null) { call.reject("Bluetooth ist aus"); return; }
        Map<String, JSObject> gefunden = new LinkedHashMap<>();
        ScanCallback cb = new ScanCallback() {
            @Override
            public void onScanResult(int typ, ScanResult r) {
                String name = r.getScanRecord() != null ? r.getScanRecord().getDeviceName() : null;
                if (name == null) name = r.getDevice().getName();
                if (!istWaechter(name, r)) return;
                JSObject g = new JSObject();
                g.put("name", name); g.put("adresse", r.getDevice().getAddress()); g.put("rssi", r.getRssi());
                synchronized (gefunden) { gefunden.put(r.getDevice().getAddress(), g); }
            }
        };
        scanner.startScan(cb);
        handler.postDelayed(() -> {
            try { scanner.stopScan(cb); } catch (Exception ignoriert) { /* Bluetooth inzwischen aus */ }
            JSArray liste = new JSArray();
            synchronized (gefunden) { for (JSObject g : gefunden.values()) liste.put(g); }
            JSObject r = new JSObject(); r.put("geraete", liste); call.resolve(r);
        }, call.getInt("sekunden", 8) * 1000L);
    }

    // ---------- Verbinden ----------
    @PluginMethod
    public void start(PluginCall call) { if (bereit(call, "startErlaubt")) startJetzt(call); }
    @PermissionCallback
    private void startErlaubt(PluginCall call) {
        if (rechteFehlen()) call.reject("Bluetooth nicht erlaubt"); else if (bereit(call, "startErlaubt")) startJetzt(call);
    }
    @SuppressLint("MissingPermission")
    private synchronized void startJetzt(PluginCall call) {
        String adresse = call.getString("adresse");
        if (adresse == null || !BluetoothAdapter.checkBluetoothAddress(adresse)) { call.reject("Keine gültige Adresse"); return; }
        if (laeuft) { call.resolve(); return; }
        laeuft = true;
        verbinden(adapter().getRemoteDevice(adresse), false);
        handler.postDelayed(befehlTakt, BEFEHL_MS);
        call.resolve();
    }
    @SuppressLint("MissingPermission")
    private synchronized void verbinden(BluetoothDevice d, boolean auto) {
        if (gatt != null) gatt.close();
        schreiben = null;
        gatt = d.connectGatt(getContext(), auto, rueckruf, BluetoothDevice.TRANSPORT_LE);
    }
    @PluginMethod
    @SuppressLint("MissingPermission")
    public synchronized void stop(PluginCall call) {
        laeuft = false;
        handler.removeCallbacks(befehlTakt);
        if (gatt != null) { try { gatt.disconnect(); gatt.close(); } catch (SecurityException ignoriert) { /* Recht entzogen */ } }
        gatt = null; schreiben = null;
        call.resolve();
    }

    private final Runnable befehlTakt = new Runnable() {
        @Override
        public void run() {
            befehlSenden();
            synchronized (Batteriewaechter.this) { if (laeuft) handler.postDelayed(this, BEFEHL_MS); }
        }
    };

    private final BluetoothGattCallback rueckruf = new BluetoothGattCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothGatt g, int status, int zustand) {
            synchronized (Batteriewaechter.this) {
                if (g != gatt) return;
                if (zustand == BluetoothProfile.STATE_CONNECTED) { g.discoverServices(); return; }
                if (zustand == BluetoothProfile.STATE_DISCONNECTED && laeuft) {
                    BluetoothDevice d = g.getDevice();
                    handler.postDelayed(() -> { synchronized (Batteriewaechter.this) { if (laeuft) verbinden(d, true); } }, 2_000);
                }
            }
        }
        @Override
        @SuppressLint("MissingPermission")
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            BluetoothGattService s = g.getService(DIENST);
            if (s == null) return;
            BluetoothGattCharacteristic lesen = s.getCharacteristic(LESEN);
            synchronized (Batteriewaechter.this) { schreiben = s.getCharacteristic(SCHREIBEN); }
            if (lesen == null) return;
            g.setCharacteristicNotification(lesen, true);
            BluetoothGattDescriptor cccd = lesen.getDescriptor(CCCD);
            if (cccd == null) { befehlSenden(); return; }
            schreibeDescriptor(g, cccd, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
        }
        @Override
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) { befehlSenden(); }
        // Android 13 und neuer
        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] wert) { empfangen(c, wert); }
        // bis Android 12
        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) { empfangen(c, c.getValue()); }
    };

    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private void schreibeDescriptor(BluetoothGatt g, BluetoothGattDescriptor d, byte[] wert) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) g.writeDescriptor(d, wert);
        else { d.setValue(wert); g.writeDescriptor(d); }
    }
    @SuppressLint("MissingPermission")
    @SuppressWarnings("deprecation")
    private synchronized void befehlSenden() {
        if (!laeuft || gatt == null || schreiben == null) return;
        byte[] b = aes(BEFEHL, Cipher.ENCRYPT_MODE); if (b == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) gatt.writeCharacteristic(schreiben, b, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            else { schreiben.setValue(b); gatt.writeCharacteristic(schreiben); }
        } catch (SecurityException ignoriert) { /* Recht entzogen */ }
    }
    private synchronized void empfangen(BluetoothGattCharacteristic c, byte[] wert) {
        if (!LESEN.equals(c.getUuid()) || wert == null || wert.length % 16 != 0) return;
        byte[] klar = aes(wert, Cipher.DECRYPT_MODE); if (klar == null) return;
        letzterT = System.currentTimeMillis(); letzterHex = hex(klar);
        JSArray w = new JSArray(); w.put(letzterT); w.put(letzterHex);
        puffer.put(w);
        if (puffer.length() > PUFFER_MAX) puffer.remove(0);
    }

    // ---------- Abholen ----------
    @PluginMethod
    public synchronized void abholen(PluginCall call) {
        JSObject r = new JSObject(); r.put("werte", puffer); puffer = new JSArray();
        call.resolve(r);
    }
    @PluginMethod
    public synchronized void letzter(PluginCall call) {
        JSObject r = new JSObject();
        if (letzterHex != null) { r.put("t", letzterT); r.put("hex", letzterHex); }
        call.resolve(r);
    }

    // ---------- AES und Hex ----------
    private static byte[] aes(byte[] daten, int modus) {
        try {
            Cipher c = Cipher.getInstance("AES/CBC/NoPadding");
            c.init(modus, new SecretKeySpec(SCHLUESSEL, "AES"), new IvParameterSpec(new byte[16]));
            return c.doFinal(daten);
        } catch (Exception e) { return null; }
    }
    private static String hex(byte[] b) {
        StringBuilder s = new StringBuilder(b.length * 2);
        for (byte x : b) s.append(String.format("%02x", x));
        return s.toString();
    }
    private static byte[] hexBytes(String h) {
        byte[] b = new byte[h.length() / 2];
        for (int i = 0; i < b.length; i++) b[i] = (byte) Integer.parseInt(h.substring(2 * i, 2 * i + 2), 16);
        return b;
    }
}
