#!/usr/bin/env bash
# Clones (if needed) and builds KenLM for the host Mac, applying the same
# fd-based LoadVirtual patch ime-android applies before its NDK cross-compile
# (see ime-android/patches/kenlm-load-from-fd.patch and
# ime-android/scripts/prepare-kenlm.sh). Without this patch,
# inference-rs/cpp/wrapper.cc fails to compile on *any* host platform,
# because wrapper.cc's load_model_fd() unconditionally calls an overload of
# lm::ngram::LoadVirtual that only exists once this patch is applied -- this
# is not a macOS-specific problem, it's a gap in the upstream build that this
# script (and the equivalent fix in inference-rs/build.rs) closes.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
kenlm_dir="$repo_root/kenlm"
kenlm_revision="$(cat "$repo_root/ime-android/KENLM_REVISION")"
patch_file="$repo_root/ime-android/patches/kenlm-load-from-fd.patch"

if [ ! -d "$kenlm_dir" ]; then
  echo "Cloning kpu/kenlm@$kenlm_revision into $kenlm_dir"
  git clone https://github.com/kpu/kenlm.git "$kenlm_dir"
  git -C "$kenlm_dir" checkout "$kenlm_revision"
fi

if ! git -C "$kenlm_dir" apply --unidiff-zero --check "$patch_file" 2>/dev/null; then
  if git -C "$kenlm_dir" diff --quiet -- lm/model.cc lm/model.hh lm/binary_format.cc lm/binary_format.hh 2>/dev/null; then
    echo "Applying fd-load patch to $kenlm_dir"
    git -C "$kenlm_dir" apply --unidiff-zero "$patch_file"
  else
    echo "KenLM checkout already has local changes; assuming the fd-load patch is already applied."
  fi
else
  echo "Applying fd-load patch to $kenlm_dir"
  git -C "$kenlm_dir" apply --unidiff-zero "$patch_file"
fi

boost_root="$(brew --prefix boost 2>/dev/null || true)"
cmake_args=(-S "$kenlm_dir" -B "$kenlm_dir/build" -DCMAKE_BUILD_TYPE=Release)
if [ -n "$boost_root" ]; then
  cmake_args+=(-DBOOST_ROOT="$boost_root")
fi

cmake "${cmake_args[@]}"
cmake --build "$kenlm_dir/build" --parallel "$(sysctl -n hw.ncpu)"

echo "KenLM built at $kenlm_dir/build/lib"
