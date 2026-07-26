#!/usr/bin/env bash
# Installs the built V7ImeMac.app into ~/Library/Input Methods and restarts
# the Text Input Sources registration so the new (or updated) build is
# picked up. Enabling it in System Settings still requires one manual step
# -- see README.md "Install and enable" -- macOS does not expose an API to
# add an input source to a user's enabled list without user interaction.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ime_macos_dir="$(cd "$script_dir/.." && pwd)"
app_dir="$ime_macos_dir/build/V7ImeMac.app"
destination="$HOME/Library/Input Methods/V7ImeMac.app"

if [ ! -d "$app_dir" ]; then
  echo "V7ImeMac.app not found at $app_dir; run package-app.sh first." >&2
  exit 1
fi

echo "Stopping any running V7ImeMac process..."
pkill -f "Library/Input Methods/V7ImeMac.app/Contents/MacOS/V7ImeMac" 2>/dev/null || true

mkdir -p "$HOME/Library/Input Methods"
rm -rf "$destination"
cp -R "$app_dir" "$destination"

echo "Re-registering input sources with Launch Services..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$destination"

echo
echo "Installed to $destination"
echo "Now open System Settings > Keyboard > Input Sources > Edit... > '+',"
echo "find 'Vietnamese' or 'V7 Vietnamese IME' in the list, add it, then"
echo "select it from the input menu / globe key to start using it."
