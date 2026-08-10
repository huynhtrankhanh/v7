# Bug report / feature specification: two-syllable V7 dictionary mode

**Repository:** `huynhtrankhanh/v7`  
**Baseline reviewed:** `main` at `c15c84e90ef2b601c6ef0b10925c48e0f9830b2d`  
**Type:** feature gap / input-language extension  
**Scope:** WebUI, inference engine, Android IME integration, trainer, evaluator, tests, documentation  
**Status:** specification ready for implementation

## Summary

V7 needs a distinct **dictionary mode** for two-syllable chords.

Dictionary mode does **not** mean that a stroke uniquely identifies one output word. A dictionary-mode stroke identifies the same two-syllable V7 phonological code as its ordinary counterpart while adding one bit of user intent:

> Treat this pair as a lexical two-syllable dictionary unit, then use the language model to disambiguate among dictionary entries compatible with that code.

Ordinary two-syllable V7 remains compositional. Dictionary mode restricts candidate generation to a dedicated two-syllable lexical dictionary. The language model still ranks the remaining candidates using context.

The input encoding must use only the standard steno keys:

`#STKPWHRAO*EUFRPBLGTSDZ`

The chosen encoding is a symmetric, reversible **D/Z-polarity transform** of an ordinary canonical two-syllable V7 chord, with one small symmetric starless corner for the four `(e|u) × (e|u)` vowel pairs. It preserves consonants and tones exactly, changes only the central vowel/discriminator region, and gives a one-to-one correspondence between all canonical two-syllable V7 chords and all dictionary-mode chords.

The feature is not only a stroke decoder change. It interacts with current permissive D/Z aliases, `handleChord` priority, candidate selection, piecemeal correction, undo, capitalization, the inference request format, the Rust beam search, Stripped Plover ownership, Android preedit, raw-outline mode, trainer telemetry, evaluator assumptions, and documentation. Those interactions are specified below.

---

## 1. Why dictionary mode exists

Current two-syllable V7 communicates a pair of structured syllable templates. The inference engine expands each syllable independently and lets the LM rank combinations. This is appropriate for **compositional** input.

Dictionary mode communicates a different latent variable:

- ordinary mode: `COMPOSITIONAL(pair-code)`
- dictionary mode: `LEXICAL(pair-code)`

The dictionary mode bit is useful even though ambiguity remains. It removes compositional alternatives and restricts inference to lexical entries in a closed two-syllable dictionary bucket. The LM still resolves ambiguity within that bucket.

This means the input transform must **not** attempt to encode word identity. It only needs to encode the mode bit while retaining the underlying two-syllable V7 code exactly.

### Non-goal

Dictionary mode is not a replacement for the LM and is not intended to produce exact deterministic text directly from the stroke.

---

## 2. Design requirements

The dictionary-mode stroke system must satisfy all of the following.

### 2.1 Similarity

A dictionary stroke should be as close as possible to its ordinary two-syllable V7 counterpart. Consonant and tone fingering must remain unchanged.

### 2.2 Symmetry

No syllable should be privileged. Mirroring left and right should mirror the dictionary transform:

- `D ↔ Z`
- `O ↔ E`
- `A ↔ U`
- `* ↔ *`

### 2.3 Noncollision

When Stripped Plover is not persistently enabled, a dictionary-mode stroke must belong to a reserved V7 namespace and must not be interpreted as:

- ordinary two-syllable V7,
- ordinary single-syllable V7,
- Emily symbols,
- candidate selection or candidate+syllable composition,
- punctuation,
- spacing,
- piecemeal entry,
- control commands,
- one-shot Plover fallback.

Persistent Stripped Plover is the intentional ownership exception and continues to win before V7 handling.

### 2.4 Dictionary semantics

The stroke identifies a **dictionary bucket**, not a unique word. The bucket may contain multiple lexical entries. LM/context chooses among them.

### 2.5 One-to-one correspondence

Every canonical ordinary two-syllable V7 stroke must have exactly one dictionary-mode conjugate, and every dictionary-mode conjugate must recover exactly one canonical ordinary stroke.

### 2.6 Standard steno alphabet only

No physical key outside `#STKPWHRAO*EUFRPBLGTSDZ` may be introduced.

### 2.7 Low memorization

The transform must be a universal rule, not a per-word assignment table.

---

## 3. Existing two-syllable V7 encoding

The current decoder in `src/main.ts` requires one `*` and divides the stroke around it.

The left syllable uses:

- consonant bits: `# S T P H`
- tone bits: `K W R`
- coarse vowel bits: `A O`
- suffix `D` as the `e/u` discriminator only when neither `A` nor `O` is present

The right syllable uses:

- coarse vowel bits: `U E`
- consonant bits: `T S L P F`
- tone bits: `G B R`
- suffix `Z` as the `e/u` discriminator only when neither `U` nor `E` is present

The canonical coarse vowel states are therefore:

### Left

| Vowel class | A | O | D |
|---|---:|---:|---:|
| e | 0 | 0 | 0 |
| u | 0 | 0 | 1 |
| a | 1 | 0 | 0 |
| o | 0 | 1 | 0 |
| i | 1 | 1 | 0 |

### Right

| Vowel class | U | E | Z |
|---|---:|---:|---:|
| e | 0 | 0 | 0 |
| u | 0 | 0 | 1 |
| a | 1 | 0 | 0 |
| o | 0 | 1 | 0 |
| i | 1 | 1 | 0 |

The current decoder is more permissive than this canonical table: `D` is ignored when `A/O` already select the left vowel, and `Z` is ignored when `U/E` already select the right vowel. Dictionary mode deliberately reclaims those redundant aliases.

---

## 4. Dictionary-mode chord transform

Let `C` be a **canonical** ordinary two-syllable V7 stroke.

Define `L(C)` as follows.

### 4.1 Normal rule: toggle D and Z

If at least one of the two vowel classes is outside `{e, u}`, keep `*` and toggle the presence of both `D` and `Z`.

Everything else is unchanged.

Formally:

- if `D` is absent, add it;
- if `D` is present, remove it;
- if `Z` is absent, add it;
- if `Z` is present, remove it;
- preserve all other keys exactly.

This is the rule for 21 of the 25 coarse vowel-pair classes.

### 4.2 Symmetric starless corner

When **both** vowel classes are in `{e,u}`, merely toggling D/Z would land on another valid ordinary V7 vowel pair. Those four cases use a reserved starless encoding.

Only the middle/discriminator region changes; consonants and tones remain unchanged.

| Canonical ordinary center | Meaning | Dictionary center |
|---|---|---|
| `*` | e + e | `DZ` |
| `*Z` | e + u | `EDZ` |
| `*D` | u + e | `ODZ` |
| `*DZ` | u + u | `OEDZ` |

Interpretation:

- `DZ` is the fixed dictionary frame;
- `O` means “left source vowel was u”;
- `E` means “right source vowel was u”;
- `*` is omitted in this corner.

This is left/right symmetric: `O ↔ E`, `D ↔ Z`.

### 4.3 Stroke-distance properties

Across all coarse vowel pairs:

- 21/25 = 84% require exactly **2 key-state changes**;
- 4/25 = 16% require exactly **3 key-state changes**;
- no case requires 4 or more changes;
- consonant and tone keys never change.

### 4.4 Capacity and bijection

Each syllable has:

- 25 valid onset codes,
- 8 tone patterns,
- 5 coarse vowel classes,

for `25 × 8 × 5 = 1000` structured syllable codes.

A two-syllable chord therefore has `1000 × 1000 = 1,000,000` canonical source states.

Exhaustive enumeration of the transform gives:

- source canonical two-syllable strokes: **1,000,000**
- transformed dictionary strokes: **1,000,000**
- unique transformed strokes: **1,000,000**

The mapping is one-to-one.

---

## 5. Inverse dictionary transform

Runtime classification should be defined by an inverse transform followed by canonical V7 validation. This avoids maintaining a giant table of dictionary strokes.

### 5.1 Starred dictionary form

For a stroke containing exactly one `*`:

1. Parse the standard steno stroke into key presence.
2. Require that it is not itself a canonical two-syllable V7 stroke.
3. Require dictionary evidence in the reclaimed alias space: at least one of:
   - `D` together with left `A` or `O`, or
   - `Z` together with right `E` or `U`.
4. Toggle D and Z.
5. Serialize the result canonically.
6. Run the canonical ordinary two-syllable decoder on the result.
7. If canonical decode succeeds, this is dictionary mode and the decoded source V7 code is the semantic payload.

The implementation should use exact key sets rather than string surgery because suffix order and hyphen insertion are serialization concerns.

### 5.2 Starless corner form

For a stroke with no `*`:

1. Parse it into standard steno key presence.
2. Require both `D` and `Z`.
3. Require no `A` and no `U` in the reserved center; only optional `O` and `E` are permitted as the corner flags.
4. Remove `D`, `Z`, `O`, and `E` from the dictionary center.
5. Add `*`.
6. If original dictionary form contained `O`, add source `D`.
7. If original dictionary form contained `E`, add source `Z`.
8. Preserve all consonant and tone keys.
9. Canonically serialize and decode the recovered ordinary stroke.
10. Accept dictionary mode only if canonical decoding succeeds.

Because a starless stroke with no middle keys serializes with a hyphen before the first right-hand key, this logic must operate on parsed key sets rather than assuming a particular textual hyphen position.

### 5.3 Required API

Move two-syllable V7 parsing out of `src/main.ts` into a testable module, e.g. `src/twoSyllableV7.ts`, with APIs conceptually equivalent to:

```ts
export type TwoSyllableStrokeDecode = {
  v7Code: string;
  canonicalStroke: string;
};

export function decodeCanonicalTwoSyllableStroke(
  stroke: string,
): TwoSyllableStrokeDecode | null;

export function dictionaryStrokeForCanonicalStroke(
  stroke: string,
): string | null;

export function decodeDictionaryModeStroke(
  stroke: string,
): TwoSyllableStrokeDecode | null;
```

`dictionaryStrokeForCanonicalStroke` should reject a noncanonical source rather than normalizing arbitrary aliases.

---

## 6. Canonicalize ordinary two-syllable V7

This is mandatory for hard noncollision.

Current code accepts redundant aliases such as left `A+D`, `O+D`, `AO+D` and the symmetric right cases because D/Z are ignored once the main vowel bits are nonzero.

The canonical ordinary decoder must reject:

```ts
if (hasD && (hasA || hasO)) return null;
if (hasZ && (hasE || hasU)) return null;
```

This removes no canonical V7 stroke. It only stops accepting redundant spellings that dictionary mode now owns.

### Compatibility impact

This is a deliberate input-language migration. Users who happened to type a redundant D/Z alias will now invoke dictionary mode rather than get the same ordinary V7 interpretation.

Documentation and release notes must call this out explicitly.

### Why dispatch priority alone is insufficient

A research-time exhaustive enumeration found that under the current permissive decoder **840,000 of the 1,000,000** transformed dictionary strokes are also accepted as ordinary two-syllable V7 aliases. Merely placing dictionary handling before ordinary V7 would make behavior work by priority but would not establish a true disjoint namespace. Canonicalization reduces that overlap to zero.

---

## 7. Collision results

Exhaustive enumeration over the complete canonical two-syllable V7 source space was used to validate the proposed namespace.

After canonical D/Z rejection:

- dictionary mode vs canonical ordinary two-syllable V7: **0 collisions**
- dictionary mode vs Emily-symbol grammar: **0 collisions**
- dictionary mode vs ordinary single-syllable parser: **0 collisions**
- dictionary mode vs current punctuation/system exact strokes: **0 collisions**
- dictionary mode vs a conservative model of current candidate-selection suffix composition: **0 collisions**

These results must be converted into permanent exhaustive unit tests rather than remaining a one-off research result.

---

## 8. `handleChord` dispatch interaction

Current `handleChord` has several modes that intentionally preempt normal V7. Dictionary mode must be inserted without breaking those ownership rules.

The required order is:

1. Android raw-outline mode
2. Android `#S` “choose another IME” command
3. exact `#` persistent Stripped Plover toggle
4. persistent Stripped Plover ownership when enabled
5. desktop/WebUI `#S` raw-text escape
6. exact standalone `*` undo
7. active piecemeal-mode control/replacement handling
8. **dictionary-mode two-syllable decoder**
9. canonical ordinary two-syllable V7 decoder
10. Emily symbols
11. candidate selection + syllable/punctuation composition
12. `S-P` explicit space
13. punctuation
14. ordinary single-syllable V7
15. first-candidate append shortcut
16. lone candidate selection
17. one-shot Plover fallback
18. ignored stroke

### Dictionary miss ownership

Once `decodeDictionaryModeStroke()` succeeds structurally, the stroke is owned by dictionary mode even if its lexical dictionary bucket is empty.

It must **not** fall through to ordinary V7, Emily, candidate handling, or one-shot Plover.

This makes the user’s mode assertion reliable.

### Persistent Plover exception

When persistent Stripped Plover is enabled, its current early ownership remains unchanged. Dictionary-shaped strokes are sent to Plover, because persistent Plover is explicitly allowed to overlap the V7 namespace.

---

## 9. Candidate-selection interaction

Current candidate selection uses:

- `-T` → candidate 1
- `-TS` → candidate 2
- `-S` → candidate 3
- `-D` → candidate 4
- `-Z` → candidate 5

It also supports a combined “select candidate + type a syllable” stroke by stripping one of those right-hand suffixes and decoding the remainder as a syllable.

Because dictionary mode itself uses D/Z, classification must happen **before** candidate-selection interpretation. Otherwise future grammar changes could accidentally reinterpret a reserved lexical stroke.

The current exhaustive collision check found no valid dictionary target that becomes an accepted candidate+single-syllable composition, but dispatch must still reserve dictionary mode first as an invariant.

After dictionary inference returns candidates, the existing candidate-selection strokes remain valid. Selecting one commits the chosen candidate just as it does for compositional inference.

---

## 10. Piecemeal correction interaction

This is a nontrivial interaction.

Current piecemeal editing can target individual syllables inside an `isV7` island. For a two-syllable V7 island, replacing one syllable splits the island:

- the replacement becomes fixed Vietnamese text;
- any unreplaced V7 fragment remains an `isV7` island.

If dictionary mode is represented as metadata on the island and `splitV7IslandForReplacement()` blindly copies `{...island}`, a one-syllable remainder could incorrectly retain a **two-syllable dictionary-mode** flag.

### Required policy

Dictionary mode is a property of the unresolved **pair**, not of individual residual syllables.

Therefore:

> The first piecemeal replacement that splits a dictionary-mode island demotes all residual V7 fragments from dictionary mode to ordinary compositional V7.

Concretely, when splitting a dictionary island:

- fixed replacement: ordinary fixed Vietnamese island;
- `before` residual V7 fragment: `v7Mode: "compositional"`;
- `after` residual V7 fragment: `v7Mode: "compositional"`;
- rerun normal inference.

This preserves current piecemeal semantics and avoids inventing one-syllable dictionary mode.

### Entering piecemeal mode

The existing piecemeal entry strokes should continue to work on inferred dictionary output exactly as they do on compositional output. No new piecemeal command is needed.

### Dictionary chord while already in piecemeal mode

Current active piecemeal replacement accepts only a valid single-syllable stroke. A dictionary-mode chord is not a valid single-syllable replacement, so active piecemeal mode will be exited and normal dispatch continues. The dictionary decoder should remain after the piecemeal block so this behavior remains natural: a dictionary chord typed while piecemeal is active starts a new dictionary pair after leaving piecemeal mode.

---

## 11. Undo interaction

Standalone `*` must remain undo.

This does not conflict with dictionary mode:

- normal dictionary strokes containing `*` also contain other keys, so they are not equal to exact `*`;
- the four starless corner forms contain D/Z and are likewise distinct.

`TextBuffer` history snapshots copy full `Island` objects, so a new dictionary-mode metadata field will be preserved automatically by undo/redo-style history restoration as long as it is stored on the island.

Undoing a dictionary-mode entry must restore the prior candidates, piecemeal state, and buffer in the same way as current V7 entry undo.

---

## 12. Capitalization and Caps Lock

Dictionary-mode entry must use the exact same capitalization path as current two-syllable V7:

- if Caps Lock is active, set the island’s uppercase metadata;
- otherwise consume pending capitalization and set the island’s capitalize metadata;
- do not capitalize the internal V7 code itself;
- candidate rendering applies capitalization to the inferred lexical output.

Emily capitalization and literal uppercase behavior must not be changed.

---

## 13. Text-buffer representation

Current `Island` has `isV7?: boolean` but no mode metadata. The mode must survive rendering, inference, undo, candidate correction, and Android preedit.

Add:

```ts
export type V7Mode = "compositional" | "dictionary";

export interface Island {
  // existing fields...
  isV7?: boolean;
  v7Mode?: V7Mode;
}
```

Rules:

- non-V7 islands do not set `v7Mode`;
- ordinary V7 defaults to `"compositional"`;
- dictionary-mode pair sets `isV7: true, v7Mode: "dictionary"`;
- code paths should treat absent `v7Mode` on old/current V7 islands as compositional for backward compatibility.

Do not introduce a separate island type solely for dictionary mode; existing spacing, rendering, candidate diff, piecemeal targeting, and Android preedit all already key off `isV7` and should continue to recognize the entry as V7.

---

## 14. Inference protocol must carry mode

This is another mandatory architecture change.

Current `convertIslandsForInference()` emits a plain alternating `string[]`:

- fixed text at even positions,
- raw V7 code at odd positions.

That representation cannot express whether a V7 code is compositional or dictionary mode. Encoding the mode in a magic prefix/suffix inside the V7 code would contaminate the parser and create accidental compatibility hazards.

### Required typed protocol

Introduce a versioned typed request, for example:

```json
{
  "version": 2,
  "islands": [
    { "kind": "fixed", "text": "hôm nay " },
    {
      "kind": "v7",
      "code": "tro2dde7",
      "mode": "dictionary"
    },
    { "kind": "fixed", "text": "." }
  ]
}
```

Allowed V7 modes:

```text
compositional
dictionary
```

The response can remain:

```json
{
  "candidates": [
    ["...", "candidate for this island", "..."],
    ...
  ]
}
```

Keeping the response shape stable minimizes changes to candidate rendering, candidate selection, stripped display, and Android preedit.

### Transitional compatibility

The Rust endpoint/native inference may temporarily accept the existing `{ islands: string[] }` request as legacy compositional mode so scripts/evaluators can migrate incrementally. New WebUI code must send the typed protocol.

The compatibility path should be explicitly versioned and tested rather than inferred from arbitrary JSON shapes indefinitely.

---

## 15. Rust inference-engine behavior

Current Rust inference expands each parsed V7 syllable independently. For a two-syllable compositional island this effectively creates candidate lists for syllable 1 and syllable 2 and beam-searches combinations with KenLM.

Dictionary mode must not use that Cartesian candidate behavior.

### 15.1 New lexical pair index

Load a deterministic two-syllable dictionary index keyed by the **canonical concatenated two-syllable V7 code**:

```text
pairCode -> [LexicalPair, LexicalPair, ...]
```

where:

```rust
struct LexicalPair {
    first: Arc<str>,
    second: Arc<str>,
}
```

Multiple entries per code are expected and intentional.

### 15.2 Dictionary-mode candidate generation

For a dictionary V7 island:

1. Parse/validate the canonical pair code and require exactly two syllable templates.
2. Look up the exact code bucket in the lexical pair index.
3. Do **not** independently enumerate syllable candidates.
4. For every lexical pair in the bucket, advance the LM sequentially:
   - score first word from incoming state;
   - score second word from resulting state;
   - sum scores.
5. Beam-prune against other incoming context states in the same manner as current inference.
6. Store the pair as one island replacement string, e.g. `"word1 word2"`, while retaining the LM state after the second word.

This preserves contextual ranking without permitting combinations absent from the dictionary.

### 15.3 Empty dictionary bucket

An empty bucket is a **dictionary miss**.

It must not silently rerun compositional V7 inference. A silent fallback would erase the semantic value of the mode bit and make typing behavior depend on dictionary coverage in an invisible way.

Return no lexical candidate for that island and expose a mode-aware miss to the client. The protocol may initially represent this as an empty candidate list; a later structured diagnostic can improve UI messaging.

### 15.4 Mixed contexts

The engine must support arbitrary mixtures:

```text
fixed text
→ compositional V7 island
→ fixed punctuation/text
→ dictionary V7 island
→ compositional V7 island
```

KenLM state must flow through all segments exactly as it does today.

---

## 16. Lexical dictionary data format

This dictionary is **not** a Stripped Plover dictionary. It belongs to V7 inference and must be kept separate from Plover’s dictionary-management subsystem.

Use a dedicated source file such as:

```text
data/two_syllable_dictionary.txt
```

### Source format

One lexical pair per line:

```text
syllable1 syllable2
```

Requirements:

- UTF-8;
- NFC normalization;
- exactly two Vietnamese word-like syllables separated by ASCII whitespace;
- lowercase canonical source form;
- blank lines allowed;
- optional `#` comments only if the parser explicitly supports them;
- duplicate normalized pairs rejected or deterministically deduplicated with a build warning.

### Build-time validation

For every entry:

1. normalize NFC and Vietnamese lowercase;
2. split into exactly two syllables;
3. call `getV7Code()` or the equivalent shared/generated mapping for each syllable;
4. reject an unrepresentable syllable;
5. concatenate the two V7 codes to form `pairCode`;
6. insert the exact lexical pair into that bucket;
7. sort entries deterministically.

The generated runtime artifact can be JSON, a compact binary/index, or generated Rust source, but the source-of-truth text file should remain human-reviewable.

### Ambiguity is allowed

Multiple different lexical pairs may map to the same `pairCode`. That is expected. The LM ranks them at runtime.

---

## 17. TypeScript V7-core interaction

`src/v7Core.ts` already builds a reverse `v7CodeBySyllable` map and rejects a syllable that would have two different canonical V7 codes. This is useful for dictionary validation.

Do not duplicate a second unrelated mapping from Vietnamese syllable to V7 code for lexical dictionary generation. Reuse or generate from the same canonical source so the WebUI, evaluator, trainer, and Rust data artifact cannot drift.

A build-time consistency test should verify that TS and Rust agree on every dictionary pair code.

---

## 18. Emily symbols

Current Emily symbol grammar is based on:

```text
[#]? WH [AO]* [*-]? [EU]* [FRPBLG]* [TS]*
```

It has no D/Z positions. Every dictionary-mode target includes D and/or Z in a way reserved by the lexical transform, so the current design is structurally disjoint from Emily.

Dictionary decode still belongs before Emily in `handleChord`, both to make ownership explicit and to protect against future Emily grammar expansion.

No Emily mapping changes are required.

---

## 19. Ordinary single-syllable V7

The single-syllable parser uses its own initial/vowel/final/tone grammar and does not consume D/Z or the two-syllable `*` structure used here.

Dictionary-mode targets are therefore outside the current ordinary single-syllable grammar.

No single-syllable dictionary mode should be introduced as part of this feature.

---

## 20. Spacing and punctuation

Dictionary candidates should remain `vietnamese` V7 islands until selected/resolved, so current spacing rules continue to work.

### Punctuation after dictionary mode

Current punctuation handling auto-selects candidate 0 when candidates exist. Preserve that behavior:

1. dictionary pair entered;
2. LM produces lexical candidates;
3. punctuation stroke arrives;
4. top lexical candidate is committed;
5. punctuation is appended.

This should be covered by E2E tests because dictionary mode can change the candidate set immediately before punctuation commits it.

### Explicit `S-P` space

Keep current behavior. A space stroke does not change the dictionary/compositional nature of earlier unresolved islands; inference reruns with the new context as usual.

---

## 21. Candidate rendering and stripped display

If dictionary mode remains an `isV7` island and inference keeps the existing response shape, most candidate UI can remain unchanged:

- top prediction rendering;
- candidate diff sections;
- up-to-five candidate list;
- stripped display;
- candidate selection;
- Android grammar suggestion spans.

### Unresolved dictionary miss rendering

A dictionary miss should not look identical to an unresolved compositional V7 code.

Use a mode-aware visible form, for example:

```text
[dict:tro2dde7]
```

or a localized “No dictionary candidates” state.

The important invariant is that a miss is visibly lexical and is never silently reinterpreted compositionally.

### Editor state event

Extend `v7-editor-state` with enough metadata for trainer/diagnostics to distinguish unresolved dictionary islands, for example:

```ts
{
  text,
  candidates,
  piecemealCursorIndex,
  inferencePending,
  inferenceError,
  v7Modes: ["dictionary", ...]
}
```

Exact payload shape can be more structured, but semantic mode must be observable.

---

## 22. Stripped Plover interaction

There are two Plover paths and they behave differently.

### 22.1 Persistent Plover enabled

Current persistent Plover handling occurs before V7. Preserve it.

When enabled, Plover owns dictionary-shaped strokes just as it owns ordinary V7-shaped strokes.

### 22.2 One-shot Plover fallback

Current one-shot Plover fallback occurs only after all V7/Emily/candidate/syllable handlers fail.

A structurally valid dictionary-mode stroke must be consumed before this point even when its lexical bucket is empty. A dictionary miss must **not** be sent to one-shot Plover.

### 22.3 Plover dictionary-management UI

Do not put the V7 lexical dictionary into the existing Plover dictionary UI. That UI manages Plover stroke→translation dictionaries with enable/disable/order/solo/edit RPCs. V7 lexical pairs have different semantics and are consumed by the V7 inference engine.

To avoid naming confusion in code and UI, prefer terms such as:

- `twoSyllableLexicon`
- `lexicalDictionary`
- `dictionaryMode`

rather than reusing `PloverDictionary` types.

---

## 23. Android IME interaction

No new physical-key mapping is required.

The Android service already captures ordinary A–Z keys and forwards them to the WebUI in steno/raw modes. The WebUI maps:

- physical `T` or `G` → steno `-D`
- physical `Y` or `H` → steno `-Z`
- Space → `*`
- existing standard keys for A/O/E/U and all consonant/tone keys

Therefore the dictionary transform is fully expressible through the current standard hardware path.

### Native inference bridge

Java passes the inference JSON request body opaquely to native Rust inference. The typed version-2 inference request therefore requires:

- WebUI request construction changes;
- Rust serde/request changes;
- JNI/native library rebuild;

but does **not** require Java to understand dictionary mode semantically.

### Preedit

Dictionary candidates should flow through current `setPreeditText` behavior. A top dictionary candidate remains composing text until committed by existing IME rules.

### Input-session/lifecycle resets

No dictionary-specific held-key state is needed. The existing hardware tracker reset behavior on input/lifecycle transitions remains sufficient because mode is encoded within each completed stroke and stored in the text buffer only after stroke completion.

---

## 24. Raw-outline mode

Android raw-outline mode currently preempts all normal V7 semantics and records literal stroke outlines. Exact `*` has special undo behavior there.

Preserve that branch as the first `handleChord` owner.

Dictionary-shaped strokes in raw-outline mode are recorded as raw outlines and are **not** decoded as dictionary mode.

This is important because the starless corner and D/Z alias space must not alter raw-outline transcription semantics.

---

## 25. Plain-text / steno-disabled mode

When Android steno mode is disabled or plain-text mode is active, hardware events are allowed to reach the editor normally according to current service policy.

Dictionary mode only exists in V7 Compose/steno handling. It must not change normal typing behavior.

---

## 26. Trainer interaction

The trainer duplicates the production steno key map and serializer and embeds the production editor for sentence practice.

Dictionary mode therefore affects both teaching and telemetry.

### 26.1 Teaching

Update instructions to explain:

- ordinary two-syllable chord = compositional mode;
- dictionary conjugate = lexical dictionary mode;
- normal rule: flip D and Z;
- `(e|u) × (e|u)` special symmetric corner:
  - `* → DZ`
  - `*Z → EDZ`
  - `*D → ODZ`
  - `*DZ → OEDZ`

Do not teach word-specific dictionary briefs. The learner should derive the lexical chord from the ordinary V7 chord.

### 26.2 Hints

Sentence/drill cards can show both forms where dictionary mode is relevant:

```text
ordinary:  <stroke>
dictionary: <derived stroke>
```

The dictionary stroke should be generated by the same transform helper used by production tests/tooling, not handwritten into lesson data where possible.

### 26.3 Telemetry

The trainer currently records raw `v7-editor-stroke` values and editor candidates. That reveals the physical stroke but does not directly say whether production classified it as dictionary mode.

Add semantic classification to an event, e.g. either:

```ts
v7-editor-stroke detail = {
  stroke,
  interpretation: "dictionary-v7",
  sourceV7Stroke,
  sourceV7Code
}
```

or emit a separate semantic event after dispatch.

This is needed to measure:

- dictionary-mode attempt rate;
- recognition/miss rate;
- correction rate after dictionary entry;
- ordinary-vs-dictionary choice for the same target.

### 26.4 Duplicate serializer

The trainer currently maintains its own standard steno map/serializer. No new keys are needed, but regression tests must ensure it serializes dictionary corner strokes exactly like production, especially the starless `DZ` case where hyphen insertion matters.

Longer term, share serializer logic rather than maintaining two copies.

---

## 27. Evaluator interaction

The existing evaluator assumes every V7 entry is compositional and scores correction strategies using:

- V7 entry cost;
- candidate selection cost;
- piecemeal entry/replacement cost.

Dictionary mode should become an alternate two-syllable entry strategy.

### Required evaluator extension

For every target pair with lexical-dictionary coverage, evaluate both:

1. ordinary compositional V7 inference;
2. dictionary-mode inference using the same underlying V7 pair code.

Record at minimum:

- dictionary bucket size;
- dictionary miss rate;
- top-1 correctness;
- top-5 correctness;
- candidate-selection rate;
- piecemeal correction cost;
- total interaction score;
- delta versus compositional mode.

### Legality invariant

Every dictionary candidate must still consist of exactly two V7-representable syllables whose concatenated canonical V7 codes equal the source pair code. This is stronger than merely belonging to the dictionary file and should be asserted in evaluator and inference tests.

This protects against malformed dictionary generation and TS/Rust code-map drift.

---

## 28. Documentation interaction

Update at least:

- `README_WEB.md`
- relevant root README material describing two-syllable chords
- `PRACTICE_GAME.md`
- trainer README/instructions
- any keyboard-layout or chord-reference page that describes D/Z

Documentation must state that redundant D/Z aliases are no longer ordinary V7 forms because they are reserved for dictionary mode.

The mental model should be concise:

> Same two-syllable V7 code, different interpretation. Ordinary chord asks for compositional inference; its dictionary conjugate asks inference to choose only from the lexical two-syllable dictionary.

---

## 29. Implementation plan by component

### `src/twoSyllableV7.ts` — new

- standard-steno stroke parse/key-set helper for the two-syllable grammar;
- canonical ordinary decoder;
- canonical D/Z rejection;
- dictionary transform;
- inverse dictionary decoder/classifier;
- canonical serializer integration;
- exhaustive invariants exposed to tests.

### `src/main.ts`

- replace local `getV7FromStroke` with imported module;
- add dictionary classification before ordinary two-syllable V7;
- create `isV7` island with `v7Mode: "dictionary"`;
- preserve current capitalization metadata;
- reserve structural dictionary misses;
- update editor events if semantic telemetry is added.

### `src/textBuffer.ts`

- add `V7Mode` metadata;
- replace old string-array-only inference conversion with typed segment conversion;
- treat missing mode as compositional;
- snapshots require no special handling beyond carrying the field.

### `src/webCore.ts`

- mode-aware unresolved rendering;
- piecemeal split demotion for residual V7 fragments;
- candidate rendering should otherwise remain unchanged;
- tests for serializer/parsing of starless dictionary corner.

### `src/candidateSelection.ts`

No semantic change expected, but add regression tests proving dictionary namespace cannot be consumed as candidate suffix composition.

### `inference-rs/src/main.rs`

- versioned typed `InferRequest`;
- compositional vs dictionary V7 segment enum;
- lexical pair index loading;
- pair-wise LM scoring path;
- no Cartesian leakage;
- dictionary miss behavior;
- mixed-mode beam/context tests;
- optional temporary legacy request adapter.

### build/data tooling

- add source lexical-pair file;
- validate and generate deterministic pair index;
- verify TS/Rust V7 code consistency.

### Android

- rebuild packaged native inference library/assets;
- no Java-level stroke semantic changes expected;
- Android E2E must exercise typed request + dictionary preedit.

### trainer

- teaching copy and hints;
- semantic mode telemetry;
- serializer parity tests.

### evaluator

- dictionary-mode inference adapter/path;
- ordinary-vs-dictionary metrics and correction-cost comparison.

---

## 30. Test plan

### 30.1 Exhaustive transform tests

Enumerate all 1,000,000 canonical two-syllable V7 strokes and assert:

- `dictionaryStrokeForCanonicalStroke(C)` is non-null;
- every target is unique;
- `decodeDictionaryModeStroke(L(C))` recovers exactly `C` and its V7 code;
- canonical ordinary decoder rejects `L(C)`;
- 840,000 targets have key-state distance 2;
- 160,000 targets have key-state distance 3;
- no target has greater distance;
- consonant/tone key sets are unchanged.

### 30.2 Symmetry tests

Define left/right reflection and assert for every canonical source:

```text
L(mirror(C)) == mirror(L(C))
```

including all four starless corner cases.

### 30.3 Ordinary decoder migration tests

Assert:

- canonical ordinary strokes remain accepted;
- left `D` with A/O is rejected;
- right `Z` with E/U is rejected;
- canonical e/u use of D/Z remains accepted;
- invalid onset codes remain rejected;
- malformed zero/multiple-star forms remain rejected.

### 30.4 Collision tests

Against production predicates, assert no dictionary target is accepted by:

- canonical ordinary two-syllable V7;
- Emily;
- ordinary permitted single-syllable V7;
- punctuation;
- S-P space;
- piecemeal entry commands;
- system commands;
- candidate+syllable composition.

Do not encode these as manually curated examples only; retain exhaustive/property tests where practical.

### 30.5 Text-buffer/protocol tests

Assert:

- ordinary V7 island serializes as typed `mode: compositional`;
- dictionary island serializes as typed `mode: dictionary`;
- fixed islands preserve text/spacing;
- mode survives history snapshot/undo;
- old `isV7` island with absent mode is treated as compositional;
- legacy inference request, if supported, maps to compositional mode only.

### 30.6 Rust inference tests

Construct a tiny lexical dictionary containing ambiguous buckets and assert:

- dictionary mode returns only exact bucket entries;
- no cross-product pair absent from the dictionary appears;
- LM context changes ranking within the bucket;
- scoring advances state through both words;
- empty bucket does not invoke compositional fallback;
- candidate output preserves one replacement part per dictionary island;
- mixed fixed/compositional/dictionary islands preserve context;
- malformed dictionary candidates are rejected at build/load time.

### 30.7 Candidate-selection tests

With dictionary candidates visible, verify all five selection chords:

- `-T`
- `-TS`
- `-S`
- `-D`
- `-Z`

Select the expected lexical candidate.

Also test dictionary-shaped entry strokes before candidate handling so D/Z does not get stolen by the selection parser.

### 30.8 Piecemeal tests

- dictionary pair appears as two piecemeal targets after inference;
- replacing one syllable converts replacement to fixed text;
- all residual V7 fragments are demoted to compositional mode;
- no one-syllable dictionary island remains;
- inference reruns normally after the split;
- undo restores the original unresolved dictionary island and mode.

### 30.9 Capitalization tests

- pending capitalization on dictionary entry;
- Caps Lock on dictionary entry;
- candidate selection preserves capitalization;
- piecemeal split preserves current capitalization semantics.

### 30.10 Plover tests

- persistent Plover enabled: dictionary-shaped stroke goes to Plover;
- Plover disabled: same stroke goes to dictionary mode;
- dictionary miss is consumed and does not invoke one-shot Plover;
- ordinary unknown non-dictionary stroke may still one-shot to Plover according to current behavior.

### 30.11 Android E2E

- physical D/Z aliases serialize correctly through Android WebView path;
- starred dictionary chord produces lexical candidates in native inference;
- each starless corner form works, including a no-middle-key serialization with hyphen;
- preedit shows top dictionary candidate;
- punctuation/Enter/finish-preedit commits correctly;
- steno off/plain-text mode does not decode dictionary strokes;
- raw-outline mode records dictionary-shaped outlines literally;
- input view recreation/reset has no stale state interaction.

### 30.12 Trainer E2E

- hints derive dictionary stroke correctly;
- production iframe classifies mode;
- telemetry records semantic dictionary attempts;
- sentence completion accepts candidate/piecemeal correction after dictionary entry.

---

## 31. Acceptance criteria

The feature is complete only when all of the following are true.

1. Every canonical two-syllable V7 stroke has exactly one reversible dictionary-mode conjugate using only standard steno keys.
2. The conjugate rule is exactly the D/Z toggle plus the four specified symmetric starless corner mappings.
3. Ordinary two-syllable V7 rejects redundant D/Z aliases now reserved for dictionary mode.
4. Exhaustive tests prove zero overlap between dictionary mode and canonical ordinary two-syllable V7.
5. Production collision tests prove dictionary strokes are not consumed by Emily, single-syllable V7, candidate composition, punctuation, spacing, piecemeal entry, or commands.
6. Persistent Stripped Plover still owns strokes while enabled.
7. A dictionary-shaped stroke is consumed by dictionary mode before one-shot Plover when persistent Plover is disabled.
8. Dictionary mode carries the exact recovered canonical two-syllable V7 code into inference.
9. The inference request explicitly carries `dictionary` vs `compositional` mode; no magic marker is hidden inside V7 code strings.
10. Dictionary inference only emits lexical pairs present in the exact dictionary bucket; it never generates a Cartesian combination absent from the dictionary.
11. LM context still ranks ambiguous dictionary entries.
12. An empty lexical bucket does not fall back silently to compositional inference.
13. Dictionary-mode islands participate in current candidate UI, capitalization, spacing, stripped display, and Android preedit.
14. Piecemeal replacement of a dictionary pair demotes residual V7 fragments to compositional mode.
15. Undo restores dictionary-mode island metadata correctly.
16. Candidate selection `-T/-TS/-S/-D/-Z` works on dictionary inference results.
17. Raw-outline and plain-text/steno-disabled modes retain their current ownership semantics.
18. Trainer teaching/hints/telemetry understand dictionary mode.
19. Evaluator can compare dictionary and compositional entry strategies.
20. Documentation explicitly describes the transform and the reassignment of redundant D/Z aliases.

---

## 32. Expected user-facing mental model

The entire feature should be teachable without a lookup table.

### Ordinary case

> Type the same two-syllable V7 chord, but flip D and Z to request dictionary mode.

### Center corner

When both coarse vowels are e/u:

```text
*    → DZ
*Z   → EDZ
*D   → ODZ
*DZ  → OEDZ
```

`O` records left-u, `E` records right-u, and `DZ` marks the lexical frame.

### Semantics

> Ordinary chord: infer compositionally.  
> Dictionary conjugate: restrict this same V7 pair code to the two-syllable lexical dictionary, then let the LM choose among compatible entries.

That is the only conceptual mode distinction the user should have to learn.

---

## 33. Research notes from current code

This specification was checked against the current implementation rather than treating dictionary mode as an isolated decoder feature.

The relevant current behaviors are:

- `getV7FromStroke` in `src/main.ts` currently accepts redundant D/Z aliases and requires `*`.
- `handleChord` gives persistent Plover ownership before V7, exact `*` is undo outside raw-outline mode, two-syllable V7 currently outranks Emily, and one-shot Plover is the final fallback.
- candidate selection reserves `-D` and `-Z` and can combine selection with a syllable.
- `TextBuffer` stores only an `isV7` boolean today and converts inference input to alternating strings, so dictionary mode cannot survive the current request representation.
- Rust inference currently expands each V7 syllable independently and scores combinations; a dictionary pair restriction therefore requires a distinct candidate-generation path.
- piecemeal splitting copies V7 island metadata to residual fragments, which requires explicit dictionary-mode demotion.
- Android forwards standard keyboard events to the WebUI and passes inference JSON opaquely to Rust, so no new native key is needed.
- the trainer duplicates the steno serializer and records production editor strokes/state, so it needs both teaching and telemetry updates.
- the evaluator assumes compositional V7 entry and should be extended to measure dictionary-mode benefit and correction cost.

These interactions are part of the feature’s correctness criteria, not follow-up polish.
