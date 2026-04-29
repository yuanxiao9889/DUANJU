import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import {
  ChevronDown,
  Film,
  Image as ImageIcon,
  Link2,
  RefreshCcw,
  Sparkles,
  TriangleAlert,
  Video,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingOverlay, UiScrollArea } from '@/components/ui';
import type { AdScriptTableRow } from '@/features/ad/types';
import { getProjectRecord } from '@/commands/projectState';
import {
  buildAdScriptReferenceSnapshot,
  extractLinkedAdProjectReference,
  type LinkedAdProjectReference,
} from '@/features/canvas/application/adProjectReferences';
import {
  buildAdScriptTransferPackage,
} from '@/features/canvas/application/referencePromptPlanning';
import {
  AD_SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT,
  AD_SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH,
  CANVAS_NODE_TYPES,
  IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  IMAGE_EDIT_NODE_DEFAULT_WIDTH,
  MJ_NODE_DEFAULT_HEIGHT,
  MJ_NODE_DEFAULT_WIDTH,
  SEEDANCE_NODE_DEFAULT_HEIGHT,
  SEEDANCE_NODE_DEFAULT_WIDTH,
  type AdScriptReferenceNodeData,
  type ReferenceTransferTargetKind,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

type AdScriptReferenceNodeProps = {
  id: string;
  data: AdScriptReferenceNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

type AdReferenceDownstreamTarget = 'image' | 'video' | 'jimengImage' | 'jimengVideo' | 'mjImage';

const MIN_NODE_WIDTH = 520;
const MIN_NODE_HEIGHT = 460;
const MAX_NODE_WIDTH = 980;
const MAX_NODE_HEIGHT = 1080;
const JIMENG_IMAGE_NODE_DEFAULT_WIDTH = 640;
const JIMENG_IMAGE_NODE_DEFAULT_HEIGHT = 340;
const JIMENG_VIDEO_NODE_DEFAULT_WIDTH = 920;
const JIMENG_VIDEO_NODE_DEFAULT_HEIGHT = 500;

const AD_ROW_GRID_STYLE = {
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
};

const AD_REFERENCE_DOWNSTREAM_TARGETS = {
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
  AdReferenceDownstreamTarget,
  {
    type: typeof CANVAS_NODE_TYPES[keyof typeof CANVAS_NODE_TYPES];
    width: number;
    height: number;
  }
>;

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

function calculateStoryboardGrid(frameCount: number): { rows: number; cols: number } {
  if (frameCount <= 1) return { rows: 1, cols: 1 };
  if (frameCount <= 2) return { rows: 1, cols: 2 };
  if (frameCount <= 4) return { rows: 2, cols: 2 };
  const cols = Math.ceil(Math.sqrt(frameCount));
  return { rows: Math.ceil(frameCount / cols), cols };
}

function isSnapshotStale(
  data: AdScriptReferenceNodeData,
  reference: LinkedAdProjectReference | null
): boolean {
  if (!data.scriptSnapshot || !reference) {
    return false;
  }

  if (data.scriptSnapshot.templateId !== reference.templateId) {
    return true;
  }

  if (data.scriptSnapshot.brief.normalizedBrief !== reference.brief.normalizedBrief) {
    return true;
  }

  if (data.scriptSnapshot.rows.length !== reference.rows.length) {
    return true;
  }

  return data.scriptSnapshot.rows.some((snapshotRow, index) => {
    const currentRow = reference.rows[index];
    return !currentRow
      || currentRow.id !== snapshotRow.id
      || currentRow.shotNumber !== snapshotRow.shotNumber
      || currentRow.duration !== snapshotRow.duration
      || currentRow.objective !== snapshotRow.objective
      || currentRow.visual !== snapshotRow.visual
      || currentRow.dialogueOrVO !== snapshotRow.dialogueOrVO
      || currentRow.camera !== snapshotRow.camera
      || currentRow.audio !== snapshotRow.audio
      || currentRow.productFocus !== snapshotRow.productFocus
      || currentRow.sellingPoint !== snapshotRow.sellingPoint
      || currentRow.cta !== snapshotRow.cta
      || currentRow.assetHint !== snapshotRow.assetHint
      || currentRow.directorIntent !== snapshotRow.directorIntent
      || currentRow.status !== snapshotRow.status;
  });
}

function AdReferenceFieldCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const normalizedValue = value.trim();
  return (
    <div className="rounded-lg bg-surface-dark px-2.5 py-2 text-[11px]">
      <div className="font-medium text-emerald-200">{label}</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-text-dark">
        {normalizedValue || '-'}
      </div>
    </div>
  );
}

function resolveTransferTargetKind(target: AdReferenceDownstreamTarget): ReferenceTransferTargetKind {
  return target === 'image' || target === 'jimengImage' || target === 'mjImage'
    ? 'image'
    : 'video';
}

function AdScriptRowCard({
  row,
  selected,
  onToggleSelected,
  t,
}: {
  row: AdScriptTableRow;
  selected: boolean;
  onToggleSelected: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-xl border px-3 py-3 transition ${
        selected
          ? 'border-emerald-400/55 bg-emerald-500/[0.08]'
          : 'border-border-dark/60 bg-surface-dark'
      }`}
    >
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
          className="mt-0.5 h-4 w-4 rounded border-border-dark bg-bg-dark text-emerald-400"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 font-medium text-emerald-200">
              {t('node.adScriptReference.rowNumber', { number: row.shotNumber || '-' })}
            </span>
            {row.duration.trim() ? (
              <span className="rounded-full bg-bg-dark px-2 py-0.5 text-text-muted">
                {row.duration.trim()}
              </span>
            ) : null}
            {row.status.trim() ? (
              <span className="rounded-full bg-bg-dark px-2 py-0.5 text-text-muted">
                {row.status.trim()}
              </span>
            ) : null}
          </div>
          <div className="mt-2 grid gap-2 text-[11px]" style={AD_ROW_GRID_STYLE}>
            <AdReferenceFieldCard label={t('node.adScriptReference.table.objective')} value={row.objective} />
            <AdReferenceFieldCard label={t('node.adScriptReference.table.visual')} value={row.visual} />
            <AdReferenceFieldCard label={t('node.adScriptReference.table.dialogueOrVO')} value={row.dialogueOrVO} />
          </div>
          <div className="mt-3 border-t border-border-dark/60 pt-2">
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="flex w-full items-center justify-center text-emerald-200/80 transition hover:text-emerald-100"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="mt-3 pl-7">
          <div className="grid gap-2 text-[11px]" style={AD_ROW_GRID_STYLE}>
            <AdReferenceFieldCard label={t('node.adScriptReference.table.camera')} value={row.camera} />
            <AdReferenceFieldCard label={t('node.adScriptReference.table.audio')} value={row.audio} />
            <AdReferenceFieldCard label={t('node.adScriptReference.table.productFocus')} value={row.productFocus} />
            <AdReferenceFieldCard label={t('node.adScriptReference.table.sellingPoint')} value={row.sellingPoint} />
            <AdReferenceFieldCard label={t('node.adScriptReference.table.cta')} value={row.cta} />
            <AdReferenceFieldCard label={t('node.adScriptReference.table.directorIntent')} value={row.directorIntent} />
            <AdReferenceFieldCard label={t('node.adScriptReference.table.assetHint')} value={row.assetHint} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const AdScriptReferenceNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: AdScriptReferenceNodeProps) => {
  const { t } = useTranslation();
  const currentProjectType = useProjectStore(
    (state) => state.currentProject?.projectType ?? null,
  );
  const currentLinkedAdProjectId = useProjectStore(
    (state) => state.currentProject?.linkedAdProjectId ?? null,
  );
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const [linkedReference, setLinkedReference] = useState<LinkedAdProjectReference | null>(null);
  const [linkedProjectName, setLinkedProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const linkedAdProjectId = currentProjectType === 'storyboard'
    ? currentLinkedAdProjectId
    : (data.linkedAdProjectId ?? null);
  const resolvedWidth = resolveNodeDimension(width, AD_SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, AD_SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT);
  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.adScriptReference, data);

  const loadLinkedProject = useCallback(async () => {
    if (!linkedAdProjectId) {
      setLinkedReference(null);
      setLinkedProjectName('');
      setLoadError('');
      return;
    }

    setIsLoading(true);
    setLoadError('');
    try {
      const record = await getProjectRecord(linkedAdProjectId);
      if (!record) {
        setLinkedReference(null);
        setLinkedProjectName('');
        setLoadError(t('node.adScriptReference.missingProject'));
        return;
      }

      const nextReference = extractLinkedAdProjectReference(record);
      if (!nextReference) {
        setLinkedReference(null);
        setLinkedProjectName(record.name);
        setLoadError(t('node.adScriptReference.missingProjectData'));
        return;
      }

      setLinkedReference(nextReference);
      setLinkedProjectName(nextReference.projectName);
      if ((data.linkedAdProjectId ?? null) !== linkedAdProjectId) {
        updateNodeData(id, { linkedAdProjectId }, { historyMode: 'skip' });
      }
    } catch (error) {
      setLinkedReference(null);
      setLinkedProjectName('');
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [data.linkedAdProjectId, id, linkedAdProjectId, t, updateNodeData]);

  useEffect(() => {
    void loadLinkedProject();
  }, [loadLinkedProject]);

  const rows = linkedReference?.rows ?? [];
  const selectedIdSet = useMemo(() => new Set(data.selectedRowIds), [data.selectedRowIds]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedIdSet.has(row.id)),
    [rows, selectedIdSet]
  );
  const canSelectAllRows = rows.length > 0 && selectedRows.length < rows.length;
  const canDeselectAllRows = data.selectedRowIds.length > 0;
  const hasMissingSelectedRows = data.selectedRowIds.length > 0 && selectedRows.length !== data.selectedRowIds.length;
  const staleSnapshot = isSnapshotStale(data, linkedReference);
  const selectedTemplateLabel = linkedReference
    ? t(`adProject.templates.${linkedReference.templateId}.name`)
    : '';

  const statusMessage = !linkedAdProjectId
    ? t('node.adScriptReference.missingProjectLink')
    : loadError
      ? loadError
      : hasMissingSelectedRows
        ? t('node.adScriptReference.missingRows')
        : staleSnapshot
          ? t('node.adScriptReference.staleSnapshot')
          : rows.length === 0
            ? t('node.adScriptReference.noRows')
            : selectedRows.length > 0
              ? t('node.adScriptReference.ready')
              : t('node.adScriptReference.selectRowsHint');

  const derivedSyncStatus = !linkedAdProjectId
    ? 'idle'
    : loadError
      ? 'missingProject'
      : hasMissingSelectedRows
        ? 'missingRows'
        : staleSnapshot
          ? 'stale'
          : selectedRows.length > 0
            ? 'ready'
            : 'idle';
  const derivedSyncMessage = derivedSyncStatus === 'ready' || derivedSyncStatus === 'idle'
    ? null
    : statusMessage;
  const showWarningBadge = derivedSyncStatus !== 'ready' && derivedSyncStatus !== 'idle';

  useEffect(() => {
    const nextLinkedProjectId = linkedAdProjectId ?? null;
    const nextSyncMessage = derivedSyncMessage ?? null;
    const currentSyncMessage = data.syncMessage ?? null;
    if (
      (data.linkedAdProjectId ?? null) === nextLinkedProjectId
      && data.syncStatus === derivedSyncStatus
      && currentSyncMessage === nextSyncMessage
    ) {
      return;
    }

    updateNodeData(
      id,
      {
        linkedAdProjectId: nextLinkedProjectId,
        syncStatus: derivedSyncStatus,
        syncMessage: nextSyncMessage,
      },
      { historyMode: 'skip' }
    );
  }, [
    data.linkedAdProjectId,
    data.syncMessage,
    data.syncStatus,
    derivedSyncMessage,
    derivedSyncStatus,
    id,
    linkedAdProjectId,
    updateNodeData,
  ]);

  const refreshSnapshot = useCallback(() => {
    if (!linkedReference) {
      return;
    }

    updateNodeData(
      id,
      {
        linkedAdProjectId,
        scriptSnapshot: buildAdScriptReferenceSnapshot(linkedReference),
        syncStatus: selectedRows.length > 0 ? 'ready' : 'idle',
        syncMessage: null,
        lastSyncedAt: Date.now(),
      },
      { historyMode: 'skip' }
    );
  }, [id, linkedAdProjectId, linkedReference, selectedRows.length, updateNodeData]);

  const toggleRowSelection = useCallback((rowId: string) => {
    const validRowIds = new Set(rows.map((row) => row.id));
    if (!validRowIds.has(rowId)) {
      return;
    }

    const nextSelectedRowIds = data.selectedRowIds.includes(rowId)
      ? data.selectedRowIds.filter((candidateId) => candidateId !== rowId)
      : [...data.selectedRowIds.filter((candidateId) => validRowIds.has(candidateId)), rowId];

    updateNodeData(id, { selectedRowIds: nextSelectedRowIds }, { historyMode: 'skip' });
  }, [data.selectedRowIds, id, rows, updateNodeData]);

  const handleSelectAllRows = useCallback(() => {
    if (rows.length === 0) {
      return;
    }

    updateNodeData(id, {
      selectedRowIds: rows.map((row) => row.id),
    }, { historyMode: 'skip' });
  }, [id, rows, updateNodeData]);

  const handleDeselectAllRows = useCallback(() => {
    if (!canDeselectAllRows) {
      return;
    }

    updateNodeData(id, {
      selectedRowIds: [],
    }, { historyMode: 'skip' });
  }, [canDeselectAllRows, id, updateNodeData]);

  const createDownstreamNodes = useCallback((target: AdReferenceDownstreamTarget) => {
    if (!linkedReference || selectedRows.length === 0) {
      return;
    }

    const downstreamTarget = AD_REFERENCE_DOWNSTREAM_TARGETS[target];
    const transferTarget = resolveTransferTargetKind(target);

    if (transferTarget === 'video') {
      const transferPackage = buildAdScriptTransferPackage(
        id,
        linkedReference.brief,
        selectedRows,
        'video',
      );
      const firstRow = selectedRows[0];
      const lastRow = selectedRows[selectedRows.length - 1];
      const hasShotRange = firstRow?.shotNumber && lastRow?.shotNumber && firstRow.shotNumber !== lastRow.shotNumber;
      const displayName = selectedRows.length <= 1
        ? `${t('node.adScriptReference.shotPrefix')} ${firstRow?.shotNumber || '-'}`
        : hasShotRange
          ? `${resolvedTitle} ${t('node.adScriptReference.rangeVideoLabel', {
            start: firstRow.shotNumber,
            end: lastRow.shotNumber,
          })}`
          : `${resolvedTitle} ${t('node.adScriptReference.multiShotVideoLabel')}`;
      const nodeDescription = selectedRows.length <= 1
        ? (firstRow?.objective || firstRow?.sellingPoint || null)
        : t('node.adScriptReference.multiShotVideoDescription', {
          summary: firstRow?.objective || firstRow?.sellingPoint || '-',
          count: selectedRows.length,
        });

      const nextNodeId = addNode(
        downstreamTarget.type,
        findNodePosition(
          id,
          downstreamTarget.width,
          downstreamTarget.height,
        ),
        {
          displayName,
          prompt: transferPackage.renderedPrompt,
          promptSource: transferPackage,
          nodeDescription,
        },
        { inheritParentFromNodeId: id },
      );
      if (nextNodeId) {
        addEdge(id, nextNodeId);
      }
      return;
    }

    selectedRows.forEach((row) => {
      const transferPackage = buildAdScriptTransferPackage(
        id,
        linkedReference.brief,
        [row],
        'image',
      );
      const nextNodeId = addNode(
        downstreamTarget.type,
        findNodePosition(
          id,
          downstreamTarget.width,
          downstreamTarget.height,
        ),
        {
          displayName: `${t('node.adScriptReference.shotPrefix')} ${row.shotNumber || '-'}`,
          prompt: transferPackage.renderedPrompt,
          promptSource: transferPackage,
          nodeDescription: row.objective || row.sellingPoint || null,
        },
        { inheritParentFromNodeId: id },
      );
      if (nextNodeId) {
        addEdge(id, nextNodeId);
      }
    });
  }, [addEdge, addNode, findNodePosition, id, linkedReference, resolvedTitle, selectedRows, t]);

  const createStoryboardNode = useCallback(() => {
    if (!linkedReference || selectedRows.length === 0) {
      return;
    }

    const grid = calculateStoryboardGrid(selectedRows.length);
    const nextNodeId = addNode(
      CANVAS_NODE_TYPES.storyboardGen,
      findNodePosition(id, IMAGE_EDIT_NODE_DEFAULT_WIDTH, IMAGE_EDIT_NODE_DEFAULT_HEIGHT),
      {
        displayName: `${linkedProjectName || t('node.adScriptReference.badge')} ${t('node.adScriptReference.storyboardGenLabel')}`,
        gridRows: grid.rows,
        gridCols: grid.cols,
        frames: selectedRows.map((row) => {
          const transferPackage = buildAdScriptTransferPackage(id, linkedReference.brief, [row], 'storyboard');
          return {
          id: `frame-${row.id}`,
          description: transferPackage.renderedPrompt,
          referenceIndex: null,
          sourcePackage: transferPackage,
          };
        }),
      },
      { inheritParentFromNodeId: id },
    );
    if (nextNodeId) {
      addEdge(id, nextNodeId);
    }
  }, [addEdge, addNode, findNodePosition, id, linkedProjectName, linkedReference, selectedRows, t]);

  return (
    <div
      className={`group relative overflow-visible rounded-[20px] border bg-surface-dark shadow-[0_20px_40px_rgba(2,6,23,0.22)] ${selected ? 'border-emerald-300/55' : 'border-emerald-300/18 hover:border-emerald-300/32'}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <Handle type="target" id="target" position={Position.Left} className="!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-emerald-400" />
      <Handle type="source" id="source" position={Position.Right} className="!h-3 !w-3 !-right-1.5 !rounded-full !border-surface-dark !bg-teal-400" />

      <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] p-3">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[20px]">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-emerald-300/70" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-emerald-200/85">
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5">{t('node.adScriptReference.badge')}</span>
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
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-text-muted hover:border-emerald-400/25 hover:bg-emerald-500/10 hover:text-emerald-100"
              title={t('node.adScriptReference.refresh')}
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('image'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 disabled:opacity-60"><ImageIcon className="h-3.5 w-3.5" />{t('node.adScriptReference.generateImage')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('mjImage'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium text-fuchsia-200 disabled:opacity-60"><Sparkles className="h-3.5 w-3.5" />{t('node.adScriptReference.generateMidjourneyImage')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('video'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 disabled:opacity-60"><Video className="h-3.5 w-3.5" />{t('node.adScriptReference.generateVideo')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createStoryboardNode(); }} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 disabled:opacity-60"><Film className="h-3.5 w-3.5" />{t('node.adScriptReference.addStoryboardGen')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('jimengImage'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 disabled:opacity-60"><ImageIcon className="h-3.5 w-3.5" />{t('node.adScriptReference.generateJimengImage')}</button>
          <button type="button" disabled={selectedRows.length === 0} onClick={(event) => { event.stopPropagation(); createDownstreamNodes('jimengVideo'); }} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 disabled:opacity-60"><Video className="h-3.5 w-3.5" />{t('node.adScriptReference.generateJimengVideo')}</button>
        </div>

        <div
          className="nowheel mt-3 flex min-h-0 flex-1 flex-col gap-3"
          onWheelCapture={(event) => {
            event.stopPropagation();
          }}
        >
          {!linkedAdProjectId ? (
            <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark px-3 py-6 text-center text-xs text-text-muted">
              {t('node.adScriptReference.missingProjectLink')}
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border-dark/70 bg-bg-dark px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-emerald-200">
                      {selectedTemplateLabel || t('node.adScriptReference.templateFallback')}
                    </div>
                    <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-text-muted">
                      {linkedReference?.brief.normalizedBrief.trim() || t('node.adScriptReference.briefEmpty')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshSnapshot()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    {t('node.adScriptReference.refreshSelection')}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 px-1 text-xs">
                <span className="rounded-full bg-bg-dark px-2.5 py-1 text-text-muted">
                  {t('node.adScriptReference.selectedRows', { count: data.selectedRowIds.length })}
                </span>
                <button
                  type="button"
                  disabled={!canSelectAllRows}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleSelectAllRows();
                  }}
                  className="inline-flex items-center rounded-full border border-border-dark bg-bg-dark px-2.5 py-1 text-text-muted transition hover:border-emerald-400/25 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('project.selectAll')}
                </button>
                <button
                  type="button"
                  disabled={!canDeselectAllRows}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDeselectAllRows();
                  }}
                  className="inline-flex items-center rounded-full border border-border-dark bg-bg-dark px-2.5 py-1 text-text-muted transition hover:border-emerald-400/25 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t('project.deselectAll')}
                </button>
                {showWarningBadge ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-200">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    {t('node.adScriptReference.warning')}
                  </span>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 rounded-xl border border-border-dark/70 bg-bg-dark">
                {rows.length > 0 ? (
                  <UiScrollArea
                    className="nowheel h-full min-h-0"
                    viewportClassName="nowheel h-full"
                    contentClassName="space-y-3 px-3 py-3 pr-5"
                  >
                    {rows.map((row) => (
                      <AdScriptRowCard
                        key={row.id}
                        row={row}
                        selected={selectedIdSet.has(row.id)}
                        onToggleSelected={() => toggleRowSelection(row.id)}
                        t={t}
                      />
                    ))}
                  </UiScrollArea>
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-muted">
                    {t('node.adScriptReference.noRows')}
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

AdScriptReferenceNode.displayName = 'AdScriptReferenceNode';
