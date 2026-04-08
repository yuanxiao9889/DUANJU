import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type SyntheticEvent,
} from 'react';
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  useViewport,
  type NodeProps,
} from '@xyflow/react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  type UploadImageNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import {
  isNodeUsingDefaultDisplayName,
  resolveNodeDisplayName,
} from '@/features/canvas/domain/nodeDisplay';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  detectImageDimensions,
  prepareNodeImageFromFile,
  resolveImageDisplayUrl,
  shouldUseOriginalImageByZoom,
} from '@/features/canvas/application/imageData';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { ImageResolutionBadge } from '@/features/canvas/ui/ImageResolutionBadge';
import {
  NodeDescriptionPanel,
  NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT,
} from '@/features/canvas/ui/NodeDescriptionPanel';
import { resolveNodeStyleDimension } from '@/features/canvas/ui/nodeDimensionUtils';
import { useCanvasNodeById } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';

type UploadNodeProps = NodeProps & {
  id: string;
  data: UploadImageNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

function resolveDroppedImageFile(event: DragEvent<HTMLElement>): File | null {
  const directFile = event.dataTransfer.files?.[0];
  if (directFile) {
    return directFile;
  }

  const item = Array.from(event.dataTransfer.items || []).find(
    (candidate) => candidate.kind === 'file' && candidate.type.startsWith('image/')
  );
  return item?.getAsFile() ?? null;
}

export const UploadNode = memo(({ id, data, selected, width }: UploadNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const currentNode = useCanvasNodeById(id);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const isDescriptionPanelOpen = useCanvasStore(
    (state) => Boolean(state.nodeDescriptionPanelOpenById[id])
  );
  const isReferenceSourceHighlighted = useCanvasStore(
    (state) => state.highlightedReferenceSourceNodeId === id
  );
  const useUploadFilenameAsNodeTitle = useSettingsStore((state) => state.useUploadFilenameAsNodeTitle);
  const { zoom } = useViewport();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadSequenceRef = useRef(0);
  const uploadPerfRef = useRef<{
    sequence: number;
    name: string;
    size: number;
    startedAt: number;
    transientLoaded: boolean;
    stableLoaded: boolean;
  } | null>(null);
  const [transientPreviewUrl, setTransientPreviewUrl] = useState<string | null>(null);
  const resolvedAspectRatio = data.aspectRatio || '1:1';
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resolvedWidth = resolveNodeDimension(width, compactSize.width);
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeMinWidth = resizeConstraints.minWidth;
  const explicitHeight = resolveNodeStyleDimension(currentNode?.style?.height);
  const collapsedHeight = Math.max(explicitHeight ?? compactSize.height, resizeConstraints.minHeight);
  const resizeMinHeight = resizeConstraints.minHeight
    + (isDescriptionPanelOpen ? NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT : 0);
  const resolvedHeight = collapsedHeight
    + (isDescriptionPanelOpen ? NODE_DESCRIPTION_PANEL_EXPANDED_TOTAL_HEIGHT : 0);
  const imageWidth =
    typeof data.imageWidth === 'number' && Number.isFinite(data.imageWidth) && data.imageWidth > 0
      ? Math.round(data.imageWidth)
      : null;
  const imageHeight =
    typeof data.imageHeight === 'number' && Number.isFinite(data.imageHeight) && data.imageHeight > 0
      ? Math.round(data.imageHeight)
      : null;
  const resolvedTitle = useMemo(() => {
    const sourceFileName = typeof data.sourceFileName === 'string' ? data.sourceFileName.trim() : '';
    if (
      useUploadFilenameAsNodeTitle
      && sourceFileName
      && isNodeUsingDefaultDisplayName(CANVAS_NODE_TYPES.upload, data)
    ) {
      return sourceFileName;
    }

    return resolveNodeDisplayName(CANVAS_NODE_TYPES.upload, data);
  }, [data, useUploadFilenameAsNodeTitle]);

  const clearTransientPreview = useCallback(() => {
    setTransientPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      const sequence = uploadSequenceRef.current + 1;
      uploadSequenceRef.current = sequence;
      const started = performance.now();
      clearTransientPreview();
      const optimisticPreviewUrl = URL.createObjectURL(file);
      setTransientPreviewUrl(optimisticPreviewUrl);
      uploadPerfRef.current = {
        sequence,
        name: file.name,
        size: file.size,
        startedAt: started,
        transientLoaded: false,
        stableLoaded: false,
      };
      requestAnimationFrame(() => {
        const perf = uploadPerfRef.current;
        if (!perf || perf.sequence !== sequence) {
          return;
        }
        console.info(
          `[upload-perf][e2e] preview-state-committed nodeId=${id} name="${file.name}" elapsed=${Math.round(performance.now() - started)}ms`
        );
      });

      try {
        const prepared = await prepareNodeImageFromFile(file);
        const nextData: Partial<UploadImageNodeData> = {
          imageUrl: prepared.imageUrl,
          previewImageUrl: prepared.previewImageUrl,
          aspectRatio: prepared.aspectRatio || '1:1',
          imageWidth: undefined,
          imageHeight: undefined,
          sourceFileName: file.name,
        };
        if (useUploadFilenameAsNodeTitle) {
          nextData.displayName = file.name;
        }
        updateNodeData(id, nextData);

        console.info(
          `[upload-perf][node] processFile success nodeId=${id} name="${file.name}" size=${file.size}B elapsed=${Math.round(performance.now() - started)}ms`
        );
      } catch (error) {
        if (uploadSequenceRef.current === sequence) {
          clearTransientPreview();
        }
        console.error(
          `[upload-perf][node] processFile failed nodeId=${id} name="${file.name}" size=${file.size}B elapsed=${Math.round(performance.now() - started)}ms`,
          error
        );
        throw error;
      }
    },
    [clearTransientPreview, id, updateNodeData, useUploadFilenameAsNodeTitle]
  );

  const handleImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const perf = uploadPerfRef.current;
    if (!perf) {
      return;
    }

    const displayedSrc = event.currentTarget.currentSrc || event.currentTarget.src || '';
    const isTransient = displayedSrc.startsWith('blob:');
    const now = performance.now();

    if (isTransient && !perf.transientLoaded) {
      perf.transientLoaded = true;
      console.info(
        `[upload-perf][e2e] first-visible transient nodeId=${id} name="${perf.name}" size=${perf.size}B elapsed=${Math.round(now - perf.startedAt)}ms`
      );
      requestAnimationFrame(() => {
        const nextPerf = uploadPerfRef.current;
        if (!nextPerf || nextPerf.sequence !== perf.sequence) {
          return;
        }
        console.info(
          `[upload-perf][e2e] first-painted transient nodeId=${id} name="${nextPerf.name}" elapsed=${Math.round(performance.now() - nextPerf.startedAt)}ms`
        );
      });
      return;
    }

    if (!isTransient && !perf.stableLoaded) {
      perf.stableLoaded = true;
      console.info(
        `[upload-perf][e2e] stable-visible nodeId=${id} name="${perf.name}" size=${perf.size}B elapsed=${Math.round(now - perf.startedAt)}ms`
      );
      if (uploadSequenceRef.current === perf.sequence) {
        clearTransientPreview();
      }
      requestAnimationFrame(() => {
        const nextPerf = uploadPerfRef.current;
        if (!nextPerf || nextPerf.sequence !== perf.sequence) {
          return;
        }
        console.info(
          `[upload-perf][e2e] stable-painted nodeId=${id} name="${nextPerf.name}" elapsed=${Math.round(performance.now() - nextPerf.startedAt)}ms`
        );
      });
    }
  }, [clearTransientPreview, id]);

  const handleDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const file = resolveDroppedImageFile(event);
      if (!file || !file.type.startsWith('image/')) {
        return;
      }

      await processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !file.type.startsWith('image/')) {
        return;
      }

      await processFile(file);
      event.target.value = '';
    },
    [processFile]
  );

  useEffect(() => {
    return canvasEventBus.subscribe('upload-node/reupload', ({ nodeId }) => {
      if (nodeId !== id) {
        return;
      }
      inputRef.current?.click();
    });
  }, [id]);

  useEffect(() => {
    return canvasEventBus.subscribe('upload-node/paste-image', ({ nodeId, file }) => {
      if (nodeId !== id || !file.type.startsWith('image/')) {
        return;
      }
      void processFile(file);
    });
  }, [id, processFile]);

  const handleNodeClick = useCallback(() => {
    setSelectedNode(id);
    if (!data.imageUrl && !data.previewImageUrl && !transientPreviewUrl) {
      inputRef.current?.click();
    }
  }, [data.imageUrl, data.previewImageUrl, id, setSelectedNode, transientPreviewUrl]);

  useEffect(() => () => {
    uploadPerfRef.current = null;
    clearTransientPreview();
  }, [clearTransientPreview]);

  const originalImageUrl = useMemo(() => {
    if (!data.imageUrl) {
      return null;
    }

    return resolveImageDisplayUrl(data.imageUrl);
  }, [data.imageUrl]);

  const previewImageUrl = useMemo(() => {
    if (!data.previewImageUrl) {
      return null;
    }

    return resolveImageDisplayUrl(data.previewImageUrl);
  }, [data.previewImageUrl]);

  const persistedImageSource = useMemo(() => {
    const preferOriginal = shouldUseOriginalImageByZoom(zoom);
    return preferOriginal
      ? (originalImageUrl ?? previewImageUrl)
      : (previewImageUrl ?? originalImageUrl);
  }, [originalImageUrl, previewImageUrl, zoom]);

  const imageSource = useMemo(
    () => transientPreviewUrl ?? persistedImageSource,
    [persistedImageSource, transientPreviewUrl]
  );

  const fallbackImageSource = useMemo(() => {
    if (transientPreviewUrl) {
      return persistedImageSource;
    }

    if (!imageSource) {
      return null;
    }

    if (imageSource === originalImageUrl) {
      return previewImageUrl && previewImageUrl !== imageSource ? previewImageUrl : null;
    }

    return originalImageUrl && originalImageUrl !== imageSource ? originalImageUrl : null;
  }, [
    imageSource,
    originalImageUrl,
    persistedImageSource,
    previewImageUrl,
    transientPreviewUrl,
  ]);
  const nodeDescription =
    typeof data.nodeDescription === 'string' ? data.nodeDescription : '';

  const dimensionSource = data.imageUrl ?? data.previewImageUrl ?? null;

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    if (!dimensionSource || (imageWidth !== null && imageHeight !== null)) {
      return;
    }

    let disposed = false;

    void detectImageDimensions(dimensionSource)
      .then((dimensions) => {
        if (disposed) {
          return;
        }

        updateNodeData(id, {
          imageWidth: dimensions.width,
          imageHeight: dimensions.height,
        });
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, [dimensionSource, id, imageHeight, imageWidth, updateNodeData]);

  return (
      <div
        className={`
        group relative flex flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-all duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]'
          : isReferenceSourceHighlighted
            ? 'border-accent/80 shadow-[0_0_0_2px_rgba(59,130,246,0.28),0_4px_18px_rgba(59,130,246,0.12)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={handleNodeClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Upload className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      {data.imageUrl || data.previewImageUrl || transientPreviewUrl ? (
        <div
          className="relative block min-h-0 flex-1 overflow-hidden rounded-[var(--node-radius)] bg-bg-dark"
        >
          <CanvasNodeImage
            src={imageSource ?? ''}
            fallbackSrc={fallbackImageSource}
            viewerSourceUrl={originalImageUrl ?? previewImageUrl}
            alt={t('node.upload.uploadedAlt')}
            className="h-full w-full object-contain"
            onLoad={handleImageLoad}
          />
          <ImageResolutionBadge width={imageWidth} height={imageHeight} />
        </div>
      ) : (
        <label
          className="block min-h-0 flex-1 overflow-hidden rounded-[var(--node-radius)] bg-bg-dark"
        >
          <div className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 text-text-muted/85">
            <Upload className="h-7 w-7 opacity-60" />
            <span className="px-3 text-center text-[12px] leading-6">{t('node.upload.hint')}</span>
          </div>
        </label>
      )}
      <NodeDescriptionPanel
        isOpen={isDescriptionPanelOpen}
        value={nodeDescription}
        placeholder={t('nodeToolbar.descriptionPlaceholder')}
        onChange={(value) => updateNodeData(id, { nodeDescription: value })}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={resizeMinWidth}
        minHeight={resizeMinHeight}
        maxWidth={1400}
        maxHeight={1400}
        isVisible={selected}
      />
    </div>
  );
});

UploadNode.displayName = 'UploadNode';
