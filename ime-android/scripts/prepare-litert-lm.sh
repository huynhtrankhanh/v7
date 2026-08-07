#!/usr/bin/env bash
set -euo pipefail

destination=${1:?LiteRT-LM destination is required}
revision_file=${2:?LiteRT-LM revision file is required}
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
revision=$(tr -d '[:space:]' < "$revision_file")

if [[ ! -d "$destination/.git" ]]; then
  rm -rf "$destination"
  GIT_LFS_SKIP_SMUDGE=1 git clone \
    https://github.com/google-ai-edge/LiteRT-LM.git "$destination"
fi

git -C "$destination" fetch --depth 1 origin "$revision"
git -C "$destination" reset --hard "$revision"
git -C "$destination" clean -fdx
git -C "$destination" lfs pull --include='prebuilt/android_arm64/**,prebuilt/android_x86_64/**'
git -C "$destination" apply \
  "$script_dir/../patches/litert-lm-batched-text-scoring.patch"
printf '%s\n' "$revision" > "$destination/.v7-prepared-revision"
