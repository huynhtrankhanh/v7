# Build, Install, and Screenshot V7 Practice in Waydroid

This guide builds an installable APK from this repository, installs it in
Waydroid, launches `V7 Practice`, and captures a PNG screenshot.

## Host requirements

Waydroid runs Android in an LXC container. The Linux host kernel must provide
Android Binder IPC, either built in or through the `binder_linux` module. Check
that requirement before downloading the Android images:

```sh
grep CONFIG_ANDROID_BINDER_IPC /boot/config-"$(uname -r)" 2>/dev/null || true
sudo modprobe binder_linux devices=binder,hwbinder,vndbinder
ls -l /dev/binder /dev/hwbinder /dev/vndbinder
```

On WSL2, a custom WSL kernel with Binder enabled must be selected in the
Windows user's `.wslconfig`, followed by `wsl.exe --shutdown`. Installing Linux
packages inside a running WSL distribution cannot add a feature disabled in
the active kernel.

### Enable Binder in the WSL2 kernel

The following procedure builds Microsoft's current WSL2 kernel source with
Binder built into the kernel. Run these commands inside WSL:

```sh
sudo apt update
sudo apt install -y \
  build-essential flex bison dwarves libssl-dev libelf-dev \
  bc cpio git

cd "$HOME"
git clone --depth 1 \
  https://github.com/microsoft/WSL2-Linux-Kernel.git
cd WSL2-Linux-Kernel

scripts/config --file Microsoft/config-wsl \
  --enable ANDROID_BINDER_IPC \
  --enable ANDROID_BINDERFS \
  --set-str ANDROID_BINDER_DEVICES "binder,hwbinder,vndbinder"

grep -E 'CONFIG_ANDROID_BINDER' Microsoft/config-wsl
make -j"$(nproc)" KCONFIG_CONFIG=Microsoft/config-wsl
```

The configuration check should include:

```text
CONFIG_ANDROID_BINDER_IPC=y
CONFIG_ANDROID_BINDERFS=y
CONFIG_ANDROID_BINDER_DEVICES="binder,hwbinder,vndbinder"
```

Copy the built kernel to the current Windows user's profile:

```sh
WIN_HOME="$(wslpath "$(powershell.exe -NoProfile -Command \
  '[Environment]::GetFolderPath("UserProfile")' | tr -d '\r')")"
cp arch/x86/boot/bzImage "$WIN_HOME/waydroid-bzImage"
printf 'Kernel copied to: %s\n' "$WIN_HOME/waydroid-bzImage"
```

Microsoft documents the WSL kernel build process in the
[WSL2-Linux-Kernel repository][wsl-kernel] and the custom `kernel` setting in
the [WSL advanced configuration documentation][wsl-config].

[wsl-kernel]: https://github.com/microsoft/WSL2-Linux-Kernel
[wsl-config]: https://learn.microsoft.com/en-us/windows/wsl/wsl-config

### Activate the custom kernel from Windows

This step changes the kernel for every WSL2 distribution. Run it in **Windows
PowerShell**, not in WSL. First back up an existing configuration because
`Set-Content` replaces the file:

```powershell
if (Test-Path "$env:USERPROFILE\.wslconfig") {
    Copy-Item "$env:USERPROFILE\.wslconfig" `
      "$env:USERPROFILE\.wslconfig.before-waydroid"
}

@"
[wsl2]
kernel=C:\\Users\\$env:USERNAME\\waydroid-bzImage
"@ | Set-Content -Encoding ASCII "$env:USERPROFILE\.wslconfig"

wsl --shutdown
```

If `.wslconfig` already contains required memory, networking, swap, or other
settings, edit its existing `[wsl2]` section and add only the `kernel=...` line
instead of replacing the file. Closing WSL interrupts all running WSL
processes, including Docker builds and containers, so wait for important work
to finish before running `wsl --shutdown`.

Start the WSL distribution again and verify the new kernel inside WSL:

```sh
uname -r

zgrep CONFIG_ANDROID_BINDER /proc/config.gz 2>/dev/null || \
  grep CONFIG_ANDROID_BINDER "/boot/config-$(uname -r)" 2>/dev/null || \
  true

sudo mkdir -p /dev/binderfs
sudo mount -t binder binder /dev/binderfs 2>/dev/null || true
ls -la /dev/binderfs
```

The Binder filesystem should contain `binder`, `hwbinder`, `vndbinder`, and
`binder-control`. Once those devices exist, continue with **Install Waydroid**.

### Roll back a kernel that does not boot

If WSL fails to start with the custom kernel, use Windows PowerShell to restore
the backup and restart WSL:

```powershell
if (Test-Path "$env:USERPROFILE\.wslconfig.before-waydroid") {
    Copy-Item -Force "$env:USERPROFILE\.wslconfig.before-waydroid" `
      "$env:USERPROFILE\.wslconfig"
} else {
    Remove-Item "$env:USERPROFILE\.wslconfig"
}
wsl --shutdown
```

This returns WSL to either the prior configuration or Microsoft's default
kernel. The custom `waydroid-bzImage` file can remain in the Windows profile;
it has no effect unless `.wslconfig` points to it.

For a headless host, this guide uses Weston with its headless backend and Mesa
software rendering. A normal Wayland desktop can omit the Weston setup and use
its existing `WAYLAND_DISPLAY` and `XDG_RUNTIME_DIR`.

## Build an APK

The repository's documented release workflow creates an AAB for Google Play.
Waydroid installs APK files, so build the debug variant for local testing:

```sh
cd /home/ubuntu/v7
sudo docker build -f Dockerfile.practice-android \
  -t v7-practice-android-builder .
sudo docker run --rm \
  -v "$PWD:/workspace" \
  -w /workspace/practice-android \
  v7-practice-android-builder \
  gradle --no-daemon assembleDebug
```

The resulting APK is:

```text
practice-android/app/build/outputs/apk/debug/app-debug.apk
```

## Install Waydroid

Follow the current Ubuntu/Debian instructions in the official Waydroid
documentation rather than copying an unversioned third-party package URL:

<https://docs.waydro.id/usage/install-on-desktops>

At the time this was tested, the standard sequence was:

```sh
sudo apt install curl ca-certificates -y
curl -s https://repo.waydro.id | sudo bash
sudo apt install waydroid weston -y
sudo waydroid init
```

Confirm Binder is available before continuing:

```sh
test -e /dev/binder || test -d /dev/binderfs
```

## Start a headless Wayland session

Run Weston in a dedicated runtime directory at a phone-sized resolution:

```sh
sudo install -d -m 700 -o "$(id -u)" -g "$(id -g)" /run/user/"$(id -u)"
export XDG_RUNTIME_DIR=/run/user/"$(id -u)"
export WAYLAND_DISPLAY=wayland-1
export LIBGL_ALWAYS_SOFTWARE=1
weston --backend=headless-backend.so \
  --socket="$WAYLAND_DISPLAY" \
  --width=1080 --height=1920 \
  --use-pixman &
```

Start the container and user session:

```sh
sudo waydroid container start &
waydroid session start &
waydroid status
```

## Install and launch the app

Waydroid's official application guide documents `waydroid app install`:

<https://docs.waydro.id/usage/install-and-run-android-applications>

Install and launch this repository's package:

```sh
waydroid app install \
  /home/ubuntu/v7/practice-android/app/build/outputs/apk/debug/app-debug.apk
waydroid app launch com.huynhtrankhanh.v7practice
```

Allow the WebView content to render, then confirm that the foreground activity
belongs to the expected package:

```sh
sleep 5
waydroid shell dumpsys activity activities | \
  grep -m1 com.huynhtrankhanh.v7practice
```

## Capture the screenshot

Capture from Android itself so the file records the actual Waydroid display:

```sh
waydroid shell screencap -p /sdcard/v7-practice.png
waydroid shell cat /sdcard/v7-practice.png > \
  /home/ubuntu/v7/waydroid-screenshot.png
file /home/ubuntu/v7/waydroid-screenshot.png
```

An alternative on a visible Weston session is `weston-screenshooter`, but the
Android `screencap` command is deterministic on headless compositors.

## Commit and push

Inspect the screenshot and repository state before publishing:

```sh
cd /home/ubuntu/v7
git status --short
git add WAYDROID.md waydroid-screenshot.png
git commit -m "Add Waydroid app screenshot and setup guide"
git push origin main
```

## Results on the 2026-07-10 host

The available environment was Ubuntu 26.04 under WSL2 with kernel
`6.6.87.2-microsoft-standard-WSL2`. The checks returned:

```text
# CONFIG_ANDROID_BINDER_IPC is not set
modprobe: FATAL: Module binder_linux not found in directory
             /lib/modules/6.6.87.2-microsoft-standard-WSL2
ls: cannot access '/dev/kvm': No such file or directory
```

There were no Binder devices, no loadable Binder module, and no KVM device for
a nested Binder-capable VM. Consequently, Waydroid could not be started and no
genuine Waydroid screenshot could be captured on that kernel. The required
next action is to enable Binder in the WSL kernel and restart WSL, then resume
at **Install Waydroid** above.
