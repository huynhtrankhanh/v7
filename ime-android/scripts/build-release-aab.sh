#!/usr/bin/env bash
set -euo pipefail

version="${1:-${V7_VERSION:-}}"
version_code="${2:-${V7_VERSION_CODE:-}}"

if [[ $# -gt 2 || -z "${version}" ]]; then
  cat >&2 <<'USAGE'
usage: build-release-aab <version> [versionCode]

Set V7_SIGNING_PASSWORD for non-interactive signing. The password derives a
deterministic V7 IME PKCS#12 release key unless a registered upload key is
provided through SIGNING_STORE_FILE, SIGNING_STORE_PASSWORD,
SIGNING_KEY_ALIAS, SIGNING_KEY_PASSWORD, and optional SIGNING_STORE_TYPE.
USAGE
  exit 2
fi

read_signing_password() {
  if [[ -n "${V7_SIGNING_PASSWORD:-}" ]]; then
    signing_password="${V7_SIGNING_PASSWORD}"
    return
  fi

  signing_password=""
  if [[ -t 0 ]]; then
    local character
    printf 'Signing password: ' >&2
    while IFS= read -r -s -n 1 character; do
      if [[ "${character}" == $'\n' || "${character}" == $'\r' ]]; then
        break
      fi
      if [[ "${character}" == $'\177' || "${character}" == $'\b' ]]; then
        if [[ -n "${signing_password}" ]]; then
          signing_password="${signing_password%?}"
          printf '\b \b' >&2
        fi
        continue
      fi
      signing_password+="${character}"
      printf '*' >&2
    done
    printf '\n' >&2
    return
  fi

  IFS= read -r signing_password || [[ -n "${signing_password}" ]]
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "${script_dir}/.." && pwd)"
root_dir="$(cd "${project_dir}/.." && pwd)"
artifacts_dir="${V7_ARTIFACTS_DIR:-${root_dir}/android-artifacts}"
signing_dir="$(mktemp -d)"
trap 'rm -rf "${signing_dir}"' EXIT
keystore="${signing_dir}/v7-ime.p12"
signing_env="${signing_dir}/signing.env"

mkdir -p "${artifacts_dir}"

if [[ -n "${SIGNING_STORE_FILE:-}" ]]; then
  : "${SIGNING_STORE_PASSWORD:?SIGNING_STORE_PASSWORD is required when SIGNING_STORE_FILE is set}"
  : "${SIGNING_KEY_ALIAS:?SIGNING_KEY_ALIAS is required when SIGNING_STORE_FILE is set}"
  : "${SIGNING_KEY_PASSWORD:?SIGNING_KEY_PASSWORD is required when SIGNING_STORE_FILE is set}"
  if [[ ! -f "${SIGNING_STORE_FILE}" ]]; then
    printf 'SIGNING_STORE_FILE does not exist: %s\n' "${SIGNING_STORE_FILE}" >&2
    exit 2
  fi
else
  read_signing_password
  if [[ -z "${signing_password}" ]]; then
    printf 'Signing password is required.\n' >&2
    exit 2
  fi

  printf '%s' "${signing_password}" \
    | "${script_dir}/derive-v7-ime-keystore.py" "${keystore}" > "${signing_env}"
  chmod 600 "${signing_env}"
  set -a
  # shellcheck disable=SC1090
  source "${signing_env}"
  set +a
  export SIGNING_STORE_FILE="${keystore}"
fi

gradle_args=("-Pv7ImeVersion=${version}")
if [[ -n "${version_code}" ]]; then
  gradle_args+=("-Pv7ImeVersionCode=${version_code}")
fi

gradle -p "${project_dir}" --no-daemon bundleRelease "${gradle_args[@]}"

aab_path="${project_dir}/app/build/outputs/bundle/release/app-release.aab"
if [[ ! -f "${aab_path}" ]]; then
  printf 'Release App Bundle was not created: %s\n' "${aab_path}" >&2
  exit 1
fi

jarsigner -verify -certs "${aab_path}"

artifact_name="v7-ime-${version}.aab"
cp "${aab_path}" "${artifacts_dir}/${artifact_name}"
sha256sum "${artifacts_dir}/${artifact_name}" \
  | tee "${artifacts_dir}/${artifact_name}.sha256"
keytool -list -v \
  -keystore "${SIGNING_STORE_FILE}" \
  -storepass "${SIGNING_STORE_PASSWORD}" \
  -alias "${SIGNING_KEY_ALIAS}" \
  | awk '/SHA1:|SHA256:/{print}' \
  | tee "${artifacts_dir}/v7-ime-${version}.upload-certificate.txt"
keytool -printcert -jarfile "${artifacts_dir}/${artifact_name}" \
  | awk '/SHA1:|SHA256:/{print}' \
  | tee "${artifacts_dir}/v7-ime-${version}.bundle-certificate.txt"
if ! cmp -s \
  "${artifacts_dir}/v7-ime-${version}.upload-certificate.txt" \
  "${artifacts_dir}/v7-ime-${version}.bundle-certificate.txt"; then
  printf 'Release App Bundle signer does not match the configured signing key.\n' >&2
  exit 1
fi

printf 'AAB: %s\n' "${artifacts_dir}/${artifact_name}"
