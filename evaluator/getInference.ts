/**
 * Backwards-compatible evaluator entry point.
 *
 * V7 language rules live in src so runtime and evaluation consumers share a
 * dependency-neutral core.
 */
export { getInference, getV7Code } from "../src/v7Core";
