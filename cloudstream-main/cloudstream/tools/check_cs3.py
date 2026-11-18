#!/usr/bin/env python3
import json, sys, zipfile

REQUIRED = [
    "manifest.json", "classes.dex", "assets/manifest.json", "assets/sources.lock.json",
    "assets/shim/shim-common.js", "assets/shim/contract-scraper.js",
]
SORYN_REQUIRED = [
    "manifest.json", "classes.dex", "assets/soryn/source.json", "assets/soryn/catalog.js",
    "assets/soryn/stream.js", "assets/sources.lock.json", "assets/shim/shim-common.js",
    "assets/shim/contract-soryn.js",
]
PLAYZ_REQUIRED = [
    "manifest.json", "classes.dex", "assets/playz/source.json", "assets/playz/core.js",
    "assets/playz/catalog.js", "assets/playz/stream.js", "assets/sources.lock.json",
    "assets/shim/shim-common.js", "assets/shim/contract-playz.js",
    "assets/poster/fonts/archivo-regular.otf", "assets/poster/fonts/bagnard.otf",
    "assets/poster/fonts/bluu-next-titling.otf",
    "assets/fonts/inter-regular.ttf", "assets/fonts/inter-medium.ttf", "assets/fonts/inter-bold.ttf",
]
bad = 0
for path in sys.argv[1:]:
    names = set(zipfile.ZipFile(path).namelist())
    extra = ""
    if "assets/playz/source.json" in names:
        required = PLAYZ_REQUIRED
    elif "assets/soryn/source.json" in names:
        required = SORYN_REQUIRED
    else:
        required = REQUIRED
    missing = [r for r in required if r not in names]
    if required is PLAYZ_REQUIRED:
        flags = [n for n in names if n.startswith("assets/poster/flags/") and n.endswith(".webp")]
        if not flags:
            missing.append("assets/poster/flags/*.webp")
        extra = f", {len(flags)} flags"
    if "assets/manifest.json" in names:
        ids = [s["id"] for s in json.loads(zipfile.ZipFile(path).read("assets/manifest.json"))["scrapers"]]
        missing += [f"assets/scrapers/{i}.js" for i in ids if f"assets/scrapers/{i}.js" not in names]
    rhino = [n for n in names if n.startswith("org/mozilla/")]
    if missing or rhino:
        bad += 1
        print(f"FAIL {path}: missing={missing[:5]} rhino_classes={len(rhino)}")
    else:
        print(f"ok {path} ({len(names)} entries{extra})")
sys.exit(1 if bad or len(sys.argv) < 2 else 0)
