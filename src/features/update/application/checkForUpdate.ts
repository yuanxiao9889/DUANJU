import packageMetadata from '../../../../package.json';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';

const GITHUB_LATEST_RELEASE_API =
  'https://api.github.com/repos/henjicc/Storyboard-Copilot/releases/latest';
const VERSION_SUPPRESSION_STORAGE_KEY = 'storyboard:update-check:version-suppressions';
const UPDATE_CHECK_TIMEOUT_MS = 8_000;

export type UpdateErrorCode = 'network' | 'no-endpoint' | 'install' | 'unknown';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  latestVersion?: string;
  currentVersion?: string;
  releaseNotes?: string;
  publishedAt?: string;
  error?: UpdateErrorCode;
}

export interface UpdateDownloadProgress {
  phase: 'downloading' | 'installing';
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

interface GithubLatestReleaseResponse {
  tag_name?: string;
  body?: string;
  published_at?: string;
}

interface GithubLatestReleaseInfo {
  version: string;
  releaseNotes?: string;
  publishedAt?: string;
}

type VersionSuppressionMode = 'today' | 'forever';

interface VersionSuppressionRecord {
  mode: VersionSuppressionMode;
  dayKey?: string;
}

type VersionSuppressionMap = Record<string, VersionSuppressionRecord>;

let pendingUpdate: Update | null = null;

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function getLocalDateKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readVersionSuppressions(): VersionSuppressionMap {
  try {
    const raw = localStorage.getItem(VERSION_SUPPRESSION_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<VersionSuppressionMap>(
      (acc, [version, value]) => {
        if (!version || typeof value !== 'object' || value === null) {
          return acc;
        }
        const mode = (value as { mode?: unknown }).mode;
        if (mode !== 'today' && mode !== 'forever') {
          return acc;
        }
        const dayKey = (value as { dayKey?: unknown }).dayKey;
        acc[version] = {
          mode,
          dayKey: typeof dayKey === 'string' ? dayKey : undefined,
        };
        return acc;
      },
      {}
    );
  } catch {
    return {};
  }
}

function writeVersionSuppressions(map: VersionSuppressionMap): void {
  try {
    localStorage.setItem(VERSION_SUPPRESSION_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures
  }
}

export function suppressUpdateVersion(version: string, mode: VersionSuppressionMode): void {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    return;
  }

  const map = readVersionSuppressions();
  map[normalized] =
    mode === 'today'
      ? {
          mode: 'today',
          dayKey: getLocalDateKey(new Date()),
        }
      : { mode: 'forever' };

  writeVersionSuppressions(map);
}

export function isUpdateVersionSuppressed(version: string): boolean {
  const normalized = normalizeVersion(version);
  if (!normalized) {
    return false;
  }

  const map = readVersionSuppressions();
  const record = map[normalized];
  if (!record) {
    return false;
  }

  if (record.mode === 'forever') {
    return true;
  }

  const today = getLocalDateKey(new Date());
  return record.dayKey === today;
}

function parseVersionParts(version: string): number[] {
  const core = normalizeVersion(version).split('-')[0] ?? '';
  return core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) {
      return 1;
    }
    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function isWindowsUpdaterRuntime(): boolean {
  return (
    isTauri() &&
    typeof navigator !== 'undefined' &&
    /Windows/i.test(navigator.userAgent)
  );
}

function resolveUpdateErrorCode(error: unknown): UpdateErrorCode {
  const message = String(error ?? '').toLowerCase();

  if (
    message.includes('endpoint') ||
    message.includes('pubkey') ||
    message.includes('public key')
  ) {
    return 'no-endpoint';
  }

  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('dns') ||
    message.includes('status code') ||
    message.includes('http') ||
    message.includes('request') ||
    message.includes('fetch')
  ) {
    return 'network';
  }

  return 'unknown';
}

function withTimeoutSignal(timeoutMs = UPDATE_CHECK_TIMEOUT_MS): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => globalThis.clearTimeout(timeoutId),
  };
}

async function resolveCurrentVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const runtimeVersion = normalizeVersion(await getVersion());
      if (runtimeVersion) {
        return runtimeVersion;
      }
    } catch {
      // fall through to package version
    }
  }

  return normalizeVersion(packageMetadata.version ?? '');
}

async function replacePendingUpdate(nextUpdate: Update | null): Promise<void> {
  if (pendingUpdate && pendingUpdate !== nextUpdate) {
    await pendingUpdate.close().catch(() => undefined);
  }
  pendingUpdate = nextUpdate;
}

async function fetchLatestGithubRelease(): Promise<GithubLatestReleaseInfo | null> {
  const { signal, clear } = withTimeoutSignal();

  try {
    const response = await fetch(GITHUB_LATEST_RELEASE_API, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`github latest release request failed with status ${response.status}`);
    }

    const data = (await response.json()) as GithubLatestReleaseResponse;
    const version = normalizeVersion(data.tag_name ?? '');
    if (!version) {
      return null;
    }

    return {
      version,
      releaseNotes: typeof data.body === 'string' ? data.body : undefined,
      publishedAt: typeof data.published_at === 'string' ? data.published_at : undefined,
    };
  } finally {
    clear();
  }
}

function toManualUpdateResult(
  release: GithubLatestReleaseInfo,
  currentVersion: string,
  error?: UpdateErrorCode
): UpdateCheckResult {
  return {
    hasUpdate: true,
    latestVersion: release.version,
    currentVersion,
    releaseNotes: release.releaseNotes,
    publishedAt: release.publishedAt,
    error,
  };
}

async function checkGithubReleaseFallback(
  currentVersion: string,
  error?: UpdateErrorCode
): Promise<UpdateCheckResult> {
  const latestRelease = await fetchLatestGithubRelease();
  if (!latestRelease) {
    return { hasUpdate: false, currentVersion, error };
  }

  if (compareVersions(latestRelease.version, currentVersion) > 0) {
    return toManualUpdateResult(latestRelease, currentVersion, error);
  }

  return { hasUpdate: false, currentVersion, error };
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const currentVersion = await resolveCurrentVersion();
    if (!currentVersion) {
      return { hasUpdate: false };
    }

    if (!isWindowsUpdaterRuntime()) {
      return await checkGithubReleaseFallback(currentVersion);
    }

    try {
      const availableUpdate = await check();
      if (!availableUpdate) {
        await replacePendingUpdate(null);
        return { hasUpdate: false, currentVersion };
      }

      await replacePendingUpdate(availableUpdate);
      return {
        hasUpdate: true,
        latestVersion: normalizeVersion(availableUpdate.version),
        currentVersion: normalizeVersion(availableUpdate.currentVersion) || currentVersion,
        releaseNotes: availableUpdate.body,
        publishedAt: availableUpdate.date,
      };
    } catch (error) {
      await replacePendingUpdate(null);
      const updateErrorCode = resolveUpdateErrorCode(error);

      try {
        return await checkGithubReleaseFallback(currentVersion, updateErrorCode);
      } catch {
        return {
          hasUpdate: false,
          currentVersion,
          error: updateErrorCode,
        };
      }
    }
  } catch (error) {
    return {
      hasUpdate: false,
      error: resolveUpdateErrorCode(error),
    };
  }
}

export async function downloadAndInstallUpdate(
  onProgress?: (progress: UpdateDownloadProgress) => void
): Promise<void> {
  if (!isWindowsUpdaterRuntime()) {
    throw new Error('In-app updater is only available on Windows.');
  }

  if (!pendingUpdate) {
    throw new Error('No update is ready to install. Please check for updates again.');
  }

  const currentUpdate = pendingUpdate;
  let downloadedBytes = 0;
  let totalBytes: number | undefined;

  await currentUpdate.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        downloadedBytes = 0;
        totalBytes = event.data.contentLength;
        onProgress?.({
          phase: 'downloading',
          downloadedBytes,
          totalBytes,
          percent: totalBytes ? 0 : undefined,
        });
        break;
      case 'Progress':
        downloadedBytes += event.data.chunkLength;
        onProgress?.({
          phase: 'downloading',
          downloadedBytes,
          totalBytes,
          percent: totalBytes ? Math.min(downloadedBytes / totalBytes, 1) : undefined,
        });
        break;
      case 'Finished':
        onProgress?.({
          phase: 'installing',
          downloadedBytes,
          totalBytes,
          percent: 1,
        });
        break;
    }
  });

  await currentUpdate.close().catch(() => undefined);
  if (pendingUpdate === currentUpdate) {
    pendingUpdate = null;
  }
}
