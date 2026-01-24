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
```
