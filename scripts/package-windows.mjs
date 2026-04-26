#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const VALID_BUMPS = new Set(["patch", "minor", "major", "manual"]);
const VALID_BUNDLES = new Set(["nsis", "msi"]);
const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const EVENT_PREFIX = "SBPACK_JSON ";
const SNAPSHOT_PATHS = [
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
];

process.stdout.setDefaultEncoding?.("utf8");
process.stderr.setDefaultEncoding?.("utf8");

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function emitEvent(payload) {
  process.stdout.write(`${EVENT_PREFIX}${JSON.stringify(payload)}\n`);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function parseVersion(version) {
  const [core] = version.split("-", 1);
  const parts = core.split(".");
  if (parts.length !== 3) {
    fail(`Invalid version: ${version}`);
  }

  const [major, minor, patch] = parts.map((value) => Number(value));
  if ([major, minor, patch].some((value) => Number.isNaN(value))) {
    fail(`Invalid version: ${version}`);
  }

  return { major, minor, patch };
}

function bumpVersion(currentVersion, bumpType) {
  const parsed = parseVersion(currentVersion);
  if (bumpType === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  if (bumpType === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function parseCliArgs(argv) {
  const options = {
    bump: "patch",
    bundle: "nsis",
    version: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bump") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value after --bump");
      }
      options.bump = value;
      index += 1;
      continue;
    }

    if (arg === "--bundle") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value after --bundle");
      }
      options.bundle = value;
      index += 1;
      continue;
    }

    if (arg === "--version") {
      const value = argv[index + 1];
      if (!value) {
        fail("Missing value after --version");
      }
      options.version = value;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!VALID_BUMPS.has(options.bump)) {
    fail("Bump type must be one of: patch, minor, major, manual");
  }

  if (!VALID_BUNDLES.has(options.bundle)) {
    fail("Bundle type must be one of: nsis, msi");
  }

  if (options.bump === "manual") {
    if (!options.version) {
      fail("Manual version mode requires --version x.y.z");
    }
    if (!VERSION_PATTERN.test(options.version)) {
      fail(`Invalid target version: ${options.version}`);
    }
  } else if (options.version) {
    fail("--version can only be used together with --bump manual");
  }

  return options;
}

function getCurrentVersion(repoRoot) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const currentVersion = packageJson.version;
  if (!VERSION_PATTERN.test(currentVersion)) {
    fail(`Invalid current version in package.json: ${currentVersion}`);
  }
  return currentVersion;
}

function snapshotVersionFiles(repoRoot) {
  return SNAPSHOT_PATHS.map((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    return {
      relativePath,
      absolutePath,
      content: fs.readFileSync(absolutePath),
    };
  });
}

function restoreVersionFiles(snapshotEntries) {
  for (const entry of snapshotEntries) {
    fs.writeFileSync(entry.absolutePath, entry.content);
  }
}

function getNpmCommand() {
  return "npm";
}

async function runStreaming(command, args, options = {}) {
  const { cwd, env, shell = false } = options;
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });

    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`${command} terminated with signal ${signal}`));
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function getArtifactExtension(bundle) {
  return bundle === "msi" ? ".msi" : ".exe";
}

function findLatestArtifact(repoRoot, bundle, targetVersion) {
  const outputDir = path.join(repoRoot, "src-tauri", "target", "release", "bundle", bundle);
  if (!fs.existsSync(outputDir)) {
    fail(`Bundle output directory does not exist: ${outputDir}`);
  }

  const extension = getArtifactExtension(bundle);
  const candidates = fs
    .readdirSync(outputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => {
      const filePath = path.join(outputDir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        filePath,
        fileName: entry.name,
        mtimeMs: stat.mtimeMs,
      };
    });

  if (candidates.length === 0) {
    fail(`No ${extension} artifact found in ${outputDir}`);
  }

  const matchingVersion = candidates.filter((candidate) => candidate.fileName.includes(targetVersion));
  const preferred = matchingVersion.length > 0 ? matchingVersion : candidates;

  preferred.sort((left, right) => {
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return left.fileName.localeCompare(right.fileName);
  });

  return preferred[0].filePath;
}

async function main() {
  const repoRoot = resolveRepoRoot();
  process.chdir(repoRoot);

  const options = parseCliArgs(process.argv.slice(2));
  const currentVersion = getCurrentVersion(repoRoot);
  const targetVersion =
    options.bump === "manual" ? options.version : bumpVersion(currentVersion, options.bump);

  if (!VERSION_PATTERN.test(targetVersion)) {
    fail(`Invalid target version: ${targetVersion}`);
  }

  const bundleLabel = options.bundle.toUpperCase();
  let snapshotEntries = [];
  let restoredAfterFailure = false;

  emitEvent({
    type: "meta",
    message: `准备打包 Windows ${bundleLabel} 安装包`,
    bundle: options.bundle,
    currentVersion,
    targetVersion,
    outputDir: path.join(repoRoot, "src-tauri", "target", "release", "bundle", options.bundle),
  });

  try {
    snapshotEntries = snapshotVersionFiles(repoRoot);
    log(`Packaging ${bundleLabel} installer: ${currentVersion} -> ${targetVersion}`);

    emitEvent({
      type: "status",
      message: `正在同步版本号到 ${targetVersion}`,
      currentVersion,
      targetVersion,
    });
    await runStreaming(process.execPath, ["scripts/sync-version.mjs", targetVersion], { cwd: repoRoot });

    if (process.env.SBPACK_SIMULATE_BUILD_FAILURE === "1") {
      fail("Simulated build failure requested by SBPACK_SIMULATE_BUILD_FAILURE=1");
    }

    emitEvent({
      type: "status",
      message: `正在构建 ${bundleLabel} 安装包`,
      bundle: options.bundle,
      targetVersion,
    });
    await runStreaming(getNpmCommand(), ["run", "tauri", "build", "--", "--bundles", options.bundle], {
      cwd: repoRoot,
      shell: process.platform === "win32",
    });

    emitEvent({
      type: "status",
      message: "正在定位最新安装包产物",
      bundle: options.bundle,
      targetVersion,
    });
    const artifactPath = findLatestArtifact(repoRoot, options.bundle, targetVersion);

    emitEvent({
      type: "artifact",
      message: "安装包已生成",
      bundle: options.bundle,
      targetVersion,
      path: artifactPath,
    });
    emitEvent({
      type: "done",
      message: "打包完成",
      success: true,
      bundle: options.bundle,
      currentVersion,
      targetVersion,
      path: artifactPath,
    });
    log(`Installer generated at: ${artifactPath}`);
  } catch (error) {
    try {
      if (snapshotEntries.length > 0) {
        emitEvent({
          type: "status",
          message: "打包失败，正在恢复版本文件",
        });
        restoreVersionFiles(snapshotEntries);
        restoredAfterFailure = true;
        log("Restored version files to their pre-build state.");
      }
    } catch (restoreError) {
      const restoreMessage =
        restoreError instanceof Error ? restoreError.message : String(restoreError);
      const baseMessage = error instanceof Error ? error.message : String(error);
      emitEvent({
        type: "error",
        message: `${baseMessage}; rollback failed: ${restoreMessage}`,
        restored: false,
      });
      emitEvent({
        type: "done",
        message: "打包失败，且版本文件回滚失败",
        success: false,
        restored: false,
      });
      throw error;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    emitEvent({
      type: "error",
      message: errorMessage,
      restored: restoredAfterFailure,
    });
    emitEvent({
      type: "done",
      message: "打包失败",
      success: false,
      restored: restoredAfterFailure,
    });
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
