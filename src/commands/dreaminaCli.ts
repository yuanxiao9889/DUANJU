import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DreaminaReferenceAssetPayload {
  fileName: string;
  dataUrl: string;
}

export interface GenerateJimengDreaminaImagesPayload {
  prompt: string;
  aspectRatio?: string;
  resolutionType?: string;
  modelVersion?: string;
  referenceImages?: DreaminaReferenceAssetPayload[];
  imageCount?: number;
  timeoutMs?: number;
}

export interface GenerateJimengDreaminaVideosPayload {
  prompt: string;
  referenceMode?: string;
  aspectRatio?: string;
  durationSeconds?: number;
  videoResolution?: string;
  modelVersion?: string;
  referenceImages?: DreaminaReferenceAssetPayload[];
  referenceVideos?: DreaminaReferenceAssetPayload[];
  referenceAudios?: DreaminaReferenceAssetPayload[];
  timeoutMs?: number;
}

export interface JimengDreaminaGeneratedImageResult {
  index: number;
  sourceUrl: string;
  width?: number | null;
  height?: number | null;
  fileName?: string | null;
}

export interface JimengDreaminaGeneratedVideoResult {
  index: number;
  sourceUrl: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  fileName?: string | null;
}

export type DreaminaCliStatusCode =
  | "ready"
  | "gitBashMissing"
  | "cliMissing"
  | "loginRequired"
  | "membershipRequired"
  | "unknown";

export type DreaminaGitSource = "bundled" | "system";
export type DreaminaCliBinarySource = "bundled" | "userInstalled" | "systemPath";

export type DreaminaSetupProgressStage =
  | "checking"
  | "preparingGit"
  | "installingCli"
  | "openingLogin"
  | "waitingForLogin"
  | "failed"
  | "verifying"
  | "completed";

export interface DreaminaCliStatusResponse {
  ready: boolean;
  code: DreaminaCliStatusCode;
  message: string;
  detail?: string | null;
}

export interface DreaminaCliActionResponse {
  message: string;
  detail?: string | null;
}

export interface DreaminaCliUpdateInfoResponse {
  activeSource: DreaminaCliBinarySource;
  currentVersion?: string | null;
  bundledVersion?: string | null;
  latestVersion?: string | null;
  releaseDate?: string | null;
  releaseNotes?: string | null;
  hasUpdate: boolean;
  checkError?: string | null;
}

export interface DreaminaSetupProgressEvent {
  stage: DreaminaSetupProgressStage;
  progress: number;
  gitSource?: DreaminaGitSource | null;
  detail?: string | null;
  loginQrDataUrl?: string | null;
}

export interface DreaminaGuidedSetupResponse {
  status: DreaminaCliStatusResponse;
  gitSource?: DreaminaGitSource | null;
  loginTerminalOpened: boolean;
  loginWaitTimedOut: boolean;
}

export interface JimengDreaminaImageGenerationResponse {
  results: JimengDreaminaGeneratedImageResult[];
  submitIds: string[];
}

export interface JimengDreaminaImageSubmitResponse {
  submitIds: string[];
}

export interface JimengDreaminaVideoGenerationResponse {
  results: JimengDreaminaGeneratedVideoResult[];
  submitId: string;
}

export interface JimengDreaminaVideoSubmitResponse {
  submitId: string;
}

export interface QueryJimengDreaminaImageResultsPayload {
  submitIds: string[];
}

export interface QueryJimengDreaminaVideoResultPayload {
  submitId: string;
}

export interface JimengDreaminaImageQueryResponse {
  submitIds: string[];
  pendingSubmitIds: string[];
  failedSubmitIds: string[];
  results: JimengDreaminaGeneratedImageResult[];
  warnings: string[];
}

export interface JimengDreaminaVideoQueryResponse {
  submitId: string;
  pending: boolean;
  status: "pending" | "success" | "failed";
  results: JimengDreaminaGeneratedVideoResult[];
  warnings: string[];
  failureMessage?: string | null;
}

export async function checkDreaminaCliStatus(): Promise<DreaminaCliStatusResponse> {
  return await invoke<DreaminaCliStatusResponse>("check_dreamina_cli_status");
}

export async function checkDreaminaCliUpdate(): Promise<DreaminaCliUpdateInfoResponse> {
  return await invoke<DreaminaCliUpdateInfoResponse>("check_dreamina_cli_update");
}

export async function installDreaminaCli(): Promise<DreaminaCliActionResponse> {
  return await invoke<DreaminaCliActionResponse>("install_dreamina_cli");
}

export async function updateDreaminaCli(): Promise<DreaminaCliActionResponse> {
  return await invoke<DreaminaCliActionResponse>("update_dreamina_cli");
}

export async function openDreaminaLoginTerminal(): Promise<DreaminaCliActionResponse> {
  return await invoke<DreaminaCliActionResponse>(
    "open_dreamina_login_terminal",
  );
}

export async function logoutDreaminaCli(): Promise<DreaminaCliActionResponse> {
  return await invoke<DreaminaCliActionResponse>("logout_dreamina_cli");
}

export async function runDreaminaGuidedSetup(): Promise<DreaminaGuidedSetupResponse> {
  return await invoke<DreaminaGuidedSetupResponse>("run_dreamina_guided_setup");
}

export function onDreaminaSetupProgress(
  callback: (progress: DreaminaSetupProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<DreaminaSetupProgressEvent>(
    "dreamina://setup-progress",
    (event) => {
      callback(event.payload);
    },
  );
}

export async function generateJimengDreaminaImages(
  payload: GenerateJimengDreaminaImagesPayload,
): Promise<JimengDreaminaImageGenerationResponse> {
  return await invoke<JimengDreaminaImageGenerationResponse>(
    "generate_jimeng_dreamina_images",
    {
      payload,
    },
  );
}

export async function submitJimengDreaminaImages(
  payload: GenerateJimengDreaminaImagesPayload,
): Promise<JimengDreaminaImageSubmitResponse> {
  return await invoke<JimengDreaminaImageSubmitResponse>(
    "submit_jimeng_dreamina_images",
    {
      payload,
    },
  );
}

export async function generateJimengDreaminaVideos(
  payload: GenerateJimengDreaminaVideosPayload,
): Promise<JimengDreaminaVideoGenerationResponse> {
  return await invoke<JimengDreaminaVideoGenerationResponse>(
    "generate_jimeng_dreamina_videos",
    {
      payload,
    },
  );
}

export async function submitJimengDreaminaVideos(
  payload: GenerateJimengDreaminaVideosPayload,
): Promise<JimengDreaminaVideoSubmitResponse> {
  return await invoke<JimengDreaminaVideoSubmitResponse>(
    "submit_jimeng_dreamina_videos",
    {
      payload,
    },
  );
}

export async function queryJimengDreaminaImageResults(
  payload: QueryJimengDreaminaImageResultsPayload,
): Promise<JimengDreaminaImageQueryResponse> {
  return await invoke<JimengDreaminaImageQueryResponse>(
    "query_jimeng_dreamina_image_results",
    {
      payload,
    },
  );
}

export async function queryJimengDreaminaVideoResult(
  payload: QueryJimengDreaminaVideoResultPayload,
): Promise<JimengDreaminaVideoQueryResponse> {
  return await invoke<JimengDreaminaVideoQueryResponse>(
    "query_jimeng_dreamina_video_result",
    {
      payload,
    },
  );
}
