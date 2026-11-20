#!/usr/bin/env python3
"""Run Robolectric differential fuzzing of V7ImeService Telex against real ibus-unikey."""
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
parser.add_argument("--seeds", type=int, default=40)
parser.add_argument("--steps", type=int, default=40)
parser.add_argument("--first-seed", type=int, default=0)
parser.add_argument("--report-only", action="store_true")
args = parser.parse_args()

gradle_home = Path(os.environ.get("GRADLE_USER_HOME", str(Path.home() / ".gradle")))
cache = gradle_home / "caches/modules-2/files-2.1"
jars = sorted(cache.rglob("*.jar"))
if not any(p.name.startswith("robolectric-4.16.1") for p in jars):
    parser.error("Robolectric 4.16.1 dependencies must first be installed in the Gradle cache")

selected = [
    "TelexUniKeyFuzzTest",
    "TelexRawBufferTest",
    "TelexHardwareKeyPolicyTest",
    "TelexPreeditStateTest",
    "HardwareEditorKeyPolicyTest",
]

with tempfile.TemporaryDirectory(prefix="v7-telex-fuzz-") as temporary:
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
        + "".join(
            "public static final class " + kind + " {"
            + "".join(
                "public static final int " + name + " = " + str(0x7F010000 + i) + ";"
                for i, name in enumerate(sorted(names))
            )
            + "}"
            for kind, names in resources.items()
        )
        + "}"
    )
    tests = [
        ROOT / f"ime-android/app/src/test/java/com/huynhtrankhanh/v7ime/{name}.java"
        for name in selected
    ]
    compile_result = subprocess.run([
        "javac", "--release", "17", "-cp", classpath, "-d", str(classes),
        *map(str, [*main, resource_source, *tests]),
    ])
    if compile_result.returncode:
        sys.exit(compile_result.returncode)

    # Ensure Robolectric has a writable user.home while preserving access to .m2
    robo_home = work / "robo-home"
    robo_home.mkdir()
    m2 = Path.home() / ".m2"
    if m2.exists():
        (robo_home / ".m2").symlink_to(m2)

    java_cmd = [
        "java", "-Xmx1g", "--enable-native-access=ALL-UNNAMED",
        f"-Duser.home={robo_home}",
        f"-Dv7.test.root={ROOT}",
        f"-Dv7.telex.seeds={args.seeds}",
        f"-Dv7.telex.steps={args.steps}",
        f"-Dv7.telex.firstSeed={args.first_seed}",
        f"-Dv7.telex.reportOnly={'true' if args.report_only else 'false'}",
        "-Drobolectric.dependency.repo.url=https://repo.maven.apache.org/maven2",
        "-cp", os.pathsep.join([str(classes), classpath]),
        "org.junit.runner.JUnitCore",
        *["com.huynhtrankhanh.v7ime." + name for name in selected],
    ]
    result = subprocess.run(java_cmd, cwd=ROOT)
    sys.exit(result.returncode)
