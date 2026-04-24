FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends clang lldb \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
