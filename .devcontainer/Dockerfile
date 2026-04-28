FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    clang \
    lldb \
    default-jdk-headless \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
