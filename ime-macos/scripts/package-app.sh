#!/usr/bin/env bash
# Assembles V7ImeMac.app: builds the Swift executable, then lays out the
# standard macOS app-bundle structure IMKit expects (Contents/Info.plist,
# Contents/MacOS/<executable>, Contents/Resources/*) and ad-hoc code-signs
# it so Launch Services and the Text Input Sources framework will register
# and run it locally.
#
# lm.binary is deliberately NOT bundled here: it's a large (600+ MB),
# per-user generated artifact (see README.md "Training the Language Model"),
# exactly like Android's IME, which never bundles it either and instead
# lets the user point Settings at their own file. Preferences.swift looks
# for it at ~/Library/Application Support/V7ImeMac/lm.binary and
# ~/Downloads/lm.binary; use set-model-path.sh to point elsewhere.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ime_macos_dir="$(cd "$script_dir/.." && pwd)"
build_dir="$ime_macos_dir/build"
app_dir="$build_dir/V7ImeMac.app"

"$script_dir/build-inference-macos.sh"
"$script_dir/sync-webui.sh"

echo "Building V7ImeMac.app Swift executable (release)..."
( cd "$ime_macos_dir" && swift build -c release )

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources/static"

cp "$ime_macos_dir/Resources/Info.plist" "$app_dir/Contents/Info.plist"
cp "$ime_macos_dir/.build/release/V7ImeMac" "$app_dir/Contents/MacOS/V7ImeMac"
cp "$ime_macos_dir/Resources/bridge.js" "$app_dir/Contents/Resources/bridge.js"
cp "$build_dir/inference-rs" "$app_dir/Contents/Resources/inference-rs"
cp "$build_dir/static/ime.html" "$app_dir/Contents/Resources/static/ime.html"
cp "$build_dir/static/ime.css" "$app_dir/Contents/Resources/static/ime.css"
cp "$build_dir/static/script.js" "$app_dir/Contents/Resources/static/script.js"
chmod +x "$app_dir/Contents/MacOS/V7ImeMac" "$app_dir/Contents/Resources/inference-rs"

echo "Ad-hoc code-signing $app_dir ..."
codesign --force --deep --sign - "$app_dir"

echo "Built $app_dir"
codesign --verify --verbose "$app_dir" || true
