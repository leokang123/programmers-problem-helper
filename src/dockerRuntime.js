const cp = require("child_process");
const path = require("path");
const {
  DOCKER_CONTAINER_PREFIX,
  DOCKER_IMAGE,
  DOCKER_WORKSPACE_ROOT,
  getDockerfilePath,
} = require("./config");

const runtimeCache = {
  dockerAvailable: false,
  imageAvailable: false,
};

// 문제를 열 때 Docker 런타임을 준비하고 상태 메시지를 만듭니다.
async function prepareDockerRuntimeOnOpen({ vscode, extensionDir, problemDir, execCommand, limitStatusText, postStatus }) {
  postStatus?.({
    type: "status",
    kind: "running",
    text: "실행 컨테이너 준비 중...\n\n컴파일 및 테스트용 Docker 컨테이너를 확인하고 있습니다.",
  });

  try {
    const runtime = await ensureDockerRuntimeReady({ vscode, extensionDir, problemDir, execCommand });
    const mode = vscode.env.remoteName === "dev-container" ? "개발판: Dev Container + 실행 컨테이너" : "배포판: 로컬 + 실행 컨테이너";
    return { kind: "ready", detail: `${mode}\n${runtime.containerName}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", detail: `Docker 준비 실패\n${limitStatusText(message, 240)}` };
  }
}

// Docker 이미지와 실행 컨테이너를 사용할 수 있게 보장합니다.
async function ensureDockerRuntimeReady({ vscode, extensionDir, problemDir, execCommand }) {
  const hadCachedReadiness = runtimeCache.dockerAvailable || runtimeCache.imageAvailable;
  try {
    return await ensureDockerRuntimeReadyOnce({ vscode, extensionDir, problemDir, execCommand });
  } catch (error) {
    if (!hadCachedReadiness) {
      throw error;
    }

    invalidateRuntimeCache();
    return ensureDockerRuntimeReadyOnce({ vscode, extensionDir, problemDir, execCommand });
  }
}

async function ensureDockerRuntimeReadyOnce({ vscode, extensionDir, problemDir, execCommand }) {
  const programmersDir = path.dirname(problemDir);
  const containerName = getDockerContainerName(programmersDir);
  const mountSource = getDockerMountSource(vscode, programmersDir);
  const problemPath = getDockerProblemPath(programmersDir, problemDir);

  await ensureDockerAvailable({ vscode, execCommand });
  await ensureDockerImageAvailable({ extensionDir, execCommand });

  const inspect = await execCommand("docker", ["inspect", "--format", "{{.State.Running}}", containerName], {
    allowNonZeroExit: true,
  });

  if (inspect.code !== 0) {
    await execCommand("docker", [
      "create",
      "--name",
      containerName,
      "--workdir",
      DOCKER_WORKSPACE_ROOT,
      "-v",
      `${mountSource}:${DOCKER_WORKSPACE_ROOT}`,
      "--entrypoint",
      "tail",
      DOCKER_IMAGE,
      "-f",
      "/dev/null",
    ]);
    await execCommand("docker", ["start", containerName]);
  } else if (inspect.stdout.trim() !== "true") {
    await execCommand("docker", ["start", containerName]);
  }

  return { containerName, problemPath, mountSource };
}

// 실행 중인 helper 컨테이너들을 모두 멈춥니다.
async function stopDockerRuntimeContainers({ execCommand }) {
  const list = await execCommand("docker", [
    "ps",
    "--filter",
    `name=^/${DOCKER_CONTAINER_PREFIX}`,
    "--filter",
    "status=running",
    "--format",
    "{{.Names}}",
  ], {
    allowNonZeroExit: true,
  });

  const names = list.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (names.length === 0) {
    return [];
  }

  await execCommand("docker", ["stop", ...names], {
    allowNonZeroExit: true,
  });
  return names;
}

// VS Code 종료를 막지 않도록 Docker stop을 별도 프로세스에 맡깁니다.
function stopDockerRuntimeContainersInBackground() {
  const script = `
const cp = require("child_process");
function run(args) {
  try {
    return cp.spawnSync("docker", args, { encoding: "utf8" });
  } catch {
    return { status: 1, stdout: "", stderr: "" };
  }
}
const list = run([
  "ps",
  "--filter",
  ${JSON.stringify(`name=^/${DOCKER_CONTAINER_PREFIX}`)},
  "--filter",
  "status=running",
  "--format",
  "{{.Names}}",
]);
if (list.status !== 0) {
  process.exit(0);
}
const names = String(list.stdout || "")
  .split(/\\r?\\n/)
  .map((line) => line.trim())
  .filter(Boolean);
if (names.length === 0) {
  process.exit(0);
}
run(["stop", ...names]);
`;

  try {
    const child = cp.spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// Docker CLI가 실행 가능한지 확인합니다.
async function ensureDockerAvailable({ vscode, execCommand }) {
  if (runtimeCache.dockerAvailable) {
    return;
  }

  let result;
  try {
    result = await execCommand("docker", ["version", "--format", "{{.Server.Version}}"], {
      allowNonZeroExit: true,
      timeoutMs: 5000,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      const remoteHint = getRemoteDockerHint(vscode);
      throw new Error(`Docker를 찾지 못했습니다.\nDocker Desktop 또는 docker 엔진을 설치한 뒤 다시 시도해주세요.${remoteHint ? `\n${remoteHint}` : ""}`);
    }
    throw error;
  }

  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    const remoteHint = getRemoteDockerHint(vscode);
    throw new Error(`Docker 실행을 확인하지 못했습니다.${detail ? `\n${detail}` : ""}${remoteHint ? `\n${remoteHint}` : ""}`);
  }

  runtimeCache.dockerAvailable = true;
}

// Dev Container 환경에서 필요한 Docker 안내 문구를 만듭니다.
function getRemoteDockerHint(vscode) {
  if (vscode.env.remoteName !== "dev-container") {
    return "";
  }
  return "현재 개발판은 Dev Container 안에서 실행되지만, 컴파일 및 실행은 호스트 Docker daemon에 붙는 sibling 실행 컨테이너에서 진행됩니다. Dev Container를 다시 빌드한 뒤 다시 시도해주세요.";
}

// 런타임 이미지가 없으면 Dockerfile로 빌드합니다.
async function ensureDockerImageAvailable({ extensionDir, execCommand }) {
  if (runtimeCache.imageAvailable) {
    return;
  }

  const inspect = await execCommand("docker", ["image", "inspect", DOCKER_IMAGE], {
    allowNonZeroExit: true,
  });
  if (inspect.code === 0) {
    runtimeCache.imageAvailable = true;
    return;
  }

  await execCommand("docker", ["build", "-t", DOCKER_IMAGE, "-f", getDockerfilePath(extensionDir), extensionDir], {
    cwd: extensionDir,
  });
  runtimeCache.imageAvailable = true;
}

function invalidateRuntimeCache() {
  runtimeCache.dockerAvailable = false;
  runtimeCache.imageAvailable = false;
}

// Programmers 폴더별 고정 컨테이너 이름을 만듭니다.
function getDockerContainerName(programmersDir) {
  return `${DOCKER_CONTAINER_PREFIX}${hashText(path.resolve(programmersDir))}`;
}

// Docker 마운트에 사용할 호스트 경로를 구합니다.
function getDockerMountSource(vscode, programmersDir) {
  if (vscode.env.remoteName === "dev-container") {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const hostWorkspace = process.env.PROGRAMMERS_HELPER_HOST_WORKSPACE;
    if (!workspaceFolder?.uri || !hostWorkspace) {
      throw new Error("Dev Container에서 호스트 워크스페이스 경로를 확인하지 못했습니다.\n`Dev Containers: Rebuild Container`를 실행한 뒤 다시 시도해주세요.");
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const relative = path.relative(workspacePath, programmersDir);
    if (relative.startsWith("..")) {
      throw new Error("개발판에서는 문제 폴더가 현재 워크스페이스 아래 `Programmers/`에 있어야 합니다.");
    }

    return path.join(hostWorkspace, relative);
  }

  return programmersDir;
}

// 컨테이너 안에서의 문제 폴더 경로를 계산합니다.
function getDockerProblemPath(programmersDir, problemDir) {
  const relative = path.relative(programmersDir, problemDir).split(path.sep).join(path.posix.sep);
  return path.posix.join(DOCKER_WORKSPACE_ROOT, relative);
}

// 짧은 해시 문자열을 만듭니다.
function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

module.exports = {
  ensureDockerRuntimeReady,
  prepareDockerRuntimeOnOpen,
  stopDockerRuntimeContainers,
  stopDockerRuntimeContainersInBackground,
};
