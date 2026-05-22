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

  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      fs.rmSync(outputPath, { force: true });
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

      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(outputPath));
      return;
    } catch (error) {
      lastError = error;
      const delayMs = attempt * 2000;
      console.warn(
        `Download attempt ${attempt} failed for ${url}: ${error?.message ?? error}`,
      );
      if (attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  fail(`Failed to download ${url} after retries: ${lastError?.message ?? lastError}`);
}

function resolveDreaminaArtifactInfo(installerScript, platform) {
  const downloadBaseMatch = installerScript.match(/^DOWNLOAD_BASE="([^"]+)"$/m);
  const fileMatch = installerScript.match(
    new RegExp(`PLATFORM="${platform}"[\\s\\S]*?DOWNLOAD_FILE="([^"]+)"`),
  );
  const versionUrlMatch = installerScript.match(/^VERSION_URL="([^"]+)"$/m);

  if (!downloadBaseMatch?.[1]) {
    fail("Could not parse DOWNLOAD_BASE from the official Dreamina installer script.");
  }

  if (!fileMatch?.[1]) {
    fail(`Could not parse the ${platform} Dreamina CLI asset name from the installer script.`);
  }

  if (!versionUrlMatch?.[1]) {
    fail("Could not parse VERSION_URL from the official Dreamina installer script.");
  }

  const downloadBase = downloadBaseMatch[1];
  const binaryName = fileMatch[1];
  const versionUrl = versionUrlMatch[1];

  return {
    downloadBase,
    platform,
    binaryName,
    binaryUrl: `${downloadBase}/${binaryName}`,
    skillUrl: `${downloadBase}/SKILL.md`,
    versionUrl,
  };
}

function resolveBundleTargets() {
  if (process.platform === "win32") {
    return [
      {
        platform: "windows_amd64",
        binaryFileName: "dreamina.exe",
        relativeOutputPath: path.join("bin", "dreamina.exe"),
      },
    ];
  }

  if (process.platform === "darwin") {
    return [
      {
        platform: "darwin_arm64",
        binaryFileName: "dreamina",
        relativeOutputPath: path.join("bin", "darwin-arm64", "dreamina"),
      },
      {
        platform: "darwin_amd64",
        binaryFileName: "dreamina",
        relativeOutputPath: path.join("bin", "darwin-amd64", "dreamina"),
      },
    ];
  }

  return [];
}

async function main() {
  if (process.env[SKIP_ENV] === "1") {
    console.log(`Skipping Dreamina CLI preparation because ${SKIP_ENV}=1.`);
    return;
  }

  const bundleTargets = resolveBundleTargets();
  if (bundleTargets.length === 0) {
    console.log("Skipping Dreamina CLI preparation on unsupported packaging host.");
    return;
  }

  const repoRoot = resolveRepoRoot();
  const dreaminaDir = path.join(repoRoot, "src-tauri", "resources", "dreamina-cli");
  const dreaminaBinDir = path.join(dreaminaDir, "bin");
  const manifestPath = path.join(dreaminaDir, ".dreamina-cli-manifest.json");
  const skillPath = path.join(dreaminaDir, "SKILL.md");
  const tempDir = path.join(repoRoot, ".codex", "cache", "dreamina-cli");
  const tempSkillPath = path.join(tempDir, "SKILL.md");

  ensureDirectory(dreaminaDir);
  ensureDirectory(dreaminaBinDir);
  ensureDirectory(tempDir);

  const existingManifest = readJsonFile(manifestPath);

  console.log("Resolving official Dreamina CLI installer metadata...");
  const installerScript = await fetchText(DREAMINA_INSTALLER_URL);
  const artifactInfos = bundleTargets.map((target) => ({
    target,
    artifactInfo: resolveDreaminaArtifactInfo(installerScript, target.platform),
  }));
  const versionUrl = artifactInfos[0]?.artifactInfo.versionUrl;
  if (!versionUrl) {
    fail("Could not resolve Dreamina version metadata url.");
  }
  const versionInfo = JSON.parse(await fetchText(versionUrl));

  const alreadyPrepared =
    Array.isArray(existingManifest?.artifacts) &&
    existingManifest.artifacts.length === artifactInfos.length &&
    artifactInfos.every(({ target, artifactInfo }) => {
      const existing = existingManifest.artifacts.find(
        (item) => item?.platform === target.platform,
      );
      return (
        existing?.binaryUrl === artifactInfo.binaryUrl &&
        fs.existsSync(path.join(dreaminaDir, target.relativeOutputPath))
      );
    }) &&
    existingManifest?.skillUrl === artifactInfos[0]?.artifactInfo.skillUrl &&
    existingManifest?.versionUrl === versionUrl &&
    existingManifest?.version === versionInfo?.version &&
    fs.existsSync(skillPath);

  if (alreadyPrepared) {
    console.log(
      `Dreamina CLI is already prepared: ${artifactInfos
        .map(({ artifactInfo }) => artifactInfo.binaryName)
        .join(", ")}`,
    );
    return;
  }

  const preparedArtifacts = [];
  for (const { target, artifactInfo } of artifactInfos) {
    const tempBinaryPath = path.join(tempDir, artifactInfo.binaryName);
    const outputPath = path.join(dreaminaDir, target.relativeOutputPath);
    console.log(`Downloading ${artifactInfo.binaryName} from the official Dreamina installer source...`);
    await downloadFile(artifactInfo.binaryUrl, tempBinaryPath);
    preparedArtifacts.push({
      target,
      artifactInfo,
      tempBinaryPath,
      outputPath,
    });
  }

  console.log("Downloading bundled Dreamina skill metadata...");
  await downloadFile(artifactInfos[0].artifactInfo.skillUrl, tempSkillPath);

  removeChildren(dreaminaDir, new Set([".gitignore", "README.md", ".dreamina-cli-manifest.json"]));
  ensureDirectory(dreaminaBinDir);
  for (const { target, tempBinaryPath, outputPath } of preparedArtifacts) {
    ensureDirectory(path.dirname(outputPath));
    fs.copyFileSync(tempBinaryPath, outputPath);
    if (process.platform !== "win32") {
      fs.chmodSync(outputPath, 0o755);
    }
    if (target.platform === "windows_amd64") {
      fs.copyFileSync(tempBinaryPath, path.join(dreaminaBinDir, "dreamina.exe"));
    }
  }
  fs.copyFileSync(tempSkillPath, skillPath);

  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        installerUrl: DREAMINA_INSTALLER_URL,
        downloadBase: artifactInfos[0]?.artifactInfo.downloadBase ?? null,
        artifacts: artifactInfos.map(({ target, artifactInfo }) => ({
          platform: target.platform,
          binaryName: artifactInfo.binaryName,
          binaryUrl: artifactInfo.binaryUrl,
          relativeOutputPath: target.relativeOutputPath.replace(/\\/g, "/"),
        })),
        binaryName: artifactInfos[0]?.artifactInfo.binaryName ?? null,
        binaryUrl: artifactInfos[0]?.artifactInfo.binaryUrl ?? null,
        skillUrl: artifactInfos[0]?.artifactInfo.skillUrl ?? null,
        versionUrl,
        version: versionInfo?.version ?? null,
        releaseDate: versionInfo?.release_date ?? null,
        releaseNotes: versionInfo?.release_notes ?? null,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(
    `Dreamina CLI is ready and will be bundled into the installer: ${artifactInfos
      .map(({ artifactInfo }) => artifactInfo.binaryName)
      .join(", ")}`,
  );
}

await main();
