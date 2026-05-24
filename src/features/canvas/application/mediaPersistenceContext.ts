import type {
  MediaPersistContext,
  MediaPersistRole,
  MediaPersistType,
} from '@/commands/media';

let activeMediaProjectId: string | null = null;
let activeMediaProjectName: string | null = null;

export function setActiveMediaProjectId(
  projectId: string | null | undefined,
  projectName?: string | null | undefined
): void {
  activeMediaProjectId = projectId?.trim() || null;
  activeMediaProjectName = activeMediaProjectId ? projectName?.trim() || null : null;
}

export function getActiveMediaProjectId(): string | null {
  return activeMediaProjectId;
}

export function createCurrentProjectMediaContext(
  mediaType: MediaPersistType,
  role?: MediaPersistRole
): MediaPersistContext {
  const context: MediaPersistContext = {
    projectId: activeMediaProjectId,
    projectName: activeMediaProjectName,
    mediaType,
  };
  if (role) {
    context.role = role;
  }
  return context;
}

export function createSharedMediaContext(
  mediaType: MediaPersistType,
  role?: MediaPersistRole
): MediaPersistContext {
  const context: MediaPersistContext = {
    projectId: null,
    projectName: null,
    mediaType,
  };
  if (role) {
    context.role = role;
  }
  return context;
}
