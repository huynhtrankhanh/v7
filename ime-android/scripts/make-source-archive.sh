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

The ZIP aggregate, as a whole, is distributed under GPL-3.0-or-later; see
AGGREGATE-LICENSE.txt. This does not replace the licenses of its constituent
files: V7 remains 0BSD, and third-party files retain their own notices and
licenses. KenLM's license texts are in third_party/kenlm.
EOF

cat > "$staging/AGGREGATE-LICENSE.txt" <<'EOF'
V7 IME APK build-source ZIP aggregate

SPDX-License-Identifier: GPL-3.0-or-later

The build-source ZIP aggregate, as a combined collection, may be redistributed
and/or modified under the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

This aggregate license does not replace the licenses attached to constituent
files. In particular, V7 source files remain available under 0BSD, and KenLM
retains its upstream licenses and notices.

The GNU General Public License version 3 text follows.

EOF
cat "$kenlm_root/COPYING.3" >> "$staging/AGGREGATE-LICENSE.txt"

(
  cd "$repo_root"
  git ls-files --cached --others --exclude-standard |
    LC_ALL=C sort |
    zip -q "$archive" -@
)
(
  cd "$staging"
  zip -qr "$archive" AGGREGATE-LICENSE.txt BUILD-SOURCE.md third_party
)
mv "$archive" "$output"
