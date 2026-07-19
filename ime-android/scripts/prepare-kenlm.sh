#!/usr/bin/env bash
set -euo pipefail

destination=${1:?KenLM destination is required}
revision_file=${2:?KenLM revision file is required}
revision=$(tr -d '[:space:]' < "$revision_file")
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
fd_patch="$script_dir/../patches/kenlm-load-from-fd.patch"

if [[ ! -d "$destination/.git" ]]; then
  mkdir -p "$(dirname "$destination")"
  git clone --filter=blob:none --no-checkout \
    https://github.com/kpu/kenlm.git "$destination"
fi

current=$(git -C "$destination" rev-parse HEAD 2>/dev/null || true)
if [[ "$current" != "$revision" || ! -f "$destination/CMakeLists.txt" ]]; then
  git -C "$destination" fetch --depth 1 origin "$revision"
  git -C "$destination" checkout --detach "$revision"
fi

actual=$(git -C "$destination" rev-parse HEAD)
if [[ "$actual" != "$revision" ]]; then
  echo "Expected KenLM $revision but checked out $actual" >&2
  exit 1
fi

if git -C "$destination" apply --unidiff-zero \
    --reverse --check "$fd_patch" 2>/dev/null; then
  exit 0
fi
git -C "$destination" apply --unidiff-zero --check "$fd_patch"
git -C "$destination" apply --unidiff-zero "$fd_patch"
