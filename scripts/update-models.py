#!/usr/bin/env python3
"""Aktualisiert models/models.json anhand aller .glb-Dateien im Ordner models/.

- Lokale Einträge ({"file": ...}) werden aus den vorhandenen Dateien neu erzeugt.
- Eigene Namen bereits eingetragener Dateien bleiben erhalten.
- Externe Einträge ({"url": ...}) bleiben unverändert am Ende der Liste.
"""
import json
import pathlib

MODELS_DIR = pathlib.Path(__file__).resolve().parent.parent / "models"
MANIFEST = MODELS_DIR / "models.json"


def main() -> None:
    existing = []
    if MANIFEST.exists():
        try:
            existing = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print("Warnung: models.json ist ungültig und wird neu erzeugt.")

    entries = [e for e in existing if isinstance(e, dict)]
    remote = [e for e in entries if e.get("url")]
    names = {e["file"]: e.get("name") for e in entries if e.get("file")}

    local = []
    for path in sorted(MODELS_DIR.rglob("*")):
        if path.is_file() and path.suffix.lower() == ".glb":
            rel = path.relative_to(MODELS_DIR).as_posix()
            default_name = path.stem.replace("_", " ").replace("-", " ")
            local.append({"name": names.get(rel) or default_name, "file": rel})

    MANIFEST.write_text(
        json.dumps(local + remote, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"models.json: {len(local)} lokale, {len(remote)} externe Modelle")


if __name__ == "__main__":
    main()
