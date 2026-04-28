FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

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
    openjdk-21-jdk-headless \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/Programmers
