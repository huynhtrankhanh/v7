# Android IME

The engine consists of a "frontend" and a "backend". In reality, the "backend" is only responsible for inference, whereas the "frontend" is responsible for most of the steno logic. This is not a problem.

But:
* The Rust code has to be compiled to various Android targets.
* JavaScript code:
  * Use QuickJS to evaluate the JavaScript code. Yes, it's yet another dependency that needs to be compiled.
  * There is a recognizable "core" of the frontend that doesn't interact with the DOM. Use it to run on Android.
  * However, it contains a fetch() call to get inferred text. Since on Android, opening a port creates security risk, we **make the Rust code offer an STDIO interface for inference** and then send inference requests via STDIO.
* Stripped Plover integration:
* lm.binary: The user should be able to select an lm.binary file with a file picker.
