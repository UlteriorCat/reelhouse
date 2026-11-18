#!/usr/bin/env python3
import hashlib, json, pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
shared = root / "shared/src/eclipsia/main/assets"
check = "--check" in sys.argv
stale = []


def sha(f):
    return hashlib.sha256(f.read_bytes()).hexdigest()


def finish(name, own, files):
    out = own / "sources.lock.json"
    text = json.dumps({"version": 1, "files": files}, indent=2, sort_keys=True) + "\n"
    if check:
        if not out.exists() or out.read_text() != text:
            stale.append(name)
        else:
            print(f"lock ok {name} ({len(files)} files)")
    else:
        out.write_text(text)
        print(f"wrote {out.relative_to(root)} ({len(files)} files)")


for mod in sorted(p.parent.parent.parent.parent for p in root.glob("eclipsia/*/src/main/assets/manifest.json")):
    own = mod / "src/main/assets"
    files = {}
    for base in (own, shared):
        for f in sorted(base.rglob("*.js")):
            files[f.relative_to(base).as_posix()] = sha(f)
    finish(mod.name, own, files)

for name, mod, key, shared_dir in (
    ("Soryn", root / "soryn", "soryn", root / "shared/src/soryn/main/assets"),
    ("Playz", root / "playz", "playz", root / "shared/src/playz/main/assets"),
):
    if not (mod / "build.gradle.kts").exists():
        continue
    own = mod / "src/main/assets"
    files = {}
    for f in sorted(own.rglob("*.js")):
        files[f.relative_to(own).as_posix()] = sha(f)
    src = own / key / "source.json"
    files[src.relative_to(own).as_posix()] = sha(src)
    for f in sorted(shared_dir.rglob("*.js")):
        files[f.relative_to(shared_dir).as_posix()] = sha(f)
    finish(name, own, files)

if stale:
    sys.exit("sources.lock.json is stale for: " + ", ".join(stale) + " - run tools/lock_sources.py")
