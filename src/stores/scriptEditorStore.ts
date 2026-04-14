import { create } from 'zustand';

interface ScriptEditorState {
  activeChapterId: string | null;
  activeChapterSceneId: string | null;
  activeSceneNodeId: string | null;
  activeEpisodeId: string | null;
  focusChapter: (chapterId: string, sceneId?: string | null) => void;
  focusChapterScene: (chapterId: string, sceneId: string) => void;
  focusSceneNode: (sceneNodeId: string, episodeId?: string | null) => void;
  clearSelection: () => void;
}

export const useScriptEditorStore = create<ScriptEditorState>((set) => ({
  activeChapterId: null,
  activeChapterSceneId: null,
  activeSceneNodeId: null,
  activeEpisodeId: null,
  focusChapter: (chapterId, sceneId) => {
    set({
      activeChapterId: chapterId,
      activeChapterSceneId: sceneId ?? null,
      activeSceneNodeId: null,
      activeEpisodeId: null,
    });
  },
  focusChapterScene: (chapterId, sceneId) => {
    set({
      activeChapterId: chapterId,
      activeChapterSceneId: sceneId,
      activeSceneNodeId: null,
      activeEpisodeId: null,
    });
  },
  focusSceneNode: (sceneNodeId, episodeId) => {
    set({
      activeChapterId: null,
      activeChapterSceneId: null,
      activeSceneNodeId: sceneNodeId,
      activeEpisodeId: episodeId ?? null,
    });
  },
  clearSelection: () => {
    set({
      activeChapterId: null,
      activeChapterSceneId: null,
      activeSceneNodeId: null,
      activeEpisodeId: null,
    });
  },
}));
