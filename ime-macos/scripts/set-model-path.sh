#!/usr/bin/env bash
# Points the installed V7ImeMac at a specific lm.binary, writing the same
# config.json Preferences.swift reads. Useful when your model doesn't live
# at one of the automatic fallback locations (~/Downloads/lm.binary or
# ~/Library/Application Support/V7ImeMac/lm.binary).
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 /path/to/lm.binary" >&2
  exit 1
fi

model_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
if [ ! -f "$model_path" ]; then
  echo "No such file: $model_path" >&2
  exit 1
fi

config_dir="$HOME/Library/Application Support/V7ImeMac"
mkdir -p "$config_dir"
python3 -c "
import json, sys
path = sys.argv[1]
config_file = sys.argv[2]
try:
    with open(config_file) as f:
        config = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    config = {}
config['modelPath'] = path
with open(config_file, 'w') as f:
    json.dump(config, f, indent=2)
" "$model_path" "$config_dir/config.json"

echo "Set modelPath to $model_path in $config_dir/config.json"
echo "Restart V7ImeMac (or log out/in) for the change to take effect."
