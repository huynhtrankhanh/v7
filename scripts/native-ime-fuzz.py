#!/usr/bin/env python3
"""Run native IME Robolectric fuzzing without an Android SDK/APK build.

Uses the Android/Robolectric/AndroidX artifacts already in the Gradle dependency
cache, compiles production Java plus the selected tests, then runs JUnit. Resource
IDs are compile-only placeholders; these tests exercise the service and editing
protocol rather than inflating APK layouts. The standard Android Gradle test task
can run the same test class with generated APK resources.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--seeds", type=int, default=100)
parser.add_argument("--steps", type=int, default=100)
parser.add_argument("--first-seed", type=int, default=0)
args = parser.parse_args()
if args.seeds < 1 or args.steps < 1:
    parser.error("seeds and steps must be positive")
cache = Path(os.environ.get("GRADLE_USER_HOME", str(Path.home() / ".gradle"))) / "caches/modules-2/files-2.1"
jars = sorted(cache.rglob("*.jar"))
if not any(p.name.startswith("robolectric-4.16.1") for p in jars):
    parser.error("Robolectric 4.16.1 dependencies must first be installed in the Gradle cache")
selected = [
    "V7PloverNativeFuzzTest", "V7ImePreeditSynchronizationTest",
    "HardwareKeyActionResolverTest", "HardwareKeyPressOwnershipTest",
    "HardwareInputModeTest", "HardwareEditorKeyPolicyTest", "GenerationOwnershipTest",
]
with tempfile.TemporaryDirectory(prefix="v7-native-fuzz-") as temporary:
    work = Path(temporary)
    classes = work / "classes"
    classes.mkdir()
    for aar in sorted(cache.rglob("*.aar")):
        with zipfile.ZipFile(aar) as archive:
            if "classes.jar" in archive.namelist():
                target = work / ("aar-" + hashlib.sha256(str(aar).encode()).hexdigest()[:12] + ".jar")
                target.write_bytes(archive.read("classes.jar"))
                jars.append(target)
    classpath = os.pathsep.join(map(str, jars))
    main = sorted((ROOT / "ime-android/app/src/main/java").rglob("*.java"))
    resources = {}
    for source in main:
        for kind, name in re.findall(r"(?<!android\.)\bR\.(\w+)\.(\w+)", source.read_text()):
            resources.setdefault(kind, set()).add(name)
    resource_source = work / "R.java"
    resource_source.write_text(
        "package com.huynhtrankhanh.v7ime; public final class R {"
        + "".join("public static final class " + kind + " {"
                  + "".join("public static final int " + name + " = " + str(0x7F010000 + i) + ";"
                            for i, name in enumerate(sorted(names))) + "}"
                  for kind, names in resources.items()) + "}"
    )
    tests = [ROOT / f"ime-android/app/src/test/java/com/huynhtrankhanh/v7ime/{name}.java" for name in selected]
    compile_result = subprocess.run([
        "javac", "--release", "17", "-cp", classpath, "-d", str(classes),
        *map(str, [*main, resource_source, *tests]),
    ])
    if compile_result.returncode:
        sys.exit(compile_result.returncode)
    result = subprocess.run([
        "java", "-Xmx1g", "--enable-native-access=ALL-UNNAMED",
        f"-Dv7.test.root={ROOT}", f"-Dv7.fuzz.seeds={args.seeds}",
        f"-Dv7.fuzz.steps={args.steps}", f"-Dv7.fuzz.firstSeed={args.first_seed}",
        "-Drobolectric.dependency.repo.url=https://repo.maven.apache.org/maven2",
        "-cp", os.pathsep.join([str(classes), classpath]), "org.junit.runner.JUnitCore",
        *["com.huynhtrankhanh.v7ime." + name for name in selected],
    ], cwd=ROOT)
    sys.exit(result.returncode)
