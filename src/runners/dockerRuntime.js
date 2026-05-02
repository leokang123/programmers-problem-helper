const cp = require("child_process");
const path = require("path");
const {
  DOCKER_CONTAINER_PREFIX,
  DOCKER_IMAGE,
  DOCKER_LOCAL_IMAGE,
  DOCKER_WORKSPACE_ROOT,
  getDockerfilePath,
} = require("../core/config");
const {
  getDockerRuntimeModeLabel,
} = require("../core/environment");

const SIDEBAR_VIEW_ID = "programmersHelper.sidebar";

const runtimeCache = {
  dockerAvailable: false,
  imageAvailable: false,
};

// 문제를 열 때 Docker runtime 준비를 시도하고 실패 시 사이드바 상태를 갱신합니다.
async function prepareDockerRuntimeOnOpen({ context, vscode, extensionDir, problemDir, execCommand, limitStatusText, postStatus }) {
  reportRuntimeStatus({ postStatus }, "컴파일 및 테스트용 Docker 컨테이너를 확인하고 있습니다.");

  try {
    const runtime = await ensureDockerRuntimeReady({ vscode, extensionDir, problemDir, execCommand, postStatus });
    const mode = getDockerRuntimeModeLabel(context);
    return { kind: "ready", detail: `${mode}\n${runtime.containerName}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", detail: `Docker 준비 실패\n${limitStatusText(message, 240)}` };
  }
}

// Docker image와 container가 테스트 실행 가능한 상태인지 확인합니다.
async function ensureDockerRuntimeReady({ vscode, extensionDir, problemDir, execCommand, postStatus, progress = true }) {
  if (progress === true) {
    return vscode.window.withProgress(
      {
        location: { viewId: SIDEBAR_VIEW_ID },
        title: "실행 컨테이너 준비 중...",
      },
      (progressReporter) => ensureDockerRuntimeReady({
        vscode,
        extensionDir,
        problemDir,
        execCommand,
        postStatus,
        progress: progressReporter,
      })
    );
  }

  const progressReporter = progress && typeof progress.report === "function" ? progress : undefined;
  const statusContext = { postStatus, progress: progressReporter, problemDir };
  const hadCachedReadiness = runtimeCache.dockerAvailable || runtimeCache.imageAvailable;
  try {
    return await ensureDockerRuntimeReadyOnce({ vscode, extensionDir, problemDir, execCommand, statusContext });
  } catch (error) {
    if (!hadCachedReadiness) {
      throw error;
    }

    reportRuntimeStatus(statusContext, "캐시된 Docker 상태를 다시 확인하고 있습니다.");
    invalidateRuntimeCache();
    return ensureDockerRuntimeReadyOnce({ vscode, extensionDir, problemDir, execCommand, statusContext });
  }
}

// progress wrapper 안에서 실제 Docker runtime 준비 단계를 한 번 수행합니다.
async function ensureDockerRuntimeReadyOnce({ vscode, extensionDir, problemDir, execCommand, statusContext }) {
  const programmersDir = path.dirname(problemDir);
  const containerName = getDockerContainerName(programmersDir);

  await ensureDockerAvailable({ execCommand, statusContext });
  const mountSource = getDockerMountSource(programmersDir);
  const problemPath = getDockerProblemPath(programmersDir, problemDir);
  await ensureDockerImageAvailable({ extensionDir, execCommand, statusContext });
  await ensureDockerContainerRunning({ containerName, mountSource, execCommand, statusContext });

  return { containerName, problemPath, mountSource };
}

// Programmers 저장소를 mount한 runtime container가 실행 중인지 보장합니다.
async function ensureDockerContainerRunning({ containerName, mountSource, execCommand, statusContext }) {
  reportRuntimeStatus(statusContext, `실행 컨테이너를 확인하고 있습니다.\n${containerName}`);
  const inspect = await execCommand("docker", ["inspect", "--format", "{{.State.Running}}", containerName], {
    allowNonZeroExit: true,
  });

  if (inspect.code !== 0) {
    reportRuntimeStatus(statusContext, `실행 컨테이너를 생성하고 있습니다.\n${containerName}`);
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
    reportRuntimeStatus(statusContext, `실행 컨테이너를 시작하고 있습니다.\n${containerName}`);
    await execCommand("docker", ["start", containerName]);
  } else if (inspect.stdout.trim() !== "true") {
    reportRuntimeStatus(statusContext, `중지된 실행 컨테이너를 시작하고 있습니다.\n${containerName}`);
    await execCommand("docker", ["start", containerName]);
  }
}

// 현재 extension이 만든 Docker runtime container들을 foreground에서 중지합니다.
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
    timeoutMs: 5000,
  });

  const names = list.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (names.length === 0) {
    return [];
  }

  await execCommand("docker", ["stop", ...names], {
    allowNonZeroExit: true,
    timeoutMs: 15000,
  });
  return names;
}

// extension 종료 시 VS Code 생명주기를 막지 않도록 Docker 정리를 백그라운드로 예약합니다.
function stopDockerRuntimeContainersInBackground() {
  const script = buildDockerCleanupScript();

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

// 백그라운드 node 프로세스가 실행할 Docker container 정리 스크립트를 만듭니다.
function buildDockerCleanupScript() {
  return `
const cp = require("child_process");
// 백그라운드 정리 프로세스에서 docker CLI 명령을 안전하게 실행합니다.
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
}

// docker CLI가 설치되어 있고 daemon에 접근 가능한지 확인합니다.
async function ensureDockerAvailable({ execCommand, statusContext }) {
  if (runtimeCache.dockerAvailable) {
    reportRuntimeStatus(statusContext, "Docker 실행 환경은 이미 확인되었습니다.");
    return;
  }

  reportRuntimeStatus(statusContext, "Docker 실행 환경을 확인하고 있습니다.");
  let result;
  try {
    result = await execCommand("docker", ["version", "--format", "{{.Server.Version}}"], {
      allowNonZeroExit: true,
      timeoutMs: 5000,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("Docker를 찾지 못했습니다.\nDocker Desktop 또는 docker 엔진을 설치한 뒤 다시 시도해주세요.");
    }
    throw error;
  }

  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`Docker 실행을 확인하지 못했습니다.${detail ? `\n${detail}` : ""}`);
  }

  runtimeCache.dockerAvailable = true;
}

// runtime image가 없으면 pull을 시도하고 실패 시 로컬 Dockerfile로 빌드합니다.
async function ensureDockerImageAvailable({ extensionDir, execCommand, statusContext }) {
  if (runtimeCache.imageAvailable) {
    reportRuntimeStatus(statusContext, `캐시된 런타임 이미지를 다시 확인하고 있습니다.\n${DOCKER_IMAGE}`);
  } else {
    reportRuntimeStatus(statusContext, `런타임 이미지를 확인하고 있습니다.\n${DOCKER_IMAGE}`);
  }

  const inspect = await execCommand("docker", ["image", "inspect", DOCKER_IMAGE], {
    allowNonZeroExit: true,
  });
  if (inspect.code === 0) {
    runtimeCache.imageAvailable = true;
    reportRuntimeStatus(statusContext, `런타임 이미지가 이미 있습니다.\n${DOCKER_IMAGE}`);
    return;
  }

  reportRuntimeStatus(statusContext, `Docker Hub에서 런타임 이미지를 다운로드하고 있습니다.\n${DOCKER_IMAGE}`);
  const pull = await execCommand("docker", ["pull", DOCKER_IMAGE], {
    allowNonZeroExit: true,
  });
  if (pull.code === 0) {
    runtimeCache.imageAvailable = true;
    reportRuntimeStatus(statusContext, `런타임 이미지 다운로드가 완료되었습니다.\n${DOCKER_IMAGE}`);
    return;
  }

  reportRuntimeStatus(statusContext, `이미지 다운로드에 실패해 로컬에서 빌드하고 있습니다.\n${DOCKER_LOCAL_IMAGE}`);
  await execCommand("docker", ["build", "-t", DOCKER_LOCAL_IMAGE, "-f", getDockerfilePath(extensionDir), extensionDir], {
    cwd: extensionDir,
  });
  reportRuntimeStatus(statusContext, `로컬 빌드 이미지를 런타임 이미지로 태그하고 있습니다.\n${DOCKER_IMAGE}`);
  await execCommand("docker", ["tag", DOCKER_LOCAL_IMAGE, DOCKER_IMAGE]);
  runtimeCache.imageAvailable = true;
}

// Docker 준비 상태를 사이드바 현재 문제 status로 전달합니다.
function reportRuntimeStatus(statusContext, detail) {
  const firstLine = String(detail || "").split(/\r?\n/)[0];
  statusContext?.progress?.report?.({ message: firstLine });
  statusContext?.postStatus?.({
    type: "status",
    kind: "running",
    problemDir: statusContext?.problemDir,
    text: `실행 컨테이너 준비 중...\n\n${detail}`,
  });
}

// Docker 설정 변경 후 image/container 확인 cache를 무효화합니다.
function invalidateRuntimeCache() {
  runtimeCache.dockerAvailable = false;
  runtimeCache.imageAvailable = false;
}

// 저장소별로 충돌하지 않는 Docker container 이름을 만듭니다.
function getDockerContainerName(programmersDir) {
  return `${DOCKER_CONTAINER_PREFIX}${hashText(path.resolve(programmersDir))}`;
}

// Docker mount에 사용할 Programmers 저장소의 host 경로를 계산합니다.
function getDockerMountSource(programmersDir) {
  return programmersDir;
}

// container 내부에서 현재 문제 폴더가 보이는 경로를 계산합니다.
function getDockerProblemPath(programmersDir, problemDir) {
  const relative = path.relative(programmersDir, problemDir).split(path.sep).join(path.posix.sep);
  return path.posix.join(DOCKER_WORKSPACE_ROOT, relative);
}

// container 이름에 넣을 짧고 안정적인 저장소 식별자를 만듭니다.
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
