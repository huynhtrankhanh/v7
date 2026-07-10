#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${V7_UI_CORE_WASM_IMAGE:-v7-ui-core-wasm}"
DOCKER=(docker)

if ! docker info >/dev/null 2>&1; then
  DOCKER=(sudo docker)
fi

"${DOCKER[@]}" build \
  --file "${ROOT_DIR}/Dockerfile.ui-core" \
  --tag "${IMAGE_NAME}" \
  "${ROOT_DIR}"

"${DOCKER[@]}" run --rm \
  --volume "${ROOT_DIR}:/workspace" \
  "${IMAGE_NAME}"

if [[ -d "${ROOT_DIR}/src/generated" ]]; then
  if command -v sudo >/dev/null 2>&1; then
    sudo chown -R "$(id -u):$(id -g)" "${ROOT_DIR}/src/generated"
  else
    chown -R "$(id -u):$(id -g)" "${ROOT_DIR}/src/generated"
  fi
fi
