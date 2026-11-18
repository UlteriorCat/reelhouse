#!/usr/bin/env python3
import json, pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
modules = sorted(p.parent.parent.parent.parent for p in root.glob("eclipsia/*/src/main/assets/manifest.json"))
problems = []

for mod in modules:
    a = mod / "src/main/assets"
    tag = mod.name
    manifest = {m["id"]: m for m in json.loads((a / "manifest.json").read_text())["scrapers"]}

    def load(name):
        f = a / name
        return json.loads(f.read_text() or "null") if f.exists() else None

    dp = load("default-providers.json")
    ids = dp if isinstance(dp, list) else (dp or {}).get("enabled", [])
    problems += [f"{tag}/default-providers.json: unknown id '{i}'" for i in ids if i not in manifest]

    seen = {}
    for c in load("provider-category.json") or []:
        for f in ("id", "label", "bannerText"):
            if not isinstance(c.get(f), str) or not c[f].strip():
                problems.append(f"{tag}/provider-category.json: entry {c.get('id')} missing '{f}'")
        for pid in c.get("providerIds", []):
            if pid not in manifest: problems.append(f"{tag}/provider-category.json: unknown id '{pid}'")
            elif pid in seen: problems.append(f"{tag}: provider '{pid}' is in two categories")
            seen[pid] = c.get("id")

    for p in load("provider-presets.json") or []:
        if not str(p.get("label", "")).strip(): problems.append(f"{tag}/provider-presets.json: entry without label {p}")
        problems += [f"{tag}/provider-presets.json: '{p.get('label')}' lists unknown id '{i}'" for i in p.get("providerIds", []) if i not in manifest]

    files = {f.stem for f in (a / "scrapers").glob("*.js")}
    problems += [f"{tag}: manifest entry '{i}' has no scrapers/{i}.js" for i in manifest if i not in files]
    problems += [f"{tag}: scrapers/{i}.js is not in manifest.json" for i in sorted(files - set(manifest))]
    print(f"{tag}: {len(manifest)} providers")

playz = root / "playz"
if (playz / "build.gradle.kts").exists():
    assets = playz / "src/main/assets"
    source = {}
    try:
        source = json.loads((assets / "playz/source.json").read_text())
    except Exception as e:
        problems.append(f"playz: source.json unreadable: {e}")

    for field in ("id", "name", "baseUrl"):
        if not isinstance(source.get(field), str) or not source[field].strip():
            problems.append(f"playz: source.json missing '{field}'")
    version = source.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        problems.append("playz: source.json version must be a positive integer")
    if source.get("types") != ["live"]:
        problems.append("playz: source.json types must be ['live']")
    variants = source.get("variants")
    if not isinstance(variants, list) or not variants:
        problems.append("playz: source.json needs at least one variant")
    else:
        for v in variants:
            if not isinstance(v.get("id"), str) or not v["id"] or not isinstance(v.get("name"), str) or not v["name"]:
                problems.append(f"playz: variant without id or name: {v}")

    for name in ("core.js", "catalog.js", "stream.js"):
        if not (assets / "playz" / name).is_file():
            problems.append(f"playz: missing playz/{name}")

    exports = {"catalog.js": ("getHome", "search", "load"), "stream.js": ("loadStreams",)}
    for name, fns in exports.items():
        f = assets / "playz" / name
        if not f.is_file():
            continue
        text = f.read_text()
        for fn in fns:
            if not re.search(r"globalThis\.%s\s*=" % fn, text):
                problems.append(f"playz: {name} does not export {fn}")

    for name in ("archivo-regular.otf", "bagnard.otf", "bluu-next-titling.otf"):
        if not (assets / "poster/fonts" / name).is_file():
            problems.append(f"playz: missing poster font {name}")
    if not list((assets / "poster/flags").glob("*.webp")):
        problems.append("playz: no poster flags")

    shared = root / "shared/src/playz/main/assets"
    for name in ("shim/shim-common.js", "shim/contract-playz.js"):
        if not (shared / name).is_file():
            problems.append(f"playz: missing shared {name}")
    print("playz: live source")

if problems:
    sys.exit("ERROR:\n  " + "\n  ".join(problems))
print("assets ok")
