#!/usr/bin/env bash

set -euo pipefail

workspace_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
extensions_dir="${HOME}/.vscode-server/extensions"
target="${extensions_dir}/local.programmers-problem-helper"

mkdir -p "${extensions_dir}"

if [ -L "${target}" ] || [ -e "${target}" ]; then
  rm -rf "${target}"
fi

ln -s "${workspace_dir}" "${target}"
echo "[devcontainer] linked ${target} -> ${workspace_dir}"
