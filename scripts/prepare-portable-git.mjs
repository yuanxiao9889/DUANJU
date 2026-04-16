#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GIT_FOR_WINDOWS_LATEST_RELEASE_API =
  "https://api.github.com/repos/git-for-windows/git/releases/latest";
const PORTABLE_GIT_ASSET_PATTERN = /^PortableGit-.*-64-bit\.7z\.exe$/i;
const SKIP_ENV = "PORTABLE_GIT_SKIP";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function removeChildren(directoryPath, preservedNames = new Set()) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  for (const entry of fs.readdirSync(directoryPath)) {
    if (preservedNames.has(entry)) {
      continue;
    }

    fs.rmSync(path.join(directoryPath, entry), {
      recursive: true,
      force: true,
    });
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Storyboard-Copilot-Build",
    },
  });

  if (!response.ok) {
    fail(`Failed to query ${url}: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

async function downloadFile(url, outputPath) {
  if (process.platform === "win32") {
    const command = [
      "$ProgressPreference = 'SilentlyContinue'",
      `[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12`,
      `Invoke-WebRequest -Uri '${url.replace(/'/g, "''")}' -OutFile '${outputPath.replace(/'/g, "''")}'`,
    ].join("; ");
    const result = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { stdio: "inherit" },
    );

    if (result.status !== 0) {
      fail(`Failed to download ${url} with PowerShell.`);
    }
    return;
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "Storyboard-Copilot-Build",
    },
    redirect: "follow",
  });

  if (!response.ok || !response.body) {
    fail(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(outputPath));
}

function runPortableGitExtractor(archivePath, destinationPath) {
  const extractRoot = path.join(path.dirname(archivePath), "PortableGit");
  fs.rmSync(extractRoot, {
    recursive: true,
    force: true,
  });

  const result = spawnSync(archivePath, ["-y", "-gm2"], {
    cwd: path.dirname(archivePath),
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`Portable Git extraction failed with exit code ${result.status ?? "unknown"}.`);
  }

  if (!fs.existsSync(path.join(extractRoot, "bin", "bash.exe"))) {
    fail("Portable Git extraction completed, but the extracted runtime folder was not produced.");
  }

  removeChildren(
    destinationPath,
    new Set([".gitignore", "README.md", ".portable-git-manifest.json"]),
  );
  fs.cpSync(extractRoot, destinationPath, {
    recursive: true,
    force: true,
  });
  fs.rmSync(extractRoot, {
    recursive: true,
    force: true,
  });
}

async function main() {
  if (process.env[SKIP_ENV] === "1") {
    console.log(`Skipping portable Git preparation because ${SKIP_ENV}=1.`);
    return;
  }

  if (process.platform !== "win32") {
    console.log("Skipping portable Git preparation on non-Windows host.");
    return;
  }

  const repoRoot = resolveRepoRoot();
  const portableGitDir = path.join(repoRoot, "src-tauri", "resources", "portable-git");
  const manifestPath = path.join(portableGitDir, ".portable-git-manifest.json");
  const bashPath = path.join(portableGitDir, "bin", "bash.exe");
  const tempDir = path.join(repoRoot, ".codex", "cache", "portable-git");
  const archivePath = path.join(tempDir, "PortableGit-latest-64-bit.7z.exe");

  ensureDirectory(portableGitDir);
  ensureDirectory(tempDir);

  const existingManifest = readJsonFile(manifestPath);
  const hasPreparedPortableGit =
    fs.existsSync(bashPath) &&
    fs.existsSync(path.join(portableGitDir, "bin", "git.exe"));

  if (hasPreparedPortableGit) {
    console.log(
      `Portable Git is already prepared locally${
        existingManifest?.assetName ? `: ${existingManifest.assetName}` : "."
      }`,
    );
    return;
  }

  console.log("Resolving latest official Portable Git release...");
  const release = await fetchJson(GIT_FOR_WINDOWS_LATEST_RELEASE_API);
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => PORTABLE_GIT_ASSET_PATTERN.test(item.name ?? ""))
    : null;

  if (!asset?.browser_download_url || !asset?.name) {
    fail("Could not find the official PortableGit 64-bit asset in the latest Git for Windows release.");
  }

  const alreadyPrepared =
    existingManifest?.assetName === asset.name && fs.existsSync(bashPath);

  if (alreadyPrepared) {
    console.log(`Portable Git is already prepared: ${asset.name}`);
    return;
  }

  console.log(`Downloading ${asset.name} from the latest Git for Windows release...`);
  await downloadFile(asset.browser_download_url, archivePath);

  console.log("Extracting Portable Git into src-tauri/resources/portable-git ...");
  runPortableGitExtractor(archivePath, portableGitDir);

  if (!fs.existsSync(bashPath)) {
    fail("Portable Git extraction completed, but bin/bash.exe was not found.");
  }

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        assetName: asset.name,
        assetUrl: asset.browser_download_url,
        releaseTag: release.tag_name ?? null,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`Portable Git is ready and will be bundled into the installer: ${asset.name}`);
}

await main();
