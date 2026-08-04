FROM debian:bookworm-slim

RUN mkdir /submission /model && chmod 755 /submission /model
USER 65534:65534
WORKDIR /tmp
CMD ["/bin/true"]
