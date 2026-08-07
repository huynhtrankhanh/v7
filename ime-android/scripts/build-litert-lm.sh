#!/usr/bin/env bash
set -euo pipefail

source_root=${1:?LiteRT-LM source root is required}
output_dir=${2:?JNI output directory is required}
tools_dir=${3:?Build tools directory is required}

: "${ANDROID_NDK_HOME:?ANDROID_NDK_HOME must point to an installed Android NDK}"

mkdir -p "$output_dir" "$tools_dir"
bazelisk="$tools_dir/bazelisk"
bazel_output_root=${LITERT_LM_BAZEL_ROOT:-$tools_dir/output-root}
if [[ ! -x "$bazelisk" ]]; then
  GOBIN="$tools_dir" go install github.com/bazelbuild/bazelisk@v1.26.0
fi

declare -A configs=(
  [arm64-v8a]=android_arm64
  [x86_64]=android_x86_64
)
declare -A prebuilts=(
  [arm64-v8a]=android_arm64
  [x86_64]=android_x86_64
)

for abi in arm64-v8a x86_64; do
  (
    cd "$source_root"
    ANDROID_NDK_HOME="$ANDROID_NDK_HOME" \
      "$bazelisk" --output_user_root="$bazel_output_root" \
        build --config="${configs[$abi]}" //c:litert-lm
  )
  mkdir -p "$output_dir/$abi"
  rm -f \
    "$output_dir/$abi/libLiteRtTopKOpenClSampler.so" \
    "$output_dir/$abi/libLiteRtTopKWebGpuSampler.so"
  rm -f "$output_dir/$abi/liblitert-lm.so"
  cp "$source_root/bazel-bin/c/liblitert-lm.so" "$output_dir/$abi/"
  llvm_nm="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-nm"
  for symbol in \
    litert_lm_session_clone \
    litert_lm_v7_get_last_error; do
    if ! "$llvm_nm" -D --defined-only "$output_dir/$abi/liblitert-lm.so" \
      | grep -q " $symbol$"; then
      echo "Missing required LiteRT-LM bridge symbol $symbol for $abi" >&2
      exit 1
    fi
  done
  for library in \
    libGemmaModelConstraintProvider.so \
    libLiteRtGpuAccelerator.so \
    libLiteRtOpenClAccelerator.so \
    libLiteRtWebGpuAccelerator.so \
    libwebgpu_dawn.so; do
    rm -f "$output_dir/$abi/$library"
    cp "$source_root/prebuilt/${prebuilts[$abi]}/$library" \
      "$output_dir/$abi/$library"
  done
done
