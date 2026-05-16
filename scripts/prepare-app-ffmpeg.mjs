import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const workspaceRoot = process.cwd();
const destinationDir = path.join(workspaceRoot, "src-tauri", "resources", "ffmpeg");
const manifestPath = path.join(destinationDir, ".ffmpeg-manifest.json");

function getBundledSourceCandidates() {
  return [
    path.join(workspaceRoot, "build", "downloads", "ffmpeg-bin"),
    path.join(
      workspaceRoot,
      "build",
      "downloads",
      "ffmpeg-master-latest-win64-gpl",
      "ffmpeg-master-latest-win64-gpl",
      "bin",
    ),
  ];
}

function parseArgs(argv) {
  const options = {
    ffmpegSourceDir: process.env.APP_FFMPEG_SOURCE_DIR
      ? path.resolve(process.env.APP_FFMPEG_SOURCE_DIR)
      : null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ffmpeg-source-dir" && argv[index + 1]) {
      options.ffmpegSourceDir = path.resolve(argv[index + 1]);
      index += 1;
    }
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

async function runWhere(name) {
  return await new Promise((resolve) => {
    const child = spawn("where.exe", [name], {
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

async function copyIfExists(sourcePath, targetPath) {
  if (!(await exists(sourcePath))) {
    return false;
  }

  await copyFile(sourcePath, targetPath);
  return true;
}

async function resolveBinaryPair(options) {
  if (options.ffmpegSourceDir) {
    const ffmpegPath = path.join(options.ffmpegSourceDir, "ffmpeg.exe");
    const ffprobePath = path.join(options.ffmpegSourceDir, "ffprobe.exe");
    if ((await exists(ffmpegPath)) && (await exists(ffprobePath))) {
      return {
        mode: "copy",
        source: options.ffmpegSourceDir,
        ffmpegPath,
        ffprobePath,
      };
    }
  }

  for (const candidateDir of getBundledSourceCandidates()) {
    const ffmpegPath = path.join(candidateDir, "ffmpeg.exe");
    const ffprobePath = path.join(candidateDir, "ffprobe.exe");
    if ((await exists(ffmpegPath)) && (await exists(ffprobePath))) {
      return {
        mode: "copy-from-workspace-downloads",
        source: candidateDir,
        ffmpegPath,
        ffprobePath,
      };
    }
  }

  const ffmpegPath = await runWhere("ffmpeg.exe");
  const ffprobePath = await runWhere("ffprobe.exe");
  if (ffmpegPath && ffprobePath) {
    return {
      mode: "copy-from-path",
      source: path.dirname(ffmpegPath),
      ffmpegPath,
      ffprobePath,
    };
  }

  return null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(destinationDir, { recursive: true });

  const resolvedPair = await resolveBinaryPair(options);
  let copied = false;
  if (resolvedPair) {
    copied = await copyIfExists(resolvedPair.ffmpegPath, path.join(destinationDir, "ffmpeg.exe"));
    copied = (await copyIfExists(resolvedPair.ffprobePath, path.join(destinationDir, "ffprobe.exe"))) && copied;
  }

  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        copied,
        source: resolvedPair?.source ?? null,
        mode: resolvedPair?.mode ?? "missing",
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );

  if (copied) {
    console.log(`[prepare-app-ffmpeg] bundled ffmpeg from ${resolvedPair.source}`);
    return;
  }

  console.warn(
    "[prepare-app-ffmpeg] ffmpeg/ffprobe were not found. Runtime will fall back to PATH and surface a diagnostic error if they remain unavailable."
  );
}

main().catch((error) => {
  console.error("[prepare-app-ffmpeg] failed:", error);
  process.exitCode = 1;
});
