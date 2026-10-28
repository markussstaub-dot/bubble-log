import { defineConfig } from 'vite';

// Relative Pfade, damit die gebaute App aus dem Capacitor-WebView heraus lädt
// Versionsnummer: setzt apk.ps1 (BL_VERSION), beim Entwickeln im Browser „dev“
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(process.env.BL_VERSION || 'dev') },
  build: { outDir: 'dist', emptyOutDir: true },
});
