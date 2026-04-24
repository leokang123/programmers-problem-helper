FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    clang \
    coreutils \
    libclang-rt-dev \
    libc++-dev \
    libc++abi-dev \
    lld \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/Programmers
