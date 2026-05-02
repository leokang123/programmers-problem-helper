const cp = require("child_process");
const fs = require("fs");
const path = require("path");

function collectJavaScriptFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(filePath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(filePath);
    }
  }

  return files;
}

const files = [
  path.join(__dirname, "..", "extension.js"),
  ...collectJavaScriptFiles(path.join(__dirname, "..", "src")),
];

function hasNamespaceRequire(text, name, moduleName) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:const|let|var)\\s+${escapedName}\\s*=\\s*require\\(["']${escapedModule}["']\\)`).test(text);
}

function checkRequiredNamespaceImports(filesToCheck) {
  const namespaces = [
    { name: "cp", moduleName: "child_process" },
    { name: "crypto", moduleName: "crypto" },
    { name: "os", moduleName: "os" },
  ];
  const failures = [];

  for (const file of filesToCheck) {
    const text = fs.readFileSync(file, "utf8");
    for (const namespace of namespaces) {
      if (!new RegExp(`\\b${namespace.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`).test(text)) {
        continue;
      }
      if (!hasNamespaceRequire(text, namespace.name, namespace.moduleName)) {
        failures.push(`${file}: uses ${namespace.name}.* without const ${namespace.name} = require("${namespace.moduleName}")`);
      }
    }
  }

  return failures;
}

function checkClassOwnMethodCalls(file, className) {
  const text = fs.readFileSync(file, "utf8");
  const classStart = text.indexOf(`class ${className}`);
  if (classStart === -1) {
    return [`${file}: class ${className} not found`];
  }

  const classText = text.slice(classStart);
  const methods = new Set();
  const methodPattern = /^  (?:async\s+)?(?:get\s+)?([A-Za-z_$][\w$]*)\s*\(/gm;
  for (const match of classText.matchAll(methodPattern)) {
    methods.add(match[1]);
  }

  const missing = new Set();
  const callPattern = /\bthis\.([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of classText.matchAll(callPattern)) {
    const methodName = match[1];
    if (!methods.has(methodName)) {
      missing.add(methodName);
    }
  }

  return [...missing].sort().map((methodName) => `${file}: ${className} calls this.${methodName}(...) but no method is declared on the class`);
}

for (const file of files) {
  const result = cp.spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const staticFailures = [
  ...checkRequiredNamespaceImports(files),
  ...checkClassOwnMethodCalls(path.join(__dirname, "..", "src", "sync", "syncConflictActions.js"), "SyncConflictController"),
];

if (staticFailures.length > 0) {
  for (const failure of staticFailures) {
    console.error(failure);
  }
  process.exit(1);
}
