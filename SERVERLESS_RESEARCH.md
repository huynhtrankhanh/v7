# Serverless Feasibility & Deployment Notes

## Can this run serverless?
- **Yes, via container-based serverless platforms.** The inference app is an Axum HTTP server with no mutable state; it only needs `generated_regexes.json` and the KenLM model file at startup.
- **Primary constraint:** loading the KenLM binary language model (`lm.binary`, typically 100MB+) at cold start. Expect a noticeable warm-up unless provisioned/warmed. Build-time C++ dependencies (Boost, zlib, bzip2, lzma) are only needed in the image build stage.
- **Mocked path:** compiling with `--features mocked-model` skips KenLM and is suitable for lightweight demos or smoke tests.

## Recommended: AWS Lambda (Container Image + AWS Lambda Web Adapter)
Use a two-stage image so heavy build tooling stays out of the runtime, and rely on the Lambda Web Adapter to bridge HTTP traffic to Axum.

**Sketch Dockerfile (conceptual):**
```Dockerfile
FROM rust:1.80 AS builder
RUN apt-get update && apt-get install -y cmake g++ git zlib1g-dev libbz2-dev liblzma-dev libboost-all-dev
WORKDIR /app
COPY kenlm ./kenlm
RUN cd kenlm && mkdir -p build && cd build && cmake .. && make -j$(nproc)
COPY inference-rs ./inference-rs
COPY generated_regexes.json ./generated_regexes.json
# Use mocked-model for lightweight builds; drop the feature to include KenLM.
RUN cd inference-rs && cargo build --release --features mocked-model

FROM public.ecr.aws/lambda/provided:al2
# Adapter wires API Gateway/Lambda URLs to the Axum HTTP server.
ADD https://github.com/awslabs/aws-lambda-web-adapter/releases/latest/download/aws-lambda-adapter /opt/extensions/aws-lambda-adapter
RUN chmod +x /opt/extensions/aws-lambda-adapter
COPY --from=builder /app/inference-rs/target/release/inference-rs /var/task/inference-rs
COPY generated_regexes.json /var/task/
COPY static /var/task/static
# Option A: bake the model if size fits; Option B: mount via EFS or download from S3 to /tmp at init.
# COPY lm.binary /var/task/
ENV PORT=8080 AWS_LWA_PORT=8080 AWS_LWA_READINESS_CHECK_PATH=/
CMD ["/var/task/inference-rs","--server","--port","8080","--static_dir","/var/task/static","--model_path","/var/task/lm.binary"]
```

**Deployment outline:**
1) `docker build -t <account>.dkr.ecr.<region>.amazonaws.com/v7-lambda:latest .`
2) Push to ECR and create a Lambda function with `Package type: Image`.
3) Configure **memory/timeout** generously (≥1024 MB, 20–30s) and enable **Provisioned Concurrency** for predictable cold starts.
4) Provide the model: bake it into the image (if within limits), mount EFS, or download from S3 on cold start and point `--model_path` to `/tmp/lm.binary`.
5) Expose via Function URL or API Gateway; `/infer` remains the primary POST endpoint, `/` serves static assets, `/plover/*` is optional.

## Alternative: GCP Cloud Run (no adapter needed)
- Build with the existing Dockerfile or a slimmer multi-stage variant; ensure the server binds to `$PORT`:
  - `CMD ["./inference-rs/target/release/inference-rs","--server","--port","${PORT:-8080}"]`
- Deploy with `gcloud run deploy ... --image <image> --memory 1Gi --timeout 30s`.
- Provide `lm.binary` by baking it into the image (size allows up to 10GB), or download from Cloud Storage/EFS-equivalent on startup and set `--model_path`.

## Operational notes
- **Cold start mitigation:** keep the model on fast storage (baked image or EFS), use provisioned/low-scale-min settings, and consider the mocked-model build for staging.
- **Plover proxy:** optional; leave `STRIPPED_PLOVER_HOST/PORT` unset to disable.
- **Static assets:** served from `static/`; no extra work needed.
- **Health/readiness:** the adapter can use `/` as a readiness probe; the Axum server starts only after the model (or mocked model) is loaded.
