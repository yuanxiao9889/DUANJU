import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Download, Scissors, SquareArrowOutUpRight } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import { join } from '@tauri-apps/api/path';
import { useTranslation } from 'react-i18next';

import { saveImageSourceToDirectory } from '@/commands/image';
import { UiButton } from '@/components/ui';
import {
  CANVAS_NODE_TYPES,
  type StoryboardFrameItem,
  type StoryboardSplitResultNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName, EXPORT_RESULT_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NODE_CONTROL_ICON_CLASS, NODE_CONTROL_PRIMARY_BUTTON_CLASS } from '@/features/canvas/ui/nodeControlStyles';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { prepareNodeImage, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';

type StoryboardSplitResultNodeProps = NodeProps & {
  id: string;
  data: StoryboardSplitResultNodeData;
  selected?: boolean;
};

const STORYBOARD_NODE_WIDTH_PX = 620;
const STORYBOARD_NODE_MIN_WIDTH_PX = 620;
const STORYBOARD_NODE_MIN_HEIGHT_PX = 360;
const STORYBOARD_GRID_GAP_PX = 1;
const STORYBOARD_NODE_WIDTH_PADDING_PX = 200;
const STORYBOARD_NODE_HEIGHT_PADDING_PX = 160;
const STORYBOARD_NODE_COL_WIDTH_PX = 136;
const STORYBOARD_NODE_ROW_HEIGHT_PX = 92;

function SplitResultIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 0c1.66 0 3 1.34 3 3v3l2.4-1.5a3.003 3.003 0 0 1 3 5.2a3.003 3.003 0 0 1-4.452-2.051l-.952.55v6.8h-2v-5.65l-4.01 2.32l-.988-1.73l5-2.94v-1.17a2.996 2.996 0 0 1-4-2.829c0-1.66 1.34-3 3-3zM9 3a1 1 0 0 0 2 0a1 1 0 0 0-2 0m7 4a1 1 0 0 0 2 0a1 1 0 0 0-2 0M2.97 19h2v-2h-2V9h3V7h-3c-1.1 0-2 .895-2 2v8c0 1.1.895 2 2 2m6 0h-2v-2h2zm4-2c0 1.1-.895 2-2 2v-2z" />
    </svg>
  );
}

function resolveStoryboardNodeDefaultSize(rows: number, cols: number): { width: number; height: number } {
  const safeRows = Math.max(1, Math.floor(rows));
  const safeCols = Math.max(1, Math.floor(cols));

  return {
    width: Math.max(
      STORYBOARD_NODE_WIDTH_PX,
      STORYBOARD_NODE_WIDTH_PADDING_PX + safeCols * STORYBOARD_NODE_COL_WIDTH_PX
    ),
    height: Math.max(
      STORYBOARD_NODE_MIN_HEIGHT_PX,
      STORYBOARD_NODE_HEIGHT_PADDING_PX + safeRows * STORYBOARD_NODE_ROW_HEIGHT_PX
    ),
  };
}

function toCssAspectRatio(aspectRatio: string): string {
  const [rawWidth = '1', rawHeight = '1'] = aspectRatio.split(':');
  const width = Number(rawWidth);
  const height = Number(rawHeight);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1 / 1';
  }

  return `${width} / ${height}`;
}

function sanitizePathSegment(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return fallback;
  }

  const sanitized = Array.from(trimmed)
    .filter((ch) => !/[<>:"/\\|?*]/.test(ch) && ch >= ' ')
    .join('')
    .trim()
    .replace(/\.+$/g, '');

  return sanitized || fallback;
}

function sanitizeExportLabel(raw: string, maxLength = 50): string {
  const compact = sanitizePathSegment(raw, '').replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }
  return compact.slice(0, maxLength);
}

function SplitResultFrameCard({
  frame,
  index,
  frameAspectRatioCss,
  viewerImageList,
  label,
  editLabel,
  onEditFrame,
}: {
  frame: StoryboardFrameItem;
  index: number;
  frameAspectRatioCss: string;
  viewerImageList: string[];
  label: string;
  editLabel: string;
  onEditFrame: (frame: StoryboardFrameItem, index: number) => void;
}) {
  const source = frame.imageUrl || frame.previewImageUrl;
  const displaySource = source ? resolveImageDisplayUrl(frame.previewImageUrl || frame.imageUrl || source) : null;
  const viewerSource = source ? resolveImageDisplayUrl(source) : null;
  const noteText = frame.note?.trim() || label;

  return (
    <div className="relative bg-bg-dark/85">
      <div className="group/frame relative overflow-hidden bg-surface-dark" style={{ aspectRatio: frameAspectRatioCss }}>
        {displaySource && viewerSource ? (
          <CanvasNodeImage
            src={displaySource}
            alt={label}
            viewerSourceUrl={viewerSource}
            viewerImageList={viewerImageList}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5 text-[11px] text-text-muted">
            {label}
          </div>
        )}
        {source ? (
          <button
            type="button"
            className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white opacity-0 transition-all duration-150 hover:bg-black/75 group-hover/frame:opacity-100"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onEditFrame(frame, index);
            }}
            title={editLabel}
          >
            <SquareArrowOutUpRight className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <div className="min-h-10 border-t border-[rgba(255,255,255,0.12)] bg-bg-dark/90 px-1.5 py-1 text-[11px] text-text-dark">
        <div className="line-clamp-2 break-words text-text-muted/90">{noteText}</div>
      </div>
      <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
        {index + 1}
      </div>
    </div>
  );
}

export const StoryboardSplitResultNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: StoryboardSplitResultNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addStoryboardSplitFrameExportNodes = useCanvasStore(
    (state) => state.addStoryboardSplitFrameExportNodes
  );
  const addEdge = useCanvasStore((state) => state.addEdge);
  const currentProjectName = useProjectStore((state) => state.currentProject?.name);
  const downloadPresetPaths = useSettingsStore((state) => state.downloadPresetPaths);

  const [isExportingFrames, setIsExportingFrames] = useState(false);
  const [isSeparatingFrames, setIsSeparatingFrames] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const orderedFrames = useMemo(
    () => [...data.frames].sort((a, b) => a.order - b.order),
    [data.frames]
  );
  const frameAspectRatio = useMemo(
    () =>
      data.frameAspectRatio
      ?? orderedFrames.find((frame) => typeof frame.aspectRatio === 'string')?.aspectRatio
      ?? '1:1',
    [data.frameAspectRatio, orderedFrames]
  );
  const frameAspectRatioCss = useMemo(() => toCssAspectRatio(frameAspectRatio), [frameAspectRatio]);

  const gridCols = Math.max(1, data.gridCols);
  const gridRows = Math.max(1, data.gridRows);
  const totalFrames = orderedFrames.length;
  const totalGridSlots = Math.max(1, gridRows * gridCols);
  const emptyFrameSlotCount = Math.max(0, totalGridSlots - totalFrames);
  const defaultNodeSize = useMemo(
    () => resolveStoryboardNodeDefaultSize(gridRows, gridCols),
    [gridCols, gridRows]
  );
  const resolvedNodeWidth = Math.max(
    STORYBOARD_NODE_MIN_WIDTH_PX,
    Math.round(width ?? defaultNodeSize.width)
  );
  const resolvedNodeHeight = Math.max(
    STORYBOARD_NODE_MIN_HEIGHT_PX,
    Math.round(height ?? defaultNodeSize.height)
  );

  const viewerImageList = useMemo(
    () =>
      orderedFrames
        .map((frame) => frame.imageUrl || frame.previewImageUrl)
        .filter((item): item is string => Boolean(item))
        .map((item) => resolveImageDisplayUrl(item)),
    [orderedFrames]
  );

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedNodeHeight, resolvedNodeWidth, updateNodeInternals]);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.storyboardSplitResult, data),
    [data]
  );

  const resolveExportRootDir = useCallback(async (): Promise<string | null> => {
    const presetPath = downloadPresetPaths.find((path) => path.trim().length > 0)?.trim() ?? '';
    if (presetPath) {
      return presetPath;
    }

    const selectedDir = await open({
      directory: true,
      multiple: false,
      title: t('node.storyboardSplitResult.selectExportDir'),
    });
    return typeof selectedDir === 'string' && selectedDir.trim().length > 0 ? selectedDir : null;
  }, [downloadPresetPaths, t]);

  const handleExportFrames = useCallback(async () => {
    if (isExportingFrames) {
      return;
    }

    const frameEntries = orderedFrames
      .map((frame, index) => ({
        source: frame.imageUrl ?? frame.previewImageUrl ?? '',
        index,
        note: frame.note ?? '',
      }))
      .filter((item) => item.source.length > 0);

    if (frameEntries.length === 0) {
      setExportError(t('node.storyboardSplitResult.exportEmpty'));
      return;
    }

    setExportError(null);
    setIsExportingFrames(true);
    try {
      const rootDir = await resolveExportRootDir();
      if (!rootDir) {
        return;
      }

      const projectName = sanitizePathSegment(currentProjectName ?? '', t('node.storyboardSplitResult.defaultProjectName'));
      const outputDir = await join(rootDir, projectName);
      const baseFileName = sanitizeExportLabel(projectName, 40) || t('node.storyboardSplitResult.defaultProjectName');
      let firstSavedFilePath = '';

      for (const item of frameEntries) {
        const frameNo = String(item.index + 1).padStart(2, '0');
        const noteLabel = sanitizeExportLabel(item.note, 60);
        const fileStem = noteLabel
          ? `${baseFileName}_${frameNo}_${noteLabel}`
          : `${baseFileName}_${frameNo}`;
        const savedPath = await saveImageSourceToDirectory(item.source, outputDir, fileStem);
        if (!firstSavedFilePath) {
          firstSavedFilePath = savedPath;
        }
      }

      if (firstSavedFilePath) {
        await revealItemInDir(firstSavedFilePath);
      } else {
        await openPath(outputDir);
      }
    } catch (error) {
      setExportError(
        error instanceof Error && error.message.trim()
          ? error.message
          : t('node.storyboardSplitResult.exportFailed')
      );
    } finally {
      setIsExportingFrames(false);
    }
  }, [currentProjectName, isExportingFrames, orderedFrames, resolveExportRootDir, t]);

  const handleEditFrame = useCallback(async (frame: StoryboardFrameItem, index: number) => {
    try {
      const sourceImage = frame.imageUrl ?? frame.previewImageUrl;
      if (!sourceImage) {
        setExportError(t('node.storyboardSplitResult.editEmpty'));
        return;
      }

      const frameTitle = t('node.storyboardNode.frameIndex', { index: index + 1 })
        || EXPORT_RESULT_DISPLAY_NAME.storyboardFrameEdit;
      const prepared = await prepareNodeImage(sourceImage);
      const createdNodeId = addDerivedExportNode(
        id,
        prepared.imageUrl,
        prepared.aspectRatio,
        prepared.previewImageUrl,
        {
          defaultTitle: frameTitle,
          resultKind: 'storyboardFrameEdit',
        }
      );

      if (createdNodeId) {
        addEdge(id, createdNodeId);
      }
    } catch (error) {
      setExportError(
        error instanceof Error && error.message.trim()
          ? error.message
          : t('node.storyboardSplitResult.editFailed')
      );
    }
  }, [addDerivedExportNode, addEdge, id, t]);

  const handleSeparateAllFrames = useCallback(async () => {
    if (isSeparatingFrames) {
      return;
    }

    const frameEntries = orderedFrames
      .map((frame, index) => ({
        sourceImage: frame.imageUrl ?? frame.previewImageUrl ?? '',
        title: t('node.storyboardNode.frameIndex', { index: index + 1 }),
      }))
      .filter((frame): frame is { sourceImage: string; title: string } => frame.sourceImage.length > 0);

    if (frameEntries.length === 0) {
      setExportError(t('node.storyboardSplitResult.editEmpty'));
      return;
    }

    setExportError(null);
    setIsSeparatingFrames(true);
    try {
      const preparedFrames = await Promise.all(
        frameEntries.map(async (frame) => {
          const prepared = await prepareNodeImage(frame.sourceImage);
          return {
            imageUrl: prepared.imageUrl,
            previewImageUrl: prepared.previewImageUrl,
            aspectRatio: prepared.aspectRatio,
            title: frame.title,
          };
        })
      );

      addStoryboardSplitFrameExportNodes(id, preparedFrames, {
        gridCols,
      });
    } catch (error) {
      setExportError(
        error instanceof Error && error.message.trim()
          ? error.message
          : t('node.storyboardSplitResult.separateAllFailed')
      );
    } finally {
      setIsSeparatingFrames(false);
    }
  }, [addStoryboardSplitFrameExportNodes, gridCols, id, isSeparatingFrames, orderedFrames, t]);

  return (
    <div
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: `${resolvedNodeWidth}px`, height: `${resolvedNodeHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<SplitResultIcon className="h-3.5 w-3.5" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="ui-scrollbar nowheel min-h-0 flex-1 overflow-auto" onWheelCapture={(event) => event.stopPropagation()}>
        <div
          className="grid overflow-hidden rounded-lg border border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.14)]"
          style={{
            gap: `${STORYBOARD_GRID_GAP_PX}px`,
            gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
          }}
        >
          {orderedFrames.map((frame, index) => (
            <SplitResultFrameCard
              key={frame.id}
              frame={frame}
              index={index}
              frameAspectRatioCss={frameAspectRatioCss}
              viewerImageList={viewerImageList}
              label={t('node.storyboardNode.frameIndex', { index: index + 1 })}
              editLabel={t('node.storyboardSplitResult.editFrame')}
              onEditFrame={handleEditFrame}
            />
          ))}
          {Array.from({ length: emptyFrameSlotCount }, (_, index) => (
            <div key={`split-result-empty-${index}`} className="bg-bg-dark/70">
              <div
                className="flex items-center justify-center border border-dashed border-[rgba(255,255,255,0.14)] bg-[rgba(255,255,255,0.03)]"
                style={{ aspectRatio: frameAspectRatioCss }}
              >
                <span className="text-[10px] text-text-muted/65">{t('node.storyboardNode.emptySlot')}</span>
              </div>
              <div className="h-10 border-t border-[rgba(255,255,255,0.08)] bg-bg-dark/80" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="truncate text-[11px] text-text-muted/80">
          {t('node.storyboardNode.layoutSummary', {
            rows: gridRows,
            cols: gridCols,
            count: totalFrames,
            capacity: totalGridSlots,
          })}
        </div>
        <div className="flex items-center gap-2">
          <UiButton
            size="sm"
            variant="ghost"
            className={`nodrag ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              void handleSeparateAllFrames();
            }}
            disabled={isSeparatingFrames}
          >
            <Scissors className={NODE_CONTROL_ICON_CLASS} />
            {isSeparatingFrames
              ? t('node.storyboardSplitResult.separatingAll')
              : t('node.storyboardSplitResult.separateAll')}
          </UiButton>
          <UiButton
            size="sm"
            variant="primary"
            className={`nodrag ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
            onClick={(event) => {
              event.stopPropagation();
              void handleExportFrames();
            }}
            disabled={isExportingFrames}
          >
            <Download className={NODE_CONTROL_ICON_CLASS} />
            {isExportingFrames
              ? t('node.storyboardSplitResult.exportingFrames')
              : t('node.storyboardSplitResult.exportFrames')}
          </UiButton>
        </div>
      </div>

      {exportError ? (
        <div className="mt-2 text-xs text-rose-300">{exportError}</div>
      ) : null}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle minWidth={STORYBOARD_NODE_MIN_WIDTH_PX} minHeight={STORYBOARD_NODE_MIN_HEIGHT_PX} />
    </div>
  );
});

StoryboardSplitResultNode.displayName = 'StoryboardSplitResultNode';
