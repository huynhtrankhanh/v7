# Experimental native candidate rescoring

V7 can optionally replace KenLM's order for its leading candidates with real
causal-language-model scores from Gemma. The feature is off by default, runs
entirely on device, and fails open to the unchanged KenLM result.

## Download and install the model

The recommended portable model is
[`litert-community/Gemma3-1B-IT`](https://huggingface.co/litert-community/Gemma3-1B-IT):

```text
gemma3-1b-it-int4.litertlm
```

It is 584,417,280 bytes (about 557 MiB). Do not select a `-web.task` artifact
or a Qualcomm/MediaTek-specific package. A smaller compatible alternative is
`gemma3-270m-it-q8.litertlm` from
[`litert-community/gemma-3-270m-it`](https://huggingface.co/litert-community/gemma-3-270m-it),
although the 1B model is preferred for accuracy.

1. In **V7 IME settings**, open the Gemma model page.
2. Sign in to Hugging Face, accept the Gemma terms, open **Files and
   versions**, and download `gemma3-1b-it-int4.litertlm`.
3. Tap **Choose downloaded .litertlm file** and select the download.
4. Wait for copying to finish, choose the number of candidates to rescore
   (2–100, default 50), and enable experimental reranking.

Command-line download, after accepting the terms in a browser:

```sh
python -m pip install --upgrade huggingface_hub
hf auth login
hf download litert-community/Gemma3-1B-IT \
  gemma3-1b-it-int4.litertlm --local-dir .
```

The app atomically copies the selected file to
`noBackupFilesDir/experimental-reranker/model.litertlm`. This preserves model
access when the document provider disappears and excludes the weights from
Android backup. App-data export does not include the model. The APK does not
redistribute Gemma weights; their use remains subject to the
[`gemma` terms](https://ai.google.dev/gemma/terms).

## Scoring data path

```text
WebUI islands
  -> JNI/Rust/KenLM generates 100 candidates
  -> Rust finds the selected top-K candidates' complete shared prefix (possibly empty)
  -> native LiteRT-LM prefills that prefix once (shared KV state)
  -> one batched scoring call evaluates every candidate continuation
  -> Rust sorts by mean token log-likelihood, stably breaking ties by KenLM
  -> WebUI receives the complete reordered array and displays at most five
```

This is scoring, not prompted generation. LiteRT-LM returns accumulated token
log-likelihood and token count for every continuation; Rust divides the former
by the latter so short candidates do not win merely because they contain fewer
tokens. Gemma is authoritative within the rescored pool—KenLM scores are not
blended back in. Candidates below the selected depth retain their relative
order. The WebUI remains capped at five visible candidates regardless of the
scoring depth.

All LiteRT ownership is in `inference-rs/src/litert_reranker.rs`. There is no
LiteRT Kotlin/Java engine, Retrofit client, HTTP request, prompt parser, or
generated candidate-ID list. Android Java supplies settings and private paths
through JNI and reports native loading/ranking/backend state.

## KV reuse, batching, GPU, and responsiveness

For each candidate set, Rust creates one isolated scoring session, prefills the
longest complete-word prefix once, then branches the whole selected pool in a
single `RunTextScoring` batch. LiteRT-LM's session KV cache therefore avoids
reprocessing shared sentence context while isolation prevents previous
candidate sets from contaminating later inference. The engine and compiled
kernel cache remain process-wide and are preloaded on a background executor
when the IME starts, when the feature is enabled, and after model replacement.

The app packages the pinned LiteRT-LM C shared library and its official GPU,
OpenCL, and WebGPU accelerator libraries for `arm64-v8a` and `x86_64`.
Decode-only top-K sampler plugins are deliberately omitted because rescoring
does not sample tokens, saving about 44 MiB of uncompressed APK payload.
The manifest advertises optional Vulkan compute/OpenGL ES support and permits
optional vendor `libOpenCL.so`/`libvndksupport.so` access. Rust tries the GPU
backend first. A GPU that cannot initialize or score is discarded and that
batch is retried once with LiteRT-LM's parallel CPU backend. A 32-bit device
continues to use KenLM but cannot enable this native reranker.

Reranking uses the asynchronous Android bridge. Composition and keyboard input
remain active while an indeterminate progress indicator distinguishes loading,
ranking, ready, and fail-open error states. A newer chord requests cancellation
of an obsolete native session. A load or score error is retained for diagnosis
but returns the original KenLM JSON, so the experimental feature cannot make
the keyboard unavailable.

## Root cause

The original reranker asked an instruction-tuned model to *generate an ordinal
list* after reading eight alternatives. That output was not a probability or
naturalness score. It spent decode work producing IDs, could copy input order,
required constrained-output parsing, and provided no proof that candidate text
affected the final order. Managed LiteRT execution also sat outside the Rust
inference pipeline, complicating cancellation and making synchronous WebView
calls appear to freeze the keyboard during cold loading.

The former progress poller ran only while a typing request was outstanding, so
background preload could remain visually stuck on an old state. It now remains
active for either loading or scoring and stops when both are idle. Native
cancellation also protects the active session's lifetime while the cancel call
uses it, preventing a completion/cancellation race from reaching a freed
session. A cancellation epoch closes the other timing window: an obsolete
request that is still finishing KenLM cannot begin Gemma work after a newer
chord arrives.

KenLM itself is a fast 3-gram model and necessarily sees only short local
history. The replacement keeps KenLM for enumeration and its inexpensive first
pass, then uses the causal LM's actual token likelihood over broader context.
One prefix prefill and one multi-candidate batch remove repeated work, and
length normalization gives the raw scoring function a meaningful comparison.

## Model choice and limitations

Gemma 3 1B IT was selected because it has a portable INT4 `.litertlm` artifact,
multilingual coverage including Vietnamese, and a practical mobile footprint.
Gemini Nano's foreground-app restriction is unsuitable for an IME; MediaPipe's
generic text classifier needs a purpose-trained naturalness label model;
PhoBERT pseudo-likelihood needs many masked forward passes; and BGE rerankers
score query-document relevance rather than unconditional sentence naturalness.

Gemma remains experimental: language-model likelihood is a useful naturalness
signal, not a guarantee of the intended meaning. Representative Vietnamese
evaluation should measure top-1 accuracy, reciprocal rank, cold/warm latency,
memory, thermal load, and battery impact against the KenLM baseline. Increasing
top-K improves coverage but increases the score tensor, KV branching cost, and
latency.

## Native build and license

The build pins LiteRT-LM 0.15.0 commit
`2117fc4314670e00047bc8469783f02a68c33f0c`, fetches its official accelerator
libraries with Git LFS, and builds `//c:litert-lm` for Android with Bazel. A
narrow carried patch removes an erroneous single-target guard and sizes the
decoded-ID tensor from the C API's `num_targets`; LiteRT-LM's existing
`Tasks::Score` implementation and tests already support multi-target batches.

Required build tools are JDK 21, Go (to obtain pinned Bazelisk 1.26.0), Git
LFS, Android NDK, Rust/cargo-ndk, Node, and Gradle. The native dependency graph
uses substantial temporary disk space. `LITERT_LM_BAZEL_ROOT` may point its
Bazel output tree at a larger volume:

```sh
ANDROID_NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018" \
LITERT_LM_BAZEL_ROOT=/path/with/space/litert-lm-bazel \
  gradle -p ime-android assembleDebug
```

The GitHub build workflows reclaim their ephemeral runner's unused Docker,
.NET, GHC, and Boost payloads before this build; they do not remove Android,
Java, Node, Rust, Gradle, repository, model, or signing data.

LiteRT-LM is Apache-2.0. Its pinned `LICENSE` is bundled under
`assets/third-party/litert-lm/`; upstream does not publish a
`THIRD_PARTY_NOTICE.txt` at this revision. The source revision, build scripts,
and batch patch are included in Corresponding Source.

## Verification

Automated checks cover the WebUI's five-item render cap, Java settings and
lifecycle compilation, all Android unit tests, cross-compilation of the native
scorer for all four Android Rust targets, and the signed APK build. Real-device
acceptance must additionally compare enabled/disabled ordering, verify GPU and
CPU labels, type during loading/ranking, replace/disable the model, and operate
in airplane mode.
