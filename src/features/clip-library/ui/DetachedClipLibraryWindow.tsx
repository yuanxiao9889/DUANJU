import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Film,
  FolderOpen,
  GripVertical,
  Layers3,
  Music4,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  UiButton,
  UiInput,
  UiLoadingAnimation,
  UiPanel,
  UiSelect,
  TextPromptDialog,
  UiTextArea,
} from '@/components/ui';
import { openClipLibraryRoot } from '@/commands/clipLibrary';
import { formatAudioDuration, resolveAudioDisplayUrl } from '@/features/canvas/application/audioData';
import { resolveImageDisplayUrl, resolveLocalFileSourcePath } from '@/features/canvas/application/imageData';
import {
  CLIP_LIBRARY_PANEL_CLOSED_EVENT,
  CLIP_LIBRARY_PANEL_CONTEXT_EVENT,
  CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT,
  CLIP_LIBRARY_PANEL_READY_EVENT,
  CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT,
  emitToMainWindow,
  persistCurrentClipLibraryPanelBounds,
  type ClipLibraryPanelFocusTarget,
  type ClipLibraryPanelProjectContext,
} from '@/features/clip-library/application/clipLibraryPanelBridge';
import type {
  ClipFolderRecord,
  ClipItemRecord,
  ClipLibrarySnapshot,
  ClipMediaType,
} from '@/features/clip-library/domain/types';
import { ClipAudioWaveform } from '@/features/clip-library/ui/ClipAudioWaveform';
import { useClipLibraryStore } from '@/stores/clipLibraryStore';

type ClipLibrarySortMode = 'recent' | 'name' | 'number' | 'duration';
type ClipLibraryMediaFilter = 'all' | ClipMediaType;
type TreeNodeKind = 'library' | 'chapter' | 'shot' | 'script';

interface ClipLibraryFilterState {
  query: string;
  mediaType: ClipLibraryMediaFilter;
  sortMode: ClipLibrarySortMode;
}

interface TreeNode {
  key: string;
  kind: TreeNodeKind;
  label: string;
  count: number;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  chapterId?: string;
  folderId?: string;
}

interface TextPromptState {
  title: string;
  label: string;
  initialValue?: string;
  onConfirm: (value: string) => Promise<void>;
}

const EMPTY_PROJECT_CONTEXT: ClipLibraryPanelProjectContext = {
  projectId: null,
  projectName: null,
  projectType: null,
  clipLibraryId: null,
  clipLastFolderId: null,
};

const DEFAULT_FILTER_STATE: ClipLibraryFilterState = {
  query: '',
  mediaType: 'all',
  sortMode: 'recent',
};

const DEFAULT_LEFT_WIDTH = 280;
const DEFAULT_RIGHT_WIDTH = 360;
const LEFT_WIDTH_MIN = 220;
const LEFT_WIDTH_MAX = 420;
const RIGHT_WIDTH_MIN = 300;
const RIGHT_WIDTH_MAX = 520;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseFilterState(value: string | null | undefined): ClipLibraryFilterState {
  if (!value) {
    return DEFAULT_FILTER_STATE;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ClipLibraryFilterState>;
    const mediaType =
      parsed.mediaType === 'audio' || parsed.mediaType === 'video' ? parsed.mediaType : 'all';
    const sortMode: ClipLibrarySortMode =
      parsed.sortMode === 'name'
      || parsed.sortMode === 'number'
      || parsed.sortMode === 'duration'
        ? parsed.sortMode
        : 'recent';

    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      mediaType,
      sortMode,
    };
  } catch {
    return DEFAULT_FILTER_STATE;
  }
}

function formatDateTime(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function firstLineSummary(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const [firstLine] = trimmed.split(/\r?\n/, 1);
  return firstLine.trim();
}

function buildFileUrl(localPath: string): string {
  const normalized = localPath.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    return `file:${normalized}`;
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return `file://${normalized}`;
}

function safeFileDragPayload(item: ClipItemRecord): { localPath: string; fileUrl: string } | null {
  const localPath = resolveLocalFileSourcePath(item.sourcePath);
  if (!localPath) {
    return null;
  }

  return {
    localPath,
    fileUrl: buildFileUrl(localPath),
  };
}

function rootTreeKey(libraryId: string): string {
  return `library:${libraryId}`;
}

function chapterTreeKey(chapterId: string): string {
  return `chapter:${chapterId}`;
}

function folderTreeKey(folderId: string): string {
  return `folder:${folderId}`;
}

function sortFolders(folders: ClipFolderRecord[]): ClipFolderRecord[] {
  return [...folders].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return left.createdAt - right.createdAt;
  });
}

function expandKeysForFolder(snapshot: ClipLibrarySnapshot, folderId: string): string[] {
  const folder = snapshot.folders.find((entry) => entry.id === folderId);
  if (!folder) {
    return [];
  }

  if (folder.kind === 'script') {
    return [chapterTreeKey(folder.chapterId), folderTreeKey(folder.parentId ?? '')].filter(Boolean);
  }

  return [chapterTreeKey(folder.chapterId)];
}

function sortItems(items: ClipItemRecord[], foldersById: Map<string, ClipFolderRecord>, sortMode: ClipLibrarySortMode) {
  const nextItems = [...items];

  nextItems.sort((left, right) => {
    if (sortMode === 'name') {
      return left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' });
    }

    if (sortMode === 'number') {
      const leftCode = foldersById.get(left.folderId)?.numberCode ?? '';
      const rightCode = foldersById.get(right.folderId)?.numberCode ?? '';
      return leftCode.localeCompare(rightCode, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' });
    }

    if (sortMode === 'duration') {
      return (right.durationMs ?? -1) - (left.durationMs ?? -1);
    }

    return right.updatedAt - left.updatedAt;
  });

  return nextItems;
}

function mediaTypeLabel(
  t: (key: string) => string,
  mediaType: ClipMediaType | ClipLibraryMediaFilter
): string {
  if (mediaType === 'all') {
    return t('clipLibrary.filters.allMedia');
  }
  return mediaType === 'video' ? t('clipLibrary.filters.video') : t('clipLibrary.filters.audio');
}

export function DetachedClipLibraryWindow() {
  const { t, i18n } = useTranslation();
  const appWindow = getCurrentWindow();
  const hydrate = useClipLibraryStore((state) => state.hydrate);
  const libraries = useClipLibraryStore((state) => state.libraries);
  const currentSnapshot = useClipLibraryStore((state) => state.currentSnapshot);
  const currentLibraryId = useClipLibraryStore((state) => state.currentLibraryId);
  const isLoadingLibraries = useClipLibraryStore((state) => state.isLoadingLibraries);
  const isLoadingSnapshot = useClipLibraryStore((state) => state.isLoadingSnapshot);
  const loadLibrary = useClipLibraryStore((state) => state.loadLibrary);
  const refreshCurrentLibrary = useClipLibraryStore((state) => state.refreshCurrentLibrary);
  const createChapter = useClipLibraryStore((state) => state.createChapter);
  const renameChapter = useClipLibraryStore((state) => state.renameChapter);
  const moveChapter = useClipLibraryStore((state) => state.moveChapter);
  const deleteChapter = useClipLibraryStore((state) => state.deleteChapter);
  const createFolder = useClipLibraryStore((state) => state.createFolder);
  const moveFolder = useClipLibraryStore((state) => state.moveFolder);
  const renameFolder = useClipLibraryStore((state) => state.renameFolder);
  const deleteFolder = useClipLibraryStore((state) => state.deleteFolder);
  const moveItem = useClipLibraryStore((state) => state.moveItem);
  const renameItem = useClipLibraryStore((state) => state.renameItem);
  const deleteItem = useClipLibraryStore((state) => state.deleteItem);
  const updateItemDescription = useClipLibraryStore((state) => state.updateItemDescription);
  const saveUiState = useClipLibraryStore((state) => state.saveUiState);
  const getDeleteImpact = useClipLibraryStore((state) => state.getDeleteImpact);

  const [projectContext, setProjectContext] = useState<ClipLibraryPanelProjectContext>(EMPTY_PROJECT_CONTEXT);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<ClipLibraryMediaFilter>('all');
  const [sortMode, setSortMode] = useState<ClipLibrarySortMode>('recent');
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [textPromptState, setTextPromptState] = useState<TextPromptState | null>(null);

  const pendingFocusTargetRef = useRef<ClipLibraryPanelFocusTarget | null>(null);
  const restoredLibraryIdRef = useRef<string | null>(null);
  const lastProjectFocusKeyRef = useRef('');
  const treeScrollRef = useRef<HTMLDivElement | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const persistBoundsTimerRef = useRef<number | null>(null);
  const isClosingWindowRef = useRef(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const persistBounds = useCallback(async () => {
    try {
      await persistCurrentClipLibraryPanelBounds();
    } catch (error) {
      console.warn('Failed to persist clip library panel bounds', error);
    }
  }, []);

  const schedulePersistBounds = useCallback(() => {
    if (persistBoundsTimerRef.current !== null) {
      window.clearTimeout(persistBoundsTimerRef.current);
    }

    persistBoundsTimerRef.current = window.setTimeout(() => {
      persistBoundsTimerRef.current = null;
      void persistBounds();
    }, 180);
  }, [persistBounds]);

  const handleCloseWindow = useCallback(async () => {
    if (isClosingWindowRef.current) {
      return;
    }

    isClosingWindowRef.current = true;
    if (import.meta.env.DEV) {
      console.info('[clip-library] close requested from detached window');
    }

    try {
      await persistBounds();
      await emitToMainWindow(CLIP_LIBRARY_PANEL_CLOSED_EVENT);
      await appWindow.close();
    } catch (error) {
      isClosingWindowRef.current = false;
      console.warn('Failed to close clip library window', error);
    }
  }, [appWindow, persistBounds]);

  useEffect(() => {
    let unlistenContext: (() => void) | null = null;
    let unlistenFocusTarget: (() => void) | null = null;
    let unlistenSetLibrary: (() => void) | null = null;
    let unlistenMove: (() => void) | null = null;
    let unlistenResize: (() => void) | null = null;
    let unlistenClose: (() => void) | null = null;

    const registerListeners = async () => {
      unlistenContext = await appWindow.listen<ClipLibraryPanelProjectContext>(
        CLIP_LIBRARY_PANEL_CONTEXT_EVENT,
        (event) => {
          setProjectContext(event.payload ?? EMPTY_PROJECT_CONTEXT);
        }
      );

      unlistenFocusTarget = await appWindow.listen<ClipLibraryPanelFocusTarget>(
        CLIP_LIBRARY_PANEL_FOCUS_TARGET_EVENT,
        (event) => {
          pendingFocusTargetRef.current = event.payload ?? null;
        }
      );

      unlistenSetLibrary = await appWindow.listen<string | null>(
        CLIP_LIBRARY_PANEL_SET_LIBRARY_EVENT,
        (event) => {
          const nextLibraryId = event.payload?.trim() || null;
          if (nextLibraryId) {
            void loadLibrary(nextLibraryId);
          }
        }
      );

      unlistenMove = await appWindow.onMoved(() => {
        schedulePersistBounds();
      });
      unlistenResize = await appWindow.onResized(() => {
        schedulePersistBounds();
      });
      unlistenClose = await appWindow.onCloseRequested((event) => {
        if (isClosingWindowRef.current) {
          return;
        }
        event.preventDefault();
        void handleCloseWindow();
      });

      await emitToMainWindow(CLIP_LIBRARY_PANEL_READY_EVENT);
      await appWindow.show();
    };

    void registerListeners().catch((error) => {
      console.error('Failed to register clip library window listeners', error);
    });

    return () => {
      if (persistBoundsTimerRef.current !== null) {
        window.clearTimeout(persistBoundsTimerRef.current);
      }
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
      unlistenContext?.();
      unlistenFocusTarget?.();
      unlistenSetLibrary?.();
      unlistenMove?.();
      unlistenResize?.();
      unlistenClose?.();
    };
  }, [appWindow, handleCloseWindow, loadLibrary, schedulePersistBounds]);

  useEffect(() => {
    const targetLibraryId = projectContext.clipLibraryId?.trim() || null;
    if (targetLibraryId && targetLibraryId !== currentLibraryId) {
      void loadLibrary(targetLibraryId);
      return;
    }

    if (!targetLibraryId && !currentLibraryId && libraries.length > 0) {
      void loadLibrary(libraries[0].id);
    }
  }, [currentLibraryId, libraries, loadLibrary, projectContext.clipLibraryId]);

  useEffect(() => {
    if (!currentSnapshot) {
      return;
    }
    if (restoredLibraryIdRef.current === currentSnapshot.library.id) {
      return;
    }
    restoredLibraryIdRef.current = currentSnapshot.library.id;

    const restoredExpandedKeys = parseStringArray(currentSnapshot.uiState?.expandedKeysJson);
    const restoredFilter = parseFilterState(currentSnapshot.uiState?.lastFilterJson);
    setExpandedKeys(restoredExpandedKeys);
    setSelectedKey(currentSnapshot.uiState?.selectedKey ?? rootTreeKey(currentSnapshot.library.id));
    setSelectedItemId(null);
    setLeftWidth(
      clamp(currentSnapshot.uiState?.leftWidth ?? DEFAULT_LEFT_WIDTH, LEFT_WIDTH_MIN, LEFT_WIDTH_MAX)
    );
    setRightWidth(
      clamp(currentSnapshot.uiState?.rightWidth ?? DEFAULT_RIGHT_WIDTH, RIGHT_WIDTH_MIN, RIGHT_WIDTH_MAX)
    );
    setTreeScrollTop(Math.max(0, currentSnapshot.uiState?.scrollTop ?? 0));
    setSearchQuery(restoredFilter.query);
    setMediaTypeFilter(restoredFilter.mediaType);
    setSortMode(restoredFilter.sortMode);
    setAlwaysOnTop(Boolean(currentSnapshot.uiState?.alwaysOnTop));

    window.requestAnimationFrame(() => {
      if (treeScrollRef.current) {
        treeScrollRef.current.scrollTop = Math.max(0, currentSnapshot.uiState?.scrollTop ?? 0);
      }
    });
  }, [currentSnapshot]);

  useEffect(() => {
    void appWindow.setAlwaysOnTop(alwaysOnTop).catch((error) => {
      console.warn('Failed to update clip library always-on-top state', error);
    });
  }, [alwaysOnTop, appWindow]);

  const chapterMap = useMemo(
    () => new Map((currentSnapshot?.chapters ?? []).map((chapter) => [chapter.id, chapter])),
    [currentSnapshot?.chapters]
  );

  const folderMap = useMemo(
    () => new Map((currentSnapshot?.folders ?? []).map((folder) => [folder.id, folder])),
    [currentSnapshot?.folders]
  );

  const shotFoldersByChapter = useMemo(() => {
    const map = new Map<string, ClipFolderRecord[]>();
    for (const folder of currentSnapshot?.folders ?? []) {
      if (folder.kind !== 'shot' || folder.parentId !== null) {
        continue;
      }
      const list = map.get(folder.chapterId) ?? [];
      list.push(folder);
      map.set(folder.chapterId, list);
    }
    for (const list of map.values()) {
      list.sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.createdAt - right.createdAt;
      });
    }
    return map;
  }, [currentSnapshot?.folders]);

  const scriptFoldersByShot = useMemo(() => {
    const map = new Map<string, ClipFolderRecord[]>();
    for (const folder of currentSnapshot?.folders ?? []) {
      if (folder.kind !== 'script' || !folder.parentId) {
        continue;
      }
      const list = map.get(folder.parentId) ?? [];
      list.push(folder);
      map.set(folder.parentId, list);
    }
    for (const list of map.values()) {
      list.sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder;
        }
        return left.createdAt - right.createdAt;
      });
    }
    return map;
  }, [currentSnapshot?.folders]);

  const itemCountByFolder = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of currentSnapshot?.items ?? []) {
      map.set(item.folderId, (map.get(item.folderId) ?? 0) + 1);
    }
    return map;
  }, [currentSnapshot?.items]);

  const itemCountByShot = useMemo(() => {
    const map = new Map<string, number>();
    for (const [shotId, scripts] of scriptFoldersByShot.entries()) {
      let count = 0;
      for (const folder of scripts) {
        count += itemCountByFolder.get(folder.id) ?? 0;
      }
      map.set(shotId, count);
    }
    return map;
  }, [itemCountByFolder, scriptFoldersByShot]);

  const itemCountByChapter = useMemo(() => {
    const map = new Map<string, number>();
    for (const chapter of currentSnapshot?.chapters ?? []) {
      const count = (shotFoldersByChapter.get(chapter.id) ?? []).reduce(
        (total, shot) => total + (itemCountByShot.get(shot.id) ?? 0),
        0
      );
      map.set(chapter.id, count);
    }
    return map;
  }, [currentSnapshot?.chapters, itemCountByShot, shotFoldersByChapter]);

  const treeNodes = useMemo(() => {
    if (!currentSnapshot) {
      return [] as TreeNode[];
    }

    const nodes: TreeNode[] = [
      {
        key: rootTreeKey(currentSnapshot.library.id),
        kind: 'library',
        label: currentSnapshot.library.name,
        count: currentSnapshot.items.length,
        depth: 0,
        expandable: false,
        expanded: true,
      },
    ];

    for (const chapter of currentSnapshot.chapters) {
      const chapterKey = chapterTreeKey(chapter.id);
      const chapterExpanded = expandedKeys.includes(chapterKey);
      const shots = shotFoldersByChapter.get(chapter.id) ?? [];
      nodes.push({
        key: chapterKey,
        kind: 'chapter',
        label: chapter.fsName,
        count: itemCountByChapter.get(chapter.id) ?? 0,
        depth: 1,
        expandable: shots.length > 0,
        expanded: chapterExpanded,
        chapterId: chapter.id,
      });

      if (!chapterExpanded) {
        continue;
      }

      for (const shot of shots) {
        const shotKey = folderTreeKey(shot.id);
        const shotExpanded = expandedKeys.includes(shotKey);
        const scripts = scriptFoldersByShot.get(shot.id) ?? [];
        nodes.push({
          key: shotKey,
          kind: 'shot',
          label: shot.fsName,
          count: itemCountByShot.get(shot.id) ?? 0,
          depth: 2,
          expandable: scripts.length > 0,
          expanded: shotExpanded,
          chapterId: chapter.id,
          folderId: shot.id,
        });

        if (!shotExpanded) {
          continue;
        }

        for (const script of scripts) {
          nodes.push({
            key: folderTreeKey(script.id),
            kind: 'script',
            label: script.fsName,
            count: itemCountByFolder.get(script.id) ?? 0,
            depth: 3,
            expandable: false,
            expanded: false,
            chapterId: chapter.id,
            folderId: script.id,
          });
        }
      }
    }

    return nodes;
  }, [
    currentSnapshot,
    expandedKeys,
    itemCountByChapter,
    itemCountByFolder,
    itemCountByShot,
    scriptFoldersByShot,
    shotFoldersByChapter,
  ]);

  const selectedChapter = useMemo(() => {
    if (!selectedKey?.startsWith('chapter:')) {
      return null;
    }
    return chapterMap.get(selectedKey.slice('chapter:'.length)) ?? null;
  }, [chapterMap, selectedKey]);

  const selectedFolder = useMemo(() => {
    if (!selectedKey?.startsWith('folder:')) {
      return null;
    }
    return folderMap.get(selectedKey.slice('folder:'.length)) ?? null;
  }, [folderMap, selectedKey]);

  const selectedItems = useMemo(() => {
    if (!currentSnapshot) {
      return [] as ClipItemRecord[];
    }

    let baseItems = currentSnapshot.items;
    if (selectedChapter) {
      baseItems = baseItems.filter((item) => folderMap.get(item.folderId)?.chapterId === selectedChapter.id);
    } else if (selectedFolder?.kind === 'shot') {
      const scriptIds = new Set((scriptFoldersByShot.get(selectedFolder.id) ?? []).map((folder) => folder.id));
      baseItems = baseItems.filter((item) => scriptIds.has(item.folderId));
    } else if (selectedFolder?.kind === 'script') {
      baseItems = baseItems.filter((item) => item.folderId === selectedFolder.id);
    }

    const query = searchQuery.trim().toLocaleLowerCase();
    if (query) {
      baseItems = baseItems.filter((item) => {
        const folder = folderMap.get(item.folderId);
        return [
          item.name,
          item.fileName,
          item.descriptionText,
          folder?.numberCode ?? '',
          folder?.fsName ?? '',
          item.sourceNodeTitle ?? '',
          item.sourceProjectName,
        ].some((value) => value.toLocaleLowerCase().includes(query));
      });
    }

    if (mediaTypeFilter !== 'all') {
      baseItems = baseItems.filter((item) => item.mediaType === mediaTypeFilter);
    }

    return sortItems(baseItems, folderMap, sortMode);
  }, [
    currentSnapshot,
    folderMap,
    mediaTypeFilter,
    scriptFoldersByShot,
    searchQuery,
    selectedChapter,
    selectedFolder,
    sortMode,
  ]);

  useEffect(() => {
    if (!selectedItems.length) {
      setSelectedItemId(null);
      return;
    }

    if (selectedItemId && selectedItems.some((item) => item.id === selectedItemId)) {
      return;
    }
    setSelectedItemId(selectedItems[0].id);
  }, [selectedItemId, selectedItems]);

  const selectedItem = useMemo(
    () => selectedItems.find((item) => item.id === selectedItemId) ?? null,
    [selectedItemId, selectedItems]
  );

  useEffect(() => {
    setDescriptionDraft(selectedItem?.descriptionText ?? '');
  }, [selectedItem?.descriptionText, selectedItem?.id]);

  const availableScriptFolders = useMemo(() => {
    if (!currentSnapshot) {
      return [] as ClipFolderRecord[];
    }
    return sortFolders(currentSnapshot.folders.filter((folder) => folder.kind === 'script'));
  }, [currentSnapshot]);

  const selectedItemFolder = selectedItem ? folderMap.get(selectedItem.folderId) ?? null : null;
  const selectedItemChapter =
    selectedItemFolder ? chapterMap.get(selectedItemFolder.chapterId) ?? null : null;
  const selectedItemShot =
    selectedItemFolder && selectedItemFolder.parentId
      ? folderMap.get(selectedItemFolder.parentId) ?? null
      : null;

  const applyFocusTarget = useCallback(
    (snapshot: ClipLibrarySnapshot, target: ClipLibraryPanelFocusTarget) => {
      const targetItem = target.clipItemId
        ? snapshot.items.find((item) => item.id === target.clipItemId) ?? null
        : null;
      const targetFolderId = target.clipFolderId?.trim() || targetItem?.folderId || null;

      if (targetFolderId) {
        setExpandedKeys((current) => {
          const nextKeys = new Set(current);
          for (const key of expandKeysForFolder(snapshot, targetFolderId)) {
            if (key) {
              nextKeys.add(key);
            }
          }
          return Array.from(nextKeys);
        });
        setSelectedKey(folderTreeKey(targetFolderId));
      } else {
        setSelectedKey(rootTreeKey(snapshot.library.id));
      }

      setSelectedItemId(targetItem?.id ?? null);
    },
    []
  );

  useEffect(() => {
    if (!currentSnapshot) {
      return;
    }

    const pendingFocusTarget = pendingFocusTargetRef.current;
    if (
      pendingFocusTarget
      && (!pendingFocusTarget.clipLibraryId
        || pendingFocusTarget.clipLibraryId === currentSnapshot.library.id)
    ) {
      applyFocusTarget(currentSnapshot, pendingFocusTarget);
      pendingFocusTargetRef.current = null;
      return;
    }

    const projectFocusKey = [
      currentSnapshot.library.id,
      projectContext.projectId ?? '',
      projectContext.clipLastFolderId ?? '',
    ].join(':');
    if (
      projectContext.clipLibraryId === currentSnapshot.library.id
      && projectContext.clipLastFolderId
      && lastProjectFocusKeyRef.current !== projectFocusKey
    ) {
      lastProjectFocusKeyRef.current = projectFocusKey;
      applyFocusTarget(currentSnapshot, {
        clipLibraryId: currentSnapshot.library.id,
        clipFolderId: projectContext.clipLastFolderId,
      });
    }
  }, [applyFocusTarget, currentSnapshot, projectContext]);

  useEffect(() => {
    if (!currentSnapshot) {
      return;
    }

    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void saveUiState({
        libraryId: currentSnapshot.library.id,
        expandedKeysJson: JSON.stringify(expandedKeys),
        selectedKey,
        scrollTop: treeScrollTop,
        leftWidth,
        rightWidth,
        lastFilterJson: JSON.stringify({
          query: searchQuery,
          mediaType: mediaTypeFilter,
          sortMode,
        }),
        alwaysOnTop,
      }).catch((error) => {
        console.warn('Failed to persist clip library ui state', error);
      });
    }, 220);

    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [
    alwaysOnTop,
    currentSnapshot,
    expandedKeys,
    leftWidth,
    mediaTypeFilter,
    rightWidth,
    saveUiState,
    searchQuery,
    selectedKey,
    sortMode,
    treeScrollTop,
  ]);

  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
    );
  }, []);

  const handleResizePane = useCallback(
    (side: 'left' | 'right', event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startLeftWidth = leftWidth;
      const startRightWidth = rightWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        if (side === 'left') {
          setLeftWidth(clamp(startLeftWidth + delta, LEFT_WIDTH_MIN, LEFT_WIDTH_MAX));
        } else {
          setRightWidth(clamp(startRightWidth - delta, RIGHT_WIDTH_MIN, RIGHT_WIDTH_MAX));
        }
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [leftWidth, rightWidth]
  );

  const handleHeaderDrag = useCallback(
    async (event: ReactMouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('button') || target?.closest('input') || target?.closest('select')) {
        return;
      }
      try {
        await appWindow.startDragging();
      } catch (error) {
        console.warn('Failed to start dragging clip library window', error);
      }
    },
    [appWindow]
  );

  const canCreateShot = Boolean(
    currentSnapshot && (selectedChapter || selectedFolder?.kind === 'shot' || selectedFolder?.kind === 'script')
  );
  const canCreateScript = Boolean(
    currentSnapshot && (selectedFolder?.kind === 'shot' || selectedFolder?.kind === 'script')
  );

  const handleCreateChapter = useCallback(async () => {
    if (!currentSnapshot) {
      return;
    }
    setTextPromptState({
      title: t('clipLibrary.actions.createChapter'),
      label: t('clipLibrary.actions.createChapterPrompt'),
      onConfirm: async (name) => {
        try {
          const chapter = await createChapter({
            libraryId: currentSnapshot.library.id,
            name,
          });
          await refreshCurrentLibrary();
          setExpandedKeys((current) => Array.from(new Set([...current, chapterTreeKey(chapter.id)])));
          setSelectedKey(chapterTreeKey(chapter.id));
        } catch (error) {
          console.error('Failed to create chapter in clip library window', error);
          window.alert(t('clipLibrary.actions.createChapterFailed'));
          throw error;
        }
      },
    });
  }, [createChapter, currentSnapshot, refreshCurrentLibrary, t]);

  const handleCreateShot = useCallback(async () => {
    const chapterId =
      selectedChapter?.id ?? selectedFolder?.chapterId ?? currentSnapshot?.chapters[0]?.id;
    if (!currentSnapshot || !chapterId) {
      return;
    }
    setTextPromptState({
      title: t('clipLibrary.actions.createShot'),
      label: t('clipLibrary.actions.createShotPrompt'),
      onConfirm: async (name) => {
        try {
          const folder = await createFolder({
            libraryId: currentSnapshot.library.id,
            chapterId,
            kind: 'shot',
            name,
          });
          await refreshCurrentLibrary();
          setExpandedKeys((current) =>
            Array.from(new Set([...current, chapterTreeKey(chapterId), folderTreeKey(folder.id)]))
          );
          setSelectedKey(folderTreeKey(folder.id));
        } catch (error) {
          console.error('Failed to create shot in clip library window', error);
          window.alert(t('clipLibrary.actions.createShotFailed'));
          throw error;
        }
      },
    });
  }, [createFolder, currentSnapshot, refreshCurrentLibrary, selectedChapter?.id, selectedFolder?.chapterId, t]);

  const handleCreateScript = useCallback(async () => {
    const shotFolder =
      selectedFolder?.kind === 'shot'
        ? selectedFolder
        : selectedFolder?.kind === 'script' && selectedFolder.parentId
          ? folderMap.get(selectedFolder.parentId) ?? null
          : null;
    if (!currentSnapshot || !shotFolder) {
      return;
    }
    setTextPromptState({
      title: t('clipLibrary.actions.createScript'),
      label: t('clipLibrary.actions.createScriptPrompt'),
      onConfirm: async (name) => {
        try {
          const folder = await createFolder({
            libraryId: currentSnapshot.library.id,
            chapterId: shotFolder.chapterId,
            parentId: shotFolder.id,
            kind: 'script',
            name,
          });
          await refreshCurrentLibrary();
          setExpandedKeys((current) =>
            Array.from(
              new Set([...current, chapterTreeKey(shotFolder.chapterId), folderTreeKey(shotFolder.id)])
            )
          );
          setSelectedKey(folderTreeKey(folder.id));
        } catch (error) {
          console.error('Failed to create script folder in clip library window', error);
          window.alert(t('clipLibrary.actions.createScriptFailed'));
          throw error;
        }
      },
    });
  }, [createFolder, currentSnapshot, refreshCurrentLibrary, selectedFolder, t]);

  const handleRenameSelectedNode = useCallback(async () => {
    if (selectedChapter) {
      setTextPromptState({
        title: t('common.edit'),
        label: t('clipLibrary.actions.renameChapterPrompt'),
        initialValue: selectedChapter.name,
        onConfirm: async (name) => {
          if (name === selectedChapter.name) {
            return;
          }
          try {
            await renameChapter({ id: selectedChapter.id, name });
          } catch (error) {
            console.error('Failed to rename clip chapter', error);
            window.alert(t('clipLibrary.actions.renameChapterFailed'));
            throw error;
          }
        },
      });
      return;
    }

    if (selectedFolder) {
      setTextPromptState({
        title: t('common.edit'),
        label:
          selectedFolder.kind === 'shot'
            ? t('clipLibrary.actions.renameShotPrompt')
            : t('clipLibrary.actions.renameScriptPrompt'),
        initialValue: selectedFolder.name,
        onConfirm: async (name) => {
          if (name === selectedFolder.name) {
            return;
          }
          try {
            await renameFolder({ id: selectedFolder.id, name });
          } catch (error) {
            console.error('Failed to rename clip folder', error);
            window.alert(t('clipLibrary.actions.renameFolderFailed'));
            throw error;
          }
        },
      });
    }
  }, [renameChapter, renameFolder, selectedChapter, selectedFolder, t]);

  const handleMoveSelectedNode = useCallback(
    async (direction: -1 | 1) => {
      if (selectedChapter && currentSnapshot) {
        const currentIndex = currentSnapshot.chapters.findIndex((chapter) => chapter.id === selectedChapter.id);
        const targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= currentSnapshot.chapters.length) {
          return;
        }
        try {
          await moveChapter({ chapterId: selectedChapter.id, targetIndex });
        } catch (error) {
          console.error('Failed to move clip chapter', error);
          window.alert(t('clipLibrary.actions.moveNodeFailed'));
        }
        return;
      }

      if (selectedFolder?.kind === 'shot') {
        const siblings = shotFoldersByChapter.get(selectedFolder.chapterId) ?? [];
        const currentIndex = siblings.findIndex((folder) => folder.id === selectedFolder.id);
        const targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= siblings.length) {
          return;
        }
        try {
          await moveFolder({
            folderId: selectedFolder.id,
            targetChapterId: selectedFolder.chapterId,
            targetParentId: null,
            targetIndex,
          });
        } catch (error) {
          console.error('Failed to move clip shot', error);
          window.alert(t('clipLibrary.actions.moveNodeFailed'));
        }
        return;
      }

      if (selectedFolder?.kind === 'script' && selectedFolder.parentId) {
        const siblings = scriptFoldersByShot.get(selectedFolder.parentId) ?? [];
        const currentIndex = siblings.findIndex((folder) => folder.id === selectedFolder.id);
        const targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= siblings.length) {
          return;
        }
        try {
          await moveFolder({
            folderId: selectedFolder.id,
            targetChapterId: selectedFolder.chapterId,
            targetParentId: selectedFolder.parentId,
            targetIndex,
          });
        } catch (error) {
          console.error('Failed to move clip script folder', error);
          window.alert(t('clipLibrary.actions.moveNodeFailed'));
        }
      }
    },
    [
      currentSnapshot,
      moveChapter,
      moveFolder,
      selectedChapter,
      selectedFolder,
      scriptFoldersByShot,
      shotFoldersByChapter,
      t,
    ]
  );

  const handleDeleteSelectedNode = useCallback(async () => {
    if (selectedChapter) {
      try {
        const impact = await getDeleteImpact({ chapterId: selectedChapter.id });
        const confirmed = window.confirm(
          `${t('clipLibrary.actions.deleteChapterConfirm', { name: selectedChapter.name })}\n\n${t('clipLibrary.deleteImpact', {
            projects: impact.projectCount,
            nodes: impact.nodeCount,
            folders: impact.folderCount,
            items: impact.itemCount,
          })}`
        );
        if (!confirmed) {
          return;
        }
        await deleteChapter(selectedChapter.id);
        setSelectedKey(currentSnapshot ? rootTreeKey(currentSnapshot.library.id) : null);
      } catch (error) {
        console.error('Failed to delete clip chapter', error);
        window.alert(t('clipLibrary.actions.deleteChapterFailed'));
      }
      return;
    }

    if (selectedFolder) {
      try {
        const impact = await getDeleteImpact({ folderId: selectedFolder.id });
        const confirmed = window.confirm(
          `${t('clipLibrary.actions.deleteFolderConfirm', { name: selectedFolder.fsName })}\n\n${t('clipLibrary.deleteImpact', {
            projects: impact.projectCount,
            nodes: impact.nodeCount,
            folders: impact.folderCount,
            items: impact.itemCount,
          })}`
        );
        if (!confirmed) {
          return;
        }
        await deleteFolder(selectedFolder.id);
        setSelectedKey(currentSnapshot ? rootTreeKey(currentSnapshot.library.id) : null);
      } catch (error) {
        console.error('Failed to delete clip folder', error);
        window.alert(t('clipLibrary.actions.deleteFolderFailed'));
      }
    }
  }, [currentSnapshot, deleteChapter, deleteFolder, getDeleteImpact, selectedChapter, selectedFolder, t]);

  const handleRenameSelectedItem = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    setTextPromptState({
      title: t('clipLibrary.actions.renameItem'),
      label: t('clipLibrary.actions.renameItemPrompt'),
      initialValue: selectedItem.name,
      onConfirm: async (name) => {
        if (name === selectedItem.name) {
          return;
        }
        try {
          await renameItem({ itemId: selectedItem.id, name });
        } catch (error) {
          console.error('Failed to rename clip item', error);
          window.alert(t('clipLibrary.actions.renameItemFailed'));
          throw error;
        }
      },
    });
  }, [renameItem, selectedItem, t]);

  const handleDeleteSelectedItem = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    try {
      const impact = await getDeleteImpact({ itemId: selectedItem.id });
      const confirmed = window.confirm(
        `${t('clipLibrary.actions.deleteItemConfirm', { name: selectedItem.name })}\n\n${t('clipLibrary.deleteImpact', {
          projects: impact.projectCount,
          nodes: impact.nodeCount,
          folders: impact.folderCount,
          items: impact.itemCount,
        })}`
      );
      if (!confirmed) {
        return;
      }
      await deleteItem(selectedItem.id);
    } catch (error) {
      console.error('Failed to delete clip item', error);
      window.alert(t('clipLibrary.actions.deleteItemFailed'));
    }
  }, [deleteItem, getDeleteImpact, selectedItem, t]);

  const handleSaveDescription = useCallback(async () => {
    if (!selectedItem || isSavingDescription) {
      return;
    }
    setIsSavingDescription(true);
    try {
      await updateItemDescription({
        itemId: selectedItem.id,
        descriptionText: descriptionDraft,
      });
    } catch (error) {
      console.error('Failed to save clip item description', error);
      window.alert(t('clipLibrary.details.saveDescriptionFailed'));
    } finally {
      setIsSavingDescription(false);
    }
  }, [descriptionDraft, isSavingDescription, selectedItem, t, updateItemDescription]);

  const handleMoveSelectedItem = useCallback(
    async (targetFolderId: string) => {
      if (!selectedItem || !targetFolderId || targetFolderId === selectedItem.folderId) {
        return;
      }
      try {
        await moveItem({
          itemId: selectedItem.id,
          targetFolderId,
        });
      } catch (error) {
        console.error('Failed to move clip item', error);
        window.alert(t('clipLibrary.actions.moveItemFailed'));
      }
    },
    [moveItem, selectedItem, t]
  );

  const handleOpenSelectedFile = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    try {
      await openPath(selectedItem.sourcePath);
    } catch (error) {
      console.error('Failed to open clip file', error);
      window.alert(t('clipLibrary.actions.openFileFailed'));
    }
  }, [selectedItem, t]);

  const handleOpenSelectedFolder = useCallback(async () => {
    if (!selectedItem) {
      return;
    }
    try {
      await revealItemInDir(selectedItem.sourcePath);
    } catch (error) {
      console.error('Failed to reveal clip file', error);
      window.alert(t('clipLibrary.actions.openFolderFailed'));
    }
  }, [selectedItem, t]);

  const handleOpenLibraryRoot = useCallback(async () => {
    if (!currentSnapshot) {
      return;
    }

    try {
      await openClipLibraryRoot(currentSnapshot.library.id);
    } catch (error) {
      console.error('Failed to open clip library root path', error);
      window.alert(t('clipLibrary.actions.openRootFailed'));
    }
  }, [currentSnapshot, t]);

  const canSaveDescription =
    Boolean(selectedItem)
    && !isSavingDescription
    && descriptionDraft.trim() !== (selectedItem?.descriptionText ?? '').trim();

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-dark">
      <header
        className="flex h-12 shrink-0 items-center gap-3 border-b border-border-dark px-4"
        onMouseDown={handleHeaderDrag}
      >
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-dark">{t('clipLibrary.windowTitle')}</div>
          <div className="truncate text-xs text-text-muted">
            {projectContext.projectName
              ? t('clipLibrary.currentProjectLabel', { name: projectContext.projectName })
              : t('clipLibrary.noProject')}
          </div>
        </div>

        <UiSelect
          value={currentLibraryId ?? ''}
          onChange={(event) => void loadLibrary(event.target.value || null)}
          className="h-9 min-w-[220px] rounded-xl text-sm"
        >
          <option value="">{t('clipLibrary.selectLibrary')}</option>
          {libraries.map((library) => (
            <option key={library.id} value={library.id}>
              {library.name}
            </option>
          ))}
        </UiSelect>

        <UiButton type="button" variant="ghost" size="sm" className="gap-2" onClick={() => setAlwaysOnTop((value) => !value)}>
          {alwaysOnTop ? <Pin className="h-4 w-4" /> : <PinOff className="h-4 w-4" />}
          {alwaysOnTop ? t('clipLibrary.pinned') : t('clipLibrary.pin')}
        </UiButton>
        <UiButton
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={() => void handleOpenLibraryRoot()}
          disabled={!currentSnapshot}
        >
          <FolderOpen className="h-4 w-4" />
          {t('clipLibrary.openRoot')}
        </UiButton>
        <UiButton type="button" variant="ghost" size="sm" className="gap-2" onClick={() => void refreshCurrentLibrary()}>
          <RefreshCw className="h-4 w-4" />
          {t('common.retry')}
        </UiButton>
        <UiButton type="button" variant="ghost" size="sm" onClick={() => void handleCloseWindow()}>
          <X className="h-4 w-4" />
        </UiButton>
      </header>

      <div className="flex shrink-0 items-center gap-3 border-b border-border-dark px-4 py-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <UiInput
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t('clipLibrary.searchPlaceholder')}
            className="pl-9"
          />
        </div>
        <UiSelect
          value={mediaTypeFilter}
          onChange={(event) => setMediaTypeFilter(event.target.value as ClipLibraryMediaFilter)}
          className="h-10 w-[120px] rounded-xl text-sm"
        >
          <option value="all">{t('clipLibrary.filters.allMedia')}</option>
          <option value="video">{t('clipLibrary.filters.video')}</option>
          <option value="audio">{t('clipLibrary.filters.audio')}</option>
        </UiSelect>
        <UiSelect
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value as ClipLibrarySortMode)}
          className="h-10 w-[150px] rounded-xl text-sm"
        >
          <option value="recent">{t('clipLibrary.filters.sortRecent')}</option>
          <option value="name">{t('clipLibrary.filters.sortName')}</option>
          <option value="number">{t('clipLibrary.filters.sortNumber')}</option>
          <option value="duration">{t('clipLibrary.filters.sortDuration')}</option>
        </UiSelect>
      </div>

      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {!currentSnapshot && !isLoadingSnapshot ? (
          <UiPanel className="flex h-full items-center justify-center rounded-2xl border-dashed text-sm text-text-muted">
            {isLoadingLibraries ? <UiLoadingAnimation /> : t('clipLibrary.emptyTree')}
          </UiPanel>
        ) : (
          <div
            className="grid h-full min-h-0 gap-0"
            style={{
              gridTemplateColumns: `${leftWidth}px 10px minmax(0,1fr) 10px ${rightWidth}px`,
            }}
          >
            <UiPanel className="flex min-h-0 flex-col overflow-hidden !rounded-r-none !border-r-0">
              <div className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-text-dark">{t('clipLibrary.tree.title')}</div>
                  <div className="text-xs text-text-muted">{t('clipLibrary.tree.subtitle')}</div>
                </div>
                {isLoadingSnapshot ? <UiLoadingAnimation size="sm" /> : null}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2 border-b border-[rgba(255,255,255,0.08)] px-4 py-3">
                <UiButton type="button" variant="ghost" size="sm" className="gap-1" onClick={() => void handleCreateChapter()}>
                  <Plus className="h-3.5 w-3.5" />
                  {t('clipLibrary.actions.createChapter')}
                </UiButton>
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => void handleCreateShot()}
                  disabled={!canCreateShot}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('clipLibrary.actions.createShot')}
                </UiButton>
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => void handleCreateScript()}
                  disabled={!canCreateScript}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('clipLibrary.actions.createScript')}
                </UiButton>
                <UiButton type="button" variant="ghost" size="sm" onClick={() => void handleRenameSelectedNode()} disabled={!selectedChapter && !selectedFolder}>
                  {t('common.edit')}
                </UiButton>
                <UiButton type="button" variant="ghost" size="sm" onClick={() => void handleMoveSelectedNode(-1)} disabled={!selectedChapter && !selectedFolder}>
                  {t('common.moveUp')}
                </UiButton>
                <UiButton type="button" variant="ghost" size="sm" onClick={() => void handleMoveSelectedNode(1)} disabled={!selectedChapter && !selectedFolder}>
                  {t('common.moveDown')}
                </UiButton>
                <UiButton type="button" variant="ghost" size="sm" onClick={() => void handleDeleteSelectedNode()} disabled={!selectedChapter && !selectedFolder}>
                  {t('common.delete')}
                </UiButton>
              </div>

              <div
                ref={treeScrollRef}
                className="ui-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-3"
                onScroll={(event) => setTreeScrollTop(event.currentTarget.scrollTop)}
              >
                {treeNodes.map((node) => {
                  const isSelected = selectedKey === node.key;
                  const paddingLeft = 12 + node.depth * 16;
                  return (
                    <button
                      key={node.key}
                      type="button"
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors ${
                        isSelected
                          ? 'bg-accent/12 text-text-dark'
                          : 'text-text-muted hover:bg-white/[0.04] hover:text-text-dark'
                      }`}
                      style={{ paddingLeft }}
                      onClick={() => setSelectedKey(node.key)}
                    >
                      {node.expandable ? (
                        <span
                          className="inline-flex h-4 w-4 items-center justify-center"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            toggleExpanded(node.key);
                          }}
                        >
                          {node.expanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </span>
                      ) : (
                        <span className="inline-flex h-4 w-4 items-center justify-center" />
                      )}
                      <span className="text-accent">
                        {node.kind === 'chapter' ? (
                          <Rows3 className="h-4 w-4" />
                        ) : node.kind === 'shot' ? (
                          <Film className="h-4 w-4" />
                        ) : node.kind === 'script' ? (
                          <Layers3 className="h-4 w-4" />
                        ) : (
                          <FolderOpen className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{node.label}</span>
                      <span className="rounded-full border border-[rgba(255,255,255,0.08)] px-2 py-0.5 text-[11px]">
                        {node.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </UiPanel>

            <div className="group flex cursor-col-resize items-center justify-center" onMouseDown={(event) => handleResizePane('left', event)}>
              <div className="h-16 w-[3px] rounded-full bg-white/[0.08] transition-colors group-hover:bg-accent/40" />
            </div>

            <UiPanel className="flex min-h-0 flex-col overflow-hidden !rounded-none !border-x-0">
              <div className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-text-dark">{t('clipLibrary.content.title')}</div>
                  <div className="text-xs text-text-muted">
                    {t('clipLibrary.content.summary', {
                      count: selectedItems.length,
                      mediaType: mediaTypeLabel(t, mediaTypeFilter),
                    })}
                  </div>
                </div>
                {isLoadingSnapshot ? <UiLoadingAnimation size="sm" /> : null}
              </div>

              <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                {selectedItems.length === 0 ? (
                  <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-[rgba(255,255,255,0.1)] px-6 text-center text-sm text-text-muted">
                    {t('clipLibrary.content.empty')}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                    {selectedItems.map((item) => {
                      const isSelected = selectedItemId === item.id;
                      const dragPayload = safeFileDragPayload(item);
                      const folder = folderMap.get(item.folderId) ?? null;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`rounded-2xl border p-3 text-left transition-all ${
                            isSelected
                              ? 'border-accent/40 bg-accent/[0.08]'
                              : 'border-[rgba(255,255,255,0.08)] bg-white/[0.03] hover:border-[rgba(255,255,255,0.16)]'
                          }`}
                          onClick={() => setSelectedItemId(item.id)}
                        >
                          <div className="flex items-start gap-3">
                            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-bg-dark/70">
                              {item.mediaType === 'video' ? (
                                <img
                                  src={resolveImageDisplayUrl(item.previewPath || item.sourcePath)}
                                  alt={item.name}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-cyan-200">
                                  <Music4 className="h-6 w-6" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-text-dark">{item.name}</div>
                                  <div className="mt-1 text-xs text-text-muted">
                                    {folder?.numberCode || t('clipLibrary.content.noNumber')}
                                  </div>
                                </div>
                                {dragPayload ? (
                                  <span
                                    draggable
                                    onDragStart={(event) => {
                                      event.stopPropagation();
                                      event.dataTransfer.effectAllowed = 'copy';
                                      event.dataTransfer.setData('text/plain', dragPayload.localPath);
                                      event.dataTransfer.setData('text/uri-list', dragPayload.fileUrl);
                                      event.dataTransfer.setData(
                                        'DownloadURL',
                                        `${item.mimeType || 'application/octet-stream'}:${item.fileName}:${dragPayload.fileUrl}`
                                      );
                                    }}
                                    className="inline-flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg border border-[rgba(255,255,255,0.08)] bg-white/[0.03] text-text-muted hover:text-text-dark active:cursor-grabbing"
                                    title={t('clipLibrary.dragHint')}
                                  >
                                    <GripVertical className="h-4 w-4" />
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-2 line-clamp-2 text-xs text-text-muted">
                                {firstLineSummary(item.descriptionText) || item.fileName}
                              </div>
                              <div className="mt-2 text-[11px] text-text-muted">
                                {item.sourceProjectName || t('clipLibrary.details.unknown')}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </UiPanel>

            <div className="group flex cursor-col-resize items-center justify-center" onMouseDown={(event) => handleResizePane('right', event)}>
              <div className="h-16 w-[3px] rounded-full bg-white/[0.08] transition-colors group-hover:bg-accent/40" />
            </div>

            <UiPanel className="flex min-h-0 flex-col overflow-hidden !rounded-l-none !border-l-0">
              <div className="flex shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-text-dark">{t('clipLibrary.details.title')}</div>
                  <div className="text-xs text-text-muted">{t('clipLibrary.details.subtitle')}</div>
                </div>
                {selectedItem ? (
                  <div className="flex items-center gap-1">
                    <UiButton type="button" variant="ghost" size="sm" onClick={() => void handleOpenSelectedFile()}>
                      <ExternalLink className="h-4 w-4" />
                    </UiButton>
                    <UiButton type="button" variant="ghost" size="sm" onClick={() => void handleOpenSelectedFolder()}>
                      <FolderOpen className="h-4 w-4" />
                    </UiButton>
                  </div>
                ) : null}
              </div>

              <div className="ui-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
                {!selectedItem ? (
                  <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-[rgba(255,255,255,0.1)] text-center text-sm text-text-muted">
                    {t('clipLibrary.details.empty')}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-bg-dark/60">
                      {selectedItem.mediaType === 'video' ? (
                        <video
                          controls
                          src={resolveImageDisplayUrl(selectedItem.sourcePath)}
                          poster={resolveImageDisplayUrl(selectedItem.previewPath || selectedItem.sourcePath)}
                          className="aspect-video w-full bg-black"
                        />
                      ) : (
                        <div className="space-y-4 p-4">
                          <audio
                            controls
                            src={resolveAudioDisplayUrl(selectedItem.sourcePath)}
                            className="w-full"
                          />
                          <ClipAudioWaveform sourcePath={selectedItem.sourcePath} />
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] p-4">
                      <div>
                        <div className="text-lg font-semibold text-text-dark">{selectedItem.name}</div>
                        <div className="mt-1 text-sm text-text-muted">
                          {selectedItemFolder?.numberCode || t('clipLibrary.content.noNumber')}
                        </div>
                      </div>

                      <InfoRow label={t('clipLibrary.details.fileName')} value={selectedItem.fileName} />
                      <InfoRow
                        label={t('clipLibrary.details.duration')}
                        value={
                          selectedItem.durationMs
                            ? formatAudioDuration(selectedItem.durationMs / 1000)
                            : t('clipLibrary.details.unknown')
                        }
                      />
                      <InfoRow
                        label={t('clipLibrary.details.sourceNode')}
                        value={selectedItem.sourceNodeTitle || t('clipLibrary.details.unknown')}
                      />
                      <InfoRow
                        label={t('clipLibrary.details.sourceProject')}
                        value={selectedItem.sourceProjectName || t('clipLibrary.details.unknown')}
                      />
                      <InfoRow
                        label={t('clipLibrary.details.importedAt')}
                        value={formatDateTime(selectedItem.createdAt, i18n.language)}
                      />
                      <InfoRow
                        label={t('clipLibrary.details.currentPath')}
                        value={
                          [selectedItemChapter?.fsName, selectedItemShot?.fsName, selectedItemFolder?.fsName]
                            .filter(Boolean)
                            .join(' / ') || t('clipLibrary.details.unknown')
                        }
                      />

                      <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-text-muted/80">
                          {t('clipLibrary.actions.moveItem')}
                        </div>
                        <UiSelect
                          value={selectedItem.folderId}
                          onChange={(event) => void handleMoveSelectedItem(event.target.value)}
                          className="h-11 w-full rounded-xl text-sm"
                        >
                          {availableScriptFolders.map((folder) => {
                            const chapter = chapterMap.get(folder.chapterId);
                            const shot = folder.parentId ? folderMap.get(folder.parentId) : null;
                            const label = [chapter?.fsName, shot?.fsName, folder.fsName]
                              .filter(Boolean)
                              .join(' / ');
                            return (
                              <option key={folder.id} value={folder.id}>
                                {label}
                              </option>
                            );
                          })}
                        </UiSelect>
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-text-muted/80">
                          {t('clipLibrary.details.description')}
                        </div>
                        <UiTextArea
                          value={descriptionDraft}
                          onChange={(event) => setDescriptionDraft(event.target.value)}
                          placeholder={t('clipLibrary.details.descriptionPlaceholder')}
                          className="min-h-[120px]"
                        />
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          <UiButton type="button" variant="ghost" onClick={() => void handleRenameSelectedItem()}>
                            {t('clipLibrary.actions.renameItem')}
                          </UiButton>
                          <UiButton type="button" variant="ghost" onClick={() => void handleDeleteSelectedItem()}>
                            <Trash2 className="mr-1 h-4 w-4" />
                            {t('common.delete')}
                          </UiButton>
                          <UiButton
                            type="button"
                            variant="primary"
                            className="gap-2"
                            disabled={!canSaveDescription}
                            onClick={() => void handleSaveDescription()}
                          >
                            {isSavingDescription ? <UiLoadingAnimation size="xs" /> : null}
                            {t('common.save')}
                          </UiButton>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </UiPanel>
          </div>
        )}
      </main>
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
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 text-right text-text-dark">{value}</span>
    </div>
  );
}
