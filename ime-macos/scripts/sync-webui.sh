#!/usr/bin/env bash
# Builds the shared V7 web UI (npm run build -> static/script.js) and stages
# the exact files V7ImeMac's WKWebView loads: ime.html, ime.css, script.js
# (the same "dedicated ime.html + shared script.js" pairing
# ime-android/README.md describes), plus this project's bridge.js.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
out_dir="$repo_root/ime-macos/build/static"
mkdir -p "$out_dir"

( cd "$repo_root" && npm ci && npm run build )

cp "$repo_root/static/ime.html" "$out_dir/ime.html"
cp "$repo_root/static/ime.css" "$out_dir/ime.css"
cp "$repo_root/static/script.js" "$out_dir/script.js"

echo "Web UI staged at $out_dir"
