import { cp, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const workspaceRoot = process.cwd();
const templateDir = path.join(
  workspaceRoot,
  "extension-packages",
  "rmbg2-complete-template",
);
const defaultRuntimeSourceDir = path.join(
  workspaceRoot,
  "extension-packages",
  "qwen3-tts-complete",
  "runtime",
  "python",
);
const defaultOutputDir = path.join(
  workspaceRoot,
  "build",
  "extensions",
  "rmbg2-complete",
);
const defaultModelRepoIds = {
  modelscope: "AI-ModelScope/RMBG-2.0",
  huggingface: "briaai/RMBG-2.0",
};
const defaultTorchIndexUrl = "https://download.pytorch.org/whl/cu130";

function getRuntimeSourceCandidates() {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  return [
    defaultRuntimeSourceDir,
    process.env.RMBG2_PYTHON_RUNTIME_SOURCE
      ? path.resolve(process.env.RMBG2_PYTHON_RUNTIME_SOURCE)
      : null,
    localAppData
      ? path.join(localAppData, "Programs", "Python", "Python312")
      : null,
    localAppData
      ? path.join(localAppData, "Programs", "Python", "Python311")
      : null,
    localAppData
      ? path.join(localAppData, "Programs", "Python", "Python310")
      : null,
  ].filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    runtimeSource: null,
    output: defaultOutputDir,
    modelSource: null,
    modelRepoId: defaultModelRepoIds.modelscope,
    downloadSource: "modelscope",
    torchIndexUrl: defaultTorchIndexUrl,
    skipInstall: false,
  };
  let didOverrideModelRepoId = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--runtime-source" && argv[index + 1]) {
      options.runtimeSource = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--model-source" && argv[index + 1]) {
      options.modelSource = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--output" && argv[index + 1]) {
      options.output = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--model-repo" && argv[index + 1]) {
      options.modelRepoId = argv[index + 1];
      didOverrideModelRepoId = true;
      index += 1;
      continue;
    }
    if (arg === "--download-source" && argv[index + 1]) {
      options.downloadSource = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--torch-index-url" && argv[index + 1]) {
      options.torchIndexUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--skip-install") {
      options.skipInstall = true;
    }
  }

  if (!["modelscope", "huggingface"].includes(options.downloadSource)) {
    throw new Error(`Unsupported download source: ${options.downloadSource}`);
  }

  if (!didOverrideModelRepoId) {
    options.modelRepoId = defaultModelRepoIds[options.downloadSource];
  }

  if (!options.runtimeSource) {
    options.runtimeSource = getRuntimeSourceCandidates().find(Boolean) ?? null;
  }

  return options;
}

async function exists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureMissing(targetPath, label) {
  if (!(await exists(targetPath))) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

async function resolveExistingRuntimeSource(runtimeSource) {
  if (!runtimeSource) {
    return null;
  }

  const resolvedRuntimeSource = path.resolve(runtimeSource);
  const pythonExePath = path.join(resolvedRuntimeSource, "python.exe");
  if (await exists(pythonExePath)) {
    return resolvedRuntimeSource;
  }

  return null;
}

async function runProcess(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function buildDownloadSnippet(downloadSource, repoId, destinationDir) {
  const normalizedDestinationDir = destinationDir.replace(/\\/g, "\\\\");
  const normalizedRepoId = repoId.replace(/\\/g, "\\\\");

  if (downloadSource === "huggingface") {
    return [
      "from huggingface_hub import snapshot_download",
      `snapshot_download(repo_id='${normalizedRepoId}', local_dir=r'${normalizedDestinationDir}', local_dir_use_symlinks=False)`,
    ].join("; ");
  }

  return [
    "from modelscope.hub.snapshot_download import snapshot_download",
    `snapshot_download(model_id='${normalizedRepoId}', local_dir=r'${normalizedDestinationDir}')`,
  ].join("; ");
}

async function copyRuntime(runtimeSourceDir, destinationDir) {
  await rm(destinationDir, { recursive: true, force: true });
  await cp(runtimeSourceDir, destinationDir, {
    recursive: true,
    filter: (currentSource) =>
      !currentSource.includes("__pycache__") && !currentSource.endsWith(".pyc"),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = options.output;
  const runtimeSourceDir = await resolveExistingRuntimeSource(options.runtimeSource);
  const modelSourceDir = options.modelSource ? path.resolve(options.modelSource) : null;

  await ensureMissing(templateDir, "extension template directory");
  if (!runtimeSourceDir) {
    throw new Error(
      "Unable to find a usable Python runtime source. Pass --runtime-source or set RMBG2_PYTHON_RUNTIME_SOURCE."
    );
  }
  await ensureMissing(runtimeSourceDir, "portable Python runtime source");

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.dirname(outputDir), { recursive: true });
  await cp(templateDir, outputDir, { recursive: true });

  const runtimePythonDir = path.join(outputDir, "runtime", "python");
  await copyRuntime(runtimeSourceDir, runtimePythonDir);

  const runtimePythonExe = path.join(runtimePythonDir, "python.exe");
  await ensureMissing(runtimePythonExe, "portable Python executable");

  if (!options.skipInstall) {
    await runProcess(runtimePythonExe, ["-m", "pip", "install", "--upgrade", "pip"], {
      cwd: outputDir,
    });

    await runProcess(
      runtimePythonExe,
      [
        "-m",
        "pip",
        "install",
        "--upgrade",
        "torch",
        "torchvision",
        "--index-url",
        options.torchIndexUrl,
      ],
      {
        cwd: outputDir,
      },
    );

    const installPackages = [
      "transformers",
      "safetensors",
      "pillow",
      "kornia",
      "timm",
      "numpy",
      options.downloadSource === "huggingface" ? "huggingface_hub" : "modelscope",
    ];

    await runProcess(runtimePythonExe, ["-m", "pip", "install", "--upgrade", ...installPackages], {
      cwd: outputDir,
    });
  }

  const modelsDir = path.join(outputDir, "runtime", "models");
  const targetModelDir = path.join(modelsDir, "RMBG-2.0");
  await mkdir(modelsDir, { recursive: true });
  await rm(targetModelDir, { recursive: true, force: true });

  let modelProvision = {
    mode: "download",
    source: options.downloadSource,
    repoId: options.modelRepoId,
  };

  if (modelSourceDir) {
    await ensureMissing(modelSourceDir, "RMBG-2.0 model source directory");
    await cp(modelSourceDir, targetModelDir, { recursive: true });
    modelProvision = {
      mode: "copy",
      source: modelSourceDir,
      repoId: options.modelRepoId,
    };
  } else {
    const downloadSnippet = buildDownloadSnippet(
      options.downloadSource,
      options.modelRepoId,
      targetModelDir,
    );
    await runProcess(runtimePythonExe, ["-c", downloadSnippet], {
      cwd: outputDir,
    });
  }

  await rm(path.join(targetModelDir, "._____temp"), { recursive: true, force: true });

  await writeFile(
    path.join(outputDir, "assembly-info.json"),
    JSON.stringify(
      {
        outputDir,
        runtimeSourceDir,
        modelProvision,
        intendedUse: "internal-evaluation-non-commercial",
        assembledAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`[rmbg2-extension] assembled package -> ${outputDir}`);
  console.log(`[rmbg2-extension] runtime source    -> ${runtimeSourceDir}`);
  console.log(`[rmbg2-extension] model source      -> ${modelSourceDir ?? `${options.downloadSource}:${options.modelRepoId}`}`);
  console.log(`[rmbg2-extension] torch index       -> ${options.torchIndexUrl}`);
}

main().catch((error) => {
  console.error("[rmbg2-extension] failed:", error);
  process.exitCode = 1;
});
