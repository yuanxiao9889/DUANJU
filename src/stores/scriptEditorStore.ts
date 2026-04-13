import { create } from 'zustand';

interface ScriptEditorState {
  activeSceneNodeId: string | null;
  activeEpisodeId: string | null;
  focusSceneNode: (sceneNodeId: string, episodeId?: string | null) => void;
  clearSelection: () => void;
}

export const useScriptEditorStore = create<ScriptEditorState>((set) => ({
  activeSceneNodeId: null,
  activeEpisodeId: null,
  focusSceneNode: (sceneNodeId, episodeId) => {
    set({
      activeSceneNodeId: sceneNodeId,
      activeEpisodeId: episodeId ?? null,
    });
  },
  clearSelection: () => {
    set({
      activeSceneNodeId: null,
      activeEpisodeId: null,
    });
  },
}));
