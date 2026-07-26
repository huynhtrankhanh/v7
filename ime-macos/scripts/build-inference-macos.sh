#!/usr/bin/env bash
# Builds inference-rs for macOS, producing a universal (arm64 + x86_64)
# binary when both Rust targets are installed, otherwise falling back to the
# host's native architecture only.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
inference_dir="$repo_root/inference-rs"
out_dir="$repo_root/ime-macos/build"
mkdir -p "$out_dir"

"$script_dir/build-kenlm-macos.sh"

targets=()
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if rustup target list --installed 2>/dev/null | grep -q "^$target$"; then
    targets+=("$target")
  fi
done
if [ ${#targets[@]} -eq 0 ]; then
  echo "Neither aarch64-apple-darwin nor x86_64-apple-darwin rustup target is installed; building for the host toolchain default."
  ( cd "$inference_dir" && cargo build --release )
  cp "$inference_dir/target/release/inference-rs" "$out_dir/inference-rs"
elif [ ${#targets[@]} -eq 1 ]; then
  target="${targets[0]}"
  echo "Building inference-rs for $target only (install the other target with 'rustup target add' for a universal binary)."
  ( cd "$inference_dir" && cargo build --release --target "$target" )
  cp "$inference_dir/target/$target/release/inference-rs" "$out_dir/inference-rs"
else
  echo "Building inference-rs for both arm64 and x86_64, then lipo-combining into a universal binary."
  for target in "${targets[@]}"; do
    ( cd "$inference_dir" && cargo build --release --target "$target" )
  done
  lipo -create \
    "$inference_dir/target/aarch64-apple-darwin/release/inference-rs" \
    "$inference_dir/target/x86_64-apple-darwin/release/inference-rs" \
    -output "$out_dir/inference-rs"
fi

chmod +x "$out_dir/inference-rs"
file "$out_dir/inference-rs"
echo "inference-rs staged at $out_dir/inference-rs"
