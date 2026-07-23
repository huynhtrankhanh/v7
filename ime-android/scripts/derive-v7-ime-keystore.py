#!/usr/bin/env python3
"""Derive the V7 IME release key using the shared Android key generator."""

import os
import pathlib
import runpy


os.environ.setdefault("V7_KEYSTORE_ID", "v7-ime")
os.environ.setdefault("V7_KEYSTORE_COMMON_NAME", "V7 IME")

root = pathlib.Path(__file__).resolve().parents[2]
runpy.run_path(
    root / "practice-android" / "container" / "derive-v7-practice-keystore.py",
    run_name="__main__",
)
