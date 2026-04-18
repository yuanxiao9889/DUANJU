import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  UiButton,
  UiChipButton,
  UiLoadingAnimation,
  UiModal,
  UiPanel,
  UiSelect,
  TextPromptDialog,
} from '@/components/ui';
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes';
import {
  CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT,
  CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT,
  emitToClipLibraryPanel,
  isClipLibraryPanelOpenBlocked,
  openClipLibraryPanelWindow,
  queueClipLibraryPanelFocusTarget,
  queueClipLibraryPanelLibrary,
} from '@/features/clip-library/application/clipLibraryPanelBridge';
import type {
  ClipFolderRecord,
  ClipLibrarySnapshot,
} from '@/features/clip-library/domain/types';
import { useCanvasStore } from '@/stores/canvasStore';
import { useClipLibraryStore } from '@/stores/clipLibraryStore';
import { useProjectStore } from '@/stores/projectStore';

interface NodeAddToClipLibraryButtonProps {
  node: CanvasNode;
  mediaSource: string;
  className: string;
}

interface FolderSelection {
  chapterId: string;
  shotId: string;
  scriptId: string;
}

interface TextPromptState {
  title: string;
  label: string;
  initialValue?: string;
  onConfirm: (value: string) => Promise<void>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveNodeDescriptionText(node: CanvasNode): string {
  const data = node.data as Record<string, unknown>;
  for (const key of [
    'descriptionText',
    'nodeDescription',
    'description',
    'prompt',
    'note',
    'caption',
    'scriptText',
  ]) {
    const value = normalizeText(data[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function resolveNodeMediaOverride(node: CanvasNode) {
  const data = node.data as Record<string, unknown>;
  const audioUrl = normalizeText(data.audioUrl);
  const videoUrl = normalizeText(data.videoUrl);
  const sourcePath = audioUrl || videoUrl;
  if (!sourcePath) {
    return null;
  }

  const mediaType = audioUrl ? 'audio' : 'video';
  const fileName = normalizeText(audioUrl ? data.audioFileName : data.videoFileName);
  const displayName = normalizeText(data.displayName);
  const mimeType = normalizeText(data.mimeType);
  const durationSeconds =
    typeof data.duration === 'number' && Number.isFinite(data.duration) && data.duration > 0
      ? data.duration
      : null;

  return {
    mediaType,
    sourcePath,
    previewPath: normalizeText(data.previewImageUrl) || null,
    title: displayName || fileName || null,
    descriptionText: resolveNodeDescriptionText(node) || null,
    durationMs: durationSeconds !== null ? Math.round(durationSeconds * 1000) : null,
    mimeType: mimeType || null,
  } as const;
}

function resolveFolderSelection(
  snapshot: ClipLibrarySnapshot | null,
  scriptFolderId: string | null | undefined
): FolderSelection | null {
  if (!snapshot || !scriptFolderId) {
    return null;
  }

  const scriptFolder = snapshot.folders.find(
    (folder) => folder.id === scriptFolderId && folder.kind === 'script'
  );
  if (!scriptFolder) {
    return null;
  }

  const shotFolder = snapshot.folders.find(
    (folder) => folder.id === scriptFolder.parentId && folder.kind === 'shot'
  );
  if (!shotFolder) {
    return null;
  }

  return {
    chapterId: shotFolder.chapterId,
    shotId: shotFolder.id,
    scriptId: scriptFolder.id,
  };
}

function firstScriptFolder(snapshot: ClipLibrarySnapshot | null): FolderSelection | null {
  if (!snapshot) {
    return null;
  }

  const scriptFolder = [...snapshot.folders]
    .filter((folder) => folder.kind === 'script')
    .sort((left, right) => {
      if (left.chapterId !== right.chapterId) {
        return left.chapterId.localeCompare(right.chapterId, 'zh-Hans-CN', { numeric: true });
      }
      if ((left.parentId ?? '') !== (right.parentId ?? '')) {
        return (left.parentId ?? '').localeCompare(right.parentId ?? '', 'zh-Hans-CN', {
          numeric: true,
        });
      }
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }
      return left.createdAt - right.createdAt;
    })[0];

  return resolveFolderSelection(snapshot, scriptFolder?.id ?? null);
}

function sortFolders(folders: ClipFolderRecord[]): ClipFolderRecord[] {
  return [...folders].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return left.createdAt - right.createdAt;
  });
}

function ClipLibraryTargetPickerDialog({
  isOpen,
  onClose,
  currentLibraryId,
  currentLastFolderId,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentLibraryId: string | null;
  currentLastFolderId: string | null;
  onConfirm: (selection: { libraryId: string; folderId: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const hydrate = useClipLibraryStore((state) => state.hydrate);
  const libraries = useClipLibraryStore((state) => state.libraries);
  const currentSnapshot = useClipLibraryStore((state) => state.currentSnapshot);
  const currentStoreLibraryId = useClipLibraryStore((state) => state.currentLibraryId);
  const isLoadingLibraries = useClipLibraryStore((state) => state.isLoadingLibraries);
  const isLoadingSnapshot = useClipLibraryStore((state) => state.isLoadingSnapshot);
  const loadLibrary = useClipLibraryStore((state) => state.loadLibrary);
  const createChapter = useClipLibraryStore((state) => state.createChapter);
  const createFolder = useClipLibraryStore((state) => state.createFolder);

  const [selectedLibraryId, setSelectedLibraryId] = useState('');
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [selectedShotId, setSelectedShotId] = useState('');
  const [selectedScriptId, setSelectedScriptId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [textPromptState, setTextPromptState] = useState<TextPromptState | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    void hydrate();
  }, [hydrate, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const nextLibraryId = currentLibraryId?.trim() || libraries[0]?.id || '';
    setSelectedLibraryId(nextLibraryId);
  }, [currentLibraryId, isOpen, libraries]);

  useEffect(() => {
    if (!isOpen || !selectedLibraryId) {
      return;
    }
    if (currentStoreLibraryId === selectedLibraryId && currentSnapshot?.library.id === selectedLibraryId) {
      return;
    }
    void loadLibrary(selectedLibraryId);
  }, [currentSnapshot?.library.id, currentStoreLibraryId, isOpen, loadLibrary, selectedLibraryId]);

  useEffect(() => {
    if (!isOpen || !currentSnapshot || currentSnapshot.library.id !== selectedLibraryId) {
      return;
    }

    const preferredSelection =
      resolveFolderSelection(currentSnapshot, currentLastFolderId)
      ?? firstScriptFolder(currentSnapshot);

    if (!preferredSelection) {
      setSelectedChapterId(currentSnapshot.chapters[0]?.id ?? '');
      setSelectedShotId('');
      setSelectedScriptId('');
      return;
    }

    setSelectedChapterId((value) => {
      if (value && currentSnapshot.chapters.some((chapter) => chapter.id === value)) {
        return value;
      }
      return preferredSelection.chapterId;
    });
    setSelectedShotId(preferredSelection.shotId);
    setSelectedScriptId(preferredSelection.scriptId);
  }, [currentLastFolderId, currentSnapshot, isOpen, selectedLibraryId]);

  const chapters = currentSnapshot?.chapters ?? [];
  const shots = useMemo(() => {
    if (!currentSnapshot || !selectedChapterId) {
      return [];
    }
    return sortFolders(
      currentSnapshot.folders.filter(
        (folder) =>
          folder.kind === 'shot' && folder.chapterId === selectedChapterId && folder.parentId === null
      )
    );
  }, [currentSnapshot, selectedChapterId]);

  const scripts = useMemo(() => {
    if (!currentSnapshot || !selectedShotId) {
      return [];
    }
    return sortFolders(
      currentSnapshot.folders.filter(
        (folder) => folder.kind === 'script' && folder.parentId === selectedShotId
      )
    );
  }, [currentSnapshot, selectedShotId]);

  useEffect(() => {
    if (!selectedChapterId && chapters.length > 0) {
      setSelectedChapterId(chapters[0].id);
      return;
    }
    if (selectedChapterId && !chapters.some((chapter) => chapter.id === selectedChapterId)) {
      setSelectedChapterId(chapters[0]?.id ?? '');
    }
  }, [chapters, selectedChapterId]);

  useEffect(() => {
    if (shots.length === 0) {
      setSelectedShotId('');
      setSelectedScriptId('');
      return;
    }
    if (!selectedShotId || !shots.some((folder) => folder.id === selectedShotId)) {
      setSelectedShotId(shots[0].id);
      return;
    }
  }, [selectedShotId, shots]);

  useEffect(() => {
    if (scripts.length === 0) {
      setSelectedScriptId('');
      return;
    }
    if (!selectedScriptId || !scripts.some((folder) => folder.id === selectedScriptId)) {
      setSelectedScriptId(scripts[0].id);
    }
  }, [scripts, selectedScriptId]);

  const handleCreateChapter = useCallback(async () => {
    if (!selectedLibraryId) {
      return;
    }

    setTextPromptState({
      title: t('clipLibrary.actions.createChapter'),
      label: t('clipLibrary.targetPicker.createChapterPrompt'),
      onConfirm: async (name) => {
        try {
          const chapter = await createChapter({ libraryId: selectedLibraryId, name });
          await loadLibrary(selectedLibraryId);
          setSelectedChapterId(chapter.id);
          setSelectedShotId('');
          setSelectedScriptId('');
        } catch (error) {
          console.error('Failed to create clip chapter inside target picker', error);
          window.alert(t('clipLibrary.targetPicker.createChapterFailed'));
          throw error;
        }
      },
    });
  }, [createChapter, loadLibrary, selectedLibraryId, t]);

  const handleCreateShot = useCallback(async () => {
    if (!selectedLibraryId || !selectedChapterId) {
      return;
    }

    setTextPromptState({
      title: t('clipLibrary.actions.createShot'),
      label: t('clipLibrary.targetPicker.createShotPrompt'),
      onConfirm: async (name) => {
        try {
          const folder = await createFolder({
            libraryId: selectedLibraryId,
            chapterId: selectedChapterId,
            kind: 'shot',
            name,
          });
          await loadLibrary(selectedLibraryId);
          setSelectedShotId(folder.id);
          setSelectedScriptId('');
        } catch (error) {
          console.error('Failed to create clip shot inside target picker', error);
          window.alert(t('clipLibrary.targetPicker.createShotFailed'));
          throw error;
        }
      },
    });
  }, [createFolder, loadLibrary, selectedChapterId, selectedLibraryId, t]);

  const handleCreateScript = useCallback(async () => {
    if (!selectedLibraryId || !selectedChapterId || !selectedShotId) {
      return;
    }

    setTextPromptState({
      title: t('clipLibrary.actions.createScript'),
      label: t('clipLibrary.targetPicker.createScriptPrompt'),
      onConfirm: async (name) => {
        try {
          const folder = await createFolder({
            libraryId: selectedLibraryId,
            chapterId: selectedChapterId,
            parentId: selectedShotId,
            kind: 'script',
            name,
          });
          await loadLibrary(selectedLibraryId);
          setSelectedScriptId(folder.id);
        } catch (error) {
          console.error('Failed to create clip script folder inside target picker', error);
          window.alert(t('clipLibrary.targetPicker.createScriptFailed'));
          throw error;
        }
      },
    });
  }, [createFolder, loadLibrary, selectedChapterId, selectedLibraryId, selectedShotId, t]);

  const handleConfirm = useCallback(async () => {
    if (!selectedLibraryId || !selectedScriptId || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({
        libraryId: selectedLibraryId,
        folderId: selectedScriptId,
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, onClose, onConfirm, selectedLibraryId, selectedScriptId]);

  const hasLibraries = libraries.length > 0;

  return (
    <UiModal
      isOpen={isOpen}
      onClose={onClose}
      title={t('clipLibrary.targetPicker.title')}
      widthClassName="w-[560px]"
      footer={
        <>
          <UiButton type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            type="button"
            variant="primary"
            className="gap-2"
            disabled={!selectedLibraryId || !selectedScriptId || isSubmitting}
            onClick={() => void handleConfirm()}
          >
            {isSubmitting ? <UiLoadingAnimation size="xs" /> : null}
            {t('common.confirm')}
          </UiButton>
        </>
      }
    >
      <div className="space-y-4">
        {!hasLibraries && !isLoadingLibraries ? (
          <UiPanel className="rounded-xl border-dashed px-4 py-5 text-sm text-text-muted">
            {t('clipLibrary.targetPicker.emptyLibraries')}
          </UiPanel>
        ) : null}

        <label className="block">
          <div className="mb-2 text-sm font-medium text-text-dark">
            {t('project.clipLibraryLabel')}
          </div>
          <UiSelect
            value={selectedLibraryId}
            onChange={(event) => setSelectedLibraryId(event.target.value)}
            className="h-11 w-full rounded-xl text-sm"
          >
            <option value="">{t('project.bindClipLibraryLibraryPlaceholder')}</option>
            {libraries.map((library) => (
              <option key={library.id} value={library.id}>
                {library.name}
              </option>
            ))}
          </UiSelect>
        </label>

        {selectedLibraryId && isLoadingSnapshot ? (
          <div className="flex items-center justify-center py-6">
            <UiLoadingAnimation />
          </div>
        ) : null}

        {selectedLibraryId && currentSnapshot?.library.id === selectedLibraryId ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-text-dark">
                  <span>{t('clipLibrary.targetPicker.chapter')}</span>
                  <UiButton type="button" size="sm" variant="ghost" onClick={() => void handleCreateChapter()}>
                    <Plus className="h-3.5 w-3.5" />
                  </UiButton>
                </div>
                <UiSelect
                  value={selectedChapterId}
                  onChange={(event) => setSelectedChapterId(event.target.value)}
                  className="h-11 w-full rounded-xl text-sm"
                >
                  <option value="">{t('clipLibrary.targetPicker.selectChapter')}</option>
                  {chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.fsName}
                    </option>
                  ))}
                </UiSelect>
              </label>

              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-text-dark">
                  <span>{t('clipLibrary.targetPicker.shot')}</span>
                  <UiButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleCreateShot()}
                    disabled={!selectedChapterId}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </UiButton>
                </div>
                <UiSelect
                  value={selectedShotId}
                  onChange={(event) => setSelectedShotId(event.target.value)}
                  className="h-11 w-full rounded-xl text-sm"
                >
                  <option value="">{t('clipLibrary.targetPicker.selectShot')}</option>
                  {shots.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.fsName}
                    </option>
                  ))}
                </UiSelect>
              </label>

              <label className="block">
                <div className="mb-2 flex items-center justify-between gap-2 text-sm font-medium text-text-dark">
                  <span>{t('clipLibrary.targetPicker.script')}</span>
                  <UiButton
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleCreateScript()}
                    disabled={!selectedShotId}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </UiButton>
                </div>
                <UiSelect
                  value={selectedScriptId}
                  onChange={(event) => setSelectedScriptId(event.target.value)}
                  className="h-11 w-full rounded-xl text-sm"
                >
                  <option value="">{t('clipLibrary.targetPicker.selectScript')}</option>
                  {scripts.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.fsName}
                    </option>
                  ))}
                </UiSelect>
              </label>
            </div>
          </div>
        ) : null}
      </div>
      <TextPromptDialog
        isOpen={Boolean(textPromptState)}
        title={textPromptState?.title ?? ''}
        label={textPromptState?.label}
        initialValue={textPromptState?.initialValue ?? ''}
        onClose={() => setTextPromptState(null)}
        onConfirm={async (value) => {
          if (!textPromptState) {
            return;
          }
          await textPromptState.onConfirm(value);
        }}
      />
    </UiModal>
  );
}

export function NodeAddToClipLibraryButton({
  node,
  mediaSource,
  className,
}: NodeAddToClipLibraryButtonProps) {
  const { t } = useTranslation();
  const currentProject = useProjectStore((state) => state.currentProject);
  const flushCurrentProjectToDisk = useProjectStore((state) => state.flushCurrentProjectToDisk);
  const setProjectClipLibrary = useProjectStore((state) => state.setProjectClipLibrary);
  const setProjectClipLastFolder = useProjectStore((state) => state.setProjectClipLastFolder);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNodeMedia = useClipLibraryStore((state) => state.addNodeMedia);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddedSuccess, setIsAddedSuccess] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const clipItemId = normalizeText((node.data as { clipItemId?: unknown }).clipItemId);
  const boundClipLibraryId = normalizeText(
    (node.data as { clipLibraryId?: unknown }).clipLibraryId
  ) || (currentProject?.clipLibraryId?.trim() ?? '');
  const boundClipFolderId = normalizeText((node.data as { clipFolderId?: unknown }).clipFolderId);

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  const handleConfirmAdd = useCallback(
    async ({ libraryId, folderId }: { libraryId: string; folderId: string }) => {
      if (!currentProject?.id || isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      try {
        if ((currentProject.clipLibraryId ?? null) !== libraryId) {
          await setProjectClipLibrary(currentProject.id, libraryId, null);
        }

        await flushCurrentProjectToDisk();
        const result = await addNodeMedia({
          projectId: currentProject.id,
          nodeId: node.id,
          libraryId,
          folderId,
          mediaOverride: resolveNodeMediaOverride(node),
        });

        updateNodeData(node.id, {
          clipLibraryId: result.clipLibraryId,
          clipFolderId: result.clipFolderId,
          clipItemId: result.item.id,
        });
        await flushCurrentProjectToDisk();
        await setProjectClipLastFolder(currentProject.id, result.clipFolderId);

        setIsAddedSuccess(true);
        if (successTimerRef.current) {
          clearTimeout(successTimerRef.current);
        }
        successTimerRef.current = setTimeout(() => {
          setIsAddedSuccess(false);
          successTimerRef.current = null;
        }, 1400);
      } catch (error) {
        console.error('Failed to add node media to clip library', error);
        window.alert(t('nodeToolbar.addToClipLibraryFailed'));
        throw error;
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      addNodeMedia,
      currentProject,
      flushCurrentProjectToDisk,
      isSubmitting,
      node.id,
      setProjectClipLastFolder,
      setProjectClipLibrary,
      t,
      updateNodeData,
    ]
  );

  const handleLocate = useCallback(async () => {
    if (!boundClipLibraryId || !clipItemId) {
      return;
    }
    if (isClipLibraryPanelOpenBlocked()) {
      return;
    }

    queueClipLibraryPanelLibrary(boundClipLibraryId);
    queueClipLibraryPanelFocusTarget({
      clipLibraryId: boundClipLibraryId,
      clipFolderId: boundClipFolderId || null,
      clipItemId,
    });

    try {
      await openClipLibraryPanelWindow(t('clipLibrary.windowTitle'));
      await emitToClipLibraryPanel(CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT, boundClipLibraryId);
      await emitToClipLibraryPanel(CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT, {
        clipLibraryId: boundClipLibraryId,
        clipFolderId: boundClipFolderId || null,
        clipItemId,
      });
    } catch (error) {
      console.error('Failed to open clip library window for node locate', error);
      window.alert(t('nodeToolbar.locateInClipLibraryFailed'));
    }
  }, [boundClipFolderId, boundClipLibraryId, clipItemId, t]);

  return (
    <>
      <UiChipButton
        type="button"
        className={className}
        onClick={() => void (clipItemId ? handleLocate() : setIsPickerOpen(true))}
        disabled={clipItemId ? false : isSubmitting || mediaSource.trim().length === 0}
        title={
          clipItemId ? t('nodeToolbar.locateInClipLibrary') : t('nodeToolbar.addToClipLibrary')
        }
      >
        <Film className="h-3.5 w-3.5" />
        <span>
          {clipItemId
            ? t('nodeToolbar.locateInClipLibrary')
            : isSubmitting
              ? t('nodeToolbar.addingToClipLibrary')
              : isAddedSuccess
                ? t('nodeToolbar.addedToClipLibrary')
                : t('nodeToolbar.addToClipLibrary')}
        </span>
      </UiChipButton>

      {currentProject?.id ? (
        <ClipLibraryTargetPickerDialog
          isOpen={isPickerOpen}
          onClose={() => setIsPickerOpen(false)}
          currentLibraryId={currentProject.clipLibraryId ?? null}
          currentLastFolderId={currentProject.clipLastFolderId ?? null}
          onConfirm={handleConfirmAdd}
        />
      ) : null}
    </>
  );
}
