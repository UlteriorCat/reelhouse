#!/usr/bin/env bash
cd "$(dirname "$0")/.." || exit 1
fail=0
if grep -rnE "android\.webkit|WebView|EclipsiaCf|cf_clearance|cloudflare" --include=*.kt --include=*.kts --include=*.js \
     eclipsia soryn playz shared 2>/dev/null | grep -v "src/main/assets/scrapers/" ; then
  echo "WebView / Cloudflare code found" >&2
  fail=1
fi
files=$(find playz shared/src/playz test/node/playz -type f \( -name '*.kt' -o -name '*.kts' -o -name '*.js' -o -name '*.mjs' -o -name '*.py' -o -name '*.sh' \) 2>/dev/null)
if [ -n "$files" ]; then
  if grep -nE '^\s*(//|/\*|\*|#[^!])' $files; then
    echo "playz: comments found" >&2
    fail=1
  fi
  if grep -nE 'console\.|\bLog\.[a-z]|\bprintln\(|\bprint\(' $files; then
    echo "playz: logging found" >&2
    fail=1
  fi
fi
if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "no-WebView guard ok"
