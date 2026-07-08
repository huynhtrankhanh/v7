# V7 Practice Android Bundle

This build space packages `static/practice.html` into a release-mode Android App Bundle (`.aab`). The Android app is intentionally small: it is a native fullscreen `WebView` shell that loads the checked-in practice page from Android assets. The build also generates the Play Console assets you need alongside the bundle.

## App Identity

| Field | Value |
| :--- | :--- |
| Package name | `com.huynhtrankhanh.v7practice` |
| App label | `V7 Practice` |
| Entry point | `MainActivity` |
| Content source | `static/practice.html` |
| Android output | Release App Bundle (`.aab`) |
| Launcher icon | Included in the bundle via `mipmap-*` resources |
| Play Console screenshots | Written to `android-artifacts/play-store/` |

## Files

| Path | Purpose |
| :--- | :--- |
| `Dockerfile.practice-android` | Container image with JDK, Gradle, Android SDK, and signing helper dependencies. |
| `docker-compose.yml` | Defines the long-running `practice-android` service used by `docker exec` / `docker compose exec`. |
| `practice-android/app/build.gradle` | Android application config, package name, release signing config, and version inputs. |
| `practice-android/app/src/main/java/.../MainActivity.java` | Fullscreen WebView wrapper that loads `file:///android_asset/practice.html`. |
| `practice-android/container/build-practice-aab` | Build entrypoint that derives signing material and runs `bundleRelease`. |
| `practice-android/container/derive-v7-practice-keystore.py` | Deterministic password-to-PKCS12 signing keystore generator. |

## Build Workflow

Build the image and start the service:

```sh
docker compose build practice-android
docker compose up -d practice-android
```

Create a signed release bundle:

```sh
docker compose exec practice-android build-practice-aab "1.0.0"
```

The command can also be run with direct Docker exec:

```sh
docker exec -it v7-practice-android-1 build-practice-aab "1.0.0"
```

Artifacts are written through the bind mount to:

```text
android-artifacts/
```

For version `1.0.0`, the expected outputs are:

```text
android-artifacts/v7-practice-1.0.0.aab
android-artifacts/v7-practice-1.0.0.aab.sha256
android-artifacts/play-store/app-icon-512.png
android-artifacts/play-store/phone-portrait-1080x1920.png
android-artifacts/play-store/phone-landscape-1920x1080.png
android-artifacts/play-store/tablet-portrait-1440x2560.png
android-artifacts/play-store/tablet-landscape-2560x1440.png
```

## Inputs

The build command accepts:

```text
build-practice-aab <versionName> [versionCode]
```

| Argument | Required | Meaning |
| :--- | :--- | :--- |
| `versionName` | Yes | Human-readable Android version name, for example `1.0.0`. |
| `versionCode` | No | Integer Android version code. If omitted, digits are derived from `versionName`; if no digits exist, `1` is used. |

The signing password is prompted from stdin with `*` masking when run interactively. For automation, provide `V7_SIGNING_PASSWORD` in the environment instead of passing the secret as a command-line argument.

Example with explicit version code:

```sh
docker compose exec practice-android build-practice-aab "1.0.0" 100
```

The same values can be supplied via environment variables:

```sh
docker compose exec \
  -e V7_SIGNING_PASSWORD="your signing password" \
  -e V7_VERSION="1.0.0" \
  -e V7_VERSION_CODE="100" \
  practice-android build-practice-aab
```

## Signing Model

The build does not store a signing key in the repository. Instead, `derive-v7-practice-keystore.py` derives a P-256 private key from the supplied password and writes a temporary PKCS12 keystore inside the container. Gradle uses that keystore for release signing.

Important consequences:

*   The same password recreates the same signing key, so future versions can be signed consistently.
*   Losing or changing the password changes the signing key and produces bundles that are not compatible as updates to an app signed with the previous password.
*   The derived keystore is temporary container build material. It is not copied to `android-artifacts/` and should not be committed.

## Content Packaging

`practice-android/app/build.gradle` copies `../static/practice.html` into `app/src/main/assets` before Android builds. The WebView loads that local asset with:

```text
file:///android_asset/practice.html
```

Rebuilding the bundle after editing `static/practice.html` is enough to package the latest practice page.

The build entrypoint also generates the launcher icon resources consumed by the bundle and the Play Store screenshots used for submission.

## Verification

A successful build ends with Gradle's `bundleRelease` task and prints the bundle path plus SHA-256 checksum, for example:

```text
BUILD SUCCESSFUL
<sha256>  /workspace/artifacts/v7-practice-1.0.0.aab
AAB: /workspace/artifacts/v7-practice-1.0.0.aab
```
