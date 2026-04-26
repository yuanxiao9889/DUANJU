#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

const repoRoot = resolveRepoRoot();
process.chdir(repoRoot);

const [versionArg = "patch", bundleArg = "nsis"] = process.argv.slice(2);

if (!VALID_BUNDLES.has(bundleArg)) {
  fail("Bundle type must be one of: msi, nsis");
}

const packageWindowsArgs = ["scripts/package-windows.mjs", "--bundle", bundleArg];

if (VALID_BUMPS.has(versionArg)) {
  packageWindowsArgs.push("--bump", versionArg);
} else if (VERSION_PATTERN.test(versionArg)) {
  packageWindowsArgs.push("--bump", "manual", "--version", versionArg);
} else {
  fail("Usage: node scripts/build-installer.mjs <patch|minor|major|x.y.z> [msi|nsis]");
}

execFileSync(process.execPath, packageWindowsArgs, { stdio: "inherit" });
