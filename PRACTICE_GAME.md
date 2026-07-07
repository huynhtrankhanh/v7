## V7 Practice Game — Player Documentation (English)

This is a **60‑second speed game** to practice typing **Vietnamese syllables using “chords”** (pressing multiple keys at the same time, like stenography).

You will see a **Vietnamese syllable** on the screen (example: `cá`, `quy`, `ngọt`). Your job is to press the **correct chord** on a physical keyboard. If correct, you gain **+1 point** and the game shows a new syllable. If wrong, you must try again (the syllable does not change).

---

# 2026-07-07 deployed HTML update

`static/practice.html` now matches the HTML from `https://sweet-sawine-8b8276.netlify.app`.

This is a departure from the previous local HTML in a few visible ways:

- The page now uses a dark Monkeytype-style theme with monospace text, compact controls, and a wider responsive layout instead of the old light card-based layout.
- The prompt area now shows a queue of upcoming targets in a wrapping word wall. The active target is highlighted, and Mixed mode labels one-syllable vs two-syllable units inline.
- Daily diligence is now tracked in localStorage with a completed-games count for the current local date. The count appears in the top chip and stats row.
- The leaderboard is now displayed as a compact `top:` summary line instead of an ordered list card.
- Mode labels and status text are lower-case and shorter, matching the new visual style.
- Emily help remains available only in Emily mode, but the dialog now follows the dark theme and uses the same compact table data.

The core gameplay contract is unchanged: rounds are still 60 seconds, scores and bests are stored locally per mode, input still comes from physical-keyboard chords, and wrong chords still do not advance the prompt.

---

# 1) What you need

1. **A computer + a physical keyboard**  
   The game has **no on‑screen keyboard**. Phones/tablets only work if you connect an external keyboard.

2. **A browser** (Chrome / Edge / Firefox).

3. **Keyboard layout**  
   The game uses the **`;` (semicolon) key** and expects a standard layout where `;` is a single key (common on US/ANSI layouts).

---

# 2) What you see on the screen

- **Mode**: choose what kind of chord you must type.
- **Start 60s Game**: starts a 60‑second round.
- **Time**: seconds remaining.
- **Score**: correct answers in the current round.
- **Best**: best score saved for that mode (on this browser/device).
- **Today**: completed games recorded for the current local date.
- **Leaderboard**: top scores saved locally for the selected mode, shown as a compact `top:` line.

The main practice area shows:
- A mode label like **“left hand”**, **“full syllable”**, **“mixed · 2 syllables unit”**, or **“emily symbols”**
- The current target plus upcoming targets in a word wall
- A status message: **correct** / **wrong chord**

---

# 3) How input works (VERY IMPORTANT)

This game reads **chords**, not normal typing.

### A “chord” is submitted when:
- You press one or more keys,
- keep them held together (they can overlap),
- and then **release all keys** (when the last held key is released).

### Tips
- Don’t type letters one-by-one.
- Press the whole chord together, then release.
- If you accidentally release all keys in the middle, the game will treat it as a completed chord.

---

# 4) The keyboard → game-symbol mapping

The game converts your QWERTY keys into internal “steno symbols”.

### Main keys used

| Physical key | Game symbol |
|---|---|
| `q` | `#` |
| `a` | `S` |
| `w` | `T` |
| `s` | `K` |
| `e` | `P` |
| `d` | `W` |
| `r` | `H` |
| `f` | `R` |
| `c` | `A` |
| `v` | `O` |
| `n` | `E` |
| `m` | `U` |
| `u` | `F` |
| `j` | `RR` |
| `i` | `PP` |
| `k` | `B` |
| `o` | `L` |
| `l` | `G` |
| `p` | `TT` |
| `;` | `SS` |
| `Space` | `*` |

### Special mirrored keys
These pairs produce the same symbol:

| Physical key | Game symbol |
|---|---|
| `t` **or** `g` | `D` |
| `y` **or** `h` | `Z` |

---

# 5) Game modes (what they mean)

There are 6 modes:

1. **Partial syllable, left hand**  
   You only type the **left-hand half** of the chord (+ vowel key + tone key) and **must include Space (`*`)**.

2. **Partial syllable, right hand**  
   Same idea, but you only type the **right-hand half** (+ vowel key + tone key) and **must include Space (`*`)**.

3. **Partial syllable, random hand**  
   Each prompt tells you **Left hand** or **Right hand** randomly.

4. **Full syllable**  
   You type the **full steno-style stroke** that produces the exact syllable. (This is the hardest; start with Partial modes first.)

5. **Mixed**  
   Prompts can be one full syllable or two syllables in one unit. The page marks the active unit size.

6. **Emily symbols**  
   Prompts are symbols from the Emily table. Use the Emily help button in this mode to view the starter, pattern keys, variants, and symbol table.

**Important:** In partial modes, the chord must match **exactly**. Extra keys = wrong.

---

# 6) How to play Partial modes (recommended starting point)

In Partial modes you must build a chord from:

1) **Initial consonant group** (from the start of the syllable)  
2) **Vowel group** (one of a/e/i/o/u groups)  
3) **Tone** (ngang/sắc/huyền/hỏi/ngã/nặng + special checked tones)  
4) **Spacebar `*` must be held** in the chord

When you release all keys, the game checks if your set of keys equals the expected set.

---

## 6.1) Step A — Identify the initial consonant group

Look at the beginning of the displayed syllable.

Use these rules:

- Starts with a vowel (a/e/i/o/u/y…) → consonant group **`0`** (none)
- `đ…` → consonant group **đ**
- `ch…` → **ch**
- `ngh…` or `ng…` → **ng**
- `nh…` → **nh**
- `ph…` → **ph**
- `th…` → **th**
- `tr…` → **tr**
- `kh…` → **kh**
- `qu…` → consonant group **qu** (special group)
- `gi…` **or** Vietnamese “g” used like `gì, gìn, giếng…` → consonant group **gi** (special group)
- `gh…` → consonant group **g**
- `c…` or `k…` → consonant group **c/k** (the same group in this game)
- Otherwise: `b, d, g, h, l, m, n, p, r, s, t, v, x` map to themselves.

---

## 6.2) Step B — Identify the vowel group (a / e / i / o / u)

You do **not** need the final consonant for partial modes. Only decide which vowel family the syllable belongs to:

### Vowel group **a**
If the main vowel is based on: `a, ă, â` (examples: `ba, băng, bậc, ngoái`)

### Vowel group **e**
If it’s based on: `e, ê` (examples: `me, mến, nghẹt`)

### Vowel group **i**
If it’s based on: `i, y, iê/ia, yê/ya, uy…` (examples: `mi, lý, tiên, quy`)

### Vowel group **o**
If it’s based on: `o, ô, ơ` (examples: `no, nốt, ngờ`)

### Vowel group **u**
If it’s based on: `u, ư, ua/uô, ưa/ươ…` (examples: `mu, nữ, mua, uốn, ước`)

If you’re unsure, start by guessing based on the most “obvious” vowel letter (you’ll learn quickly by feedback).

---

## 6.3) Step C — Identify the tone (and the special stop-final rule)

There are 8 tone codes internally, but you can think of them like this:

### Normal tones (most syllables)
- **Ngang** (no mark)  
- **Sắc** (´)
- **Huyền** (`)  
- **Hỏi** (̉)  
- **Ngã** (̃)  
- **Nặng** (.)  

### Special rule: syllables ending in **c / p / t / ch**
Vietnamese “checked tones” are handled specially:

- If the syllable ends with **c/p/t/ch** and has **sắc (´)** → use **“sắc-stop”**
- If it ends with **c/p/t/ch** and has **nặng (.)** → use **“nặng-stop”**

(Example: `ác, áp, át, ách` use the special sắc-stop; `ạc, ạp, ạt, ạch` use the special nặng-stop.)

---

## 6.4) Step D — Press the correct keys (left or right)

### 1) Vowel keys in Partial modes

**Left-hand vowel keys**
- vowel **a** → `A` → press **`c`**
- vowel **o** → `O` → press **`v`**
- vowel **i** → `A + O` → press **`c` + `v`**
- vowel **u** → `D` → press **`t` OR `g`**

**Right-hand vowel keys**
- vowel **a** → `U` → press **`m`**
- vowel **o** → `E` → press **`n`**
- vowel **i** → `U + E` → press **`m` + `n`**
- vowel **u** → `Z` → press **`y` OR `h`**

---

### 2) Tone keys in Partial modes

#### Left-hand tone keys
| Tone | Keys (symbols) | Physical keys |
|---|---|---|
| ngang (no mark) | *(none)* | *(none)* |
| sắc (´) | `K` | `s` |
| huyền (`) | `W` | `d` |
| hỏi (̉) | `R` | `f` |
| ngã (̃) | `K+W` | `s+d` |
| nặng (.) | `W+R` | `d+f` |
| **sắc + (c/p/t/ch)** | `K+R` | `s+f` |
| **nặng + (c/p/t/ch)** | `K+W+R` | `s+d+f` |

#### Right-hand tone keys
| Tone | Keys (symbols) | Physical keys |
|---|---|---|
| ngang (no mark) | *(none)* | *(none)* |
| sắc (´) | `G` | `l` |
| huyền (`) | `B` | `k` |
| hỏi (̉) | `RR` | `j` |
| ngã (̃) | `G+B` | `l+k` |
| nặng (.) | `B+RR` | `k+j` |
| **sắc + (c/p/t/ch)** | `G+RR` | `l+j` |
| **nặng + (c/p/t/ch)** | `G+B+RR` | `l+k+j` |

---

### 3) Consonant keys (Partial modes)

You add consonant keys depending on whether you’re doing **Left hand** or **Right hand**.

#### Left-hand consonant chords
(Shown as **symbols**; you press the physical keys from section 4.)

| Consonant group | Left symbols |
|---|---|
| 0 (no initial) | *(none)* |
| b | `# S P` |
| ch | `S T H` |
| d | `# T P H` |
| đ | `# S T` |
| g | `# S T P` |
| h | `H` |
| c/k | `# T` |
| kh | `# S T H` |
| l | `# S H` |
| m | `P H` |
| n | `T P H` |
| ng | `# T P` |
| nh | `# S T P H` |
| p | `P` |
| ph | `T P` |
| r | `# H` |
| s | `S T P` |
| t | `T` |
| th | `T H` |
| tr | `# T H` |
| v | `# P` |
| qu | `# S` |
| x | `# P H` |
| gi | `S T P H` |

#### Right-hand consonant chords

| Consonant group | Right symbols |
|---|---|
| 0 (no initial) | *(none)* |
| b | `TT SS PP` |
| ch | `SS L F` |
| d | `TT L PP F` |
| đ | `TT SS L` |
| g | `TT SS L PP` |
| h | `F` |
| c/k | `TT L` |
| kh | `TT SS L F` |
| l | `TT SS F` |
| m | `PP F` |
| n | `L PP F` |
| ng | `TT L PP` |
| nh | `TT SS L PP F` |
| p | `PP` |
| ph | `L PP` |
| r | `TT F` |
| s | `SS L PP` |
| t | `L` |
| th | `L F` |
| tr | `TT L F` |
| v | `TT PP` |
| qu | `TT SS` |
| x | `TT PP F` |
| gi | `SS L PP F` |

---

## 6.5) Spacebar requirement in Partial modes

In **all Partial modes**, your chord **must include**:

- `*` (spacebar)

So every valid answer is:

> consonant keys + vowel keys + tone keys + **Space**

If you forget Space, it will be wrong.

---

# 7) Worked examples (Partial modes)

## Example 1: Target syllable = **“ba”** (ngang)
- Initial consonant: **b**
- Vowel group: **a**
- Tone: ngang (none)

### Partial-left expected
- b → `# S P` → press `q + a + e`
- vowel a → `A` → press `c`
- tone ngang → none
- plus Space `*`

Chord to press together:
- **`q a e c Space`**

### Partial-right expected
- b → `TT SS PP` → press `p + ; + i`
- vowel a → `U` → press `m`
- tone ngang → none
- plus Space

Chord:
- **`p ; i m Space`**

---

## Example 2: Target syllable = **“cá”**
- Initial: written `c…` → consonant group **c/k**
- Vowel group: **a**
- Tone: **sắc (´)**, not ending with c/p/t/ch → normal sắc

### Partial-left
- c/k → `# T` → `q + w`
- vowel a → `A` → `c`
- sắc → `K` → `s`
- Space

Chord:
- **`q w c s Space`**

---

## Example 3: Target syllable = **“ạch”**
- Starts with vowel? It starts with `a…` → consonant group **0**
- Ends with **ch** and has **nặng** (dot) → **nặng-stop**
- Vowel group: this is based on **a** → vowel group **a**

### Partial-left
- consonant none
- vowel a → `A` → `c`
- nặng-stop → `K+W+R` → `s+d+f`
- Space

Chord:
- **`c s d f Space`**

---

# 8) Full syllable mode (advanced)

In **Full syllable** mode, the game decodes your chord into an actual syllable using a full Vietnamese-steno system.

### Key differences from Partial modes
- Spacebar is **not required** (pressing Space usually won’t hurt, but Space alone is ignored).
- You must type a **complete stroke** (initial + vowel + optional final + tone).
- Extra keys will usually produce the wrong syllable.

Because Full mode is complex, most players should start with Partial modes first.

If you still want Full mode, here is the minimum you need:

---

## 8.1) Full mode: initial consonant strokes

These are the **steno letter combos** and the **physical keys** you press:

(Recall: `T=w`, `K=s`, `P=e`, `W=d`, `H=r`, `R=f`)

| Initial | Steno keys | Physical keys |
|---|---|---|
| b | `PW` | `e + d` |
| c | `K` | `s` |
| ch | `KH` | `s + r` |
| d | `KWR` | `s + d + f` |
| đ | `TK` | `w + s` |
| ph | `TP` | `w + e` |
| g | `TKPW` | `w + s + e + d` |
| h | `H` | `r` |
| gi | `KWH` | `s + d + r` |
| kh | `KHR` | `s + r + f` |
| l | `HR` | `r + f` |
| m | `PH` | `e + r` |
| n | `TPH` | `w + e + r` |
| nh | `TPR` | `w + e + f` |
| ng/ngh | `TPW` | `w + e + d` |
| p | `P` | `e` |
| r | `R` | `f` |
| s | `KP` | `s + e` |
| t | `T` | `w` |
| th | `TH` | `w + r` |
| tr | `TR` | `w + f` |
| v | `W` | `d` |
| x | `WR` | `d + f` |

Capitalization: if the target starts with an uppercase letter, add `#` = press **`q`**.

---

## 8.2) Full mode: vowel strokes

Vowels use the middle keys:
- `A=c`, `O=v`, `E=n`, `U=m`

| Vowel sound | Steno | Physical keys |
|---|---|---|
| a | `A` | `c` |
| ă | `AE` | `c + n` |
| â | `AO` | `c + v` |
| e | `E` | `n` |
| ê | `AU` | `c + m` |
| i | `EU` | `n + m` |
| y | `AOEU` | `c + v + n + m` |
| o | `O` | `v` |
| ô | `OE` | `v + n` |
| ơ | `OU` | `v + m` |
| u | `U` | `m` |
| ư | `AOU` | `c + v + m` |
| iê/ia | `OEU` | `v + n + m` |
| ua/uô | `AEU` | `c + n + m` |
| ưa/ươ | `AOE` | `c + v + n` |

There is also an extra **“on-glide”** key `S` = physical **`a`** that changes some spellings (used for glide cases like `uy…`, some `oa/oe…` patterns). If Full mode feels inconsistent at first, that’s usually why—start with Partial modes.

---

## 8.3) Full mode: finals (ending consonants)

Final keys use:
- `F = u`
- `RR = j` (counts as “R” inside the system)
- `PP = i` (counts as “P” inside the system)

| Final | Steno | Physical keys |
|---|---|---|
| (none) | *(none)* | *(none)* |
| -m | `P` | `i` |
| -n | `R` | `j` |
| -ng | `FR` | `u + j` |
| -nh | `RP` | `j + i` |
| (special glide final) | `F` | `u` |
| (special glide final) | `FP` | `u + i` |

Stop finals `-c/-p/-t/-ch` are handled via special tone keys (below).

---

## 8.4) Full mode: tones

Tone keys are:
- `L = o`
- `G = l`
- `B = k`

| Tone | Steno | Physical keys |
|---|---|---|
| ngang | *(none)* | *(none)* |
| sắc | `L` | `o` |
| huyền | `G` | `l` |
| hỏi | `B` | `k` |
| ngã | `LG` | `o + l` |
| nặng | `BG` | `k + l` |

### If the syllable ends with c/p/t/ch:
- sắc + stop-final → `BL` → `k + o`
- nặng + stop-final → `BLG` → `k + o + l`

And you still press the appropriate base final:
- p uses final `P` (press `i`)
- t uses final `R` (press `j`)
- c uses final `FR` (press `u+j`)
- ch uses final `RP` (press `j+i`)

---

# 9) Troubleshooting

### “Nothing happens when I type”
- Click on an empty area of the page (so the browser is focused).
- Don’t type while a dropdown/select button has focus.

### “It always says Wrong chord”
Common causes in Partial modes:
- You forgot **Spacebar**.
- You pressed **extra keys** (Partial modes require an exact match).
- You used the wrong hand (check the label: Left/Right).
- You misclassified the vowel group (a/e/i/o/u) or tone.

### “Some keys don’t match my keyboard”
- The `;` key must exist and produce the same physical key the browser reports as `;`.
- If using a non-US layout, the physical position may differ.

---

# 10) Recommended learning path

1) Start with **Partial syllable, left hand** until you can score consistently.  
2) Then **Partial syllable, right hand**.  
3) Then **Partial random**.  
4) Try **Full syllable** only after you’re comfortable.
