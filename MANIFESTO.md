# Android IME

The engine consists of a "frontend" and a "backend". In reality, the "backend" is only responsible for inference, whereas the "frontend" is responsible for most of the steno logic. This is not a problem.

But:
* The Rust code has to be compiled to various Android targets.
* JavaScript code:
