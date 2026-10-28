package app.bubblelog.microlino;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Environment;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.File;

// Text auf dem Foto vom Tacho-Display lesen (SPEC-foto.md). Google ML Kit Text Recognition, lateinische Schrift,
// Modell steckt in der APK ("bundled"): läuft offline, schickt nichts weg. Die Prozentzahl sucht src/fototext.js.
@CapacitorPlugin(name = "Texterkennung")
public class Texterkennung extends Plugin {
    private TextRecognizer leser;

    // data: JPEG als Base64 (von foto.js schon aufrecht gedreht und verkleinert). Ergebnis: { text }, Zeilen durch \n getrennt
    @PluginMethod
    public void lesen(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("Kein Bild"); return; }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        Bitmap bild = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bild == null) { call.reject("Bild nicht lesbar"); return; }
        if (leser == null) leser = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        leser.process(InputImage.fromBitmap(bild, 0))
            .addOnSuccessListener(t -> { JSObject r = new JSObject(); r.put("text", t.getText()); call.resolve(r); })
            .addOnFailureListener(e -> call.reject("Texterkennung fehlgeschlagen: " + e.getMessage()));
    }

    // Die Kamera-App legt das Originalfoto (mehrere MB) über den Datei-Chooser von Capacitor in Android/data/…/Pictures
    // ab (JPEG_*.jpg). Behalten wird nur die verkleinerte Kopie in Directory.Data/fotos, also das Original löschen.
    @PluginMethod
    public void aufraeumen(PluginCall call) {
        File ordner = getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        int n = 0;
        File[] dateien = ordner != null ? ordner.listFiles() : null;
        if (dateien != null) for (File f : dateien) if (f.getName().startsWith("JPEG_") && f.delete()) n++;
        JSObject r = new JSObject(); r.put("geloescht", n); call.resolve(r);
    }

    @Override
    protected void handleOnDestroy() {
        if (leser != null) leser.close();
    }
}
