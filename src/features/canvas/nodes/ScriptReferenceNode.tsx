import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Check, ChevronDown, Film, Image as ImageIcon, Link2, RefreshCcw, Sparkles, TriangleAlert, Video, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingOverlay, UiScrollArea, UiSelect } from '@/components/ui';
import { getProjectRecord } from '@/commands/projectState';
import {
  buildScriptReferenceEpisodeSnapshot,
  extractLinkedScriptReferenceTree,
  findLinkedEpisodeReference,
  type LinkedScriptChapterReference,
  type LinkedScriptEpisodeReference,
  type LinkedScriptSceneReference,
} from '@/features/canvas/application/scriptProjectReferences';
import {
  CANVAS_NODE_TYPES,
  IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  IMAGE_EDIT_NODE_DEFAULT_WIDTH,
  MJ_NODE_DEFAULT_HEIGHT,
  MJ_NODE_DEFAULT_WIDTH,
  SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT,
  SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH,
  SEEDANCE_NODE_DEFAULT_HEIGHT,
  SEEDANCE_NODE_DEFAULT_WIDTH,
  type ScriptReferenceNodeData,
  type ShootingScriptRow,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

type ScriptReferenceNodeProps = {
  id: string;
  data: ScriptReferenceNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

type ScriptReferenceDownstreamTarget = 'image' | 'video' | 'jimengImage' | 'jimengVideo' | 'mjImage';

const MIN_NODE_WIDTH = 520;
const MIN_NODE_HEIGHT = 460;
const MAX_NODE_WIDTH = 980;
const MAX_NODE_HEIGHT = 1080;
const JIMENG_IMAGE_NODE_DEFAULT_WIDTH = 640;
const JIMENG_IMAGE_NODE_DEFAULT_HEIGHT = 340;
const JIMENG_VIDEO_NODE_DEFAULT_WIDTH = 920;
const JIMENG_VIDEO_NODE_DEFAULT_HEIGHT = 500;

const SHOT_ROW_GRID_STYLE = {
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
};

const SCRIPT_REFERENCE_DOWNSTREAM_TARGETS = {
  image: {
    type: CANVAS_NODE_TYPES.imageEdit,
    width: IMAGE_EDIT_NODE_DEFAULT_WIDTH,
    height: IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  },
  video: {
    type: CANVAS_NODE_TYPES.seedance,
    width: SEEDANCE_NODE_DEFAULT_WIDTH,
    height: SEEDANCE_NODE_DEFAULT_HEIGHT,
  },
  jimengImage: {
    type: CANVAS_NODE_TYPES.jimengImage,
    width: JIMENG_IMAGE_NODE_DEFAULT_WIDTH,
    height: JIMENG_IMAGE_NODE_DEFAULT_HEIGHT,
  },
  jimengVideo: {
    type: CANVAS_NODE_TYPES.jimeng,
    width: JIMENG_VIDEO_NODE_DEFAULT_WIDTH,
    height: JIMENG_VIDEO_NODE_DEFAULT_HEIGHT,
  },
  mjImage: {
    type: CANVAS_NODE_TYPES.mj,
    width: MJ_NODE_DEFAULT_WIDTH,
    height: MJ_NODE_DEFAULT_HEIGHT,
  },
} satisfies Record<
  ScriptReferenceDownstreamTarget,
  {
    type: typeof CANVAS_NODE_TYPES[keyof typeof CANVAS_NODE_TYPES];
    width: number;
    height: number;
  }
>;

type CopyFeedbackState = {
  status: 'success' | 'error';
  message: string;
  x: number;
  y: number;
  placement: 'top' | 'bottom';
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  const succeeded = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!succeeded) {
    throw new Error('execCommand copy failed');
  }
}

function buildShotPrompt(
  row: ShootingScriptRow,
  chapterTitle: string,
  sceneTitle: string,
  episodeTitle: string,
): string {
  const prompt = row.genPrompt.trim();
  if (prompt) {
    return prompt;
  }

  return [
    chapterTitle.trim(),
    episodeTitle.trim(),
    sceneTitle.trim(),
    row.beat.trim(),
    row.action.trim(),
    row.composition.trim(),
    row.camera.trim(),
    row.audio.trim(),
    row.artLighting.trim(),
  ].filter(Boolean).join(' | ');
}

function calculateStoryboardGrid(frameCount: number): { rows: number; cols: number } {
  if (frameCount <= 1) return { rows: 1, cols: 1 };
  if (frameCount <= 2) return { rows: 1, cols: 2 };
  if (frameCount <= 4) return { rows: 2, cols: 2 };
  const cols = Math.ceil(Math.sqrt(frameCount));
  return { rows: Math.ceil(frameCount / cols), cols };
}

function isSnapshotStale(
  data: ScriptReferenceNodeData,
  linkedScriptNodeId: string | null,
  linkedRows: ShootingScriptRow[],
): boolean {
  if (!data.scriptSnapshot) {
    return false;
  }

  if (data.scriptSnapshot.scriptNodeId !== linkedScriptNodeId) {
    return true;
  }

  if (data.scriptSnapshot.rows.length !== linkedRows.length) {
    return true;
  }

  return data.scriptSnapshot.rows.some((snapshotRow, index) => {
    const currentRow = linkedRows[index];
    return !currentRow
      || currentRow.id !== snapshotRow.id
      || currentRow.shotNumber !== snapshotRow.shotNumber
      || currentRow.beat !== snapshotRow.beat
      || currentRow.genTarget !== snapshotRow.genTarget
      || currentRow.genPrompt !== snapshotRow.genPrompt
      || currentRow.status !== snapshotRow.status;
  });
}

function resolveChapterReferenceId(
  chapterId: string | null | undefined,
  chapterNumber: number | null | undefined,
): string | null {
  const normalizedId = typeof chapterId === 'string' ? chapterId.trim() : '';
  if (normalizedId) {
    return normalizedId;
  }

  if (typeof chapterNumber === 'number' && Number.isFinite(chapterNumber) && chapterNumber > 0) {
    return `chapter-${chapterNumber}`;
  }

  return null;
}

function resolveSceneReferenceFallbackId(
  sceneOrder: number | null | undefined,
): string | null {
  if (typeof sceneOrder === 'number' && Number.isFinite(sceneOrder) && sceneOrder >= 0) {
    return `scene-${sceneOrder + 1}`;
  }

  return null;
}

function resolveSceneReferenceId(
  sourceSceneId: string | null | undefined,
  sceneNodeId: string | null | undefined,
  sceneOrder: number | null | undefined,
): string | null {
  const normalizedSourceId = typeof sourceSceneId === 'string' ? sourceSceneId.trim() : '';
  if (normalizedSourceId) {
    return normalizedSourceId;
  }

  const normalizedId = typeof sceneNodeId === 'string' ? sceneNodeId.trim() : '';
  if (normalizedId) {
    return normalizedId;
  }

  return resolveSceneReferenceFallbackId(sceneOrder);
}

function resolveSceneReferenceCandidates(
  sourceSceneId: string | null | undefined,
  sceneNodeId: string | null | undefined,
  sceneOrder: number | null | undefined,
): string[] {
  return Array.from(new Set([
    resolveSceneReferenceId(sourceSceneId, sceneNodeId, sceneOrder),
    typeof sceneNodeId === 'string' ? sceneNodeId.trim() : '',
    resolveSceneReferenceFallbackId(sceneOrder),
  ].filter((value): value is string => Boolean(value))));
}

function matchesSceneReference(
  scene: Pick<LinkedScriptSceneReference, 'sourceSceneId' | 'sceneNodeId' | 'sceneOrder'>,
  referenceIds: string[],
): boolean {
  if (referenceIds.length === 0) {
    return false;
  }

  const candidateIds = resolveSceneReferenceCandidates(
    scene.sourceSceneId,
    scene.sceneNodeId,
    scene.sceneOrder,
  );
  return candidateIds.some((candidateId) => referenceIds.includes(candidateId));
}

function buildEpisodeLabel(episodeRef: LinkedScriptEpisodeReference): string {
  return `${episodeRef.chapterNumber}-${episodeRef.sceneOrder + 1}-${episodeRef.episode.episodeNumber}`;
}

function buildEpisodeSourceLabel(
  chapterNumber: number,
  chapterTitle: string,
  sceneOrder: number,
  sceneTitle: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const chapterLabel = `${t('script.sceneStudio.chapterLabel', { number: chapterNumber })} · ${chapterTitle.trim() || t('script.sceneCatalog.untitledChapter')}`;
  const sceneLabel = `${t('script.sceneCatalog.sceneLabel', { number: sceneOrder + 1 })} · ${sceneTitle.trim() || t('script.sceneStudio.untitledScene')}`;
  return `${chapterLabel} / ${sceneLabel}`;
}

function sanitizeSceneCardTitle(title: string): string {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return trimmedTitle;
  }

  return trimmedTitle.replace(/^(?:场景|scene)\s*\d+\s*[:：.\-、]\s*/i, '').trim();
}

function ReferenceFieldCard({
  label,
  value,
  onCopyValue,
}: {
  label: string;
  value: string;
  onCopyValue?: (value: string, triggerRect: DOMRect) => void;
}) {
  const normalizedValue = value.trim();
  const canCopy = normalizedValue.length > 0;

  return (
    <div className="rounded-lg bg-surface-dark px-2.5 py-2 text-[11px]">
      <div className="font-medium text-cyan-200">{label}</div>
      {canCopy ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopyValue?.(normalizedValue, event.currentTarget.getBoundingClientRect());
          }}
          className="mt-1 w-full rounded-md text-left whitespace-pre-wrap break-words text-text-dark transition hover:bg-white/5 hover:text-white focus:outline-none focus:ring-1 focus:ring-cyan-400/40"
        >
          {normalizedValue}
        </button>
      ) : (
        <div className="mt-1 whitespace-pre-wrap break-words text-text-muted">
          -
        </div>
      )}
    </div>
  );
}

function CompactSelectorHint({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-dark/70 bg-bg-dark px-2.5 py-2 text-[11px] text-text-muted">
      {message}
    </div>
  );
}

function CompactReferenceCard({
  eyebrow,
  title,
  active,
  onClick,
  disabled = false,
}: {
  eyebrow: string;
  title: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={`min-w-[124px] max-w-[164px] shrink-0 rounded-lg border px-2.5 py-2 text-left transition ${active ? 'border-cyan-400/45 bg-[#0f2026] text-cyan-100' : 'border-border-dark bg-bg-dark text-text-muted hover:border-cyan-500/25 hover:text-text-dark'} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-inherit/85">
        {eyebrow}
      </div>
      <div className="mt-1 line-clamp-2 text-[13px] font-semibold leading-4">
        {title}
      </div>
    </button>
  );
}

function ScriptReferenceShotCard({
  row,
  selected,
  onToggleSelected,
  onCopyValue,
  chapterTitle,
  sceneTitle,
  episodeTitle,
  t,
}: {
  row: ShootingScriptRow;
  selected: boolean;
  onToggleSelected: () => void;
  onCopyValue: (value: string, triggerRect: DOMRect) => void;
  chapterTitle: string;
  sceneTitle: string;
  episodeTitle: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shotPrompt = buildShotPrompt(row, chapterTitle, sceneTitle, episodeTitle);

  return (
    <div className="rounded-xl border border-border-dark/60 bg-surface-dark px-3 py-3">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onClick={(event) => {
            event.stopPropagation();
          }}
          onChange={(event) => {
            event.stopPropagation();
            onToggleSelected();
          }}
          className="mt-0.5 h-4 w-4 rounded border-border-dark bg-bg-dark text-cyan-400"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 font-medium text-cyan-200">
              {row.shotNumber}
            </span>
          </div>
          <div
            className="mt-2 grid gap-2 text-[11px]"
            style={SHOT_ROW_GRID_STYLE}
          >
            <ReferenceFieldCard label={t('node.scriptReference.table.beat')} value={row.beat} onCopyValue={onCopyValue} />
            <ReferenceFieldCard label={t('node.scriptReference.table.action')} value={row.action} onCopyValue={onCopyValue} />
            <ReferenceFieldCard label={t('node.scriptReference.table.camera')} value={[row.composition, row.camera].filter(Boolean).join(' / ')} onCopyValue={onCopyValue} />
            <ReferenceFieldCard label={t('node.scriptReference.table.audio')} value={row.audio} onCopyValue={onCopyValue} />
          </div>
          <div className="mt-2">
            <ReferenceFieldCard
              label={t('node.scriptReference.table.genPrompt')}
              value={shotPrompt}
              onCopyValue={onCopyValue}
            />
          </div>
          <div className="mt-3 border-t border-border-dark/60 pt-2">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="flex w-full items-center justify-center text-cyan-200/80 transition hover:text-cyan-100"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 pl-7">
          <div
            className="grid gap-2 text-[11px]"
            style={SHOT_ROW_GRID_STYLE}
          >
            <ReferenceFieldCard label={t('node.scriptReference.detail.blocking')} value={row.blocking} onCopyValue={onCopyValue} />
            <ReferenceFieldCard label={t('node.scriptReference.detail.artLighting')} value={row.artLighting} onCopyValue={onCopyValue} />
            <ReferenceFieldCard label={t('node.scriptReference.detail.continuity')} value={row.continuityNote} onCopyValue={onCopyValue} />
            <ReferenceFieldCard label={t('node.scriptReference.detail.rhythm')} value={row.duration} onCopyValue={onCopyValue} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const ScriptReferenceNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ScriptReferenceNodeProps) => {
  const { t } = useTranslation();
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const [chapters, setChapters] = useState<LinkedScriptChapterReference[]>([]);
  const [linkedProjectName, setLinkedProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedbackState | null>(null);
  const copyToastTimerRef = useRef<number | null>(null);
  const nodeRef = useRef<HTMLDivElement | null>(null);

  const linkedScriptProjectId = currentProject?.projectType === 'storyboard'
    ? (currentProject.linkedScriptProjectId ?? data.linkedScriptProjectId ?? null)
    : (data.linkedScriptProjectId ?? null);
  const resolvedWidth = resolveNodeDimension(width, SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT);
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptReference, data);
  const selectedRowIds = data.selectedRowIds;

  const loadLinkedProject = useCallback(async () => {
    if (!linkedScriptProjectId) {
      setChapters([]);
      setLinkedProjectName('');
      setLoadError('');
      return;
    }

    setIsLoading(true);
    setLoadError('');
    try {
      const record = await getProjectRecord(linkedScriptProjectId);
      if (!record) {
        setChapters([]);
        setLinkedProjectName('');
        setLoadError(t('node.scriptReference.missingProject'));
        return;
      }

      setLinkedProjectName(record.name);
      setChapters(extractLinkedScriptReferenceTree(record));
      if ((data.linkedScriptProjectId ?? null) !== linkedScriptProjectId) {
        updateNodeData(id, { linkedScriptProjectId }, { historyMode: 'skip' });
      }
    } catch (error) {
      setChapters([]);
      setLinkedProjectName('');
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [data.linkedScriptProjectId, id, linkedScriptProjectId, t, updateNodeData]);

  useEffect(() => {
    void loadLinkedProject();
  }, [loadLinkedProject]);

  useEffect(() => () => {
    if (copyToastTimerRef.current !== null) {
      window.clearTimeout(copyToastTimerRef.current);
    }
  }, []);

  const fallbackEpisodeRef = useMemo(
    () => findLinkedEpisodeReference(chapters, data.referencedEpisodeId),
    [chapters, data.referencedEpisodeId],
  );
  const selectedChapterId = data.referencedChapterId
    ?? resolveChapterReferenceId(fallbackEpisodeRef?.chapterId, fallbackEpisodeRef?.chapterNumber);
  const selectedChapter = useMemo(
    () => chapters.find((chapter) => (
      resolveChapterReferenceId(chapter.chapterId, chapter.chapterNumber) === selectedChapterId
    )) ?? null,
    [chapters, selectedChapterId],
  );
  const storedSceneReferenceId = typeof data.referencedSceneNodeId === 'string'
    ? data.referencedSceneNodeId.trim() || null
    : null;
  const fallbackSceneReferenceIds = useMemo(
    () => resolveSceneReferenceCandidates(
      fallbackEpisodeRef?.sourceSceneId,
      fallbackEpisodeRef?.sceneNodeId,
      fallbackEpisodeRef?.sceneOrder,
    ),
    [fallbackEpisodeRef],
  );
  const selectedScene = useMemo(() => {
    const referenceIds = Array.from(new Set([
      storedSceneReferenceId,
      ...fallbackSceneReferenceIds,
    ].filter((value): value is string => Boolean(value))));
    if (referenceIds.length === 0) {
      return null;
    }

    const chapterScenes = selectedChapter?.scenes ?? chapters.flatMap((chapter) => chapter.scenes);
    return chapterScenes.find((scene) => matchesSceneReference(scene, referenceIds)) ?? null;
  }, [chapters, fallbackSceneReferenceIds, selectedChapter, storedSceneReferenceId]);
  const selectedSceneId = selectedScene
    ? resolveSceneReferenceId(
      selectedScene.sourceSceneId,
      selectedScene.sceneNodeId,
      selectedScene.sceneOrder,
    )
    : (storedSceneReferenceId ?? fallbackSceneReferenceIds[0] ?? null);
  const selectedEpisodeRef = useMemo(() => {
    if (!data.referencedEpisodeId) {
      return null;
    }

    const sceneMatch = selectedScene?.episodes.find(
      (episodeRef) => episodeRef.episode.id === data.referencedEpisodeId,
    );
    return sceneMatch ?? fallbackEpisodeRef;
  }, [data.referencedEpisodeId, fallbackEpisodeRef, selectedScene]);
  const selectedRows = useMemo(() => {
    if (!selectedEpisodeRef) {
      return [];
    }
    const selectedIdSet = new Set(selectedRowIds);
    return selectedEpisodeRef.rows.filter((row) => selectedIdSet.has(row.id));
  }, [selectedEpisodeRef, selectedRowIds]);
  const missingSelectedRowIds = useMemo(() => {
    const availableIds = new Set(selectedEpisodeRef?.rows.map((row) => row.id) ?? []);
    return selectedRowIds.filter((rowId) => !availableIds.has(rowId));
  }, [selectedEpisodeRef, selectedRowIds]);
  const staleSnapshot = isSnapshotStale(
    data,
    selectedEpisodeRef?.scriptNodeId ?? null,
    selectedEpisodeRef?.rows ?? [],
  );

  const availableScenes = selectedChapter?.scenes ?? [];
  const availableEpisodes = selectedScene?.episodes ?? [];
  const statusMessage = !linkedScriptProjectId
    ? t('node.scriptReference.missingProjectLink')
    : loadError
      ? loadError
      : data.referencedEpisodeId && !selectedEpisodeRef
        ? t('node.scriptReference.missingEpisode')
        : missingSelectedRowIds.length > 0
          ? t('node.scriptReference.missingRows')
          : staleSnapshot
            ? t('node.scriptReference.staleSnapshot')
            : selectedEpisodeRef
              ? t('node.scriptReference.ready')
              : selectedScene
                ? t('node.scriptReference.selectEpisodeHint')
                : selectedChapter
                  ? t('node.scriptReference.selectSceneHint')
                  : t('node.scriptReference.selectChapterHint');

  const handleSelectChapter = useCallback((chapterId: string) => {
    if (selectedChapterId === chapterId && (data.referencedChapterId ?? null) === chapterId) {
      return;
    }

    if (selectedChapterId === chapterId) {
      updateNodeData(id, { linkedScriptProjectId, referencedChapterId: chapterId }, { historyMode: 'skip' });
      return;
    }

    updateNodeData(id, {
      linkedScriptProjectId,
      referencedChapterId: chapterId,
      referencedSceneNodeId: null,
      referencedEpisodeId: null,
      referencedScriptNodeId: null,
      selectedRowIds: [],
      scriptSnapshot: null,
      syncStatus: 'idle',
      syncMessage: null,
      lastSyncedAt: null,
    }, { historyMode: 'skip' });
  }, [data.referencedChapterId, id, linkedScriptProjectId, selectedChapterId, updateNodeData]);

  const handleSelectScene = useCallback((sceneId: string) => {
    if (!selectedChapterId) {
      return;
    }

    if (
      selectedSceneId === sceneId
      && (data.referencedSceneNodeId ?? null) === sceneId
      && (data.referencedChapterId ?? null) === selectedChapterId
    ) {
      return;
    }

    if (selectedSceneId === sceneId) {
      updateNodeData(id, {
        linkedScriptProjectId,
        referencedChapterId: selectedChapterId,
        referencedSceneNodeId: sceneId,
      }, { historyMode: 'skip' });
      return;
    }

    updateNodeData(id, {
      linkedScriptProjectId,
      referencedChapterId: selectedChapterId,
      referencedSceneNodeId: sceneId,
      referencedEpisodeId: null,
      referencedScriptNodeId: null,
      selectedRowIds: [],
      scriptSnapshot: null,
      syncStatus: 'idle',
      syncMessage: null,
      lastSyncedAt: null,
    }, { historyMode: 'skip' });
  }, [
    data.referencedChapterId,
    data.referencedSceneNodeId,
    id,
    linkedScriptProjectId,
    selectedChapterId,
    selectedSceneId,
    updateNodeData,
  ]);

  const persistSelection = useCallback((episodeRef: LinkedScriptEpisodeReference, nextSelectedRowIds: string[]) => {
    const validSelectedRowIds = episodeRef.rows
      .map((row) => row.id)
      .filter((rowId) => nextSelectedRowIds.includes(rowId));

    updateNodeData(id, {
      linkedScriptProjectId,
      referencedChapterId: resolveChapterReferenceId(episodeRef.chapterId, episodeRef.chapterNumber),
      referencedSceneNodeId: resolveSceneReferenceId(
        episodeRef.sourceSceneId,
        episodeRef.sceneNodeId,
        episodeRef.sceneOrder,
      ),
      referencedEpisodeId: episodeRef.episode.id,
      referencedScriptNodeId: episodeRef.scriptNodeId,
      selectedRowIds: validSelectedRowIds,
      scriptSnapshot: buildScriptReferenceEpisodeSnapshot(episodeRef),
      syncStatus: 'ready',
      syncMessage: null,
      lastSyncedAt: Date.now(),
    }, { historyMode: 'skip' });
  }, [id, linkedScriptProjectId, updateNodeData]);

  const showCopyFeedback = useCallback((
    status: CopyFeedbackState['status'],
    message: string,
    triggerRect: DOMRect,
  ) => {
    const rootRect = nodeRef.current?.getBoundingClientRect();
    if (!rootRect) {
      setCopyFeedback({
        status,
        message,
        x: 64,
        y: 18,
        placement: 'bottom',
      });
      return;
    }

    const anchorX = triggerRect.left - rootRect.left + triggerRect.width / 2;
    const anchorY = triggerRect.top - rootRect.top + triggerRect.height / 2;
    const placement = anchorY < 68 ? 'bottom' : 'top';
    const clampedX = Math.min(Math.max(anchorX, 54), Math.max(54, rootRect.width - 54));
    const yOffset = placement === 'top' ? 10 : 12;
    const clampedY = Math.min(
      Math.max(anchorY + (placement === 'top' ? -yOffset : yOffset), 18),
      Math.max(18, rootRect.height - 18),
    );

    setCopyFeedback({
      status,
      message,
      x: clampedX,
      y: clampedY,
      placement,
    });
  }, []);

  const handleCopyValue = useCallback(async (value: string, triggerRect: DOMRect) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return;
    }

    try {
      await copyTextToClipboard(normalizedValue);
      showCopyFeedback('success', t('node.scriptReference.copySuccess'), triggerRect);
      if (copyToastTimerRef.current !== null) {
        window.clearTimeout(copyToastTimerRef.current);
      }
      copyToastTimerRef.current = window.setTimeout(() => {
        setCopyFeedback(null);
      }, 1400);
    } catch (error) {
      showCopyFeedback('error', t('node.scriptReference.copyFailed'), triggerRect);
      if (copyToastTimerRef.current !== null) {
        window.clearTimeout(copyToastTimerRef.current);
      }
      copyToastTimerRef.current = window.setTimeout(() => {
        setCopyFeedback(null);
      }, 1800);
      console.error('Failed to copy script reference text', error);
    }
  }, [showCopyFeedback, t]);

  const toggleRowSelection = useCallback((rowId: string) => {
    if (!selectedEpisodeRef) {
      return;
    }

    const validRowIds = new Set(selectedEpisodeRef.rows.map((row) => row.id));
    const nextSelectedRowIds = selectedRowIds.includes(rowId)
      ? selectedRowIds.filter((candidateId) => candidateId !== rowId)
      : [...selectedRowIds, rowId];

    updateNodeData(id, {
      selectedRowIds: nextSelectedRowIds.filter((candidateId) => validRowIds.has(candidateId)),
    }, { historyMode: 'skip' });
  }, [id, selectedEpisodeRef, selectedRowIds, updateNodeData]);

  const createDownstreamNodes = useCallback((target: ScriptReferenceDownstreamTarget) => {
    if (!selectedEpisodeRef || selectedRows.length === 0) {
      return;
    }

    const downstreamTarget = SCRIPT_REFERENCE_DOWNSTREAM_TARGETS[target];

    selectedRows.forEach((row) => {
      const prompt = buildShotPrompt(
        row,
        selectedEpisodeRef.chapterTitle,
        selectedEpisodeRef.sceneTitle,
        selectedEpisodeRef.episode.title,
      );
      const nextNodeId = addNode(
        downstreamTarget.type,
        findNodePosition(
          id,
          downstreamTarget.width,
          downstreamTarget.height,
        ),
        {
          displayName: `${t('node.scriptReference.shotPrefix')} ${row.shotNumber}`,
          prompt,
          nodeDescription: row.beat || row.action || null,
        },
        { inheritParentFromNodeId: id },
      );
      if (nextNodeId) {
        addEdge(id, nextNodeId);
      }
    });
  }, [addEdge, addNode, findNodePosition, id, selectedEpisodeRef, selectedRows, t]);

  const createStoryboardNode = useCallback(() => {
    if (!selectedEpisodeRef || selectedRows.length === 0) {
      return;
    }

    const grid = calculateStoryboardGrid(selectedRows.length);
    const nextNodeId = addNode(
      CANVAS_NODE_TYPES.storyboardGen,
      findNodePosition(id, IMAGE_EDIT_NODE_DEFAULT_WIDTH, IMAGE_EDIT_NODE_DEFAULT_HEIGHT),
      {
        displayName: `${selectedEpisodeRef.episode.title || selectedEpisodeRef.episode.id} ${t('node.scriptReference.storyboardGenLabel')}`,
        gridRows: grid.rows,
        gridCols: grid.cols,
        frames: selectedRows.map((row) => ({
          id: `frame-${row.id}`,
          description: buildShotPrompt(
            row,
            selectedEpisodeRef.chapterTitle,
            selectedEpisodeRef.sceneTitle,
            selectedEpisodeRef.episode.title,
          ),
          referenceIndex: null,
        })),
      },
      { inheritParentFromNodeId: id },
    );
    if (nextNodeId) {
      addEdge(id, nextNodeId);
    }
  }, [addEdge, addNode, findNodePosition, id, selectedEpisodeRef, selectedRows, t]);

  return (
    <div
      ref={nodeRef}
      className={`group relative overflow-visible rounded-[20px] border bg-surface-dark shadow-[0_20px_40px_rgba(2,6,23,0.22)] ${selected ? 'border-cyan-300/55' : 'border-cyan-300/18 hover:border-cyan-300/32'}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <Handle type="target" id="target" position={Position.Left} className="!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-cyan-400" />
      <Handle type="source" id="source" position={Position.Right} className="!h-3 !w-3 !-right-1.5 !rounded-full !border-surface-dark !bg-teal-400" />
      {copyFeedback ? (
        <div
          className={`pointer-events-none absolute z-30 transition-all duration-200 ${
            copyFeedback.placement === 'top'
              ? '-translate-x-1/2 -translate-y-full'
              : '-translate-x-1/2 translate-y-0'
          }`}
          style={{
            left: copyFeedback.x,
            top: copyFeedback.y,
          }}
        >
          <div
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-[0_10px_30px_rgba(2,6,23,0.28)] backdrop-blur-sm ${
              copyFeedback.status === 'success'
                ? 'border-emerald-400/35 bg-emerald-500/16 text-emerald-50'
                : 'border-red-400/35 bg-red-500/16 text-red-50'
            }`}
          >
            {copyFeedback.status === 'success' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <X className="h-3.5 w-3.5" />
            )}
            <span>{copyFeedback.message}</span>
          </div>
        </div>
      ) : null}

      <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] p-3">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[20px]">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-cyan-300/70" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-200/85">
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5">{t('node.scriptReference.badge')}</span>
              {linkedProjectName ? (
                <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-amber-200">
                  <Link2 className="mr-1 inline h-3 w-3" />
                  {linkedProjectName}
                </span>
              ) : null}
            </div>
            <div className="mt-2 truncate text-sm font-semibold text-text-dark">{resolvedTitle}</div>
            <div className="mt-1 line-clamp-2 text-xs text-text-muted">{statusMessage}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void loadLinkedProject();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-text-muted hover:border-cyan-400/25 hover:bg-cyan-500/10 hover:text-cyan-100"
              title={t('node.scriptReference.refresh')}
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-bg-dark px-2.5 py-1 text-text-muted">
            {t('node.scriptReference.selectedRows', { count: selectedRowIds.length })}
          </span>
          {statusMessage !== t('node.scriptReference.ready') ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-200">
              <TriangleAlert className="h-3.5 w-3.5" />
              {t('node.scriptReference.warning')}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('image'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 disabled:opacity-60"><ImageIcon className="h-3.5 w-3.5" />{t('node.scriptReference.generateImage')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('mjImage'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200 disabled:opacity-60"><Sparkles className="h-3.5 w-3.5" />{t('node.scriptReference.generateMidjourneyImage')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('video'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 disabled:opacity-60"><Video className="h-3.5 w-3.5" />{t('node.scriptReference.generateVideo')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createStoryboardNode(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 disabled:opacity-60"><Film className="h-3.5 w-3.5" />{t('node.scriptReference.addStoryboardGen')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('jimengImage'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 disabled:opacity-60"><ImageIcon className="h-3.5 w-3.5" />{t('node.scriptReference.generateJimengImage')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('jimengVideo'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 disabled:opacity-60"><Video className="h-3.5 w-3.5" />{t('node.scriptReference.generateJimengVideo')}</button>
        </div>

        <div
          className="nowheel mt-3 flex min-h-0 flex-1 flex-col gap-3"
          onWheelCapture={(event) => {
            event.stopPropagation();
          }}
        >
          {!linkedScriptProjectId ? (
            <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark px-3 py-6 text-center text-xs text-text-muted">
              {t('node.scriptReference.missingProjectLink')}
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border-dark/70 bg-bg-dark px-3 py-2.5">
                <div className="grid gap-2">
                  <div className="grid grid-cols-[58px,minmax(0,1fr)] items-center gap-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-cyan-200">
                      {t('node.scriptReference.chapterStep')}
                    </div>
                    {chapters.length > 0 ? (
                      <UiSelect
                        value={selectedChapterId ?? ''}
                        onChange={(event) => {
                          const nextChapterId = event.currentTarget.value.trim();
                          if (nextChapterId) {
                            handleSelectChapter(nextChapterId);
                          }
                        }}
                        className="h-9 rounded-lg px-3 text-sm"
                        aria-label={t('node.scriptReference.chapterStep')}
                      >
                        <option value="" disabled>{t('node.scriptReference.selectChapterHint')}</option>
                        {chapters.map((chapter) => {
                          const chapterId = resolveChapterReferenceId(chapter.chapterId, chapter.chapterNumber);
                          if (!chapterId) {
                            return null;
                          }

                          return (
                            <option key={chapterId} value={chapterId}>
                              {`${t('script.sceneStudio.chapterLabel', { number: chapter.chapterNumber })} · ${chapter.chapterTitle || t('script.sceneCatalog.untitledChapter')}`}
                            </option>
                          );
                        })}
                      </UiSelect>
                    ) : (
                      <CompactSelectorHint message={loadError || t('node.scriptReference.missingProject')} />
                    )}
                  </div>

                  <div className="grid grid-cols-[58px,minmax(0,1fr)] items-start gap-2">
                    <div className="pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-cyan-200">
                      {t('node.scriptReference.sceneStep')}
                    </div>
                    {selectedChapter ? (
                      availableScenes.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {availableScenes.map((scene) => {
                              const sceneId = resolveSceneReferenceId(
                                scene.sourceSceneId,
                                scene.sceneNodeId,
                                scene.sceneOrder,
                              );
                              const isActive = Boolean(sceneId && sceneId === selectedSceneId);
                              return (
                                <CompactReferenceCard
                                  key={sceneId ?? `scene-${scene.sceneOrder + 1}`}
                                  eyebrow={t('script.sceneCatalog.sceneLabel', { number: scene.sceneOrder + 1 })}
                                  title={sanitizeSceneCardTitle(scene.sceneTitle || t('script.sceneStudio.untitledScene'))}
                                  active={isActive}
                                  disabled={!sceneId}
                                  onClick={() => {
                                    if (sceneId) {
                                      handleSelectScene(sceneId);
                                    }
                                  }}
                                />
                              );
                            })}
                        </div>
                      ) : (
                        <CompactSelectorHint message={t('node.scriptReference.noScenes')} />
                      )
                    ) : (
                      <CompactSelectorHint message={t('node.scriptReference.selectChapterHint')} />
                    )}
                  </div>

                  <div className="grid grid-cols-[58px,minmax(0,1fr)] items-start gap-2">
                    <div className="pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-cyan-200">
                      {t('node.scriptReference.episodeStep')}
                    </div>
                    {selectedScene ? (
                      availableEpisodes.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                            {availableEpisodes.map((episodeRef) => (
                              <CompactReferenceCard
                                key={episodeRef.episode.id}
                                eyebrow={buildEpisodeLabel(episodeRef)}
                                title={episodeRef.episode.title || t('script.sceneWorkbench.untitledEpisode')}
                                active={data.referencedEpisodeId === episodeRef.episode.id}
                                onClick={() => persistSelection(episodeRef, [])}
                              />
                            ))}
                        </div>
                      ) : (
                        <CompactSelectorHint message={t('node.scriptReference.noEpisodes')} />
                      )
                    ) : (
                      <CompactSelectorHint message={t('node.scriptReference.selectSceneHint')} />
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 rounded-xl border border-border-dark/70 bg-bg-dark">
                {selectedEpisodeRef ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex items-center justify-between gap-3 border-b border-border-dark/70 px-3 py-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-cyan-200">{buildEpisodeLabel(selectedEpisodeRef)}</div>
                        <div className="truncate text-sm font-semibold text-text-dark">
                          {selectedEpisodeRef.episode.title || t('script.sceneWorkbench.untitledEpisode')}
                        </div>
                        <div className="mt-1 truncate text-xs text-text-muted">
                          {buildEpisodeSourceLabel(
                            selectedEpisodeRef.chapterNumber,
                            selectedEpisodeRef.chapterTitle,
                            selectedEpisodeRef.sceneOrder,
                            selectedEpisodeRef.sceneTitle,
                            t,
                          )}
                        </div>
                      </div>
                      <button type="button" onClick={() => persistSelection(selectedEpisodeRef, selectedRowIds)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark"><RefreshCcw className="h-3.5 w-3.5" />{t('node.scriptReference.refreshSelection')}</button>
                    </div>
                    <UiScrollArea
                      className="nowheel min-h-0 flex-1"
                      viewportClassName="nowheel h-full"
                      contentClassName="space-y-3 px-3 py-3 pr-5"
                    >
                      {selectedEpisodeRef.rows.length > 0 ? selectedEpisodeRef.rows.map((row) => (
                        <ScriptReferenceShotCard
                          key={row.id}
                          row={row}
                          selected={selectedRowIds.includes(row.id)}
                          onToggleSelected={() => toggleRowSelection(row.id)}
                          onCopyValue={handleCopyValue}
                          chapterTitle={selectedEpisodeRef.chapterTitle}
                          sceneTitle={selectedEpisodeRef.sceneTitle}
                          episodeTitle={selectedEpisodeRef.episode.title}
                          t={t}
                        />
                      )) : (
                        <div className="px-3 py-6 text-center text-xs text-text-muted">
                          {t('node.scriptReference.noShots')}
                        </div>
                      )}
                    </UiScrollArea>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-muted">
                    {t('node.scriptReference.selectEpisodeHint')}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <NodeResizeHandle minWidth={MIN_NODE_WIDTH} minHeight={MIN_NODE_HEIGHT} maxWidth={MAX_NODE_WIDTH} maxHeight={MAX_NODE_HEIGHT} isVisible={selected} />
      <UiLoadingOverlay
        visible={isLoading}
        insetClassName="inset-3"
        backdropClassName="bg-transparent"
        variant="bare"
      />
    </div>
  );
});

ScriptReferenceNode.displayName = 'ScriptReferenceNode';
