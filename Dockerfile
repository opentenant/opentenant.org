# syntax=docker/dockerfile:1

# ---- build stage ----
FROM rust:1.99-slim-bookworm AS builder
WORKDIR /app

COPY . .

RUN cargo build --release

# ---- runtime stage ----
# distroless/cc: glibc + libgcc + CA certs, no shell, runs as non-root.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=builder /app/target/release/opentenant-website /usr/local/bin/opentenant-website

ENV RUST_LOG=info
USER nonroot
ENTRYPOINT ["/usr/local/bin/logs-processor"]