# Next-Generation Inference Engine: CPU-Optimized Implementation

This document outlines the research and implementation approach for a next-generation V7 inference engine that achieves high accuracy while running entirely on CPU. Training is performed on GPU machines; the resulting inference engine is deployed CPU-only.

## Table of Contents

- [1. Current Architecture](#1-current-architecture)
- [2. Motivation for a Next-Generation Engine](#2-motivation-for-a-next-generation-engine)
- [3. Design Principles](#3-design-principles)
- [4. Recommended Architecture](#4-recommended-architecture)
- [5. Training Pipeline (GPU)](#5-training-pipeline-gpu)
- [6. Inference Pipeline (CPU)](#6-inference-pipeline-cpu)
- [7. Model Quantization](#7-model-quantization)
- [8. Rust Integration Options](#8-rust-integration-options)
- [9. Alternative Approaches Considered](#9-alternative-approaches-considered)
- [10. Implementation Roadmap](#10-implementation-roadmap)
- [11. Performance Targets](#11-performance-targets)
- [12. References](#12-references)

---

## 1. Current Architecture

The V7 engine currently uses:

- **KenLM** — a 3-gram statistical language model trained on Vietnamese corpora.
- **Beam Search** — implemented in Rust, exploring all valid candidates per V7 syllable template and scoring sequences via KenLM probabilities.
- **FFI Bindings** — Rust calls into the KenLM C++ library via `libc` for model loading and scoring.

This architecture achieves good accuracy for common phrases but is fundamentally limited by the 3-gram context window: the model can only consider the two preceding words when scoring the next word. Long-range dependencies, idiomatic expressions spanning four or more words, and rare-but-correct phrases are poorly modeled.

## 2. Motivation for a Next-Generation Engine

| Limitation | Impact |
|:---|:---|
| **3-gram context** | Cannot capture dependencies beyond 2 preceding words. Sentences like "bộ trưởng bộ giáo dục" (Minister of Education) require longer context. |
| **No semantic understanding** | N-gram models treat words as opaque tokens with no understanding of meaning or grammatical structure. |
| **Sparse data problem** | Rare but valid word sequences receive very low (or backoff) probabilities, hurting accuracy on uncommon phrases. |
| **Scaling ceiling** | Increasing to 5-gram or higher dramatically increases model size without proportional accuracy gains. |

A neural language model with transformer attention can address all of these limitations while maintaining sub-10ms latency on CPU through careful optimization.

## 3. Design Principles

1. **Train on GPU, infer on CPU.** All heavy computation (gradient descent, backpropagation) happens on GPU during training. The deployed model runs on CPU only.
2. **Sub-10ms per syllable.** The engine must respond within a single keyboard event cycle. Users should perceive zero latency.
3. **Small model footprint.** The model should be under 50 MB on disk (quantized) to enable easy distribution and fast loading.
4. **Pure Rust inference path.** Minimize external C/C++ dependencies. Prefer Rust-native solutions or well-maintained Rust bindings.
5. **Backward compatibility.** The V7 input format, regex-based candidate generation, and beam search framework remain unchanged. Only the scoring function is replaced.

## 4. Recommended Architecture

### 4.1 Model: Small Transformer Language Model

Train a **custom small transformer** language model specifically for Vietnamese, designed from the start for CPU inference:

| Parameter | Value | Rationale |
|:---|:---|:---|
| **Architecture** | Decoder-only Transformer (GPT-2 style) | Autoregressive LM aligns with beam search scoring |
| **Layers** | 4–6 | Sufficient for Vietnamese phonotactic patterns |
| **Hidden dimension** | 256–384 | Balances capacity with CPU speed |
| **Attention heads** | 4–6 | Multi-head attention captures diverse patterns |
| **Context window** | 32–64 tokens | Covers typical V7 input sentences |
| **Vocabulary** | Vietnamese word-level (~30k–50k tokens) | Matches the existing KenLM vocabulary approach |
| **Total parameters** | ~5M–15M | Well within CPU real-time inference budget |

This is **not** a general-purpose LLM. It is a purpose-built, small language model trained exclusively for Vietnamese word-level probability estimation — the same role KenLM fills today, but with far deeper contextual understanding.

### 4.2 Why Not Use a Pre-trained LLM?

Pre-trained models like Llama, Qwen, or Phi are designed for general text generation and are orders of magnitude too large for a keyboard input method. Even quantized to INT4, a 1B-parameter model requires hundreds of megabytes and tens of milliseconds per token on CPU. Our use case needs only a **scoring function** — "given this prefix, how likely is this next word?" — which a 5M–15M parameter model handles excellently for a constrained domain like Vietnamese text input.

### 4.3 Integration with Beam Search

The existing beam search algorithm remains:

```
Current:  KenLM.score(state, word) -> (log_prob, new_state)
Proposed: NeuralLM.score(state, word) -> (log_prob, new_state)
```

The neural model replaces the scoring oracle. The `state` representation changes from KenLM's opaque byte buffer to a tensor of context token IDs (or a KV-cache), but the beam search logic and API contract are identical.

## 5. Training Pipeline (GPU)

### 5.1 Data Preparation

1. **Corpus**: Use the same Vietnamese corpus (`data/corpus-full.txt`) that currently trains KenLM.
2. **Tokenization**: Word-level tokenizer matching the V7 dictionary. Each Vietnamese syllable is one token. Build vocabulary from corpus frequency (top 30k–50k words + `<unk>`, `<bos>`, `<eos>`).
3. **Sequences**: Split corpus into fixed-length chunks (32–64 tokens) for training.

### 5.2 Training

Train using **PyTorch** on GPU with standard autoregressive language modeling:

```
Loss = CrossEntropy(model(x[0:n-1]), x[1:n])
```

**Training configuration:**
- **Optimizer**: AdamW, learning rate 3e-4 with cosine schedule
- **Batch size**: 128–256 (adjust for GPU memory)
- **Epochs**: 10–30 over the full corpus
- **Hardware**: Single GPU (RTX 3060 or better) is sufficient for this model size
- **Training time**: Estimated 2–8 hours depending on corpus size and GPU

### 5.3 Knowledge Distillation (Optional Enhancement)

For maximum accuracy, use a two-stage approach:

1. **Teacher model**: Train a larger model (50M–100M parameters, 12 layers) on GPU. This model achieves the highest accuracy but is too slow for CPU inference.
2. **Student model**: Train the small model (5M–15M parameters) to mimic the teacher's output probability distribution, not just the ground truth. This transfers the teacher's "soft knowledge" into the compact student.

```
Loss = α * CrossEntropy(student, ground_truth)
     + (1-α) * KL_Divergence(student_logits / T, teacher_logits / T)
```

Where `T` is the temperature (typically 2–4) and `α` balances the two objectives.

### 5.4 Export to ONNX

After training, export the model to ONNX format for optimized CPU inference:

```python
import torch

# model = trained PyTorch model
dummy_input = torch.randint(0, vocab_size, (1, 64))  # (batch, seq_len)
torch.onnx.export(
    model,
    dummy_input,
    "v7_lm.onnx",
    input_names=["input_ids"],
    output_names=["logits"],
    dynamic_axes={"input_ids": {0: "batch", 1: "seq_len"},
                  "logits": {0: "batch", 1: "seq_len"}},
    opset_version=17,
)
```

## 6. Inference Pipeline (CPU)

### 6.1 ONNX Runtime via `ort` Crate (Primary Recommendation)

**ONNX Runtime** is a battle-tested, production-grade inference engine from Microsoft. The `ort` crate provides ergonomic Rust bindings.

**Why ONNX Runtime:**
- Automatic graph optimizations (operator fusion, constant folding, memory planning)
- CPU-specific kernel optimizations for x86-64 (AVX2/AVX-512) and ARM64 (NEON)
- INT8 quantization support with minimal accuracy loss
- Used in production by Microsoft (Office, Bing), Google (Magika), Hugging Face (Text Embeddings Inference), Supabase, and many more
- The `ort` crate is actively maintained, well-documented, and production-ready

**Integration sketch (Rust):**

```rust
use ort::session::Session;

struct NeuralLM {
    session: Session,
    vocab: Vec<String>,
}

impl NeuralLM {
    fn new(model_path: &str) -> Result<Self> {
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(model_path)?;
        // load vocabulary...
        Ok(Self { session, vocab })
    }

    fn score(&self, context: &[u32], candidate: u32) -> f32 {
        // Run model: input_ids -> logits
        // Extract log_prob for candidate token from last position
        let outputs = self.session.run(ort::inputs!["input_ids" => context])?;
        let logits = outputs["logits"].try_extract_array::<f32>()?;
        // log_softmax over vocabulary, return score for candidate
        log_softmax(&logits, candidate)
    }
}
```

**Cargo.toml addition:**

```toml
[dependencies]
ort = "=2.0.0-rc.12"
```

### 6.2 Candle (Pure Rust Alternative)

**Candle** is Hugging Face's Rust-native ML framework. It requires no C++ dependencies and compiles to a single binary.

**Why consider Candle:**
- Pure Rust — no FFI, no external shared libraries
- Supports GGUF quantized models
- Can compile to WebAssembly for browser deployment
- Ideal if the goal is a single statically-linked binary

**Trade-offs:**
- Smaller ecosystem than ONNX Runtime
- Fewer automatic optimizations compared to ONNX Runtime's graph optimizer
- Manual implementation of model architecture required

**Integration sketch:**

```rust
use candle_core::{Device, Tensor};
use candle_nn::{VarBuilder, Module};

struct CandleLM {
    model: TransformerModel,  // custom implementation
    device: Device,
}

impl CandleLM {
    fn new(weights_path: &str) -> Result<Self> {
        let device = Device::Cpu;
        let var_builder = VarBuilder::from_file(weights_path, DType::F32, &device)?;
        let model = TransformerModel::load(var_builder)?;
        Ok(Self { model, device })
    }
}
```

**Cargo.toml addition:**

```toml
[dependencies]
candle-core = "0.8"
candle-nn = "0.8"
candle-transformers = "0.8"
```

### 6.3 Burn Framework (Rust-Native, Multi-Backend)

**Burn** is a comprehensive Rust deep learning framework supporting multiple backends.

**Why consider Burn:**
- Native Rust with swappable backends (CPU, WASM, GPU)
- Can import ONNX models directly as Rust code
- Supports `no_std` environments for embedded deployment
- Built-in training and inference in one framework

**Trade-offs:**
- Younger ecosystem, still in active development
- ONNX operator coverage is still expanding

## 7. Model Quantization

Quantization is essential for CPU inference performance. It reduces model size and leverages integer arithmetic hardware.

### 7.1 Post-Training Quantization (PTQ)

Apply quantization after training without retraining:

| Technique | Precision | Size Reduction | Accuracy Impact | CPU Speedup |
|:---|:---|:---|:---|:---|
| **Dynamic INT8** | 8-bit integers | ~4× | Minimal (<1% perplexity) | 1.5–2× |
| **Static INT8** | 8-bit integers (calibrated) | ~4× | Very small | 2–3× |
| **INT4 (RTN)** | 4-bit integers | ~8× | Small (1–3% perplexity) | 2–4× |

**Recommended: Dynamic INT8 quantization** via ONNX Runtime's built-in quantizer:

```python
from onnxruntime.quantization import quantize_dynamic, QuantType

quantize_dynamic(
    "v7_lm.onnx",
    "v7_lm_int8.onnx",
    weight_type=QuantType.QInt8,
)
```

This typically reduces a 40 MB FP32 model to ~10 MB INT8 with negligible accuracy loss.

### 7.2 Quantization-Aware Training (QAT)

For maximum accuracy with quantization, simulate quantization during training:

1. Insert fake quantization nodes into the model
2. Train with simulated low-precision arithmetic
3. Export the quantization parameters alongside the model

QAT typically recovers 0.5–1% of the accuracy lost by PTQ, which can be meaningful for edge cases.

### 7.3 Advanced: Binary/Ternary Quantization

Recent research (BitNet, BitNet b1.58) demonstrates that 1-bit and 1.58-bit (ternary: {-1, 0, 1}) models can match full-precision performance for language modeling. For our small model:

- Replace `nn.Linear` with `BitLinear` layers
- Weights are stored as ternary values ({-1, 0, 1})
- Multiplications become additions/subtractions — pure integer CPU operations
- Model size reduced by 10–16× compared to FP32

This is an active research area but shows exceptional promise for CPU-only deployment.

## 8. Rust Integration Options

### 8.1 Comparison Matrix

| Approach | Binary Size | Dependencies | CPU Optimization | WASM Support | Maturity |
|:---|:---|:---|:---|:---|:---|
| **ort (ONNX Runtime)** | ~20 MB (dynamic) | ONNX Runtime C++ | Excellent (AVX2/512, VNNI) | ✅ (via tract backend) | Production-grade |
| **Candle** | ~5 MB (static) | None (pure Rust) | Good (optimized kernels) | ✅ (native) | Growing |
| **Burn** | ~5 MB (static) | None (pure Rust) | Good (NdArray/CubeCL) | ✅ (native) | Growing |
| **tract** | ~3 MB (static) | None (pure Rust) | Good | ✅ (native) | Stable |
| **KenLM (current)** | ~2 MB (static) | KenLM C++ | N/A (not neural) | ❌ | Mature |

### 8.2 Primary Recommendation: `ort` (ONNX Runtime)

The `ort` crate is the strongest choice for production deployment:

1. **Highest CPU performance** due to ONNX Runtime's hardware-specific optimized kernels
2. **Broadest model compatibility** — any PyTorch model exported to ONNX works
3. **Built-in quantization** — load INT8/INT4 models directly
4. **Active maintenance** — backed by Microsoft, used in production at scale
5. **Cross-platform** — Linux, macOS, Windows, Android, WASM (via tract fallback)

### 8.3 Secondary Recommendation: Candle (for single-binary deployment)

If the deployment goal is a single, statically-linked Rust binary with zero external dependencies (e.g., for distribution as a standalone desktop application), Candle is the better choice. The model weights are loaded from a safetensors or GGUF file, and all inference logic is pure Rust.

## 9. Alternative Approaches Considered

### 9.1 Higher-Order N-grams (KenLM 5-gram/7-gram)

- **Pros**: No code changes, just retrain with `-o 5` or `-o 7`
- **Cons**: Diminishing returns; 5-gram model is ~4× larger with marginal accuracy gain; still no semantic understanding
- **Verdict**: Incremental improvement, not a generational leap

### 9.2 General-Purpose LLMs (Llama, Phi, Qwen)

- **Pros**: State-of-the-art accuracy, massive pre-trained knowledge
- **Cons**: Even the smallest (1B–3B parameters) are far too large and slow for real-time keyboard input on CPU; INT4-quantized 1B model takes ~50–200ms per token
- **Verdict**: Overkill; the constrained V7 search space does not need general intelligence

### 9.3 RNN/LSTM Language Models

- **Pros**: Sequential processing, simple architecture, small models possible
- **Cons**: Inferior to transformers at equal parameter count; no parallelism during training; attention mechanism provides better long-range context
- **Verdict**: Transformers have superseded RNNs for language modeling

### 9.4 CTranslate2

- **Pros**: Highly optimized C++ inference for transformer models; excellent CPU benchmarks; supports INT8/INT16 quantization
- **Cons**: Primarily Python/C++ API; no native Rust bindings; adds a significant C++ dependency; project is in maintenance mode
- **Verdict**: Strong option if a Python-based server were acceptable, but does not fit the Rust-centric architecture

### 9.5 Mamba / State Space Models

- **Pros**: Linear-time inference (vs. quadratic for attention); potentially faster for long sequences
- **Cons**: Newer architecture with less tooling support; V7 context windows are short (32–64 tokens) where attention is already efficient
- **Verdict**: Worth monitoring for future consideration but premature for this use case

## 10. Implementation Roadmap

### Phase 1: Training Infrastructure (GPU)

- [ ] Design vocabulary matching current KenLM word list
- [ ] Implement word-level tokenizer for Vietnamese
- [ ] Implement small transformer LM in PyTorch
- [ ] Train on existing Vietnamese corpus (`data/corpus-full.txt`)
- [ ] Evaluate perplexity vs. KenLM 3-gram baseline
- [ ] Export trained model to ONNX format

### Phase 2: CPU Inference Integration (Rust)

- [ ] Add `ort` crate to `inference-rs/Cargo.toml`
- [ ] Implement `NeuralLM` struct wrapping ONNX Runtime session
- [ ] Implement `score(context, word) -> log_prob` matching KenLM API
- [ ] Adapt beam search to use neural scoring
- [ ] Apply INT8 dynamic quantization to ONNX model

### Phase 3: Optimization and Benchmarking

- [ ] Benchmark latency per syllable (target: <10ms)
- [ ] Benchmark end-to-end sentence prediction accuracy
- [ ] Compare accuracy against KenLM baseline on test set
- [ ] Profile and optimize hot paths (batch scoring, KV-cache reuse)
- [ ] Test on target hardware (consumer x86-64 and ARM64 CPUs)

### Phase 4: Knowledge Distillation (Optional)

- [ ] Train larger teacher model (50M–100M parameters)
- [ ] Distill into compact student model
- [ ] Re-evaluate accuracy gains vs. training cost

## 11. Performance Targets

| Metric | Current (KenLM) | Target (Neural) |
|:---|:---|:---|
| **Latency per syllable** | <1ms | <10ms |
| **End-to-end sentence latency** | <5ms | <50ms |
| **Model size on disk** | ~50 MB (lm.binary) | <50 MB (INT8 ONNX) |
| **Memory usage** | ~100 MB | <200 MB |
| **Top-1 accuracy** | Good | Significantly better |
| **Context window** | 2 words (3-gram) | 32–64 words |
| **External dependencies** | KenLM C++ | ONNX Runtime (or pure Rust via Candle) |

Note: latency increases are acceptable because the neural model provides substantially better accuracy. The sub-10ms-per-syllable target ensures the user still perceives zero-latency typing.

## 12. References

1. **ONNX Runtime** — Microsoft. Cross-platform ML model accelerator. https://onnxruntime.ai/
2. **ort crate** — Rust bindings for ONNX Runtime. https://crates.io/crates/ort / https://ort.pyke.io/
3. **Candle** — Hugging Face. Minimalist Rust ML framework. https://github.com/huggingface/candle
4. **Burn** — Tracel AI. Rust deep learning framework. https://github.com/tracel-ai/burn
5. **GGML** — Georgi Gerganov. C tensor library for ML with quantization. https://github.com/ggerganov/ggml
6. **CTranslate2** — OpenNMT. Efficient Transformer inference on CPU/GPU. https://github.com/OpenNMT/CTranslate2
7. **BitNet** — Ma et al. 1-bit Transformer architecture. arXiv:2310.11453
8. **BitNet b1.58** — Ma et al. Ternary weight LLMs. arXiv:2402.17764
9. **ONNX Runtime Quantization** — https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
10. **Hugging Face Optimum** — ONNX export and quantization tools. https://huggingface.co/docs/optimum/
11. **mistral.rs** — Rust LLM inference with ISQ, GGUF, GPTQ support. https://github.com/EricLBuehler/mistral.rs
12. **rust-bert** — Rust NLP pipelines with tch and ONNX Runtime backends. https://github.com/guillaume-be/rust-bert
13. **Knowledge Distillation** — Hinton et al., 2015. "Distilling the Knowledge in a Neural Network." arXiv:1503.02531
14. **Wu et al., 2016** — "Google's Neural Machine Translation System." arXiv:1609.08144 (INT8 quantization formula)
