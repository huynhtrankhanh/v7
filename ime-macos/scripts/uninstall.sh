#!/usr/bin/env bash
set -euo pipefail

destination="$HOME/Library/Input Methods/V7ImeMac.app"

echo "Stopping any running V7ImeMac process..."
pkill -f "Library/Input Methods/V7ImeMac.app/Contents/MacOS/V7ImeMac" 2>/dev/null || true

if [ -d "$destination" ]; then
  rm -rf "$destination"
  echo "Removed $destination"
else
  echo "Nothing installed at $destination"
fi

/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user
echo "Remove V7 Vietnamese IME from System Settings > Keyboard > Input Sources manually if it is still listed there."
