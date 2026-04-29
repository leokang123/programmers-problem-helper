#!/usr/bin/env bash

set -euo pipefail

workspace_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
extensions_dir="${HOME}/.vscode-server/extensions"
target="${extensions_dir}/local.programmers-problem-helper"
profile="${extensions_dir}/extensions.json"
obsolete="${extensions_dir}/.obsolete"

mkdir -p "${extensions_dir}"

if [ -L "${target}" ] || [ -e "${target}" ]; then
  rm -rf "${target}"
fi

ln -s "${workspace_dir}" "${target}"
echo "[devcontainer] linked ${target} -> ${workspace_dir}"

EXTENSIONS_DIR="${extensions_dir}" TARGET="${target}" WORKSPACE_DIR="${workspace_dir}" PROFILE="${profile}" OBSOLETE="${obsolete}" node <<'NODE'
const fs = require("fs");
const path = require("path");

const extensionsDir = process.env.EXTENSIONS_DIR;
const target = process.env.TARGET;
const workspaceDir = process.env.WORKSPACE_DIR;
const profile = process.env.PROFILE;
const obsoletePath = process.env.OBSOLETE;
const packagePath = path.join(workspaceDir, "package.json");
const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const extensionId = `${manifest.publisher}.${manifest.name}`;

let extensions = [];
if (fs.existsSync(profile)) {
  extensions = JSON.parse(fs.readFileSync(profile, "utf8"));
}

extensions = extensions.filter((extension) => {
  const id = extension?.identifier?.id;
  const relativeLocation = extension?.relativeLocation;
  return id !== extensionId && relativeLocation !== path.basename(target);
});

extensions.push({
  identifier: { id: extensionId },
  version: manifest.version,
  location: {
    $mid: 1,
    path: target,
    scheme: "file",
  },
  relativeLocation: path.basename(target),
  metadata: {
    installedTimestamp: Date.now(),
    source: "local",
  },
});

fs.mkdirSync(extensionsDir, { recursive: true });
fs.writeFileSync(profile, JSON.stringify(extensions));

if (fs.existsSync(obsoletePath)) {
  const obsolete = JSON.parse(fs.readFileSync(obsoletePath, "utf8"));
  for (const key of Object.keys(obsolete)) {
    if (key === `${extensionId}-${manifest.version}` || key.startsWith(`${extensionId}-`)) {
      delete obsolete[key];
    }
  }
  fs.writeFileSync(obsoletePath, JSON.stringify(obsolete));
}

console.log(`[devcontainer] registered ${extensionId} in ${profile}`);
NODE
