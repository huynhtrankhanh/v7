# Inference Backend Reranking Report

## Scope
- Added Gemini Flash reranking for inference candidates when `GEMINI_API_KEY` is set.
- Reranker can discard weak candidates by returning a filtered, ordered `keep` list.
- Backend falls back safely to original candidate order if Gemini fails or returns invalid output.

## CLI Validation Method
- Used the Rust CLI entrypoint (`cargo run ...`) only.
- Ran with `--features mocked-model` in this environment (KenLM binary + headers are not available here).
- Measured latency from CLI output (`Inference time`) and validated output format manually.

## Test Cases

| Case | CLI Input | Expected Type | Observed Output (Top 1) | Inference Time |
|---|---|---|---|---|
| 1 | `na0tro2dde7la1nhu0ma2khi0tro2mu0thi2no1ra6me7` | Legacy V7 decoding | `năm trời đẹc lắm nhưng mằm khinh trời mưng thỳ nới rấc mẹc` | `0ms` |
| 2 | `["Xin chao ","na0tro2dde7","!"]` | Islands JSON mode | `["Xin chao ","năm trời đẹc","!"]` | `0ms` |
| 3 | `na0tro2dde7` | Legacy V7 decoding | `năm trời đẹc` | `0ms` |
| 4 | `khi0tro2mu0` | Legacy V7 decoding | `khinh trời mưng` | `0ms` |
| 5 | `thi2no1ra6me7` | Legacy V7 decoding | `thỳ nới rấc mẹc` | `0ms` |

## Accuracy Notes
- For mocked-model mode, decoding picks the first enumerated candidate per syllable, so linguistic quality is limited.
- Using a simple phrase-level exactness check against intended Vietnamese text, observed exact-match accuracy in this run is low (0/4 exact for the legacy cases above).
- This is expected for mocked-model mode and is independent of Gemini reranking quality, because mocked mode produces a very narrow candidate set.

## Gemini Reranker Behavior
- Trigger condition: `GEMINI_API_KEY` present and candidate count >= 2.
- Model used: `gemini-2.0-flash`.
- Reranker prompt requires JSON-only output (`{"keep":[...]}`) and allows dropping poor candidates.
- If API call fails or response is malformed, backend keeps original candidates unchanged.

## Automated Tests Added
- `parse_ranked_indices_from_json_keep`
- `parse_ranked_indices_from_plaintext_fallback`
- `apply_ranked_indices_dedups_and_filters`

All pass under:
- `cargo test --features mocked-model`
