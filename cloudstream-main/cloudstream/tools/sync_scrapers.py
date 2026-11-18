#!/usr/bin/env python3
"""Copy providers/*.js into eclipsia/*/src/main/assets/scrapers/ for every manifest entry.

providers/ at the repo root is the single place scraper .js files are edited. For each manifest.json
scraper entry, the source is providers/<basename of the "filename" value (e.g. "providers/x.js")>, or providers/<id>.js when the
entry has no URL. Outdated copies are overwritten and the manifest's top-level "version" is
incremented by one (once per module, however many of its scrapers changed). Afterwards
tools/lock_sources.py is run so the sources.lock.json hashes match.

  python3 tools/sync_scrapers.py           # update files in place
  python3 tools/sync_scrapers.py --check   # only report, exit 1 if anything is outdated

Side files (used by the workflow):
  $SYNC_CHANGED   list of updated files          (default /tmp/sync-changed.txt)
  $SYNC_FAILURES  entries with no providers file (default /tmp/sync-failures.txt)
"""
import hashlib, json, os, pathlib, re, subprocess, sys
from urllib.parse import urlparse

root = pathlib.Path(__file__).resolve().parent.parent
providers = root / "providers"
check = "--check" in sys.argv
changed_file = pathlib.Path(os.environ.get("SYNC_CHANGED", "/tmp/sync-changed.txt"))
failures_file = pathlib.Path(os.environ.get("SYNC_FAILURES", "/tmp/sync-failures.txt"))
changed, failures = [], []
bumped = set()  # manifests whose scrapers changed


def sanity(body):
    if not body.strip():
        return "empty file"
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return "not valid UTF-8"
    if text.lstrip().startswith("<"):
        return "looks like an HTML page, not JavaScript"
    return None


if not providers.is_dir():
    sys.exit(f"{providers} does not exist")

for manifest in sorted(root.glob("eclipsia/*/src/main/assets/manifest.json")):
    assets = manifest.parent
    module = assets.parent.parent.parent.name
    for s in json.loads(manifest.read_text())["scrapers"]:
        url = s.get("filename") or ""
        if url:
            name = pathlib.PurePosixPath(urlparse(url).path).name
        else:
            name = f"{s['id']}.js"
        source = providers / name
        target = assets / "scrapers" / name
        if not source.is_file():
            if url:
                failures.append(f"{module}/{name}: missing providers/{name}")
            else:
                print(f"skip   {module}/{s['id']} (no providers/{name})")
            continue
        body = source.read_bytes()
        problem = sanity(body)
        if problem:
            failures.append(f"providers/{name}: {problem}")
            continue
        old = target.read_bytes() if target.exists() else None
        if old is not None and hashlib.sha256(old).digest() == hashlib.sha256(body).digest():
            print(f"ok     {module}/{name}")
            continue
        rel = target.relative_to(root).as_posix()
        print(f"{'NEW   ' if old is None else 'UPDATE'} {rel}")
        changed.append(rel)
        bumped.add(manifest)
        if not check:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)

for manifest in sorted(bumped):
    text = manifest.read_text()
    m = re.search(r'^(  "version":\s*)(\d+)', text, re.M)
    if not m:
        print(f"::warning::{manifest.relative_to(root)}: no top-level version to bump")
        continue
    new = int(m.group(2)) + 1
    print(f"VERSION {manifest.relative_to(root)}: {m.group(2)} -> {new}")
    if not check:
        manifest.write_text(text[:m.start(2)] + str(new) + text[m.end(2):])
        changed.append(manifest.relative_to(root).as_posix())

if changed and not check:
    before = {p: p.read_bytes() for p in root.glob("**/sources.lock.json") if "node_modules" not in p.parts}
    subprocess.run([sys.executable, str(root / "tools/lock_sources.py")], check=True)
    for p, old in before.items():
        if p.read_bytes() != old:
            changed.append(p.relative_to(root).as_posix())

changed_file.write_text("".join(c + "\n" for c in changed))
failures_file.write_text("".join(f + "\n" for f in failures))
print(f"\n{len(changed)} outdated, {len(failures)} failed")
if failures:
    print("::error::problems:\n  " + "\n  ".join(failures))
sys.exit(1 if (check and changed) or failures else 0)
