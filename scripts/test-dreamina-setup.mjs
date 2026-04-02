#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function toBashPath(inputPath) {
  const normalized = inputPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(normalized)) {
    const drive = normalized[0].toLowerCase();
    const tail = normalized.slice(2).replace(/^\/+/, "");
    return tail ? `/${drive}/${tail}` : `/${drive}`;
  }
  return normalized;
}

function bashQuote(value) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function homeDriveFromWindowsPath(inputPath) {
  const parsed = path.parse(inputPath);
  return parsed.root.replace(/[\\/]+$/, "") || "C:";
}

function homePathFromWindowsPath(inputPath) {
  const parsed = path.parse(inputPath);
  const suffix = inputPath.slice(parsed.root.length);
  return suffix ? `\\${suffix.replace(/^\\+/, "")}` : "\\";
}

function combinedOutput(result) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function assertOrExit(condition, message, details = null) {
  if (condition) {
    return;
  }

  console.error(`[FAIL] ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(targetPath, timeoutMs, intervalMs = 500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await fileExists(targetPath)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return await fileExists(targetPath);
}

async function main() {
  if (process.platform !== "win32") {
    console.log("Skipping Dreamina setup smoke test on non-Windows host.");
    return;
  }

  const repoRoot = resolveRepoRoot();
  const gitRoot = path.join(repoRoot, "src-tauri", "resources", "portable-git");
  const dreaminaRoot = path.join(repoRoot, "src-tauri", "resources", "dreamina-cli");
  const bashPath = path.join(gitRoot, "bin", "bash.exe");
  const bundledDreaminaBinary = path.join(dreaminaRoot, "bin", "dreamina.exe");

  try {
    await fs.access(bashPath);
  } catch {
    assertOrExit(false, `Bundled Git was not found at ${bashPath}`);
  }

  try {
    await fs.access(bundledDreaminaBinary);
  } catch {
    assertOrExit(false, `Bundled Dreamina CLI was not found at ${bundledDreaminaBinary}`);
  }

  const testRoot = path.join(
    os.tmpdir(),
    `dreamina-setup-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const userProfile = path.join(testRoot, "UserProfile");
  const roaming = path.join(userProfile, "AppData", "Roaming");
  const local = path.join(userProfile, "AppData", "Local");
  const tempDir = path.join(local, "Temp");
  const workspace = path.join(
    roaming,
    "com.storyboard.copilot",
    "dreamina-cli-runtime",
    "workspace",
  );

  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  const windir = process.env.WINDIR || "C:\\Windows";
  const minimalPath = [
    path.join(windir, "System32"),
    windir,
    path.join(windir, "System32", "WindowsPowerShell", "v1.0"),
  ].join(";");
  const pathPrefix = [
    toBashPath(path.join(dreaminaRoot, "bin")),
    toBashPath(path.join(userProfile, "bin")),
    toBashPath(path.join(gitRoot, "bin")),
    toBashPath(path.join(gitRoot, "usr", "bin")),
    toBashPath(path.join(gitRoot, "mingw64", "bin")),
    "/c/Windows/System32",
    "/c/Windows/System32/WindowsPowerShell/v1.0",
    "/c/Windows",
  ].join(":");
  const bashEnvPrefix = [
    `export PATH=${bashQuote(pathPrefix)}:$PATH`,
    `export USERPROFILE=${bashQuote(userProfile)}`,
    `export HOME=${bashQuote(toBashPath(userProfile))}`,
    `export HOMEDRIVE=${bashQuote(homeDriveFromWindowsPath(userProfile))}`,
    `export HOMEPATH=${bashQuote(homePathFromWindowsPath(userProfile))}`,
  ].join("; ");

  const env = {
    ...process.env,
    USERPROFILE: userProfile,
    HOME: userProfile,
    HOMEDRIVE: homeDriveFromWindowsPath(userProfile),
    HOMEPATH: homePathFromWindowsPath(userProfile),
    APPDATA: roaming,
    LOCALAPPDATA: local,
    TEMP: tempDir,
    TMP: tempDir,
    PATH: minimalPath,
  };

  console.log(`[INFO] testRoot=${testRoot}`);
  console.log(`[INFO] workspace=${workspace}`);

  const initialCheck = await runCommand(
    bashPath,
    [
      "-lc",
      `${bashEnvPrefix}; echo DREAMINA_BIN=$(command -v dreamina); set +e; dreamina user_credit; status=$?; echo __EXIT__:$status; exit 0`,
    ],
    {
      cwd: workspace,
      env,
    },
  );
  const initialOutput = combinedOutput(initialCheck);
  console.log("[STEP] initial-check");
  console.log(initialOutput);
  assertOrExit(initialCheck.code === 0, "Initial isolated check did not finish cleanly.", initialOutput);
  assertOrExit(
    initialOutput.includes(
      `DREAMINA_BIN=${toBashPath(bundledDreaminaBinary.replace(/\.exe$/i, ""))}`,
    ),
    "Initial isolated environment did not resolve the bundled Dreamina CLI.",
    initialOutput,
  );
  assertOrExit(
    /__EXIT__:(1|2|255)/.test(initialOutput),
    "Bundled Dreamina CLI did not stop at the expected login-required state.",
    initialOutput,
  );
  assertOrExit(
    /登录|login|credential|未检测到有效登录态|unauthorized|forbidden/i.test(initialOutput),
    "Bundled Dreamina CLI did not surface the expected login-required signal.",
    initialOutput,
  );

  await runCommand(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$path = '${bundledDreaminaBinary.replace(/'/g, "''")}'; Get-Process dreamina -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $path } | Stop-Process -Force -ErrorAction SilentlyContinue`,
    ],
    { env },
  ).catch(() => null);

  const loginQrPath = path.join(workspace, "dreamina-login-qr.png");
  const loginCommand = spawn(
    bashPath,
    [
      "-lc",
      `${bashEnvPrefix}; '${bundledDreaminaBinary.replace(/\\/g, "/")}' login --headless --debug`,
    ],
    {
      cwd: workspace,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let loginStdout = "";
  let loginStderr = "";
  loginCommand.stdout.on("data", (chunk) => {
    loginStdout += chunk.toString();
  });
  loginCommand.stderr.on("data", (chunk) => {
    loginStderr += chunk.toString();
  });

  const qrReady = await waitForFile(loginQrPath, 20000);

  if (loginCommand.pid) {
    await runCommand("taskkill", ["/pid", String(loginCommand.pid), "/t", "/f"], {
      env,
    }).catch(() => null);
  }

  const qrStat = await fs.stat(loginQrPath).catch(() => null);
  const loginOutput = [loginStdout, loginStderr].filter(Boolean).join("\n").trim();
  console.log("[STEP] qr-check");
  if (loginOutput) {
    console.log(loginOutput);
  }
  assertOrExit(
    qrReady && !!qrStat && qrStat.size > 0,
    "Headless Dreamina login did not render a QR code file in the runtime workspace.",
    loginOutput || `Expected QR at ${loginQrPath}`,
  );

  console.log("[PASS] Dreamina first-use setup smoke test passed.");
  console.log("[PASS] Bundled Git works, the bundled Dreamina CLI resolves directly, and the official headless login flow renders a QR code file as expected.");

  if (process.env.KEEP_DREAMINA_SMOKE !== "1") {
    let cleaned = false;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        await fs.rm(testRoot, { recursive: true, force: true });
        cleaned = true;
        break;
      } catch (error) {
        if (attempt === 5) {
          console.warn(`[WARN] Failed to remove smoke-test directory immediately: ${error}`);
          console.warn(`[WARN] You can remove it later if needed: ${testRoot}`);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }
    if (cleaned) {
      console.log("[INFO] Smoke-test directory cleaned up.");
    }
  } else {
    console.log(`[INFO] Preserved smoke-test directory: ${testRoot}`);
  }
}

await main();
