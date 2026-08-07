# Experimental on-device candidate reranking

V7 can optionally pass KenLM's leading candidates through a second, Android-owned
language model before the WebUI sees them. This is an experimental quality mode,
not part of the default input path. It is disabled until a user installs a model
and turns it on in the native Settings activity.

## Download and install the model

The recommended accuracy model is the generic CPU package from
[`litert-community/Gemma3-1B-IT`](https://huggingface.co/litert-community/Gemma3-1B-IT):

```text
gemma3-1b-it-int4.litertlm
```

It is 584,417,280 bytes (about 557 MiB). Do not choose a `-web.task` file or a
device-specific MediaTek/Qualcomm package: this integration selects LiteRT-LM's
portable CPU backend.

On a memory-constrained device, the compatible generic
`gemma3-270m-it-q8.litertlm` file from
[`litert-community/gemma-3-270m-it`](https://huggingface.co/litert-community/gemma-3-270m-it)
is about 290 MiB. It trades model capacity for a smaller footprint; the 1B INT4
artifact remains the recommended choice when ranking accuracy is the priority.

To download in a browser:

1. Open **V7 IME settings** and tap **Open Gemma 3 1B IT download page**.
2. Sign in to Hugging Face and accept the Gemma terms shown by the repository.
3. Open **Files and versions** and download
   `gemma3-1b-it-int4.litertlm`.
4. Return to V7 IME settings, tap **Choose downloaded .litertlm file**, and
   select that file in Android's document picker.
5. Wait for the status to show the installed name and size, then check
   **Enable experimental reranking**.

The same artifact can be downloaded on a computer after accepting the terms in
a browser:

```sh
python -m pip install --upgrade huggingface_hub
hf auth login
hf download litert-community/Gemma3-1B-IT \
  gemma3-1b-it-int4.litertlm --local-dir .
```

Copy the resulting file to the Android device and select it in Settings. Model
access and use remain subject to the
[`gemma` license and terms](https://ai.google.dev/gemma/terms). The APK does not
redistribute the weights.

Android copies the selected document atomically to
`noBackupFilesDir/experimental-reranker/model.litertlm`. The private copy makes
runtime access independent of document-provider availability and deliberately
keeps the roughly 557 MiB file out of Android backup. Allow enough free space
for both the downloaded source and the private copy while installing. V7 app
data export does not include this model.

## Data flow and failure policy

```text
WebUI islands
    -> JNI/Rust/KenLM: generate and rank 100 candidates
    -> Android Java: reconstruct the first 50 candidate sentences
    -> LiteRT-LM CPU / Gemma 3 1B IT: return candidate IDs in quality order
    -> Android Java: validate IDs, reorder the original candidate arrays
    -> WebUI
```

The ML stage is implemented in `AndroidCandidateReranker` and runs through
Google’s Android-native LiteRT-LM 0.15.0 API. There is no Retrofit client, HTTP
request, remote service, or reranker code in Rust. Candidate text and model
output remain inside the IME process.

## Responsiveness, progress, and cancellation

Experimental reranking always uses the asynchronous Android bridge. The
KenLM-only path may use the fast synchronous bridge, but a LiteRT model load or
generation must never run inside a blocking `JavascriptInterface` return. The
WebUI therefore keeps the raw composition visible and accepts new chords while
an indeterminate progress bar reports one of these stages:

- **Loading KenLM model · typing active**;
- **Loading Android ML model · typing active**;
- **Reranking 50 candidates · typing active**;
- **Reranker ready**; or
- **Reranker error · KenLM fallback**.

On failure, the workbench also shows the concrete LiteRT error while continuing
with KenLM candidates, so a bad or unsupported model is diagnosable without
making the keyboard unusable.

The original implementation incorrectly reused `requestInferenceSync` after
enabling LiteRT. Although Android invokes that bridge method off the UI thread,
JavaScript waits synchronously for its return. Model initialization and token
generation consequently prevented the same WebView execution context from
handling the next keyboard event, making the keyboard appear frozen.

Each candidate set is ranked in one listwise model call rather than 50 serial
calls. Android tries LiteRT-LM's GPU backend first and requests its optional
OpenCL vendor libraries. If GPU initialization is unsupported by the device or
model, it falls back to CPU automatically; the ready label reports `GPU` or
`CPU`. The fallback receives up to four worker threads (bounded by the device's
available processors), so CPU kernels execute in parallel without creating
duplicate 557 MiB engines. If another chord arrives during generation,
Android calls `Conversation.cancelProcess()`: obsolete work stops, queued stale
requests are discarded, and only the newest composition proceeds. A cold engine
initialization is allowed to finish once because cancelling and reloading it
would increase latency and memory churn.

The prompt asks for natural Vietnamese grammar, word choice, meaning, and
longer-range coherence. It labels each candidate with an integer, treats its
text as untrusted data, caps each reconstructed string to a bounded head/tail
sample, uses greedy decoding, and asks for only the best 10 in-range unique IDs
from the 50-way comparison. Avoiding generation of the remaining 40 IDs reduces
interactive decode latency; omitted IDs are appended in their original KenLM
order. Candidates 51 through 100 are never sent to Gemma and keep their original
relative order.

Reranking is fail-open. A missing model, disabled preference, invalid native
response, unsupported ABI, LiteRT load/generation failure, or malformed model
answer leaves the complete KenLM response unchanged. Failures are logged but
do not change the core inference model's ready/error state.

## Root cause and model research

The original Android path returned KenLM's beam order directly. KenLM is an
efficient 3-gram model, so its score sees only short local token history. It
cannot reliably distinguish candidates that are locally plausible but differ
in sentence-level grammar, semantics, or discourse coherence. The added stage
lets a substantially broader pretrained language model make that final
comparison without changing deterministic V7 candidate generation.

The off-the-shelf options considered were:

| Option | Decision |
| --- | --- |
| [Gemma 3 1B IT](https://ai.google.dev/gemma/docs/core/model_card_3) through [LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM) | Selected. It is instruction-tuned, supports more than 140 languages, has a 32K-token context at this size, and has a ready portable INT4 `.litertlm` artifact. It offers a stronger accuracy starting point than the smaller 270M variant. |
| [Gemini Nano Prompt API](https://developers.google.com/ml-kit/genai/prompt/android/get-started) | Rejected for this IME path. Its documented background-use restriction requires the calling app to be the top foreground application; while typing, the editor app rather than the IME package owns that position. Device availability is also narrower. |
| [MediaPipe Text Classifier](https://developers.google.com/edge/mediapipe/solutions/text/text_classifier/android) | Rejected. It returns categories from a trained classifier (the example model is sentiment), not open-ended comparative sentence quality. |
| [PhoBERT base v2](https://huggingface.co/vinai/phobert-base-v2) | Rejected for the initial Android implementation. It is a Vietnamese masked model that requires word segmentation and many pseudo-likelihood forward passes to score each complete candidate. |
| [BGE reranker v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3) | Rejected. It is a query-document relevance cross-encoder, not a sentence-naturalness model, and its 0.6B footprint is larger. |

Gemma 3 1B IT is a practical first model, not proof of an accuracy gain on a
particular V7 corpus. The feature is labeled experimental because quality must
be measured on representative Vietnamese candidate sets and because generative
listwise ranking can occasionally be unstable. The deterministic parser and
fail-open policy contain that instability. A future evaluation should record
top-1 accuracy, mean reciprocal rank, cold/warm latency, memory, and battery
cost against the unchanged KenLM baseline.

## Runtime and build constraints

LiteRT-LM 0.15.0's Android AAR contains `arm64-v8a` and `x86_64` native
libraries and is built as Java 21 bytecode. The Android build and both GitHub
Actions workflows therefore use JDK 21. A 32-bit-only device can still use the
normal KenLM IME, but experimental reranking fails open because LiteRT-LM has no
matching native library in this artifact.

The engine prefers GPU and otherwise uses up to four CPU workers. It uses an
8,192-token cache limit, a 64-token answer limit, temperature 0, a writable
compilation cache, and a process-level model cache. LiteRT-LM's
[Android API guide](https://github.com/google-ai-edge/LiteRT-LM/blob/main/docs/api/kotlin/getting_started.md)
documents the optional OpenCL manifest entries and CPU/GPU/NPU backends. Its
[published Gemma 3 1B measurements](https://github.com/google-ai-edge/LiteRT-LM#supported-models-and-performance)
show that GPU primarily accelerates long prompt prefill; decode speed can remain
similar. NPU is not selected automatically because its native runtime remains
vendor-specific rather than one broadly deployable application backend.
LiteRT-LM documents that
initialization can take up to roughly ten seconds; generation adds further
per-request latency. This mode is intentionally opt-in and may be unsuitable
for interactive typing on slower devices.

The LiteRT-LM runtime is Apache-2.0. Its `LICENSE` and
`THIRD_PARTY_NOTICE.txt` are extracted from the pinned Maven AAR and bundled in
the APK under `assets/third-party/litert-lm/`. The separately downloaded Gemma
weights retain the Gemma terms and are neither bundled in the APK nor included
in Corresponding Source.

## Verification

`CandidateRerankProtocolTest` covers prompt escaping, malformed and partial
answers, duplicate/out-of-range IDs, stable fallback order, and the 50-candidate
cap. Android unit tests exercise the integration's compile-time LiteRT API
contract without downloading gated model weights. A real-device acceptance
test should install the generic model, compare enabled/disabled ordering, turn
the feature off after a successful load to verify release, and test airplane
mode to confirm that no network access is required.
