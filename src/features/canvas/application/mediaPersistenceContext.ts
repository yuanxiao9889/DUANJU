import type {
  MediaPersistContext,
  MediaPersistRole,
  MediaPersistType,
} from '@/commands/media';

let activeMediaProjectId: string | null = null;

export function setActiveMediaProjectId(projectId: string | null | undefined): void {
  activeMediaProjectId = projectId?.trim() || null;
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
    mediaType,
  };
  if (role) {
    context.role = role;
  }
  return context;
}
