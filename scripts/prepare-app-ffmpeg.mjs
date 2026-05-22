import { copyFile, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const workspaceRoot = process.cwd();
const destinationDir = path.join(workspaceRoot, "src-tauri", "resources", "ffmpeg");
const manifestPath = path.join(destinationDir, ".ffmpeg-manifest.json");
const downloadDir = path.join(workspaceRoot, "build", "downloads");
const ffmpegArchivePath = path.join(downloadDir, "ffmpeg-master-latest-win64-gpl.zip");
const ffmpegExtractRoot = path.join(downloadDir, "ffmpeg-master-latest-win64-gpl");
const ffmpegDownloadUrl =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

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
    allowMissing: process.env.APP_FFMPEG_ALLOW_MISSING === "1",
    skipDownload: process.env.APP_FFMPEG_SKIP_DOWNLOAD === "1",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ffmpeg-source-dir" && argv[index + 1]) {
      options.ffmpegSourceDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === "--allow-missing") {
      options.allowMissing = true;
    } else if (arg === "--skip-download") {
      options.skipDownload = true;
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

async function runProcess(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `${command} terminated with signal ${signal}`
            : `${command} exited with code ${code ?? "unknown"}`
        )
      );
    });
  });
}

function escapePowerShellSingleQuotedString(value) {
  return value.replace(/'/g, "''");
}

async function downloadFile(url, outputPath) {
  const command = [
    "$ProgressPreference = 'SilentlyContinue'",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
    `Invoke-WebRequest -Uri '${escapePowerShellSingleQuotedString(url)}' -OutFile '${escapePowerShellSingleQuotedString(outputPath)}'`,
  ].join("; ");

  await runProcess("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ]);
}

async function extractZipArchive(archivePath, outputDir) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const command = [
    "$ProgressPreference = 'SilentlyContinue'",
    `Expand-Archive -LiteralPath '${escapePowerShellSingleQuotedString(archivePath)}' -DestinationPath '${escapePowerShellSingleQuotedString(outputDir)}' -Force`,
  ].join("; ");

  await runProcess("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    command,
  ]);
}

async function downloadBundledFfmpeg() {
  if (process.platform !== "win32") {
    return false;
  }

  await mkdir(downloadDir, { recursive: true });

  if (!(await exists(ffmpegArchivePath))) {
    console.log(`[prepare-app-ffmpeg] downloading ffmpeg from ${ffmpegDownloadUrl}`);
    await downloadFile(ffmpegDownloadUrl, ffmpegArchivePath);
  } else {
    console.log(`[prepare-app-ffmpeg] reusing cached ffmpeg archive ${ffmpegArchivePath}`);
  }

  await extractZipArchive(ffmpegArchivePath, ffmpegExtractRoot);
  return true;
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

  if (process.platform !== "win32") {
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          copied: false,
          source: null,
          mode: "skipped-non-windows",
          preparedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log("[prepare-app-ffmpeg] skipping bundled Windows ffmpeg preparation on non-Windows host.");
    return;
  }

  let resolvedPair = await resolveBinaryPair(options);
  if (!resolvedPair && !options.skipDownload) {
    try {
      const downloaded = await downloadBundledFfmpeg();
      if (downloaded) {
        resolvedPair = await resolveBinaryPair(options);
      }
    } catch (error) {
      if (!options.allowMissing) {
        throw error;
      }
      console.warn("[prepare-app-ffmpeg] failed to download ffmpeg:", error);
    }
  }

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

  const message =
    "[prepare-app-ffmpeg] ffmpeg/ffprobe were not found. The packaged app would not be able to extract audio from video.";
  if (!options.allowMissing) {
    throw new Error(`${message} Install ffmpeg, pass --ffmpeg-source-dir, or allow the script to download the Windows build.`);
  }

  console.warn(`${message} Runtime will fall back to PATH and surface a diagnostic error if they remain unavailable.`);
}

main().catch((error) => {
  console.error("[prepare-app-ffmpeg] failed:", error);
  process.exitCode = 1;
});
