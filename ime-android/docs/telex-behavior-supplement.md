# Telex adapter behavior for V7

## Status

This document specifies the behavior of `telex.ts`.

The adapter is deliberately implemented as a **new client of the existing V7 syllable API**. It does not require edits to `syllableStroke.ts`, `vietnameseSyllables.ts`, `v7Core.ts`, or any existing V7 code.

Its only V7 import is:

```ts
import { getValidVietnameseSyllables } from "./vietnameseSyllables";
```

The generated broad syllable set is used as an oracle for tone placement and for ranking delayed shape transformations. Telex itself remains a separate input protocol.

The design target is a predictable IME/editor composition engine, not byte-for-byte emulation of any particular UniKey release. Where Telex has well-established engine semantics, however, this adapter intentionally follows them; in particular, `z` is tone zero and the `th + uo + w` path follows UniKey's two-stage behavior: open `thuow` is temporarily `thuơ`, while a later valid coda completes `uơ` to `ươ`.

---

## Public API

```ts
export type TelexMode = "standard" | "simple";

export type TelexTone =
  | "acute"
  | "grave"
  | "hook"
  | "tilde"
  | "dot";

export type TelexOptions = {
  mode?: TelexMode;
  freeShapeMarks?: boolean;
};

export type TonePlacement = {
  index: number | null;
  source:
    | "v7-broad-exact"
    | "v7-broad-signature"
    | "mechanical"
    | "none";
};

export function stripVietnameseTone(text: string): string;
export function findTelexToneCarrier(text: string): TonePlacement;
export function applyTelexTone(text: string, tone: TelexTone): string;
export function convertTelexToken(raw: string, options?: TelexOptions): string;
export function convertTelex(input: string, options?: TelexOptions): string;
export class TelexComposer { /* ... */ }
```

Defaults:

```ts
{
  mode: "standard",
  freeShapeMarks: false,
}
```

All returned text is NFC-normalized.

---

## Core Telex keys

The adapter recognizes these keys case-insensitively while preserving the case of the letter being modified.

| Input | Effect |
|---|---|
| `s` | sắc / acute |
| `f` | huyền / grave |
| `r` | hỏi / hook above |
| `x` | ngã / tilde |
| `j` | nặng / dot below |
| `z` | tone zero: clear the active lexical tone |
| `aa` | `â` |
| `ee` | `ê` |
| `oo` | `ô` |
| `dd` | `đ` |
| `aw` | `ă` |
| `ow` | `ơ` |
| `uw` | `ư` |
| `uow` | `ươ` in the ordinary case |

`uwow` also produces `ươ`. There is one important UniKey-compatible exception: immediately after open `thuo`, `w` produces the intermediate `thuơ`, not `thươ`, so `thuowr` can produce `thuở`. That intermediate form is not sticky: if a valid consonant coda is subsequently appended, UniKey completes `uơ` (or `ưo`) to `ươ`. Therefore `thuowng` becomes `thương`. A second `w` can also horn the `u` directly: `thuoww` -> `thươ`.

Examples:

```text
tieengs      -> tiếng
Vieetj       -> Việt
dduwowngf    -> đường
dduowngf     -> đường
DDUOWNGF     -> ĐƯỜNG
thuowr       -> thuở
thuown       -> thươn
thuowng      -> thương
thuowngf     -> thường
thuowc       -> thươc
thuowcs      -> thước
thuwowng     -> thương
```

### Standard mode

Standard mode follows the classic Telex key set:

```text
w   -> ư when W is acting as the vowel itself
[   -> ư
]   -> ơ
```

Examples:

```text
w   -> ư
W   -> Ư
t[  -> tư
t]  -> tơ
```

A standalone `w` is converted only when the current active region does not already contain a vowel. If a previous vowel exists but `w` cannot legally modify it under the current options, `w` is kept literal instead of inventing another `ư` at the end of the word.

### Simple mode

`mode: "simple"` implements the modern simplified key set:

* `w` is only a modifier of a preceding `a`, `o`, or `u`;
* an otherwise standalone `w` stays `w`;
* `[` and `]` are not Telex shortcuts.

Examples:

```ts
convertTelexToken("w", { mode: "simple" }) === "w";
convertTelexToken("dduowngf", { mode: "simple" }) === "đường";
```

---

## Raw keystrokes are the source of truth

The implementation does not mutate already-rendered Unicode as its primary state model.

Conceptually:

```text
raw keys
   -> replay Telex commands
   -> toneless letter shapes + requested tone
   -> select current tone carrier
   -> render NFC text
```

This is important because a tone may move when later characters change the best analysis.

For example, an early tone key is not permanently attached to the character that happened to be visible at that moment:

```text
hofang -> hoàng
```

As the composition grows from `ho` to `hoa` to `hoan` to `hoang`, the tone carrier is recomputed.

`TelexComposer` exposes exactly this replay model. Backspace removes a raw keystroke, then reruns the composition.

---

## Tone replacement

A later, different tone key replaces the earlier tone while the same active region is being composed.

```text
toanf   -> toàn
toanfs  -> toán
```

No special “remove old tone first” operation is required.

`applyTelexTone()` likewise strips existing Vietnamese tone marks before applying the requested tone.

---

## Repeated-mark escape

Telex command letters are also ordinary Latin letters. To make mixed-language input possible, an immediately repeated non-zero tone/shape command restores the state that existed before that command and emits one literal copy of the repeated key. `z` is intentionally different because it is the zero-tone command; its behavior is specified separately below.

Examples:

```text
as       -> á
ass      -> as

a a      -> â
a a a    -> aa

aw       -> ă
aww      -> aw

guitar   -> guitả
guitarr  -> guitar
```

This same mechanism supports the classic mixed-language example:

```text
WWindowws -> Windows
```

The first `W` and the `w` after `o` are interpreted as Telex. Repeating each one restores it as a literal Latin `W`/`w`. The literal produced by a repeat escape is an explicit barrier: subsequent Telex commands do not reach backward across it.

### Repeated `w` with free shape marks

There is one deliberate exception to “second identical key means escape.”

If `freeShapeMarks` is enabled and another vowel can still receive a `w` transformation, the second `w` performs that second transformation instead of escaping.

This makes the classic end-of-word spelling possible:

```text
duongwwfd -> đường
```

The two `w` presses transform the two vowel targets one at a time. A further `w`, after there are no remaining targets, triggers repeat escape for the whole contiguous `w` command run.

---

## `z` behavior

`z` is the Telex **zero-tone command**. It removes the currently active lexical tone, and nothing else:

```text
toansz -> toan
aasz   -> â
```

It does **not** remove vowel quality and does not change `đ`:

```text
aaz -> âz
awz -> ăz
owz -> ơz
uwz -> ưz
ddz -> đz
```

Those examples end in literal `z` because there was no lexical tone for `z` to clear. This matches the way UniKey models Telex `z`: it is tone value zero, parallel to `s/f/r/x/j`, rather than a general "remove Vietnamese diacritics" operation.

A second `z` does **not** restore the tone that the first `z` cleared. After the first `z`, there is no tone, so the second `z` is ordinary literal input:

```text
aszz     -> az
toanszz  -> toanz
```

This is intentionally different from repeating a non-zero tone key such as `ss`, which is the usual repeated-mark escape.

---

## Tone placement: the important part

The Telex engine never asks “is this a valid Vietnamese syllable?” as a prerequisite for accepting a tone key.

Instead, `findTelexToneCarrier()` uses a four-stage policy.

### 1. Exact behavior derived from V7's broad syllable API

At first use, `telex.ts` calls `getValidVietnameseSyllables()` and derives:

```text
toneless surface form -> tone-bearing character index
```

For every generated toned surface form, it removes only the tone mark, preserving vowel quality:

```text
ấ -> â
ớ -> ơ
ự -> ư
```

The changed character identifies the carrier.

This is the preferred answer and is reported as:

```text
source = "v7-broad-exact"
```

Because this is generated from the existing V7 API, the Telex adapter automatically follows V7's existing spelling and tone-placement decisions. It does not duplicate the complete Vietnamese syllable grammar.

### 2. Unambiguous structural signatures learned from V7

Exact lookup necessarily fails on malformed or foreign-onset input.

The adapter therefore learns structural signatures from the same V7-generated forms. A signature records:

* special onset class (`qu`, `gi`, or other);
* vowel nucleus shape;
* exact coda where available;
* open-versus-closed status as a less-specific fallback.

Only signatures for which all generated examples agree on the carrier are retained.

This means patterns such as `ươ`, `iê`, `uô`, and many onset/coda-sensitive cases are learned from V7 rather than reimplemented as a second Vietnamese parser.

Successful use of such a signature is reported as:

```text
source = "v7-broad-signature"
```

### 3. Mechanical fallback for malformed input

If V7 has no exact form and no unambiguous learned signature, the adapter still permits a tone when a vowel nucleus can be found.

For the final active vowel run:

1. if one or more vowels already carry Vietnamese vowel-quality marks (`ă â ê ô ơ ư`), choose the rightmost such vowel;
2. otherwise choose the rightmost eligible vowel.

This is intentionally mechanical, not linguistic.

Example:

```text
uoes -> uoé
```

`uoe` is not required to be a valid Vietnamese syllable. The fallback still has a deterministic answer.

Such placement is reported as:

```text
source = "mechanical"
```

### 4. No vowel means no command

If there is no eligible vowel at all, a tone key is ordinary text.

For example, the initial `s` in `sa` is a consonant, not a tone command, because there is no vowel when it is pressed.

---

## Multiple vowel runs and foreign-looking words

A malformed token may contain several disconnected vowel runs:

```text
guita
indo
abcde
```

Exact V7 lookup still gets first priority. If there is no exact V7 form, fallback is local to the **last contiguous vowel run** rather than pretending the entire token is one Vietnamese syllable.

That behavior is important for repeat escape:

```text
guitar   -> guitả
guitarr  -> guitar
```

The first `r` acts on the final `a`; the second `r` says that the `r` was intended literally.

---

## `qu` and `gi`

The fallback analyzer has only two onset-specific rules, because they are necessary to avoid treating onset glides as ordinary nucleus vowels:

* in `quV...`, the `u` of `qu` is excluded when another vowel follows;
* in `giV...`, the `i` of `gi` is excluded when another vowel follows.

When no later vowel exists, the `u` or `i` remains eligible.

All valid cases still use V7's exact generated behavior first.

Examples:

```text
quys -> quý
tuys -> túy
gias -> giá
```

The distinction between `quy` and other `uy` spellings is learned/confirmed through the V7-derived oracle rather than flattened into one generic `uy` rule.

---

## `w` shape selection

With the default `freeShapeMarks: false`, `w` modifies the currently exposed vowel nucleus; it does not reach backward across a consonant coda.

Canonical direct forms therefore work:

```text
aw     -> ă
ow     -> ơ
uw     -> ư
uow    -> ươ
uwow   -> ươ
```

For ordinary `uo`, one `w` performs the combined `ươ` hook operation. The `u` of a `qu` onset is excluded, so `quow` does not turn `qu` into `qư`.

### The `th + uo + w` transition

Real UniKey Telex treats this as a **two-stage state transition**, not a permanent spelling exception. When `w` is pressed immediately after open `thuo`, it horns only the `o`:

```text
thuow  -> thuơ
thuowr -> thuở
```

That open intermediate is necessary because `thuở` is spelled with `uơ`, not `ươ`. Treating `thuo + w` immediately as `thươ` would make the usual `thuowr` path impossible.

However, when a following consonant turns the vowel sequence into a structurally admitted closed syllable, UniKey completes the partial hook pair:

```text
thuown    -> thươn
thuowng   -> thương
thuowngf  -> thường
thuowc    -> thươc
thuowcs   -> thước
```

Internally, UniKey's consonant-append path recognizes `uơ` or `ưo`, tests the corresponding `ươ + coda` form, and when that CVC is valid changes the remaining vowel to produce `ươ`. The adapter mirrors the observable two-stage behavior using V7's generated broad syllable set as the admission oracle. This is why `thuow` by itself remains `thuơ` while `thuowng` does **not** remain `thuơng`.

The adapter represents this as an explicit temporary state created only by the `thuo + w` transition. It does **not** scan arbitrary Unicode text and rewrite every literal `uơ` into `ươ` when a consonant follows. For example, direct precomposed input `uơng` stays `uơng`; the completion rule applies to the Telex composition history, not merely to the visible characters.

A second `w` can still complete the pair immediately, and the interleaved spelling remains available:

```text
thuoww    -> thươ
thuwow     -> thươ
thuwowng   -> thương
```

Other onsets continue to use ordinary `uo + w -> ươ` directly.

---

## Optional end-of-word shape marks

Set:

```ts
{ freeShapeMarks: true }
```

to permit shape commands after a coda.

The option supports delayed `w`, delayed `a/e/o`, and delayed initial `d` transformation. This is enough to support the classic fully delayed spelling:

```text
duongwwfd -> đường
```

The option is **off by default** because it greatly increases ambiguity in ordinary Latin text. For example, a trailing `d` may be interpreted as the delayed command that changes an initial `d` to `đ`.

When several delayed targets are possible, candidates that produce a known V7-generated toneless syllable are preferred. Otherwise the choice is deterministic, with a rightward preference for vowel targets.

---

## Tone style

There is intentionally no separate “old” versus “new” `òa/óa`, `ùy/úy`, etc. option in this adapter.

For a form represented by V7's broad generated syllables, **V7 is the source of truth**. The exact carrier and the learned signatures are derived from the current behavior of `assembleSyllable()` indirectly through `getValidVietnameseSyllables()`.

That means the Telex implementation does not silently introduce a second tone-placement standard beside the one the repository already uses.

---

## Token boundaries

`convertTelexToken()` assumes its argument is one active separator-free composition.

`convertTelex()` is a convenience wrapper for arbitrary text. Unicode letters are grouped into Telex tokens; non-letter separators are copied literally and terminate a token. In standard mode, `[` and `]` are included as Telex shortcut keys.

Examples:

```ts
convertTelex("tieengs Vieetj!") === "tiếng Việt!";
```

For a real OS/editor IME, the recommended integration is to maintain only the current active composition and commit on whitespace/punctuation/editor actions.

---

## `TelexComposer`

`TelexComposer` is intentionally replay-based.

```ts
const c = new TelexComposer();

c.push("t");
c.push("i");
c.push("e");
c.push("e");
c.push("n");
c.push("g");
c.push("s");

c.text; // "tiếng"
c.raw;  // "tieengs"

c.backspace();
c.text; // "tiêng"

const committed = c.commit();
// committed === "tiêng"
// composer is now empty
```

The public operations are:

* `push(key)` — append exactly one Unicode character;
* `backspace()` — remove one raw key;
* `replaceRaw(raw)` — replace the raw composition and replay;
* `clear()` — discard the composition;
* `commit()` — return the rendered text and clear the composition;
* `raw` — current raw keystrokes;
* `text` — current rendered text.

The replay cost is negligible for normal Vietnamese composition lengths and buys exact undo semantics.

---

## Behavioral vectors

These vectors are part of the contract.

### Default mode

| Raw | Result |
|---|---|
| `tieengs` | `tiếng` |
| `Vieetj` | `Việt` |
| `dduwowngf` | `đường` |
| `dduowngf` | `đường` |
| `thuowr` | `thuở` |
| `thuown` | `thươn` |
| `thuowng` | `thương` |
| `thuowngf` | `thường` |
| `thuowc` | `thươc` |
| `thuowcs` | `thước` |
| `thuoww` | `thươ` |
| `thuwowng` | `thương` |
| `hoangf` | `hoàng` according to the repository's carrier behavior |
| `hofang` | same final rendering as `hoangf` |
| `toanf` | `toàn` |
| `toanfs` | `toán` |
| `toanff` | `toanf` |
| `toansz` | `toan` |
| `toanszz` | `toanz` |
| `aasz` | `â` |
| `aaz` | `âz` |
| `ass` | `as` |
| `aww` | `aw` |
| `aaa` | `aa` |
| `ddd` | `dd` |
| `guitarr` | `guitar` |
| `WWindowws` | `Windows` |
| `uoes` | deterministic malformed form, mechanically toned on the selected fallback carrier |
| `w` | `ư` |
| `W` | `Ư` |
| `t[` | `tư` |
| `t]` | `tơ` |

### Simple mode

| Raw | Options | Result |
|---|---|---|
| `w` | `{ mode: "simple" }` | `w` |
| `dduowngf` | `{ mode: "simple" }` | `đường` |

### Free shape marks

| Raw | Options | Result |
|---|---|---|
| `duongwwfd` | `{ freeShapeMarks: true }` | `đường` |

---

## Invariants

The implementation should preserve these invariants:

1. Existing V7 source files are not modified.
2. The Telex module imports only the existing broad syllable API.
3. Valid/broad V7 forms use V7-derived tone placement before any fallback rule.
4. Invalid forms are not rejected merely because they are invalid Vietnamese.
5. Fallback behavior is deterministic.
6. A different tone key replaces the previous tone.
7. An immediately repeated non-zero tone/shape command can restore the literal Latin key; `z` instead follows zero-tone semantics.
8. Backspace in `TelexComposer` is defined over raw keys, not rendered Unicode characters.
9. Case of the modified base letter is preserved.
10. Output is NFC-normalized.

---

## Deliberate non-goals

This file is the language/input reducer only. It does not implement:

* Android `InputConnection` operations;
* macOS/Windows/Linux IME composition protocols;
* cursor movement inside an already committed token;
* editor selection handling;
* dictionary prediction or autocorrection;
* language detection;
* exact behavioral compatibility with every historical UniKey setting;
* a separate spelling validator.

Those concerns should wrap this module rather than be mixed into it.

---

## Background compatibility notes

The default key set, repeated-mark escape behavior, and optional end-of-word shape concept are aligned with the behavior documented in the classic UniKey manual. The `simple` mode corresponds to the simplified Telex behavior added as a built-in UniKey mode in 4.6 RC2.

The important architectural difference is intentional: tone placement is derived from this repository's own broad syllable generator first, and malformed input has an explicit deterministic fallback rather than being rejected.
