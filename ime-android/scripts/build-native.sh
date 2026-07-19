#!/usr/bin/env bash
set -euo pipefail

repo_root=${1:?Repository root is required}
kenlm_root=${2:?KenLM root is required}
output_dir=${3:?JNI output directory is required}
target_dir=${4:?Cargo target directory is required}

: "${ANDROID_NDK_HOME:?ANDROID_NDK_HOME must point to an installed Android NDK}"

abis=(arm64-v8a armeabi-v7a x86_64 x86)
mkdir -p "$output_dir" "$target_dir"

for abi in "${abis[@]}"; do
  (
    cd "$repo_root/inference-rs"
    KENLM_ROOT="$kenlm_root" \
    CARGO_TARGET_DIR="$target_dir" \
      cargo ndk -t "$abi" -o "$output_dir" \
        build \
        --release \
        --locked \
        --lib
  )
done

host_tag=$(find "$ANDROID_NDK_HOME/toolchains/llvm/prebuilt" \
  -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | head -n 1)
if [[ -z "$host_tag" ]]; then
  echo "Could not find the NDK LLVM prebuilt toolchain" >&2
  exit 1
fi

declare -A triples=(
  [arm64-v8a]=aarch64-linux-android
  [armeabi-v7a]=arm-linux-androideabi
  [x86_64]=x86_64-linux-android
  [x86]=i686-linux-android
)
for abi in "${abis[@]}"; do
  runtime="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$host_tag/sysroot/usr/lib/${triples[$abi]}/libc++_shared.so"
  if [[ ! -f "$runtime" ]]; then
    echo "Missing libc++ runtime for $abi at $runtime" >&2
    exit 1
  fi
  cp "$runtime" "$output_dir/$abi/libc++_shared.so"
done
