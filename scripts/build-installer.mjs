#!/usr/bin/env node

import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const VALID_BUMPS = new Set(["major", "minor", "patch"]);
const VALID_BUNDLES = new Set(["msi", "nsis"]);
const VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function parseVersion(version) {
  const [core] = version.split("-", 1);
  const parts = core.split(".");
  if (parts.length !== 3) {
    fail(`Invalid current version in package.json: ${version}`);
  }

  const [major, minor, patch] = parts.map((value) => Number(value));
  if ([major, minor, patch].some((value) => Number.isNaN(value))) {
    fail(`Invalid numeric version in package.json: ${version}`);
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

function runStreaming(command, args = []) {
  execFileSync(command, args, { stdio: "inherit" });
}

function runShellCommand(command) {
  execSync(command, { stdio: "inherit" });
}

const repoRoot = resolveRepoRoot();
process.chdir(repoRoot);

const [versionArg = "patch", bundleArg = "nsis"] = process.argv.slice(2);

if (!VALID_BUMPS.has(versionArg) && !VERSION_PATTERN.test(versionArg)) {
  fail("Usage: node scripts/build-installer.mjs <patch|minor|major|x.y.z> [msi|nsis]");
}

if (!VALID_BUNDLES.has(bundleArg)) {
  fail("Bundle type must be one of: msi, nsis");
}

const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const currentVersion = packageJson.version;
const nextVersion = VALID_BUMPS.has(versionArg)
  ? bumpVersion(currentVersion, versionArg)
  : versionArg;

if (!VERSION_PATTERN.test(nextVersion)) {
  fail(`Invalid target version: ${nextVersion}`);
}

console.log(`Syncing version: ${currentVersion} -> ${nextVersion}`);
runStreaming(process.execPath, ["scripts/sync-version.mjs", nextVersion]);

console.log(`Building ${bundleArg.toUpperCase()} installer for v${nextVersion}`);
runShellCommand(`npm run tauri build -- --bundles ${bundleArg}`);
