import { create } from 'zustand';

import type { ShootingScriptColumnKey } from '@/features/canvas/domain/canvasNodes';

export type ScriptWorkbenchKind = 'none' | 'chapter' | 'scene' | 'shootingScript';

export interface ShootingScriptCellSelection {
  rowId: string;
  columnKey: ShootingScriptColumnKey;
}

interface ScriptEditorState {
  activeWorkbenchKind: ScriptWorkbenchKind;
  activeChapterId: string | null;
  activeChapterSceneId: string | null;
  activeSceneNodeId: string | null;
  activeEpisodeId: string | null;
  activeScriptNodeId: string | null;
  activeScriptCell: ShootingScriptCellSelection | null;
  focusChapter: (chapterId: string, sceneId?: string | null) => void;
  focusChapterScene: (chapterId: string, sceneId: string) => void;
  focusSceneNode: (sceneNodeId: string, episodeId?: string | null) => void;
  focusShootingScript: (
    scriptNodeId: string,
    options?: {
      sceneNodeId?: string | null;
      episodeId?: string | null;
      cell?: ShootingScriptCellSelection | null;
    }
  ) => void;
  focusShootingScriptCell: (
    scriptNodeId: string,
    cell: ShootingScriptCellSelection | null,
    options?: {
      sceneNodeId?: string | null;
      episodeId?: string | null;
    }
  ) => void;
  clearSelection: () => void;
}

export const useScriptEditorStore = create<ScriptEditorState>((set) => ({
  activeWorkbenchKind: 'none',
  activeChapterId: null,
  activeChapterSceneId: null,
  activeSceneNodeId: null,
  activeEpisodeId: null,
  activeScriptNodeId: null,
  activeScriptCell: null,
  focusChapter: (chapterId, sceneId) => {
    set({
      activeWorkbenchKind: 'chapter',
      activeChapterId: chapterId,
      activeChapterSceneId: sceneId ?? null,
      activeSceneNodeId: null,
      activeEpisodeId: null,
      activeScriptNodeId: null,
      activeScriptCell: null,
    });
  },
  focusChapterScene: (chapterId, sceneId) => {
    set({
      activeWorkbenchKind: 'chapter',
      activeChapterId: chapterId,
      activeChapterSceneId: sceneId,
      activeSceneNodeId: null,
      activeEpisodeId: null,
      activeScriptNodeId: null,
      activeScriptCell: null,
    });
  },
  focusSceneNode: (sceneNodeId, episodeId) => {
    set({
      activeWorkbenchKind: 'scene',
      activeChapterId: null,
      activeChapterSceneId: null,
      activeSceneNodeId: sceneNodeId,
      activeEpisodeId: episodeId ?? null,
      activeScriptNodeId: null,
      activeScriptCell: null,
    });
  },
  focusShootingScript: (scriptNodeId, options) => {
    set({
      activeWorkbenchKind: 'shootingScript',
      activeChapterId: null,
      activeChapterSceneId: null,
      activeSceneNodeId: options?.sceneNodeId ?? null,
      activeEpisodeId: options?.episodeId ?? null,
      activeScriptNodeId: scriptNodeId,
      activeScriptCell: options?.cell ?? null,
    });
  },
  focusShootingScriptCell: (scriptNodeId, cell, options) => {
    set((state) => ({
      activeWorkbenchKind: 'shootingScript',
      activeChapterId: null,
      activeChapterSceneId: null,
      activeSceneNodeId: options?.sceneNodeId ?? state.activeSceneNodeId,
      activeEpisodeId: options?.episodeId ?? state.activeEpisodeId,
      activeScriptNodeId: scriptNodeId,
      activeScriptCell: cell,
    }));
  },
  clearSelection: () => {
    set({
      activeWorkbenchKind: 'none',
      activeChapterId: null,
      activeChapterSceneId: null,
      activeSceneNodeId: null,
      activeEpisodeId: null,
      activeScriptNodeId: null,
      activeScriptCell: null,
    });
  },
}));
