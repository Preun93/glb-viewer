# Modelle

Lege hier deine `.glb`-Dateien ab (Unterordner sind erlaubt).

- Beim Push auf `main` erzeugt der GitHub-Workflow `models.json` automatisch neu.
- Lokal aktualisierst du die Liste mit `python3 scripts/update-models.py`.
- Anzeigenamen kannst du in `models.json` über das Feld `"name"` ändern – sie bleiben beim Neuerzeugen erhalten.
- Externe Modelle trägst du mit `"url"` statt `"file"` ein (der Server muss CORS erlauben).

Dateien über 100 MB lehnt GitHub ab – dafür Git LFS verwenden oder das Modell komprimieren
(z. B. `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp`).
