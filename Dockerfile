FROM rust:latest

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

# Copy necessary project files
# We need 'ai' directory for runtime data (generated_regexes.json)
COPY ai ./ai

# Copy Rust project
COPY inference-rs ./inference-rs

# Build Rust project
WORKDIR /app/inference-rs
RUN cargo build --release

# Set working directory back to /app for runtime so paths (like ai/generated_regexes.json) align
WORKDIR /app

# Entrypoint runs the binary
# Usage: docker run ... <v7_string>
# Arguments are passed to the binary
ENTRYPOINT ["./inference-rs/target/release/inference-rs"]

