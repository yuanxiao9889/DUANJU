import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';

export function resolveDirectorStageModelUrl(source: string): string {
  return resolveImageDisplayUrl(source);
}

export function isSupportedDirectorStageModelPath(source: string): boolean {
  return /\.(glb|gltf|fbx)(?:[?#].*)?$/i.test(source.trim());
}
