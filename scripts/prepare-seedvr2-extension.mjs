import { cp, copyFile, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const workspaceRoot = process.cwd();
const templateDir = path.join(
  workspaceRoot,
  "extension-packages",
  "seedvr2-complete-template",
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
  "seedvr2-complete",
);
const defaultUpstreamRepo = "https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler.git";
const defaultUpstreamRef = "main";
const defaultModelRepo = "numz/SeedVR2_comfyUI";
const defaultDitModel = "seedvr2_ema_3b_fp8_e4m3fn.safetensors";
const defaultVaeModel = "ema_vae_fp16.safetensors";
const defaultTorchIndexUrl = "https://download.pytorch.org/whl/cu130";

function getRuntimeSourceCandidates() {
  const localAppData = process.env.LOCALAPPDATA ?? "";
  return [
    defaultRuntimeSourceDir,
    process.env.SEEDVR2_PYTHON_RUNTIME_SOURCE
      ? path.resolve(process.env.SEEDVR2_PYTHON_RUNTIME_SOURCE)
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
    upstreamSource: null,
    upstreamRepo: defaultUpstreamRepo,
    upstreamRef: defaultUpstreamRef,
    modelRepo: defaultModelRepo,
    ditModelSource: null,
    vaeModelSource: null,
    ffmpegSourceDir: null,
    torchIndexUrl: defaultTorchIndexUrl,
    skipInstall: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--runtime-source" && argv[index + 1]) {
      options.runtimeSource = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--upstream-source" && argv[index + 1]) {
      options.upstreamSource = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--upstream-repo" && argv[index + 1]) {
      options.upstreamRepo = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--upstream-ref" && argv[index + 1]) {
      options.upstreamRef = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--model-repo" && argv[index + 1]) {
      options.modelRepo = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--dit-model-source" && argv[index + 1]) {
      options.ditModelSource = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--vae-model-source" && argv[index + 1]) {
      options.vaeModelSource = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--ffmpeg-source-dir" && argv[index + 1]) {
      options.ffmpegSourceDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--output" && argv[index + 1]) {
      options.output = path.resolve(argv[index + 1]);
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

async function copyRuntime(runtimeSourceDir, destinationDir) {
  await rm(destinationDir, { recursive: true, force: true });
  await cp(runtimeSourceDir, destinationDir, {
    recursive: true,
    filter: (currentSource) =>
      !currentSource.includes("__pycache__") && !currentSource.endsWith(".pyc"),
  });
}

async function resolveGitExecutable() {
  const configured = process.env.SEEDVR2_GIT_EXE;
  if (configured) {
    return configured;
  }

  const candidates = [
    "git",
    path.join(workspaceRoot, "build", "portable-git", "cmd", "git.exe"),
    path.join(workspaceRoot, "tools", "portable-git", "cmd", "git.exe"),
  ];

  for (const candidate of candidates) {
    try {
      await runProcess(candidate, ["--version"], { cwd: workspaceRoot });
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Unable to find git. Install git, set SEEDVR2_GIT_EXE, or pass --upstream-source."
  );
}

async function provisionUpstreamSource(targetDir, options) {
  await rm(targetDir, { recursive: true, force: true });

  if (options.upstreamSource) {
    await ensureMissing(options.upstreamSource, "SeedVR2 upstream source directory");
    await cp(options.upstreamSource, targetDir, { recursive: true });
    return {
      mode: "copy",
      source: options.upstreamSource,
      ref: null,
    };
  }

  const gitExecutable = await resolveGitExecutable();
  await runProcess(gitExecutable, [
    "clone",
    "--depth",
    "1",
    "--branch",
    options.upstreamRef,
    options.upstreamRepo,
    targetDir,
  ], {
    cwd: workspaceRoot,
  });

  return {
    mode: "git-clone",
    source: options.upstreamRepo,
    ref: options.upstreamRef,
  };
}

async function downloadModelFile(pythonExe, repoId, filename, targetDir, outputDir) {
  const downloadSnippet = [
    "from huggingface_hub import hf_hub_download",
    `hf_hub_download(repo_id='${repoId.replace(/\\/g, "\\\\")}', filename='${filename}', local_dir=r'${targetDir.replace(/\\/g, "\\\\")}', local_dir_use_symlinks=False)`,
  ].join("; ");
  await runProcess(pythonExe, ["-c", downloadSnippet], {
    cwd: outputDir,
  });
}

async function provisionModelFile({
  sourcePath,
  filename,
  pythonExe,
  repoId,
  targetDir,
  outputDir,
}) {
  const targetPath = path.join(targetDir, filename);
  if (sourcePath) {
    await ensureMissing(sourcePath, `${filename} source file`);
    await copyFile(sourcePath, targetPath);
    return {
      mode: "copy",
      source: sourcePath,
      file: filename,
    };
  }

  await downloadModelFile(pythonExe, repoId, filename, targetDir, outputDir);
  return {
    mode: "download",
    source: repoId,
    file: filename,
  };
}

async function resolveSystemExecutable(name) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  return await new Promise((resolve) => {
    const child = spawn(command, [name], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.on("error", () => resolve(null));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      const firstLine = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      resolve(firstLine ?? null);
    });
  });
}

async function copyBundledBinary(sourceDir, fileName, destinationDir) {
  const sourcePath = path.join(sourceDir, fileName);
  await ensureMissing(sourcePath, fileName);
  await copyFile(sourcePath, path.join(destinationDir, fileName));
}

async function provisionFfmpeg(destinationDir, options) {
  await mkdir(destinationDir, { recursive: true });

  if (options.ffmpegSourceDir) {
    await ensureMissing(options.ffmpegSourceDir, "ffmpeg source directory");
    await copyBundledBinary(options.ffmpegSourceDir, "ffmpeg.exe", destinationDir);
    await copyBundledBinary(options.ffmpegSourceDir, "ffprobe.exe", destinationDir);
    return {
      mode: "copy",
      source: options.ffmpegSourceDir,
    };
  }

  const ffmpegPath = await resolveSystemExecutable("ffmpeg.exe");
  const ffprobePath = await resolveSystemExecutable("ffprobe.exe");
  if (!ffmpegPath || !ffprobePath) {
    throw new Error(
      "Unable to find ffmpeg/ffprobe. Install them, add them to PATH, or pass --ffmpeg-source-dir."
    );
  }

  await copyFile(ffmpegPath, path.join(destinationDir, "ffmpeg.exe"));
  await copyFile(ffprobePath, path.join(destinationDir, "ffprobe.exe"));

  return {
    mode: "copy-from-path",
    source: path.dirname(ffmpegPath),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = options.output;
  const runtimeSourceDir = await resolveExistingRuntimeSource(options.runtimeSource);

  await ensureMissing(templateDir, "extension template directory");
  if (!runtimeSourceDir) {
    throw new Error(
      "Unable to find a usable Python runtime source. Pass --runtime-source or set SEEDVR2_PYTHON_RUNTIME_SOURCE."
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

  const upstreamTargetDir = path.join(
    outputDir,
    "runtime",
    "vendor",
    "ComfyUI-SeedVR2_VideoUpscaler",
  );
  const upstreamProvision = await provisionUpstreamSource(upstreamTargetDir, options);
  const requirementsPath = path.join(upstreamTargetDir, "requirements.txt");
  await ensureMissing(requirementsPath, "SeedVR2 requirements file");

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

    await runProcess(runtimePythonExe, [
      "-m",
      "pip",
      "install",
      "--upgrade",
      "-r",
      requirementsPath,
      "huggingface_hub",
    ], {
      cwd: outputDir,
    });
  }

  const modelsDir = path.join(outputDir, "runtime", "models", "SEEDVR2");
  await mkdir(modelsDir, { recursive: true });

  const ditModelProvision = await provisionModelFile({
    sourcePath: options.ditModelSource,
    filename: defaultDitModel,
    pythonExe: runtimePythonExe,
    repoId: options.modelRepo,
    targetDir: modelsDir,
    outputDir,
  });
  const vaeModelProvision = await provisionModelFile({
    sourcePath: options.vaeModelSource,
    filename: defaultVaeModel,
    pythonExe: runtimePythonExe,
    repoId: options.modelRepo,
    targetDir: modelsDir,
    outputDir,
  });

  const ffmpegProvision = await provisionFfmpeg(
    path.join(outputDir, "runtime", "bin"),
    options,
  );

  const vendorEntries = await readdir(upstreamTargetDir);

  await writeFile(
    path.join(outputDir, "assembly-info.json"),
    JSON.stringify(
      {
        outputDir,
        runtimeSourceDir,
        upstreamProvision,
        modelProvision: {
          repoId: options.modelRepo,
          ditModel: ditModelProvision,
          vaeModel: vaeModelProvision,
        },
        ffmpegProvision,
        installedDependencies: !options.skipInstall,
        upstreamEntryCount: vendorEntries.length,
        torchIndexUrl: options.torchIndexUrl,
        assembledAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`[seedvr2-extension] assembled package -> ${outputDir}`);
  console.log(`[seedvr2-extension] runtime source    -> ${runtimeSourceDir}`);
  console.log(`[seedvr2-extension] upstream source   -> ${options.upstreamSource ?? `${options.upstreamRepo}#${options.upstreamRef}`}`);
  console.log(`[seedvr2-extension] model source      -> ${options.modelRepo}`);
}

main().catch((error) => {
  console.error("[seedvr2-extension] failed:", error);
  process.exitCode = 1;
});
