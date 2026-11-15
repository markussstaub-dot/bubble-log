package app.bubblelog.microlino;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

/**
 * Testnotizen von der Sticky-App (app.sticky.zwilling) für die Konsole (src/konsole.js, 15.11.2026).
 * Die Sticky-App schickt jede neue Notiz als Broadcast (Aktion NOTIZ, Extra "json" = eine JSONL-Zeile). Senden darf nur,
 * wer die Signatur-Berechtigung permission.NOTIZ hat, also eine App mit demselben Schlüssel wie Bubble Log.
 * Der Empfänger legt die Zeile in files/notizen-eingang.jsonl ab (auch wenn Bubble Log gerade nicht läuft),
 * die App holt sie mit abholen() ins Entwickler-Log und bekommt neue live als Ereignis "notiz".
 */
@CapacitorPlugin(name = "Notizen")
public class Notizen extends Plugin {
    static final String AKTION = "app.bubblelog.microlino.NOTIZ";
    static final String DATEI = "notizen-eingang.jsonl";
    private static final long MAX_BYTES = 2_000_000;   // falls die App lange nicht abholt
    private static Notizen aktiv;

    @Override public void load() { aktiv = this; }
    @Override protected void handleOnDestroy() { if (aktiv == this) aktiv = null; }

    static synchronized void ablegen(Context ctx, String json) {
        try {
            new JSONObject(json);   // nur gültige Zeilen annehmen
            File f = new File(ctx.getFilesDir(), DATEI);
            if (f.length() > MAX_BYTES) return;
            try (FileOutputStream o = new FileOutputStream(f, true)) {
                o.write((json.replace('\n', ' ') + "\n").getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) { return; }
        Notizen p = aktiv;
        if (p != null) p.notifyListeners("notiz", new JSObject());
    }

    /** Alle abgelegten Notizen als Liste von JSON-Zeilen, danach ist der Eingang leer */
    @PluginMethod
    public void abholen(PluginCall call) {
        JSArray zeilen = new JSArray();
        synchronized (Notizen.class) {
            File f = new File(getContext().getFilesDir(), DATEI);
            try {
                if (f.exists()) {
                    for (String z : new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).split("\n")) {
                        if (!z.trim().isEmpty()) zeilen.put(z);
                    }
                    f.delete();
                }
            } catch (Exception e) { call.reject("Eingang nicht lesbar: " + e.getMessage()); return; }
        }
        JSObject r = new JSObject(); r.put("zeilen", zeilen); call.resolve(r);
    }

    public static class Empfaenger extends BroadcastReceiver {
        @Override public void onReceive(Context ctx, Intent intent) {
            if (!AKTION.equals(intent.getAction())) return;
            String json = intent.getStringExtra("json");
            if (json != null) ablegen(ctx, json);
        }
    }
}
