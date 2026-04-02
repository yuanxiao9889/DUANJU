export const STORYBOARD_EXTENSION_MANIFEST_FILE = 'storyboard-extension.json';
export const QWEN_TTS_SIMPLE_EXTENSION_ID = 'qwen3-tts-simple';
export const QWEN_TTS_COMPLETE_EXTENSION_ID = 'qwen3-tts-complete';

export interface ExtensionFeatureSet {
  nodes: string[];
  settingsSections: string[];
  entryPoints: string[];
}

export interface ExtensionRuntimeEntry {
  kind: string;
  script?: string;
  python?: string;
}

export interface ExtensionModelAsset {
  id: string;
  path: string;
  role?: string;
}

export interface ExtensionStartupStep {
  id: string;
  label: string;
  description?: string;
  durationMs?: number;
}

export interface ExtensionPackageManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  description: string;
  runtime: string;
  features: ExtensionFeatureSet;
  startupSteps: ExtensionStartupStep[];
  entry?: ExtensionRuntimeEntry;
  models?: ExtensionModelAsset[];
}

export interface LoadedExtensionPackage extends ExtensionPackageManifest {
  folderPath: string;
  loadedAt: number;
}

export type ExtensionRuntimeStatus = 'idle' | 'starting' | 'ready' | 'error';

export interface ExtensionRuntimeState {
  status: ExtensionRuntimeStatus;
  progress: number;
  currentStepId: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}
