**inference-rs web demo**

Important and non-negotiable criteria:
* The web server has to be served by inference-rs. inference-rs is both responsible for serving static assets and handling API requests to the inference engine.
* The inference mode that the web server uses is the multiple islands inference mode.

The web demo uses stenography. The steno layout is mapped to the QWERTY layout as follows:

```
Q: #
A: S-
W: T-
S: K-
E: P-
D: W-
R: H-
F: R-
T, G: -D
Y, H: -Z
U: -F
J: -R
I: -P
K: -B
O: -L
L: -G
P: -T
;: -S
C: A
V: O
N: E
M: U
spacebar: *
```

Recall the steno order: #STKPWHRAO*EUFRPBLGTSDZ

In the above key layout, if the hyphen occurs after the letter, it means the key is to the left of the `*` in the steno layout. Otherwise, if the hyphen occurs before the letter, it means the key is to the right of the `*`.

A chord is a key combination. When a chord is pressed, it is serialized according to the steno order. Keys not present in the chord are taken out of the steno order. Then, if all of the `AO*EU` keys are taken out, they are replaced by `-` in the chord serialization, also called the outline.

For example: `TPH-LG`, `TPHOT`, `TPHAT`, `TPH*T`, `KWRA*EBG`.

With this down pat, now we tackle a different aspect of the stenography experience.

REQUIRED READING: `specimen.ts`

There are two modes in the specimen file.
* **Fully specifying a syllable:** parse() and assemble(). This mode is unambiguous, so it should be handled by the frontend. After that, the resulting syllable is then passed to the inference engine as a **fixed text island**.
* **Partially specifying two syllables:** This is where the v7 inference engine comes into place.
  * The processWord() takes a two-syllable word and returns the outline (key combination serialization) of the word that only specifies two syllables partially.
  * This function can't be used as is. Why?
    * Because when the user inputs the chord, it's not even clear what the original word is.
    * Because of this, you have to infer the **v7 code** of the two syllables, then feed to the inference engine as a **v7 code island**.

The whole text consists of both **fixed text islands**, which don't need to be inferred but serve as valuable context for the inference engine nonetheless, and **v7 code islands**, which need to be inferred. These two, in conjunction, when fed to the inference engine, produces a list of candidates. We are to present to the user the top 5 candidates.

**Important note:** These modes work in tandem! Based on the stroke being inputted, decide which mode is currently being used based on logic. There is **no mode-switching interface** here! It is just dependent on the stroke. The set of strokes being covered by the two modes **do not overlap**!

Among the top 5 candidates, the user can then choose among these candidates. Here are the chords to choose the candidate:

* TK: Candidate 1
* PW: Candidate 2
* HR: Candidate 3
* -FR: Candidate 4
* -PB: Candidate 5

When a candidate is chosen, the ambiguity collapses, and everything merges into one **fixed text island**, serving as valuable context for the model to continue inferring what is being inputted.

**The role of the * key**

In stenography, the `*` key undoes the effect of the previous stroke. So it can delete one or two syllables depending on what the previous stroke did. Remember, you can't undo an undo! So two `*` keys don't cancel each other out!

**The user experience**

There should be no textarea. Instead, the whole text is displayed in a regular div, and candidates are also displayed in a logical place. The text changes based on stenographic input!

Ideally, the candidates should be displayed at the bottom. The candidate display area should stay fixed in place no matter where the user scrolls. This means the text display area should have padding so as not to be covered by the candidate selection area. The text display area should be scrollable, and it automatically scrolls to bottom as the user inputs more text or deletes text by the `*` key.

Using a textarea, or a contenteditable, or an input[type=text] for this purpose means relinquishing too much control and yielding too much to the browser. Because stenography is different, we need to handle everything ourselves.

The website should be mobile friendly. **This doesn't mean causing a virtual keyboard to be displayed, please do not do so.** When the website runs on mobile, an external keyboard is plugged in. But the layout should be legible and clean on mobile despite the small screen.

**Testing**

The website should be thoroughly tested, and tests should be committed. Use Puppeteer for testing.
