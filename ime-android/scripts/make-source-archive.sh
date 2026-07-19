#!/usr/bin/env bash
set -euo pipefail

repo_root=${1:?Repository root is required}
kenlm_root=${2:?KenLM root is required}
output=${3:?Output ZIP is required}

staging=$(mktemp -d)
archive="$staging/v7-ime-source.zip"
trap 'rm -rf "$staging"' EXIT

mkdir -p "$(dirname "$output")" "$staging/third_party"
cp -a "$kenlm_root" "$staging/third_party/kenlm"
find "$staging/third_party/kenlm" -name .git -type d -prune -exec rm -rf {} +

v7_revision=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || printf 'working-tree')
if [[ -n "$(git -C "$repo_root" status --porcelain)" ]]; then
  v7_revision="$v7_revision (working tree with uncommitted changes)"
fi
kenlm_revision=$(git -C "$kenlm_root" rev-parse HEAD)
cat > "$staging/BUILD-SOURCE.md" <<EOF
# V7 IME APK build source

This archive contains the V7 source tree and the exact KenLM source used to
build the APK. It deliberately does not contain an lm.binary language model;
users select their own local model through Android's Storage Access Framework.

- V7 revision: $v7_revision
- KenLM revision: $kenlm_revision

The combined archive is distributed under GPL-3.0-or-later. Third-party files
retain their copyright notices and compatible licenses. KenLM's license texts
are in third_party/kenlm.
EOF

(
  cd "$repo_root"
  git ls-files --cached --others --exclude-standard |
    LC_ALL=C sort |
    zip -q "$archive" -@
)
(
  cd "$staging"
  zip -qr "$archive" BUILD-SOURCE.md third_party
)
mv "$archive" "$output"
