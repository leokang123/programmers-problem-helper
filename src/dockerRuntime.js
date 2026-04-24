const path = require("path");
const cp = require("child_process");
const {
  DOCKER_CONTAINER_PREFIX,
  DOCKER_IMAGE,
  DOCKER_WORKSPACE_ROOT,
  getDockerfilePath,
} = require("./config");

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

async function ensureDockerRuntimeReady({ vscode, extensionDir, problemDir, execCommand }) {
  const programmersDir = path.dirname(problemDir);
  const containerName = getDockerContainerName(programmersDir);
  const mountSource = getDockerMountSource(vscode, programmersDir);
  const problemPath = getDockerProblemPath(programmersDir, problemDir);

  ensureDockerAvailable(vscode);
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

function ensureDockerAvailable(vscode) {
  const result = cp.spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    encoding: "utf8",
    timeout: 5000,
  });

  if (result.error?.code === "ENOENT") {
    const remoteHint = getRemoteDockerHint(vscode);
    throw new Error(`Docker를 찾지 못했습니다.\nDocker Desktop 또는 docker 엔진을 설치한 뒤 다시 시도해주세요.${remoteHint ? `\n${remoteHint}` : ""}`);
  }

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    const remoteHint = getRemoteDockerHint(vscode);
    throw new Error(`Docker 실행을 확인하지 못했습니다.${detail ? `\n${detail}` : ""}${remoteHint ? `\n${remoteHint}` : ""}`);
  }
}

function getRemoteDockerHint(vscode) {
  if (vscode.env.remoteName !== "dev-container") {
    return "";
  }
  return "현재 개발판은 Dev Container 안에서 실행되지만, 컴파일 및 실행은 호스트 Docker daemon에 붙는 sibling 실행 컨테이너에서 진행됩니다. Dev Container를 다시 빌드한 뒤 다시 시도해주세요.";
}

async function ensureDockerImageAvailable({ extensionDir, execCommand }) {
  const inspect = await execCommand("docker", ["image", "inspect", DOCKER_IMAGE], {
    allowNonZeroExit: true,
  });
  if (inspect.code === 0) {
    return;
  }

  await execCommand("docker", ["build", "-t", DOCKER_IMAGE, "-f", getDockerfilePath(extensionDir), extensionDir], {
    cwd: extensionDir,
  });
}

function getDockerContainerName(programmersDir) {
  return `${DOCKER_CONTAINER_PREFIX}${hashText(path.resolve(programmersDir))}`;
}

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

function getDockerProblemPath(programmersDir, problemDir) {
  const relative = path.relative(programmersDir, problemDir).split(path.sep).join(path.posix.sep);
  return path.posix.join(DOCKER_WORKSPACE_ROOT, relative);
}

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
};
