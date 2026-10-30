package app.bubblelog.microlino;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.ImageDecoder;
import android.os.Build;
import android.os.Environment;
import android.util.Base64;
import android.util.Size;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.ByteBuffer;

// Text auf dem Foto vom Tacho-Display lesen (SPEC-foto.md). Google ML Kit Text Recognition, lateinische Schrift,
// Modell steckt in der APK ("bundled"): läuft offline, schickt nichts weg. Die Prozentzahl sucht src/fototext.js.
// Das Foto wird hier dekodiert, nicht im WebView: Am Fold6 konnte der WebView das Kamerafoto nicht lesen
// ("The source image could not be decoded.", Testfahrt 30.10.2026). ImageDecoder kann JPEG und HEIF, verkleinert
// beim Dekodieren und dreht nach EXIF.
@CapacitorPlugin(name = "Texterkennung")
public class Texterkennung extends Plugin {
    private TextRecognizer leser;

    // Bild: Original der Kamera-App (groesse = Bytes laut WebView) oder data (Base64 der Datei, Ausweg ohne Original).
    // kante: längste Seite für die Erkennung, kleinKante/qualitaet: gespeicherte Kopie.
    // Ergebnis: { text, klein (JPEG Base64), bild: { quelle, bytes, mime, breite, hoehe } }; fehler, wenn nur ML Kit scheitert
    @PluginMethod
    public void lesen(PluginCall call) {
        int kante = call.getInt("kante", 1600), kleinKante = call.getInt("kleinKante", 640), qualitaet = call.getInt("qualitaet", 60);
        JSObject info = new JSObject();
        Bitmap bild;
        try {
            String data = call.getString("data");
            if (data != null) {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                info.put("quelle", "daten"); info.put("bytes", bytes.length);
                bild = dekodieren(bytes, null, kante, info);
            } else {
                File datei = kamerafoto(call.getLong("groesse", -1L));
                if (datei == null) { call.reject("Kein Kamerafoto gefunden", "KEINE_DATEI"); return; }
                info.put("quelle", "datei"); info.put("bytes", datei.length());
                if (datei.length() == 0) { call.reject("Die Kamera-App hat kein Bild gespeichert (0 Byte)", "LEER", info); return; }
                bild = dekodieren(null, datei, kante, info);
            }
        } catch (Exception | OutOfMemoryError e) {
            call.reject("Bild nicht lesbar: " + e.getMessage(), "DEKODIEREN", info); return;
        }
        if (bild == null) { call.reject("Bild nicht lesbar", "DEKODIEREN", info); return; }
        info.put("breite", bild.getWidth()); info.put("hoehe", bild.getHeight());

        JSObject r = new JSObject();
        r.put("bild", info);
        r.put("klein", jpeg(bild, kleinKante, qualitaet));
        if (leser == null) leser = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        leser.process(InputImage.fromBitmap(bild, 0))
            .addOnSuccessListener(t -> { r.put("text", t.getText()); call.resolve(r); })
            .addOnFailureListener(e -> { r.put("text", ""); r.put("fehler", "Texterkennung fehlgeschlagen: " + e.getMessage()); call.resolve(r); });
    }

    // Das Foto, das Capacitor der Kamera-App als Ziel gegeben hat (JPEG_*.jpg, siehe aufraeumen): bevorzugt das mit der
    // Größe, die der WebView meldet, sonst das neueste der letzten 10 Minuten
    private File kamerafoto(long groesse) {
        File ordner = getContext().getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        File[] dateien = ordner != null ? ordner.listFiles((d, n) -> n.startsWith("JPEG_")) : null;
        if (dateien == null) return null;
        File neueste = null;
        for (File f : dateien) {
            if (groesse > 0 && f.length() == groesse) return f;
            if (neueste == null || f.lastModified() > neueste.lastModified()) neueste = f;
        }
        return neueste != null && System.currentTimeMillis() - neueste.lastModified() < 10 * 60 * 1000 ? neueste : null;
    }

    // Auf höchstens `kante` px (längste Seite) dekodieren
    private Bitmap dekodieren(byte[] bytes, File datei, int kante, JSObject info) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            ImageDecoder.Source quelle = datei != null ? ImageDecoder.createSource(datei) : ImageDecoder.createSource(ByteBuffer.wrap(bytes));
            return ImageDecoder.decodeBitmap(quelle, (decoder, bildInfo, q) -> {
                Size s = bildInfo.getSize();
                info.put("mime", bildInfo.getMimeType()); info.put("original", s.getWidth() + "x" + s.getHeight());
                float f = Math.min(1f, (float) kante / Math.max(s.getWidth(), s.getHeight()));
                if (f < 1f) decoder.setTargetSize(Math.max(1, Math.round(s.getWidth() * f)), Math.max(1, Math.round(s.getHeight() * f)));
                decoder.setAllocator(ImageDecoder.ALLOCATOR_SOFTWARE);   // für compress() und ML Kit
            });
        }
        // Android 7–8: ohne Drehung nach EXIF
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        if (datei != null) BitmapFactory.decodeFile(datei.getPath(), o); else BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
        info.put("mime", o.outMimeType); info.put("original", o.outWidth + "x" + o.outHeight);
        o.inJustDecodeBounds = false; o.inSampleSize = 1;
        while (Math.max(o.outWidth, o.outHeight) / (o.inSampleSize * 2) >= kante) o.inSampleSize *= 2;
        return datei != null ? BitmapFactory.decodeFile(datei.getPath(), o) : BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
    }

    private static String jpeg(Bitmap bild, int kante, int qualitaet) {
        float f = Math.min(1f, (float) kante / Math.max(bild.getWidth(), bild.getHeight()));
        Bitmap klein = f < 1f ? Bitmap.createScaledBitmap(bild, Math.round(bild.getWidth() * f), Math.round(bild.getHeight() * f), true) : bild;
        ByteArrayOutputStream aus = new ByteArrayOutputStream();
        klein.compress(Bitmap.CompressFormat.JPEG, qualitaet, aus);
        if (klein != bild) klein.recycle();
        return Base64.encodeToString(aus.toByteArray(), Base64.NO_WRAP);
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
