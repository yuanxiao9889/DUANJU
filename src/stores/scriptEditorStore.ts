import { create } from 'zustand';

interface ScriptEditorState {
  activeChapterId: string | null;
  activeSceneId: string | null;
  focusChapter: (chapterId: string, sceneId?: string | null) => void;
  focusScene: (chapterId: string, sceneId: string) => void;
  clearSelection: () => void;
}

export const useScriptEditorStore = create<ScriptEditorState>((set) => ({
  activeChapterId: null,
  activeSceneId: null,
  focusChapter: (chapterId, sceneId) => {
    set({
      activeChapterId: chapterId,
      activeSceneId: sceneId ?? null,
    });
  },
  focusScene: (chapterId, sceneId) => {
    set({
      activeChapterId: chapterId,
      activeSceneId: sceneId,
    });
  },
  clearSelection: () => {
    set({
      activeChapterId: null,
      activeSceneId: null,
    });
  },
}));
