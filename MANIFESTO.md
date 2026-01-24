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
