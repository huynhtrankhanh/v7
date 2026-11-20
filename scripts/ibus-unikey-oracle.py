#!/usr/bin/env python3
"""JSON-lines oracle wrapping real ibus-unikey over an isolated IBus/DBus session.

Simulates a full text editor buffer with caret, selection, and composing span so
navigation, selection (Shift+Arrow/Home/End, Ctrl+A), Ctrl+Backspace, Forward
Delete, and touch/programmatic selection changes can be differentially fuzzed
against Android's V7ImeService.
"""
import atexit
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

if os.environ.get("V7_IBUS_ORACLE_INSIDE_DBUS") != "1":
    tmp = tempfile.mkdtemp(prefix="v7-ibus-oracle-")
    os.chmod(tmp, 0o700)
    os.makedirs(os.path.join(tmp, ".config"), exist_ok=True)
    os.makedirs(os.path.join(tmp, ".cache"), exist_ok=True)
    env = os.environ.copy()
    env["V7_IBUS_ORACLE_INSIDE_DBUS"] = "1"
    env["V7_IBUS_ORACLE_TMP"] = tmp
    env["HOME"] = tmp
    env["XDG_CONFIG_HOME"] = os.path.join(tmp, ".config")
    env["XDG_CACHE_HOME"] = os.path.join(tmp, ".cache")
    env["XDG_RUNTIME_DIR"] = tmp
    try:
        rc = subprocess.call(
            ["dbus-run-session", "--", sys.executable, os.path.abspath(__file__)],
            env=env,
        )
        sys.exit(rc)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

import gi

gi.require_version("IBus", "1.0")
from gi.repository import GLib, IBus

GLib.log_set_handler(
    "GLib-GObject",
    GLib.LogLevelFlags.LEVEL_WARNING | GLib.LogLevelFlags.LEVEL_CRITICAL,
    lambda *args: None,
)

TMP = os.environ["V7_IBUS_ORACLE_TMP"]
ADDR = f"unix:path={os.path.join(TMP, 'ibus.sock')}"
os.environ["IBUS_ADDRESS"] = ADDR

daemon = subprocess.Popen(
    [
        "ibus-daemon",
        "--replace",
        "--panel=disable",
        "--config=disable",
        f"--address={ADDR}",
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)


def cleanup():
    if daemon.poll() is None:
        daemon.terminate()
        try:
            daemon.wait(timeout=3)
        except subprocess.TimeoutExpired:
            daemon.kill()


atexit.register(cleanup)

IBus.init()
bus = None
for _ in range(100):
    if os.path.exists(os.path.join(TMP, "ibus.sock")):
        bus = IBus.Bus()
        if bus.is_connected():
            break
    time.sleep(0.05)

if bus is None or not bus.is_connected():
    raise RuntimeError("Failed to connect to isolated ibus-daemon")

if not bus.set_global_engine("Unikey"):
    raise RuntimeError("Failed to set global IBus engine to Unikey")

ctx = bus.create_input_context("v7-telex-fuzz")
ctx.set_capabilities(IBus.Capabilite.PREEDIT_TEXT | IBus.Capabilite.FOCUS)
ctx.focus_in()
ctx.set_engine("Unikey")

main_ctx = GLib.MainContext.default()


def drain():
    while main_ctx.iteration(False):
        pass


for _ in range(50):
    drain()
    eng = ctx.get_engine()
    if eng and eng.get_name() == "Unikey":
        break
    time.sleep(0.02)

eng = ctx.get_engine()
if not eng or eng.get_name() != "Unikey":
    raise RuntimeError(f"Expected Unikey engine, got {eng.get_name() if eng else None}")

# Editor buffer model:
#   editor_text: full text currently visible (including preedit)
#   sel_start, sel_end: selection anchor and active caret (in code units / chars)
#   preedit_start: start index of active composing span, or -1 if none
#   preedit_text: current composing text
editor_text = ""
sel_start = 0
sel_end = 0
preedit_start = -1
preedit_text = ""


def _replace_active_span(replacement, keep_composing):
    global editor_text, sel_start, sel_end, preedit_start, preedit_text
    if preedit_start >= 0:
        lo = preedit_start
        hi = preedit_start + len(preedit_text)
    else:
        lo = min(sel_start, sel_end)
        hi = max(sel_start, sel_end)
    editor_text = editor_text[:lo] + replacement + editor_text[hi:]
    caret = lo + len(replacement)
    sel_start = caret
    sel_end = caret
    if keep_composing and replacement:
        preedit_start = lo
        preedit_text = replacement
    else:
        preedit_start = -1
        preedit_text = ""


def on_commit(_ctx, text):
    _replace_active_span(text.get_text(), keep_composing=False)


def on_update_preedit(_ctx, text, _cursor_pos, visible):
    t = text.get_text() if visible else ""
    _replace_active_span(t, keep_composing=bool(t))


def on_hide_preedit(_ctx):
    if preedit_start >= 0:
        _replace_active_span("", keep_composing=False)


ctx.connect("commit-text", on_commit)
ctx.connect("update-preedit-text", on_update_preedit)
ctx.connect("hide-preedit-text", on_hide_preedit)


def reset_state(prefix=""):
    global editor_text, sel_start, sel_end, preedit_start, preedit_text
    if preedit_text:
        ctx.reset()
        drain()
        time.sleep(0.002)
        drain()
    else:
        ctx.reset()
        drain()
    editor_text = prefix
    sel_start = len(prefix)
    sel_end = len(prefix)
    preedit_start = -1
    preedit_text = ""


def _prev_word_pos(text, pos):
    cut = pos
    while cut > 0 and text[cut - 1].isspace():
        cut -= 1
    while cut > 0 and not text[cut - 1].isspace():
        cut -= 1
    return cut


def _next_word_pos(text, pos):
    n = len(text)
    cut = pos
    while cut < n and not text[cut].isspace():
        cut += 1
    while cut < n and text[cut].isspace():
        cut += 1
    return cut


def _apply_editor_key(kind):
    global editor_text, sel_start, sel_end, preedit_start, preedit_text
    # Ensure composing span is finished if the editor receives a direct key.
    preedit_start = -1
    preedit_text = ""
    lo = min(sel_start, sel_end)
    hi = max(sel_start, sel_end)
    if kind == "backspace":
        if lo != hi:
            editor_text = editor_text[:lo] + editor_text[hi:]
            sel_start = sel_end = lo
        elif lo > 0:
            editor_text = editor_text[: lo - 1] + editor_text[lo:]
            sel_start = sel_end = lo - 1
    elif kind == "ctrl_backspace":
        if lo != hi:
            editor_text = editor_text[:lo] + editor_text[hi:]
            sel_start = sel_end = lo
        else:
            cut = _prev_word_pos(editor_text, lo)
            editor_text = editor_text[:cut] + editor_text[lo:]
            sel_start = sel_end = cut
    elif kind == "forward_delete":
        if lo != hi:
            editor_text = editor_text[:lo] + editor_text[hi:]
            sel_start = sel_end = lo
        elif lo < len(editor_text):
            editor_text = editor_text[:lo] + editor_text[lo + 1 :]
            sel_start = sel_end = lo
    elif kind == "ctrl_a":
        sel_start = 0
        sel_end = len(editor_text)
    elif kind == "left":
        pos = lo if lo != hi else max(0, sel_end - 1)
        sel_start = sel_end = pos
    elif kind == "right":
        pos = hi if lo != hi else min(len(editor_text), sel_end + 1)
        sel_start = sel_end = pos
    elif kind == "ctrl_left":
        pos = _prev_word_pos(editor_text, sel_end)
        sel_start = sel_end = pos
    elif kind == "ctrl_right":
        pos = _next_word_pos(editor_text, sel_end)
        sel_start = sel_end = pos
    elif kind == "home":
        sel_start = sel_end = 0
    elif kind == "end":
        sel_start = sel_end = len(editor_text)
    elif kind == "shift_left":
        sel_end = max(0, sel_end - 1)
    elif kind == "shift_right":
        sel_end = min(len(editor_text), sel_end + 1)
    elif kind == "ctrl_shift_left":
        sel_end = _prev_word_pos(editor_text, sel_end)
    elif kind == "ctrl_shift_right":
        sel_end = _next_word_pos(editor_text, sel_end)
    elif kind == "shift_home":
        sel_end = 0
    elif kind == "shift_end":
        sel_end = len(editor_text)


def _send_ibus(kv, state):
    handled = ctx.process_key_event(kv, 0, state)
    ctx.process_key_event(kv, 0, state | IBus.ModifierType.RELEASE_MASK)
    drain()
    return bool(handled)


def process_step(step):
    global sel_start, sel_end, preedit_start, preedit_text
    kind = step["kind"]
    CTRL = IBus.ModifierType.CONTROL_MASK
    SHIFT = IBus.ModifierType.SHIFT_MASK
    if kind == "backspace":
        handled = _send_ibus(IBus.KEY_BackSpace, 0)
        if not handled:
            _apply_editor_key("backspace")
    elif kind == "enter":
        handled = _send_ibus(IBus.KEY_Return, 0)
        if not handled:
            _replace_active_span("\n", keep_composing=False)
    elif kind == "tab":
        handled = _send_ibus(IBus.KEY_Tab, 0)
        if not handled:
            _replace_active_span("\t", keep_composing=False)
    elif kind == "char":
        ch = step["ch"]
        state = SHIFT if step.get("shift") else 0
        handled = _send_ibus(ord(ch), state)
        if not handled:
            _replace_active_span(ch, keep_composing=False)
    elif kind == "ctrl_a":
        handled = _send_ibus(ord("a"), CTRL)
        if not handled:
            _apply_editor_key("ctrl_a")
    elif kind == "ctrl_backspace":
        handled = _send_ibus(IBus.KEY_BackSpace, CTRL)
        if not handled:
            _apply_editor_key("ctrl_backspace")
    elif kind == "forward_delete":
        handled = _send_ibus(IBus.KEY_Delete, 0)
        if not handled:
            _apply_editor_key("forward_delete")
    elif kind == "left":
        handled = _send_ibus(IBus.KEY_Left, 0)
        if not handled:
            _apply_editor_key("left")
    elif kind == "right":
        handled = _send_ibus(IBus.KEY_Right, 0)
        if not handled:
            _apply_editor_key("right")
    elif kind == "ctrl_left":
        handled = _send_ibus(IBus.KEY_Left, CTRL)
        if not handled:
            _apply_editor_key("ctrl_left")
    elif kind == "ctrl_right":
        handled = _send_ibus(IBus.KEY_Right, CTRL)
        if not handled:
            _apply_editor_key("ctrl_right")
    elif kind == "home":
        handled = _send_ibus(IBus.KEY_Home, 0)
        if not handled:
            _apply_editor_key("home")
    elif kind == "end":
        handled = _send_ibus(IBus.KEY_End, 0)
        if not handled:
            _apply_editor_key("end")
    elif kind == "shift_left":
        handled = _send_ibus(IBus.KEY_Left, SHIFT)
        if not handled:
            _apply_editor_key("shift_left")
    elif kind == "shift_right":
        handled = _send_ibus(IBus.KEY_Right, SHIFT)
        if not handled:
            _apply_editor_key("shift_right")
    elif kind == "ctrl_shift_left":
        handled = _send_ibus(IBus.KEY_Left, CTRL | SHIFT)
        if not handled:
            _apply_editor_key("ctrl_shift_left")
    elif kind == "ctrl_shift_right":
        handled = _send_ibus(IBus.KEY_Right, CTRL | SHIFT)
        if not handled:
            _apply_editor_key("ctrl_shift_right")
    elif kind == "shift_home":
        handled = _send_ibus(IBus.KEY_Home, SHIFT)
        if not handled:
            _apply_editor_key("shift_home")
    elif kind == "shift_end":
        handled = _send_ibus(IBus.KEY_End, SHIFT)
        if not handled:
            _apply_editor_key("shift_end")
    elif kind == "set_selection":
        # Programmatic/touch tap or drag selection: synchronously flush ibus-unikey's
        # preedit in-place, then move selection to (start, end).
        if preedit_start >= 0:
            _send_ibus(IBus.KEY_Home, 0)
            preedit_start = -1
            preedit_text = ""
        n = len(editor_text)
        sel_start = max(0, min(n, int(step["start"])))
        sel_end = max(0, min(n, int(step["end"])))
        handled = False
    elif kind == "focus_out":
        ctx.focus_out()
        drain()
        ctx.focus_in()
        drain()
        handled = True
    else:
        raise ValueError(f"Unknown step kind: {kind}")

    committed_view = (
        editor_text[:preedit_start] + editor_text[preedit_start + len(preedit_text) :]
        if preedit_start >= 0
        else editor_text
    )
    return {
        "text": editor_text,
        "committed": committed_view,
        "preedit": preedit_text,
        "selStart": sel_start,
        "selEnd": sel_end,
        "handled": bool(handled),
    }


for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
        op = req.get("op")
        if op == "reset":
            reset_state(req.get("prefix", ""))
            resp = {
                "text": editor_text,
                "committed": editor_text,
                "preedit": preedit_text,
                "selStart": sel_start,
                "selEnd": sel_end,
            }
        elif op == "step":
            resp = process_step(req)
        elif op == "batch":
            if req.get("reset", True):
                reset_state(req.get("prefix", ""))
            results = [process_step(s) for s in req["steps"]]
            resp = {"results": results}
        else:
            resp = {"error": f"Unknown op: {op}"}
    except Exception as exc:
        resp = {"error": str(exc)}
    sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
    sys.stdout.flush()
