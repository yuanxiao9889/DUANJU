#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const DREAMINA_INSTALLER_URL = "https://jimeng.jianying.com/cli";
const SKIP_ENV = "DREAMINA_CLI_SKIP";

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

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/plain,*/*",
      "User-Agent": "Storyboard-Copilot-Build",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    fail(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return await response.text();
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

function resolveDreaminaArtifactInfo(installerScript) {
  const downloadBaseMatch = installerScript.match(/^DOWNLOAD_BASE="([^"]+)"$/m);
  const windowsFileMatch = installerScript.match(
    /PLATFORM="windows_amd64"[\s\S]*?DOWNLOAD_FILE="([^"]+)"/,
  );

  if (!downloadBaseMatch?.[1]) {
    fail("Could not parse DOWNLOAD_BASE from the official Dreamina installer script.");
  }

  if (!windowsFileMatch?.[1]) {
    fail("Could not parse the Windows Dreamina CLI asset name from the installer script.");
  }

  const downloadBase = downloadBaseMatch[1];
  const binaryName = windowsFileMatch[1];

  return {
    downloadBase,
    binaryName,
    binaryUrl: `${downloadBase}/${binaryName}`,
    skillUrl: `${downloadBase}/SKILL.md`,
  };
}

async function main() {
  if (process.env[SKIP_ENV] === "1") {
    console.log(`Skipping Dreamina CLI preparation because ${SKIP_ENV}=1.`);
    return;
  }

  if (process.platform !== "win32") {
    console.log("Skipping Dreamina CLI preparation on non-Windows host.");
    return;
  }

  const repoRoot = resolveRepoRoot();
  const dreaminaDir = path.join(repoRoot, "src-tauri", "resources", "dreamina-cli");
  const dreaminaBinDir = path.join(dreaminaDir, "bin");
  const manifestPath = path.join(dreaminaDir, ".dreamina-cli-manifest.json");
  const binaryPath = path.join(dreaminaBinDir, "dreamina.exe");
  const skillPath = path.join(dreaminaDir, "SKILL.md");
  const tempDir = path.join(repoRoot, ".codex", "cache", "dreamina-cli");
  const tempBinaryPath = path.join(tempDir, "dreamina.exe");
  const tempSkillPath = path.join(tempDir, "SKILL.md");

  ensureDirectory(dreaminaDir);
  ensureDirectory(dreaminaBinDir);
  ensureDirectory(tempDir);

  console.log("Resolving official Dreamina CLI installer metadata...");
  const installerScript = await fetchText(DREAMINA_INSTALLER_URL);
  const artifactInfo = resolveDreaminaArtifactInfo(installerScript);

  const existingManifest = readJsonFile(manifestPath);
  const alreadyPrepared =
    existingManifest?.binaryUrl === artifactInfo.binaryUrl &&
    existingManifest?.skillUrl === artifactInfo.skillUrl &&
    fs.existsSync(binaryPath) &&
    fs.existsSync(skillPath);

  if (alreadyPrepared) {
    console.log(`Dreamina CLI is already prepared: ${artifactInfo.binaryName}`);
    return;
  }

  console.log(`Downloading ${artifactInfo.binaryName} from the official Dreamina installer source...`);
  await downloadFile(artifactInfo.binaryUrl, tempBinaryPath);

  console.log("Downloading bundled Dreamina skill metadata...");
  await downloadFile(artifactInfo.skillUrl, tempSkillPath);

  removeChildren(dreaminaDir, new Set([".gitignore", "README.md", ".dreamina-cli-manifest.json"]));
  ensureDirectory(dreaminaBinDir);
  fs.copyFileSync(tempBinaryPath, binaryPath);
  fs.copyFileSync(tempSkillPath, skillPath);

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        installerUrl: DREAMINA_INSTALLER_URL,
        downloadBase: artifactInfo.downloadBase,
        binaryName: artifactInfo.binaryName,
        binaryUrl: artifactInfo.binaryUrl,
        skillUrl: artifactInfo.skillUrl,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`Dreamina CLI is ready and will be bundled into the installer: ${artifactInfo.binaryName}`);
}

await main();
