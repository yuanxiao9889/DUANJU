import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  Globe2,
  Loader2,
  Move3d,
  ScanSearch,
  SquareArrowOutUpRight,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput } from '@/components/ui';
import { renderPanoramaPerspective, type PanoramaImageDataSource } from '@/features/canvas/application/panoramaProjection';
import { flushCurrentProjectToDiskSafely } from '@/features/canvas/application/projectPersistence';
import {
  resolveErrorContent,
  showErrorDialog,
} from '@/features/canvas/application/errorDialog';
import { loadImageElement, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import {
  CANVAS_NODE_TYPES,
  PANORAMA_RESULT_NODE_DEFAULT_HEIGHT,
  PANORAMA_RESULT_NODE_DEFAULT_WIDTH,
  PANORAMA_RESULT_NODE_MIN_HEIGHT,
  PANORAMA_RESULT_NODE_MIN_WIDTH,
  type PanoramaResultNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasNodeById } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { resolveNodeStyleDimension } from '@/features/canvas/ui/nodeDimensionUtils';
import {
  extractPanoramaPerspectiveView,
  resolvePanoramaExtensionState,
} from '@/features/extensions/application/panoramaRuntime';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExtensionsStore } from '@/stores/extensionsStore';

type PanoramaResultNodeProps = NodeProps & {
  id: string;
  data: PanoramaResultNodeData;
  selected?: boolean;
};

function formatTimestamp(timestamp: number | null | undefined, locale: string): string | null {
  if (
    typeof timestamp !== 'number'
    || !Number.isFinite(timestamp)
    || timestamp <= 0
  ) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function clampNumber(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

export const PanoramaResultNode = memo(({
  id,
  data,
  selected,
  width,
}: PanoramaResultNodeProps) => {
  const { t, i18n } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const currentNode = useCanvasNodeById(id);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const openImageViewer = useCanvasStore((state) => state.openImageViewer);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const extensionPackages = useExtensionsStore((state) => state.packages);
  const enabledExtensionIds = useExtensionsStore((state) => state.enabledExtensionIds);
  const runtimeById = useExtensionsStore((state) => state.runtimeById);

  const extensionState = useMemo(
    () => resolvePanoramaExtensionState(extensionPackages, enabledExtensionIds, runtimeById),
    [enabledExtensionIds, extensionPackages, runtimeById]
  );
  const readyExtensionPackage = extensionState.readyPackage;
  const extensionRuntime = extensionState.runtime;
  const extensionRuntimeError = extensionRuntime?.status === 'error'
    ? extensionRuntime.error?.trim() || null
    : null;
  const hasImage = Boolean(data.imageUrl || data.previewImageUrl);
  const lastGeneratedTime = useMemo(
    () => formatTimestamp(data.lastGeneratedAt ?? null, i18n.language),
    [data.lastGeneratedAt, i18n.language]
  );
  const resolvedWidth = Math.max(
    PANORAMA_RESULT_NODE_MIN_WIDTH,
    Math.round(width ?? PANORAMA_RESULT_NODE_DEFAULT_WIDTH)
  );
  const explicitHeight = resolveNodeStyleDimension(currentNode?.style?.height);
  const resolvedHeight = Math.max(
    explicitHeight ?? PANORAMA_RESULT_NODE_DEFAULT_HEIGHT,
    PANORAMA_RESULT_NODE_MIN_HEIGHT
  );
  const yaw = clampNumber(data.perspectiveYaw ?? 0, 0, -180, 180);
  const pitch = clampNumber(data.perspectivePitch ?? 0, 0, -89, 89);
  const fov = clampNumber(data.perspectiveFov ?? 90, 90, 30, 120);
  const perspectiveWidth = clampNumber(data.perspectiveWidth ?? 1280, 1280, 256, 4096);
  const perspectiveHeight = clampNumber(data.perspectiveHeight ?? 720, 720, 256, 4096);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startYaw: number;
    startPitch: number;
  } | null>(null);
  const [sourceImageData, setSourceImageData] = useState<PanoramaImageDataSource | null>(null);
  const [previewAngles, setPreviewAngles] = useState(() => ({ yaw, pitch }));

  useEffect(() => {
    setPreviewAngles({ yaw, pitch });
  }, [pitch, yaw]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, selected, updateNodeInternals]);

  useEffect(() => {
    const sourceImage = data.imageUrl ?? data.previewImageUrl ?? null;
    if (!sourceImage) {
      setSourceImageData(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const image = await loadImageElement(sourceImage);
        if (cancelled) {
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        if (cancelled) {
          return;
        }

        setSourceImageData({
          width: canvas.width,
          height: canvas.height,
          data: imageData.data,
        });
      } catch {
        if (!cancelled) {
          setSourceImageData(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data.imageUrl, data.previewImageUrl]);

  useEffect(() => {
    if (!sourceImageData || !previewCanvasRef.current || !previewHostRef.current) {
      return;
    }

    const host = previewHostRef.current;
    const canvas = previewCanvasRef.current;
    const hostWidth = Math.max(1, Math.round(host.clientWidth));
    const hostHeight = Math.max(1, Math.round(host.clientHeight));
    if (canvas.width !== hostWidth || canvas.height !== hostHeight) {
      canvas.width = hostWidth;
      canvas.height = hostHeight;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const imageData = renderPanoramaPerspective(sourceImageData, {
        yaw: previewAngles.yaw,
        pitch: previewAngles.pitch,
        fov,
        targetWidth: hostWidth,
        targetHeight: hostHeight,
      });
      context.putImageData(imageData, 0, 0);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [fov, previewAngles.pitch, previewAngles.yaw, sourceImageData]);

  const setField = useCallback((patch: Partial<PanoramaResultNodeData>) => {
    updateNodeData(id, patch, { historyMode: 'skip' });
  }, [id, updateNodeData]);

  const handleCreateDerivedNode = useCallback((imageUrl: string, previewImageUrl?: string | null) => {
    const createdNodeId = addDerivedExportNode(
      id,
      imageUrl,
      '16:9',
      previewImageUrl ?? undefined,
      {
        defaultTitle: t('node.panoramaResult.perspectiveNodeTitle'),
      }
    );
    if (createdNodeId) {
      addEdge(id, createdNodeId);
    }
  }, [addDerivedExportNode, addEdge, id, t]);

  const handleExportPanorama = useCallback(() => {
    const sourceImage = data.imageUrl ?? data.previewImageUrl ?? null;
    if (!sourceImage) {
      return;
    }

    const createdNodeId = addDerivedExportNode(
      id,
      sourceImage,
      data.aspectRatio || '2:1',
      data.previewImageUrl ?? sourceImage,
      {
        defaultTitle: t('node.panoramaResult.exportNodeTitle'),
      }
    );
    if (createdNodeId) {
      addEdge(id, createdNodeId);
    }
  }, [addDerivedExportNode, addEdge, data.aspectRatio, data.imageUrl, data.previewImageUrl, id, t]);

  const handleExtractPerspective = useCallback(async () => {
    if (!readyExtensionPackage) {
      const message = extensionRuntimeError ?? t('node.panoramaResult.extensionDisabled');
      setField({ lastError: message });
      return;
    }

    const panoramaImage = data.imageUrl ?? data.previewImageUrl ?? null;
    if (!panoramaImage) {
      const message = t('node.panoramaResult.imageRequired');
      setField({ lastError: message });
      await showErrorDialog(message, t('common.error'));
      return;
    }

    setField({
      isGenerating: true,
      generationStartedAt: Date.now(),
      lastError: null,
    });

    try {
      const generated = await extractPanoramaPerspectiveView(readyExtensionPackage, {
        panoramaImagePath: panoramaImage,
        yaw,
        pitch,
        fov,
        width: Math.round(perspectiveWidth),
        height: Math.round(perspectiveHeight),
      });
      handleCreateDerivedNode(generated.imageUrl, generated.previewImageUrl);
      setField({
        isGenerating: false,
        generationStartedAt: null,
        lastError: null,
      });
      await flushCurrentProjectToDiskSafely('saving panorama perspective export');
    } catch (error) {
      const content = resolveErrorContent(error, t('node.panoramaResult.extractFailed'));
      setField({
        isGenerating: false,
        generationStartedAt: null,
        lastError: content.message,
      });
      await showErrorDialog(content.message, t('common.error'), content.details);
    }
  }, [
    data.imageUrl,
    data.previewImageUrl,
    fov,
    handleCreateDerivedNode,
    perspectiveHeight,
    perspectiveWidth,
    pitch,
    extensionRuntimeError,
    readyExtensionPackage,
    setField,
    t,
    yaw,
  ]);

  const handlePreviewPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sourceImageData) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startYaw: previewAngles.yaw,
      startPitch: previewAngles.pitch,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [previewAngles.pitch, previewAngles.yaw, sourceImageData]);

  const handlePreviewPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    setPreviewAngles({
      yaw: clampNumber(dragState.startYaw + deltaX * 0.22, 0, -180, 180),
      pitch: clampNumber(dragState.startPitch - deltaY * 0.18, 0, -89, 89),
    });
  }, []);

  const handlePreviewPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setField({
      perspectiveYaw: previewAngles.yaw,
      perspectivePitch: previewAngles.pitch,
    });
  }, [previewAngles.pitch, previewAngles.yaw, setField]);

  const handleOpenFullPanorama = useCallback(() => {
    const source = resolveImageDisplayUrl(data.imageUrl ?? data.previewImageUrl ?? '');
    if (!source) {
      return;
    }
    openImageViewer(source, [source]);
  }, [data.imageUrl, data.previewImageUrl, openImageViewer]);

  return (
    <div
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{
        width: resolvedWidth,
        minHeight: PANORAMA_RESULT_NODE_MIN_HEIGHT,
        height: resolvedHeight,
      }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Globe2 className="h-4 w-4" />}
        titleText={resolveNodeDisplayName(CANVAS_NODE_TYPES.panoramaResult, data)}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
        rightSlot={(
          data.lastError ? (
            <NodeStatusBadge
              icon={<TriangleAlert className="h-3.5 w-3.5" />}
              label={t('node.panoramaResult.errorShort')}
              tone="danger"
              title={data.lastError}
            />
          ) : data.isGenerating ? (
            <NodeStatusBadge
              icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
              label={t('node.panoramaResult.processingShort')}
              tone="processing"
            />
          ) : lastGeneratedTime ? (
            <NodeStatusBadge
              icon={<Globe2 className="h-3.5 w-3.5" />}
              label={t('node.panoramaResult.readyShort')}
              tone="processing"
              title={t('node.panoramaResult.generatedAt', { time: lastGeneratedTime })}
            />
          ) : null
        )}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 pt-8">
        <div
          ref={previewHostRef}
          className="relative min-h-[180px] flex-1 overflow-hidden rounded-lg border border-white/10 bg-black/30"
          onPointerDown={handlePreviewPointerDown}
          onPointerMove={handlePreviewPointerMove}
          onPointerUp={handlePreviewPointerUp}
          onPointerCancel={handlePreviewPointerUp}
        >
          {hasImage && sourceImageData ? (
            <>
              <canvas
                ref={previewCanvasRef}
                className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
              />
              <button
                type="button"
                className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] font-medium text-white/80 transition-colors hover:bg-black/75"
                onClick={(event) => {
                  event.stopPropagation();
                  handleOpenFullPanorama();
                }}
              >
                <SquareArrowOutUpRight className="h-3 w-3" />
                {t('node.panoramaResult.openFull')}
              </button>
            </>
          ) : hasImage ? (
            <CanvasNodeImage
              src={resolveImageDisplayUrl(data.previewImageUrl ?? data.imageUrl ?? '')}
              viewerSourceUrl={resolveImageDisplayUrl(data.imageUrl ?? data.previewImageUrl ?? '')}
              className="h-full w-full object-contain"
              alt={t('node.panoramaResult.previewAlt')}
              draggable={false}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs leading-5 text-white/60">
              {data.isGenerating
                ? t('node.panoramaResult.generatingHint')
                : t('node.panoramaResult.emptyHint')}
            </div>
          )}
          <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-white/80">
            2:1 Equirect
          </div>
          {hasImage ? (
            <div className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-white/80">
              <Move3d className="h-3 w-3" />
              {t('node.panoramaResult.dragHint')}
            </div>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/70">
              {t('node.panoramaResult.yaw')}
            </label>
            <UiInput
              type="number"
              value={String(yaw)}
              onChange={(event) => setField({
                perspectiveYaw: Number(event.currentTarget.value),
              })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/70">
              {t('node.panoramaResult.pitch')}
            </label>
            <UiInput
              type="number"
              value={String(pitch)}
              onChange={(event) => setField({
                perspectivePitch: Number(event.currentTarget.value),
              })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/70">
              {t('node.panoramaResult.fov')}
            </label>
            <UiInput
              type="number"
              value={String(fov)}
              onChange={(event) => setField({
                perspectiveFov: Number(event.currentTarget.value),
              })}
            />
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/70">
              {t('node.panoramaResult.viewWidth')}
            </label>
            <UiInput
              type="number"
              value={String(Math.round(perspectiveWidth))}
              onChange={(event) => setField({
                perspectiveWidth: Number(event.currentTarget.value),
              })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-white/70">
              {t('node.panoramaResult.viewHeight')}
            </label>
            <UiInput
              type="number"
              value={String(Math.round(perspectiveHeight))}
              onChange={(event) => setField({
                perspectiveHeight: Number(event.currentTarget.value),
              })}
            />
          </div>
        </div>

        {data.lastError ? (
          <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] leading-4 text-red-100">
            {data.lastError}
          </div>
        ) : extensionRuntimeError ? (
          <div className="rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] leading-4 text-red-100">
            {extensionRuntimeError}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <UiButton
            type="button"
            onClick={() => {
              void handleExtractPerspective();
            }}
            className="nodrag h-10 rounded-lg"
            disabled={data.isGenerating || !hasImage}
          >
            <ScanSearch className="mr-2 h-4 w-4" />
            {t('node.panoramaResult.extractPerspective')}
          </UiButton>
          <UiButton
            type="button"
            variant="muted"
            onClick={handleExportPanorama}
            className="nodrag h-10 rounded-lg"
            disabled={!hasImage}
          >
            <SquareArrowOutUpRight className="mr-2 h-4 w-4" />
            {t('node.panoramaResult.exportPanorama')}
          </UiButton>
        </div>
      </div>

      <NodeResizeHandle minWidth={PANORAMA_RESULT_NODE_MIN_WIDTH} minHeight={PANORAMA_RESULT_NODE_MIN_HEIGHT} />

      <Handle
        type="target"
        position={Position.Left}
        id="target"
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="source"
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />
    </div>
  );
});

PanoramaResultNode.displayName = 'PanoramaResultNode';
