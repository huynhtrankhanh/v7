FROM node:22 AS frontend
WORKDIR /app

# Install and build the web assets (Vite + TypeScript)
COPY package.json package-lock.json tsconfig.json tsconfig.jest.json vite.config.ts ./
COPY src ./src
COPY static ./static
RUN npm ci
RUN npm run build

FROM rust:latest AS builder

# Install build dependencies for KenLM
RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    git \
    zlib1g-dev \
    libbz2-dev \
    liblzma-dev \
    libboost-all-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download and compile KenLM
# We clone into /app/kenlm so that it is a sibling of inference-rs as expected by build.rs
RUN git clone https://github.com/kpu/kenlm.git
WORKDIR /app/kenlm
RUN mkdir -p build \
    && cd build \
    && cmake .. \
    && make -j$(nproc)

WORKDIR /app

# Copy Rust project
COPY inference-rs ./inference-rs

# Build Rust project
WORKDIR /app/inference-rs
RUN cargo build --release

# ---------------------------------------------------------------------------
# Training stage: Python + tqdm + KenLM binaries
# Use this stage to preprocess the corpus and train the language model.
# Run via:  docker compose run --rm train bash train_lm.sh
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS train

RUN apt-get update && apt-get install -y \
    cmake \
    g++ \
    git \
    zlib1g-dev \
    libbz2-dev \
    liblzma-dev \
    libboost-all-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy KenLM binaries from the builder stage
COPY --from=builder /app/kenlm ./kenlm

# Install Python dependencies (includes underthesea)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy training scripts and compile the C++ preprocessor.
# The C++ version streams files line-by-line, keeping memory usage low even
# for datasets in the tens of gigabytes (unlike the Python version which loads
# entire files with f.read()).
COPY preprocess_corpus.cpp preprocess_corpus.py train_lm.sh ./
RUN g++ -O2 -std=c++17 -o preprocess_corpus preprocess_corpus.cpp

FROM rust:latest
WORKDIR /app

# Runtime deps for inference binary only (KenLM and web assets copied from builders)
COPY --from=builder /app/inference-rs/target/release/inference-rs ./inference-rs/target/release/inference-rs
COPY --from=builder /app/kenlm ./kenlm
COPY --from=frontend /app/static ./static

# Entrypoint runs the binary
# Usage: docker run ... <v7_string>
# Arguments are passed to the binary
ENTRYPOINT ["./inference-rs/target/release/inference-rs", "--server"]
