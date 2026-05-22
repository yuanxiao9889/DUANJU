import { chmod, copyFile, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const workspaceRoot = process.cwd();
const destinationDir = path.join(workspaceRoot, "src-tauri", "resources", "ffmpeg");
const manifestPath = path.join(destinationDir, ".ffmpeg-manifest.json");
const downloadDir = path.join(workspaceRoot, "build", "downloads");
const ffmpegArchivePath = path.join(downloadDir, "ffmpeg-master-latest-win64-gpl.zip");
const ffmpegExtractRoot = path.join(downloadDir, "ffmpeg-master-latest-win64-gpl");
const ffmpegDownloadUrl =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

const ffmpegBinaryName = executableName("ffmpeg");
const ffprobeBinaryName = executableName("ffprobe");

function resolveNpmStaticBinaryPackages() {
  if (process.platform !== "darwin") {
    return null;
  }

  if (process.arch === "arm64") {
    return {
      platform: "darwin-arm64",
      ffmpegPackage: "@ffmpeg-installer/darwin-arm64",
      ffprobePackage: "@ffprobe-installer/darwin-arm64",
    };
  }

  if (process.arch === "x64") {
    return {
      platform: "darwin-x64",
      ffmpegPackage: "@ffmpeg-installer/darwin-x64",
      ffprobePackage: "@ffprobe-installer/darwin-x64",
    };
  }

  return null;
}

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
  if (process.platform !== "win32") {
    return await new Promise((resolve) => {
      const child = spawn("sh", ["-lc", `command -v ${name}`], {
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

async function downloadStream(url, outputPath) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await rm(outputPath, { force: true });
      const response = await fetch(url, {
        headers: {
          Accept: "application/octet-stream",
          "User-Agent": "Storyboard-Copilot-Build",
        },
        redirect: "follow",
      });
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(outputPath));
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        `[prepare-app-ffmpeg] download attempt ${attempt} failed for ${url}: ${error?.message ?? error}`,
      );
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
    }
  }

  throw new Error(`Failed to download ${url} after retries: ${lastError?.message ?? lastError}`);
}

async function npmView(packageName, field) {
  return await new Promise((resolve, reject) => {
    const child = spawn("npm", ["view", packageName, field, "--json"], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`npm view ${packageName} ${field} failed: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(stdout.trim());
      }
    });
  });
}

async function extractTarball(archivePath, outputDir) {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await runProcess("tar", ["-xzf", archivePath, "-C", outputDir]);
}

async function prepareNpmStaticBinary(packageName, binaryName) {
  const metadata = await npmView(packageName, "dist");
  const tarballUrl = metadata?.tarball;
  if (!tarballUrl) {
    throw new Error(`Could not resolve npm tarball for ${packageName}`);
  }

  const safeName = packageName.replace(/^@/, "").replace(/[\/]/g, "-");
  const archivePath = path.join(downloadDir, `${safeName}.tgz`);
  const extractRoot = path.join(downloadDir, safeName);
  await mkdir(downloadDir, { recursive: true });
  if (!(await exists(archivePath))) {
    console.log(`[prepare-app-ffmpeg] downloading ${packageName} from ${tarballUrl}`);
    await downloadStream(tarballUrl, archivePath);
  } else {
    console.log(`[prepare-app-ffmpeg] reusing cached ${packageName} archive ${archivePath}`);
  }
  await extractTarball(archivePath, extractRoot);
  const binaryPath = path.join(extractRoot, "package", binaryName);
  if (!(await exists(binaryPath))) {
    throw new Error(`${packageName} did not contain ${binaryName}`);
  }
  return binaryPath;
}

async function resolveNpmStaticBinaryPair() {
  const packages = resolveNpmStaticBinaryPackages();
  if (!packages) {
    return null;
  }

  const ffmpegPath = await prepareNpmStaticBinary(packages.ffmpegPackage, ffmpegBinaryName);
  const ffprobePath = await prepareNpmStaticBinary(packages.ffprobePackage, ffprobeBinaryName);
  return {
    mode: `copy-from-npm-static-${packages.platform}`,
    source: `${packages.ffmpegPackage}, ${packages.ffprobePackage}`,
    ffmpegPath,
    ffprobePath,
  };
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
    const ffmpegPath = path.join(options.ffmpegSourceDir, ffmpegBinaryName);
    const ffprobePath = path.join(options.ffmpegSourceDir, ffprobeBinaryName);
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
    const ffmpegPath = path.join(candidateDir, ffmpegBinaryName);
    const ffprobePath = path.join(candidateDir, ffprobeBinaryName);
    if ((await exists(ffmpegPath)) && (await exists(ffprobePath))) {
      return {
        mode: "copy-from-workspace-downloads",
        source: candidateDir,
        ffmpegPath,
        ffprobePath,
      };
    }
  }

  const npmStaticPair = await resolveNpmStaticBinaryPair();
  if (npmStaticPair) {
    return npmStaticPair;
  }

  const ffmpegPath = await runWhere(ffmpegBinaryName);
  const ffprobePath = await runWhere(ffprobeBinaryName);
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
    const ffmpegTargetPath = path.join(destinationDir, ffmpegBinaryName);
    const ffprobeTargetPath = path.join(destinationDir, ffprobeBinaryName);
    copied = await copyIfExists(resolvedPair.ffmpegPath, ffmpegTargetPath);
    copied = (await copyIfExists(resolvedPair.ffprobePath, ffprobeTargetPath)) && copied;
    if (copied && process.platform !== "win32") {
      await Promise.all([chmod(ffmpegTargetPath, 0o755), chmod(ffprobeTargetPath, 0o755)]);
    }
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
