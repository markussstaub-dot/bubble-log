# Bubble Log: Tests, APK bauen, prüfen und aufs angesteckte Handy kopieren. Ablauf siehe ENTWICKLUNG.md.
#   .\apk.ps1                    bauen und auf das Z Fold6 kopieren (Download-Ordner)
#   .\apk.ps1 -Geraet "Tab S10"  auf ein anderes Gerät kopieren (Anfang des Namens im Explorer)
#   .\apk.ps1 -OhneKopieren      nur bauen
# Das Handy muss entsperrt sein und „Dateien übertragen“ erlauben.
param([string]$Geraet = 'Z Fold6', [switch]$OhneKopieren)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Schritt($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Abbruch($t) { Write-Host "`nABBRUCH: $t" -ForegroundColor Red; exit 1 }

$jetzt = Get-Date
$version = $jetzt.ToString('yyyy.MM.dd-HHmm')
$code = [int](($jetzt - [datetime]'2026-01-01').TotalMinutes)   # steigt mit jeder Minute, passt in Androids versionCode
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot'
$env:BL_VERSION = $version
$apkOrdner = Join-Path $env:LOCALAPPDATA 'bubble-log-build\app\outputs\apk\debug'

$offen = git status --porcelain 2>$null
if ($offen) { Write-Host "Hinweis: $(@($offen).Count) Dateien sind nicht in git gesichert (git add -A; git commit)." -ForegroundColor Yellow }

Schritt "Tests"
npm test --silent
if ($LASTEXITCODE) { Abbruch 'Tests schlagen fehl.' }

Schritt "Web-App bauen ($version)"
npm run build --silent
if ($LASTEXITCODE) { Abbruch 'Vite-Build fehlgeschlagen.' }

Schritt "Capacitor sync"
# OneDrive macht diesen Ordner sonst zu Reparse-Points („not a regular file“), deshalb frisch anlegen
if (Test-Path android\app\src\main\assets\public) { Remove-Item -Recurse -Force android\app\src\main\assets\public }
npx cap sync android
if ($LASTEXITCODE) { Abbruch 'cap sync fehlgeschlagen.' }

Schritt "Gradle"
Push-Location android
.\gradlew.bat assembleDebug --console=plain -q "-PblVersionCode=$code" "-PblVersionName=$version"
$gradle = $LASTEXITCODE
Pop-Location
if ($gradle) { Abbruch 'Gradle-Build fehlgeschlagen.' }

Schritt "APK prüfen"
$apk = Join-Path $apkOrdner 'app-debug.apk'
if (-not (Test-Path $apk) -or (Get-Item $apk).LastWriteTime -lt $jetzt) { Abbruch 'Keine frische app-debug.apk gefunden.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($apk)
try {
  $namen = $zip.Entries | ForEach-Object { $_.FullName }
  if ($namen -notcontains 'assets/public/index.html') { Abbruch 'Web-App fehlt in der APK.' }
  if (-not ($namen | Where-Object { $_ -like 'assets/public/simwelt/*' })) { Abbruch 'Sim-Welt fehlt in der APK.' }
  $js = $zip.Entries | Where-Object { $_.FullName -like 'assets/public/assets/index-*.js' } | Select-Object -First 1
  $leser = New-Object IO.StreamReader($js.Open()); $inhalt = $leser.ReadToEnd(); $leser.Close()
  if (-not $inhalt.Contains($version)) { Abbruch "Versionsnummer $version steht nicht in der App - alter Stand in der APK?" }
} finally { $zip.Dispose() }
$ziel = "Bubble-Log-$($jetzt.ToString('HHmm')).apk"
Copy-Item $apk (Join-Path $apkOrdner $ziel) -Force
$groesse = (Get-Item $apk).Length
Write-Host ("OK: {0} ({1:N1} MB), Version {2}" -f $ziel, ($groesse / 1MB), $version) -ForegroundColor Green

if (-not $offen) { git tag "apk-$version" 2>$null }   # gesicherter Stand: Tag zum Wiederfinden

if ($OhneKopieren) { exit 0 }

Schritt "Kopieren auf $Geraet"
$shell = New-Object -ComObject Shell.Application
$dev = $shell.NameSpace(17).Items() | Where-Object { $_.Name -like "$Geraet*" } | Select-Object -First 1
if (-not $dev) { Abbruch "$Geraet ist nicht angesteckt. APK liegt unter $apkOrdner\$ziel." }
$speicher = $dev.GetFolder.Items() | Select-Object -First 1
if (-not $speicher) { Abbruch "Kein Speicher sichtbar: Handy entsperren und „Dateien übertragen“ wählen, dann .\apk.ps1 noch einmal." }
$dl = $speicher.GetFolder.Items() | Where-Object { $_.Name -eq 'Download' } | Select-Object -First 1
if (-not $dl) { Abbruch 'Ordner Download nicht gefunden.' }
$dl.GetFolder.CopyHere((Join-Path $apkOrdner $ziel), 16)
$basis = [IO.Path]::GetFileNameWithoutExtension($ziel)
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  $f = $dl.GetFolder.Items() | Where-Object { $_.Name -like "$basis*" } | Select-Object -First 1
  if ($f -and $f.ExtendedProperty('System.Size') -ge $groesse) {
    Write-Host "`nFertig: $ziel liegt im Download-Ordner von $($dev.Name). Dort antippen und aktualisieren." -ForegroundColor Green
    exit 0
  }
}
Abbruch 'Kopieren nicht bestätigt (Datei fehlt oder ist unvollständig). Im Explorer nachsehen.'
