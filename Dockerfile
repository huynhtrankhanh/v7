# syntax=docker/dockerfile:1.7

FROM node:22 AS frontend-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM frontend-deps AS frontend
WORKDIR /app
# Build configuration and application sources change more often than dependencies.
COPY tsconfig.json tsconfig.jest.json vite.config.ts ./
COPY src ./src
COPY static ./static
RUN npm run build

FROM rust:1.88-bookworm AS kenlm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    cmake \
    g++ \
    git \
    libboost-program-options-dev \
    libboost-system-dev \
    libboost-test-dev \
    libboost-thread-dev \
    libbz2-dev \
    liblzma-dev \
    make \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Keep KenLM in its own stage so Rust or frontend changes do not rebuild it.
ARG KENLM_REF=master
RUN git clone --depth 1 --branch "${KENLM_REF}" https://github.com/kpu/kenlm.git /app/kenlm
WORKDIR /app/kenlm
RUN --mount=type=cache,target=/root/.cache/cmake \
    cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --parallel "$(nproc)"

FROM rust:1.88-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    libbz2-dev \
    liblzma-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=kenlm /app/kenlm ./kenlm

# Cache crate downloads and third-party compilation separately from local source edits.
WORKDIR /app/inference-rs
COPY inference-rs/Cargo.toml inference-rs/Cargo.lock ./
# Cargo validates that the manifest has a target before `cargo fetch`, even
# though fetching does not compile application sources.
RUN mkdir -p src && touch src/main.rs
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    cargo fetch --locked

COPY inference-rs/build.rs ./
COPY inference-rs/cpp ./cpp
COPY inference-rs/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/app/inference-rs/target \
    cargo build --release --locked \
    && cp /app/inference-rs/target/release/inference-rs /tmp/inference-rs

# ---------------------------------------------------------------------------
# Training stage: Python + tqdm + KenLM binaries
# Use this stage to preprocess the corpus and train the language model.
# Run via:  docker compose run --rm train bash train_lm.sh
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS train

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libbz2-1.0 \
    libgcc-s1 \
    libgomp1 \
    liblzma5 \
    libstdc++6 \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy KenLM binaries from the dedicated KenLM stage without rebuilding Rust.
COPY --from=kenlm /app/kenlm ./kenlm

# Install Python dependencies
COPY requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# Copy training scripts.
COPY train_lm.sh ./
COPY preprocess_corpus.py preprocess_corpus.cpp ./

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libbz2-1.0 \
    libgcc-s1 \
    liblzma5 \
    libstdc++6 \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

# Runtime deps for inference binary only (KenLM and web assets copied from builders)
COPY --from=builder /tmp/inference-rs ./inference-rs/target/release/inference-rs
COPY --from=kenlm /app/kenlm ./kenlm
COPY --from=frontend /app/static ./static

HEALTHCHECK --interval=10s --timeout=3s --start-period=60s --retries=3 \
    CMD curl --fail --silent --show-error http://localhost:3000/ > /dev/null || exit 1

# Entrypoint runs the binary
# Usage: docker run ... <v7_string>
# Arguments are passed to the binary
ENTRYPOINT ["./inference-rs/target/release/inference-rs", "--server"]
