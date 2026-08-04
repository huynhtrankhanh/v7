FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libbz2-1.0 \
    libgcc-s1 \
    liblzma5 \
    libstdc++6 \
    zlib1g \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /submission /model && chmod 755 /submission /model
USER 65534:65534
WORKDIR /tmp
CMD ["/bin/true"]
