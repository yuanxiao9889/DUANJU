import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const workspaceRoot = process.cwd();
const basePackageDir = path.join(
  workspaceRoot,
  "extension-packages",
  "hunyuanworld-panorama-hq",
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
  "hunyuanworld-panorama-hq-complete",
);
const defaultRepoDownloadDir = path.join(
  workspaceRoot,
  "build",
  "downloads",
  "HunyuanWorld-1.0",
);
const defaultRepoUrl = "https://github.com/Tencent-Hunyuan/HunyuanWorld-1.0.git";
const officialModelRepos = [
  "tencent/HunyuanWorld-1",
  "black-forest-labs/FLUX.1-dev",
  "black-forest-labs/FLUX.1-Fill-dev",
];
const defaultRepoScript = "demo_panogen.py";

function printHelp() {
  console.log(`Usage:
  node scripts/prepare-hunyuanworld-panorama-extension.mjs --repo-source <path> [options]

Options:
  --repo-source <path>       Local HunyuanWorld-1.0 repo to bundle
  --repo-url <url>           Repo URL used when auto-downloading the source repo
  --runtime-source <path>    Portable Python runtime to bundle
  --output <path>            Output extension folder
  --download-dir <path>      Directory used when cloning the source repo from the internet
  --repo-script <path>       Repo entry script relative to repo root
  --requirements <path>      Requirements file to install into bundled runtime
  --download-models          Pre-download official Hugging Face model repos into the package cache
  --model-repo <id>          Additional Hugging Face model repo to cache. Can be passed multiple times
  --hf-token <token>         Hugging Face token used for gated model repos
  --repo-mode <copy|link>    How to mount the repo into the assembled package
  --skip-install             Skip pip install even if a requirements file is found
  --skip-model-download      Do not pre-download Hugging Face model repos
  --help                     Show this message
`);
}

function parseArgs(argv) {
  const options = {
    repoSource: process.env.HUNYUANWORLD_REPO
      ? path.resolve(process.env.HUNYUANWORLD_REPO)
      : null,
    repoUrl: defaultRepoUrl,
    runtimeSource: defaultRuntimeSourceDir,
    output: defaultOutputDir,
    downloadDir: defaultRepoDownloadDir,
    repoScript: defaultRepoScript,
    requirements: null,
    downloadModels: false,
    modelRepos: [...officialModelRepos],
    hfToken: process.env.HF_TOKEN ?? process.env.HUGGINGFACE_HUB_TOKEN ?? null,
    repoMode: "copy",
    skipInstall: false,
    skipModelDownload: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--repo-source" && argv[index + 1]) {
      options.repoSource = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--runtime-source" && argv[index + 1]) {
      options.runtimeSource = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--repo-url" && argv[index + 1]) {
      options.repoUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output" && argv[index + 1]) {
      options.output = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--download-dir" && argv[index + 1]) {
      options.downloadDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--repo-script" && argv[index + 1]) {
      options.repoScript = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--requirements" && argv[index + 1]) {
      options.requirements = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--download-models") {
      options.downloadModels = true;
      continue;
    }
    if (arg === "--model-repo" && argv[index + 1]) {
      options.modelRepos.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--hf-token" && argv[index + 1]) {
      options.hfToken = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--repo-mode" && argv[index + 1]) {
      options.repoMode = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--skip-install") {
      options.skipInstall = true;
      continue;
    }
    if (arg === "--skip-model-download") {
      options.skipModelDownload = true;
    }
  }

  if (!["copy", "link"].includes(options.repoMode)) {
    throw new Error(`Unsupported repo mode: ${options.repoMode}`);
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

async function removePath(targetPath) {
  await rm(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 6,
    retryDelay: 500,
  });
}

async function ensureMissing(targetPath, label) {
  if (!(await exists(targetPath))) {
    throw new Error(`Missing ${label}: ${targetPath}`);
  }
}

function normalizePathForMarkdown(value) {
  return value.replace(/\\/g, "/");
}

function shouldExcludeRepoEntry(currentSource) {
  const normalized = currentSource.replace(/\\/g, "/");
  const baseName = path.basename(normalized).toLowerCase();

  const ignoredDirectoryNames = new Set([
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".idea",
    ".vs",
    "outputs",
    "logs",
    "log",
    "tmp",
    "temp",
    ".cache",
    "node_modules",
  ]);

  const ignoredFileExtensions = new Set([
    ".pyc",
    ".pyo",
    ".tmp",
    ".log",
  ]);

  if (ignoredDirectoryNames.has(baseName)) {
    return false;
  }

  if (ignoredFileExtensions.has(path.extname(baseName))) {
    return false;
  }

  return true;
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

async function cloneOrUpdateRepo(repoUrl, destinationDir) {
  const gitDir = path.join(destinationDir, ".git");
  if (await exists(gitDir)) {
    await runProcess("git", ["-C", destinationDir, "fetch", "--depth", "1", "origin"], {
      cwd: workspaceRoot,
    });
    await runProcess("git", ["-C", destinationDir, "reset", "--hard", "origin/HEAD"], {
      cwd: workspaceRoot,
    });
    return;
  }

  await removePath(destinationDir);
  await mkdir(path.dirname(destinationDir), { recursive: true });
  await runProcess("git", ["clone", "--depth", "1", repoUrl, destinationDir], {
    cwd: workspaceRoot,
  });
}

async function copyDirectory(sourcePath, destinationPath, filter) {
  await removePath(destinationPath);
  await cp(sourcePath, destinationPath, {
    recursive: true,
    filter,
  });
}

async function mountRepo(sourcePath, destinationPath, mode) {
  await removePath(destinationPath);

  if (mode === "link") {
    await symlink(sourcePath, destinationPath, "junction");
    return "link";
  }

  await copyDirectory(sourcePath, destinationPath, shouldExcludeRepoEntry);
  return "copy";
}

async function findExistingRequirementsPath(repoSourceDir, explicitRequirementsPath) {
  const candidatePaths = explicitRequirementsPath
    ? [explicitRequirementsPath]
    : [
        path.join(repoSourceDir, "requirements.txt"),
        path.join(repoSourceDir, "requirements_windows.txt"),
        path.join(repoSourceDir, "requirements-win.txt"),
        path.join(repoSourceDir, "requirements-cu124.txt"),
        path.join(repoSourceDir, "requirements-cu121.txt"),
        path.join(repoSourceDir, "requirements-cu118.txt"),
      ];

  for (const candidatePath of candidatePaths) {
    if (await exists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

async function updateManifest(outputDir, repoScript, requirementsPath, repoMode) {
  const manifestPath = path.join(outputDir, "storyboard-extension.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

  manifest.description = "High-quality offline image-to-360 panorama runtime package for Storyboard Copilot. This assembled package bundles a packaged Python runtime plus a vendored HunyuanWorld-1.0 checkout for panorama generation and perspective extraction.";
  manifest.hardwareRequirements = {
    summary: "Designed for the HunyuanWorld-1.0 high-quality image-to-panorama pipeline. A CUDA NVIDIA GPU is strongly recommended for practical generation speed.",
    recommendations: [
      "This assembled package already includes a packaged Python runtime and a vendored HunyuanWorld-1.0 checkout.",
      "Keep the bundled repo, runtime, and any copied model assets together when moving the package to another machine.",
      "Use the 4096x2048 preset for final output and keep 2048x1024 for faster iteration.",
    ],
    notes: [
      repoMode === "link"
        ? "The vendored repo is linked into the assembled package for local development. Use copy mode before creating a distributable archive."
        : "The vendored repo is copied into runtime/vendor/HunyuanWorld-1.0.",
      `The packaged repo is configured to use ${repoScript}.`,
      requirementsPath
        ? `Python dependencies were installed into the bundled runtime from ${path.basename(requirementsPath)} during assembly.`
        : "No requirements file was auto-installed during assembly, so the packaged runtime is assumed to already contain the dependencies needed by the source repo.",
    ],
  };

  manifest.startupSteps = [
    {
      id: "validate",
      label: "Validate package",
      description: "Check the runner script, packaged Python runtime, and bundled repo entry points.",
      durationMs: 280,
    },
    {
      id: "verify-runtime",
      label: "Verify runtime",
      description: "Start the Python bridge and check the bundled HunyuanWorld integration points.",
      durationMs: 460,
    },
    {
      id: "verify-models",
      label: "Verify bundled checkout",
      description: "Confirm the vendored repo and panorama script are reachable.",
      durationMs: 420,
    },
    {
      id: "register-nodes",
      label: "Register panorama nodes",
      description: "Expose the panorama generation and result nodes in the canvas menu.",
      durationMs: 240,
    },
  ];

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
}

function buildReadme({
  outputDir,
  runtimeSourceDir,
  repoSourceDir,
  repoAcquiredFrom,
  repoScript,
  requirementsPath,
  repoMode,
  downloadedModelRepos,
  hfTokenProvided,
}) {
  const lines = [
    "# HunyuanWorld Panorama HQ Complete",
    "",
    "This folder is the assembled offline HunyuanWorld panorama extension package for Storyboard Copilot.",
    "",
    "It includes:",
    "",
    "- `runtime/python`",
    "- `runtime/app/storyboard_panorama_runner.py`",
    "- `runtime/vendor/HunyuanWorld-1.0`",
    "",
    "## Direct use",
    "",
    "Load this folder in Extensions Center:",
    "",
    `- \`${normalizePathForMarkdown(outputDir)}\``,
    "",
    "After the extension is enabled, the current app build unlocks:",
    "",
    "- `panoramaNode`",
    "- `panoramaResultNode`",
    "",
    "## Assembly details",
    "",
    `- Runtime source: \`${normalizePathForMarkdown(runtimeSourceDir)}\``,
    `- Repo source: \`${normalizePathForMarkdown(repoSourceDir)}\``,
    `- Repo acquired from: \`${repoAcquiredFrom}\``,
    `- Repo entry script: \`${repoScript}\``,
    `- Repo mode: \`${repoMode}\``,
  ];

  if (requirementsPath) {
    lines.push(`- Installed requirements: \`${normalizePathForMarkdown(requirementsPath)}\``);
  } else {
    lines.push("- Installed requirements: none detected automatically");
  }

  if (downloadedModelRepos.length > 0) {
    lines.push(`- Cached model repos: \`${downloadedModelRepos.join("`, `")}\``);
  } else {
    lines.push("- Cached model repos: none");
  }

  lines.push(
    "",
    "## Notes",
    "",
    "- This assembled package can be large because it contains both a Python runtime and a vendored HunyuanWorld checkout.",
    "- If your source repo already contained local weights, checkpoints, or custom scripts, they are copied into the assembled package unless excluded as cache or temp files.",
    hfTokenProvided
      ? "- Hugging Face gated repos were requested with a token during assembly."
      : "- No Hugging Face token was supplied during assembly. Gated model repos may fail to pre-download and may still require login or license acceptance later.",
    "- `extract_perspective` is still handled by the bridge package itself and writes output into `runtime/outputs`.",
  );

  return `${lines.join("\n")}\n`;
}

async function ensurePythonPackages(pythonExe, packageNames, cwd) {
  if (packageNames.length === 0) {
    return;
  }

  await runProcess(pythonExe, ["-m", "pip", "install", ...packageNames], {
    cwd,
  });
}

async function downloadModelReposToCache({
  pythonExe,
  outputDir,
  hfHomeDir,
  modelRepos,
  hfToken,
}) {
  if (modelRepos.length === 0) {
    return [];
  }

  await ensurePythonPackages(pythonExe, ["huggingface_hub"], outputDir);

  const script = `
from huggingface_hub import snapshot_download
import json
import os
import sys

model_repos = json.loads(os.environ["SC_HF_MODEL_REPOS"])
hf_home = os.environ["HF_HOME"]
token = os.environ.get("HF_TOKEN") or None
downloaded = []

for repo_id in model_repos:
    print(f"[hunyuanworld-panorama-extension] caching model repo -> {repo_id}", flush=True)
    snapshot_download(
        repo_id=repo_id,
        repo_type="model",
        cache_dir=hf_home,
        token=token,
        resume_download=True,
    )
    downloaded.append(repo_id)

print(json.dumps({"downloaded": downloaded}))
`;

  const env = {
    ...process.env,
    HF_HOME: hfHomeDir,
    SC_HF_MODEL_REPOS: JSON.stringify(modelRepos),
  };
  if (hfToken) {
    env.HF_TOKEN = hfToken;
  }

  await runProcess(pythonExe, ["-c", script], {
    cwd: outputDir,
    env,
  });

  return modelRepos;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  let repoSourceDir = options.repoSource ? path.resolve(options.repoSource) : null;
  const runtimeSourceDir = path.resolve(options.runtimeSource);
  const outputDir = options.output;
  const repoScript = options.repoScript;
  let repoAcquiredFrom = "local";

  if (!repoSourceDir) {
    repoSourceDir = path.resolve(options.downloadDir);
    await cloneOrUpdateRepo(options.repoUrl, repoSourceDir);
    repoAcquiredFrom = options.repoUrl;
  }

  await ensureMissing(basePackageDir, "base panorama extension package");
  await ensureMissing(repoSourceDir, "HunyuanWorld repo source");
  await ensureMissing(runtimeSourceDir, "portable Python runtime source");
  await ensureMissing(path.join(runtimeSourceDir, "python.exe"), "portable Python executable");
  await ensureMissing(path.join(repoSourceDir, repoScript), "repo entry script");

  await removePath(outputDir);
  await mkdir(path.dirname(outputDir), { recursive: true });
  await cp(basePackageDir, outputDir, { recursive: true });

  const outputRuntimePythonDir = path.join(outputDir, "runtime", "python");
  const launcherPath = path.join(basePackageDir, "runtime", "python", "python.cmd");
  await copyDirectory(runtimeSourceDir, outputRuntimePythonDir);
  await cp(launcherPath, path.join(outputRuntimePythonDir, "python.cmd"));
  await mkdir(path.join(outputDir, "runtime", "cache", "hf"), { recursive: true });
  await mkdir(path.join(outputDir, "runtime", "outputs"), { recursive: true });

  const outputVendorRepoDir = path.join(outputDir, "runtime", "vendor", "HunyuanWorld-1.0");
  await mkdir(path.dirname(outputVendorRepoDir), { recursive: true });
  const repoMode = await mountRepo(repoSourceDir, outputVendorRepoDir, options.repoMode);

  const requirementsPath = await findExistingRequirementsPath(
    repoSourceDir,
    options.requirements,
  );
  const outputPythonExe = path.join(outputRuntimePythonDir, "python.exe");

  if (!options.skipInstall && requirementsPath) {
    await runProcess(outputPythonExe, ["-m", "pip", "install", "--upgrade", "pip"], {
      cwd: outputDir,
    });
    await runProcess(outputPythonExe, ["-m", "pip", "install", "-r", requirementsPath], {
      cwd: outputDir,
    });
  }

  const shouldDownloadModels = options.downloadModels && !options.skipModelDownload;
  const modelRepos = Array.from(new Set(options.modelRepos));
  const downloadedModelRepos = shouldDownloadModels
    ? await downloadModelReposToCache({
        pythonExe: outputPythonExe,
        outputDir,
        hfHomeDir: path.join(outputDir, "runtime", "cache", "hf"),
        modelRepos,
        hfToken: options.hfToken,
      })
    : [];

  await updateManifest(outputDir, repoScript, requirementsPath, repoMode);

  await writeFile(
    path.join(outputDir, "README.md"),
    buildReadme({
      outputDir,
      runtimeSourceDir,
      repoSourceDir,
      repoAcquiredFrom,
      repoScript,
      requirementsPath,
      repoMode,
      downloadedModelRepos,
      hfTokenProvided: Boolean(options.hfToken),
    }),
    "utf-8",
  );

  await writeFile(
    path.join(outputDir, "assembly-info.json"),
    JSON.stringify(
      {
        outputDir,
        runtimeSourceDir,
        repoSourceDir,
        repoAcquiredFrom,
        repoScript,
        repoMode,
        requirementsPath,
        downloadedModelRepos,
        requestedModelRepos: modelRepos,
        hfTokenProvided: Boolean(options.hfToken),
        skipInstall: options.skipInstall,
        downloadModels: shouldDownloadModels,
        assembledAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`[hunyuanworld-panorama-extension] assembled package -> ${outputDir}`);
  console.log(`[hunyuanworld-panorama-extension] runtime source    -> ${runtimeSourceDir}`);
  console.log(`[hunyuanworld-panorama-extension] repo source       -> ${repoSourceDir}`);
  console.log(`[hunyuanworld-panorama-extension] repo acquired     -> ${repoAcquiredFrom}`);
  console.log(`[hunyuanworld-panorama-extension] repo mode         -> ${repoMode}`);
  console.log(`[hunyuanworld-panorama-extension] repo script       -> ${repoScript}`);
  console.log(
    `[hunyuanworld-panorama-extension] requirements      -> ${requirementsPath ?? "none detected"}`,
  );
  console.log(
    `[hunyuanworld-panorama-extension] cached model repos -> ${downloadedModelRepos.length > 0 ? downloadedModelRepos.join(", ") : "none"}`,
  );
}

main().catch((error) => {
  console.error("[hunyuanworld-panorama-extension] failed:", error);
  process.exitCode = 1;
});
