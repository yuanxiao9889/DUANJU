import { cp, lstat, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();
const templateDir = path.join(
  workspaceRoot,
  "extension-packages",
  "qwen3-tts-complete-template",
);
const defaultSourceDir = process.env.QWEN3_TTS_SOURCE_DIR
  ?? "I:\\Qwen3-TTS-1.7B\\Qwen3-TTS";
const defaultOutputDir = path.join(
  workspaceRoot,
  "build",
  "extensions",
  "qwen3-tts-complete",
);

function parseArgs(argv) {
  const options = {
    mode: "copy",
    source: defaultSourceDir,
    output: defaultOutputDir,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode" && argv[index + 1]) {
      options.mode = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--source" && argv[index + 1]) {
      options.source = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--output" && argv[index + 1]) {
      options.output = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  if (!["link", "copy"].includes(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}`);
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

async function copyQwenPackage(sourceDir, destinationDir) {
  const qwenSourceDir = path.join(sourceDir, "qwen_tts");
  const qwenDestinationDir = path.join(destinationDir, "runtime", "app", "qwen_tts");
  await mkdir(qwenDestinationDir, { recursive: true });

  const includeEntries = ["__init__.py", "core", "inference"];
  for (const entry of includeEntries) {
    await cp(
      path.join(qwenSourceDir, entry),
      path.join(qwenDestinationDir, entry),
      {
        recursive: true,
        filter: (currentSource) =>
          !currentSource.includes("__pycache__") && !currentSource.endsWith(".pyc"),
      },
    );
  }
}

async function mountDirectory(sourcePath, destinationPath, mode) {
  await rm(destinationPath, { recursive: true, force: true });

  if (mode === "copy") {
    await cp(sourcePath, destinationPath, { recursive: true });
    return "copy";
  }

  await symlink(sourcePath, destinationPath, "junction");
  return "link";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(options.source);
  const outputDir = options.output;

  const requiredDirectories = [
    path.join(sourceDir, "wzf312"),
    path.join(sourceDir, "qwen_tts"),
    path.join(sourceDir, "Qwen3-TTS-12Hz-1.7B-Base"),
    path.join(sourceDir, "Qwen3-TTS-12Hz-1.7B-VoiceDesign"),
    path.join(sourceDir, "Qwen3-TTS-12Hz-1.7B-CustomVoice"),
    path.join(sourceDir, "Qwen3-TTS-Tokenizer-12Hz"),
  ];

  for (const requiredPath of requiredDirectories) {
    await ensureMissing(requiredPath, "required source directory");
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.dirname(outputDir), { recursive: true });
  await cp(templateDir, outputDir, { recursive: true });

  await copyQwenPackage(sourceDir, outputDir);

  const linkedAssets = [];
  const runtimeDir = path.join(outputDir, "runtime");
  const modelsDir = path.join(runtimeDir, "models");
  await mkdir(modelsDir, { recursive: true });

  linkedAssets.push({
    target: "runtime/python",
    mode: await mountDirectory(
      path.join(sourceDir, "wzf312"),
      path.join(runtimeDir, "python"),
      options.mode,
    ),
  });

  const modelMappings = [
    "Qwen3-TTS-12Hz-1.7B-Base",
    "Qwen3-TTS-12Hz-1.7B-VoiceDesign",
    "Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "Qwen3-TTS-Tokenizer-12Hz",
  ];

  for (const modelDirName of modelMappings) {
    linkedAssets.push({
      target: `runtime/models/${modelDirName}`,
      mode: await mountDirectory(
        path.join(sourceDir, modelDirName),
        path.join(modelsDir, modelDirName),
        options.mode,
      ),
    });
  }

  await writeFile(
    path.join(outputDir, "assembly-info.json"),
    JSON.stringify(
      {
        sourceDir,
        outputDir,
        mode: options.mode,
        assembledAt: new Date().toISOString(),
        assets: linkedAssets,
      },
      null,
      2,
    ),
    "utf-8",
  );

  console.log(`[qwen3-tts-extension] assembled package -> ${outputDir}`);
  console.log(`[qwen3-tts-extension] source bundle     -> ${sourceDir}`);
  console.log(`[qwen3-tts-extension] mode              -> ${options.mode}`);
}

main().catch((error) => {
  console.error("[qwen3-tts-extension] failed:", error);
  process.exitCode = 1;
});
