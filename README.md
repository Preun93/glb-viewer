# GLB Viewer für Meta Quest 3

Web-basierter Viewer für `.glb`-Modelle im **Passthrough-Modus** der Meta Quest 3 (WebXR `immersive-ar`).
Die Modelle erscheinen in deinem echten Raum und lassen sich mit den Controllern greifen, verschieben, drehen und skalieren.

- Kein Build-Schritt, keine Installation – reines HTML/JavaScript mit [three.js](https://threejs.org) über CDN
- Läuft direkt über **GitHub Pages**
- Unterstützt Draco-, Meshopt- und KTX2-komprimierte GLBs sowie Animationen
- Desktop-Vorschau mit Maus (Orbit) zum Prüfen der Modelle am PC

## Steuerung

| Eingabe | Aktion |
|---|---|
| **Grip** (Seitentaste) halten | Modell greifen – folgt Position und Drehung der Hand |
| **Beide Grips** halten | Hände auseinander/zusammen = skalieren, umeinander drehen = drehen, gemeinsam bewegen = verschieben |
| **Rechter Stick** ↔ / ↕ | Modell um Hoch- bzw. Querachse drehen |
| **Linker Stick** ↕ | Modell näher heran / weiter weg |
| **Linker Stick** ↔ | Modell kleiner / größer |
| **A** / **B** | Nächstes / vorheriges Modell |
| **X** oder Stick drücken | Modell zurücksetzen (1 m vor dir) |
| **Y** | Animation pausieren / fortsetzen |
| Hand-Tracking: **Pinch** | Greifen (wie Grip) |

Über dem linken Controller zeigt ein kleines Panel das aktuelle Modell und eine Kurzhilfe.

## Eigene Dateien direkt öffnen

Im Overlay auf **„+ GLB-Dateien öffnen“** tippen oder eine `.glb` ins Browserfenster ziehen. Das Modell wird sofort geladen,
erscheint als „lokal“ in der Liste und bleibt nach dem Neuladen erhalten. Gespeichert wird es nur in diesem Browser,
nichts wird hochgeladen. Mit **×** entfernst du es wieder.

Auf der **Quest 3**: Die Datei zuerst aufs Headset bringen (per USB in den Ordner `Download` kopieren oder im Quest-Browser
herunterladen), dann im Viewer **vor** „START AR“ auf „GLB-Dateien öffnen“ tippen. In AR schaltest du wie gewohnt mit A/B durch.

## Modelle dauerhaft ins Repository legen

Für Modelle, die alle Besucher sehen sollen:

1. `.glb`-Datei in den Ordner [`models/`](models/) legen.
2. Committen und auf `main` pushen – der Workflow erzeugt `models/models.json` automatisch.
   Lokal geht es mit `python3 scripts/update-models.py`.

Anzeigenamen lassen sich in `models/models.json` anpassen. Externe Modelle können mit `"url"` statt `"file"` eingetragen werden.
Die zwei Beispielmodelle stammen aus den [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) und können aus der Liste entfernt werden.

## Auf GitHub veröffentlichen

1. Neues Repository auf GitHub anlegen und dieses Projekt pushen:
   ```bash
   git remote add origin https://github.com/<benutzer>/glb-viewer.git
   git push -u origin main
   ```
2. Im Repository unter **Settings → Pages → Build and deployment → Source** „**GitHub Actions**“ wählen.
3. Nach dem Workflow-Lauf ist der Viewer unter `https://<benutzer>.github.io/glb-viewer/` erreichbar.
4. Diese Adresse im **Browser der Quest 3** öffnen und **START AR** antippen.

WebXR funktioniert nur über **HTTPS** (oder `localhost`) – GitHub Pages erfüllt das automatisch.

## Lokal testen

```bash
python3 -m http.server 8000
```

- **Am PC:** `http://localhost:8000` öffnen – Vorschau mit Maus. Mit der Browser-Erweiterung
  [Immersive Web Emulator](https://chromewebstore.google.com/detail/immersive-web-emulator/cgffilbpcibhmcfbgggfhfolhkfbhmik)
  lässt sich auch die AR-Session inklusive Controller simulieren.
- **Auf der Quest 3 (per USB):** Entwicklermodus aktivieren, Brille per USB verbinden, dann
  ```bash
  adb reverse tcp:8000 tcp:8000
  ```
  und im Quest-Browser `http://localhost:8000` öffnen.

## Projektstruktur

```
index.html            Seite, Import-Map für three.js, Desktop-Overlay
style.css             Styles des Overlays
src/main.js           Renderer, Szene, Licht, WebXR-Session, Platzierung
src/modelManager.js   models.json + GLB laden, normalisieren, Animationen
src/xrControls.js     Controller: Greifen, Zwei-Hand-Skalierung, Sticks, Buttons
src/hud.js            Info-Panel am linken Controller
src/localModels.js    Selbst geöffnete GLBs im Browser speichern (IndexedDB)
models/               GLB-Dateien + models.json
scripts/              update-models.py (erzeugt models.json)
.github/workflows/    Deployment auf GitHub Pages
```

## Lizenz

[MIT](LICENSE)
