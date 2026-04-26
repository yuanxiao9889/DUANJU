import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react';
import { Handle, Position, useUpdateNodeInternals, useViewport, type NodeProps } from '@xyflow/react';
import { Download, LayoutGrid, X } from 'lucide-react';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text as KonvaText, Transformer } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type Konva from 'konva';
import { useTranslation } from 'react-i18next';

import { UiButton, UiChipButton, UiSelect } from '@/components/ui';
import {
  canvasToDataUrl,
  loadImageElement,
  parseAspectRatio,
  prepareNodeImage,
  resolveImageDisplayUrl,
} from '@/features/canvas/application/imageData';
import {
  CANVAS_NODE_TYPES,
  IMAGE_ASPECT_RATIOS,
  IMAGE_COLLAGE_NODE_DEFAULT_HEIGHT,
  IMAGE_COLLAGE_NODE_DEFAULT_WIDTH,
  IMAGE_COLLAGE_NODE_MIN_HEIGHT,
  IMAGE_COLLAGE_NODE_MIN_WIDTH,
  IMAGE_SIZES,
  type ImageCollageLayerItem,
  type ImageCollageNodeData,
  normalizeImageCollageNodeData,
  resolveSingleImageConnectionSource,
} from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME, resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasIncomingSourceNodes } from '@/features/canvas/hooks/useCanvasNodeGraph';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';

type ImageCollageNodeProps = NodeProps & {
  id: string;
  data: ImageCollageNodeData;
  selected?: boolean;
};

interface StageViewport {
  width: number;
  height: number;
}

interface CanvasLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface IncomingLayerSource {
  sourceNodeId: string;
  sourceEdgeId: string;
  imageUrl: string;
  previewImageUrl: string;
}

const COLLAGE_LAYER_DRAG_MIME = 'application/x-storyboard-collage-layer';
const CANVAS_PADDING_PX = 16;
const IMAGE_COLLAGE_NODE_MAX_WIDTH = 1600;
const IMAGE_COLLAGE_NODE_MAX_HEIGHT = 1200;
const EXPORT_LONG_EDGE_BY_SIZE = {
  '0.5K': 512,
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveCanvasLayout(viewport: StageViewport, aspectRatio: string): CanvasLayout {
  const availableWidth = Math.max(1, viewport.width - CANVAS_PADDING_PX * 2);
  const availableHeight = Math.max(1, viewport.height - CANVAS_PADDING_PX * 2);
  const ratio = Math.max(0.01, parseAspectRatio(aspectRatio));

  let width = availableWidth;
  let height = width / ratio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }

  return {
    x: Math.round((viewport.width - width) / 2),
    y: Math.round((viewport.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function createDefaultLayer(source: IncomingLayerSource, order: number): ImageCollageLayerItem {
  return {
    sourceNodeId: source.sourceNodeId,
    sourceEdgeId: source.sourceEdgeId,
    imageUrl: source.imageUrl,
    previewImageUrl: source.previewImageUrl,
    placed: false,
    order,
    centerX: 0.5,
    centerY: 0.5,
    scale: 1,
    rotationDeg: 0,
    flipX: false,
    flipY: false,
  };
}

function normalizeLayerOrdering(layers: ImageCollageLayerItem[]): ImageCollageLayerItem[] {
  return [...layers]
    .sort((left, right) => {
      const orderDelta = left.order - right.order;
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return left.sourceEdgeId.localeCompare(right.sourceEdgeId);
    })
    .map((layer, index) => ({
      ...layer,
      order: index,
    }));
}

function areLayersEqual(left: ImageCollageLayerItem[], right: ImageCollageLayerItem[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftLayer = left[index];
    const rightLayer = right[index];
    if (
      leftLayer.sourceNodeId !== rightLayer.sourceNodeId
      || leftLayer.sourceEdgeId !== rightLayer.sourceEdgeId
      || leftLayer.imageUrl !== rightLayer.imageUrl
      || (leftLayer.previewImageUrl ?? null) !== (rightLayer.previewImageUrl ?? null)
      || leftLayer.placed !== rightLayer.placed
      || leftLayer.order !== rightLayer.order
      || leftLayer.centerX !== rightLayer.centerX
      || leftLayer.centerY !== rightLayer.centerY
      || leftLayer.scale !== rightLayer.scale
      || leftLayer.rotationDeg !== rightLayer.rotationDeg
      || leftLayer.flipX !== rightLayer.flipX
      || leftLayer.flipY !== rightLayer.flipY
    ) {
      return false;
    }
  }

  return true;
}

function resolveImageBaseScale(
  image: HTMLImageElement | null | undefined,
  canvasLayout: CanvasLayout
): number {
  if (!image) {
    return 1;
  }

  return Math.min(
    canvasLayout.width / Math.max(1, image.naturalWidth),
    canvasLayout.height / Math.max(1, image.naturalHeight)
  );
}

function resolveCollageExportDimensions(aspectRatio: string, size: ImageCollageNodeData['size']): {
  width: number;
  height: number;
} {
  const longEdge = EXPORT_LONG_EDGE_BY_SIZE[size] ?? EXPORT_LONG_EDGE_BY_SIZE['1K'];
  const ratio = Math.max(0.01, parseAspectRatio(aspectRatio));
  if (ratio >= 1) {
    return {
      width: longEdge,
      height: Math.max(1, Math.round(longEdge / ratio)),
    };
  }

  return {
    width: Math.max(1, Math.round(longEdge * ratio)),
    height: longEdge,
  };
}

function reorderLayersByListPosition(
  layers: ImageCollageLayerItem[],
  draggedLayerId: string,
  targetLayerId: string
): ImageCollageLayerItem[] {
  if (draggedLayerId === targetLayerId) {
    return normalizeLayerOrdering(layers);
  }

  const listOrderedLayers = [...normalizeLayerOrdering(layers)].sort(
    (left, right) => right.order - left.order
  );
  const draggedIndex = listOrderedLayers.findIndex((layer) => layer.sourceEdgeId === draggedLayerId);
  const targetIndex = listOrderedLayers.findIndex((layer) => layer.sourceEdgeId === targetLayerId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return normalizeLayerOrdering(layers);
  }

  const nextListOrderedLayers = [...listOrderedLayers];
  const [draggedLayer] = nextListOrderedLayers.splice(draggedIndex, 1);
  nextListOrderedLayers.splice(targetIndex, 0, draggedLayer);

  return nextListOrderedLayers
    .slice()
    .reverse()
    .map((layer, index) => ({
      ...layer,
      order: index,
    }));
}

export const ImageCollageNode = memo(({ id, data, selected, width, height }: ImageCollageNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteEdge = useCanvasStore((state) => state.deleteEdge);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const incomingSourceNodes = useCanvasIncomingSourceNodes(id);
  const { zoom } = useViewport();

  const stageRef = useRef<Konva.Stage | null>(null);
  const stageHostRef = useRef<HTMLDivElement | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const imageNodeRefs = useRef<Map<string, Konva.Image>>(new Map());
  const imageCacheRef = useRef<Map<string, { source: string; image: HTMLImageElement }>>(new Map());
  const aspectRatioControlRef = useRef<HTMLDivElement | null>(null);
  const sizeControlRef = useRef<HTMLDivElement | null>(null);
  const [stageViewport, setStageViewport] = useState<StageViewport>({ width: 0, height: 0 });
  const [imageElements, setImageElements] = useState<Record<string, HTMLImageElement>>({});
  const [isCanvasDropActive, setIsCanvasDropActive] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);

  const normalizedData = useMemo(() => normalizeImageCollageNodeData(data), [data]);
  const resolvedWidth = Math.max(
    IMAGE_COLLAGE_NODE_MIN_WIDTH,
    Math.round(width ?? IMAGE_COLLAGE_NODE_DEFAULT_WIDTH)
  );
  const resolvedHeight = Math.max(
    IMAGE_COLLAGE_NODE_MIN_HEIGHT,
    Math.round(height ?? IMAGE_COLLAGE_NODE_DEFAULT_HEIGHT)
  );
  const canvasLayout = useMemo(
    () => resolveCanvasLayout(stageViewport, normalizedData.aspectRatio),
    [normalizedData.aspectRatio, stageViewport]
  );
  const orderedLayers = useMemo(
    () => normalizeLayerOrdering(normalizedData.layers),
    [normalizedData.layers]
  );
  const listLayers = useMemo(
    () => [...orderedLayers].sort((left, right) => right.order - left.order),
    [orderedLayers]
  );
  const selectedLayer = useMemo(
    () => orderedLayers.find((layer) => layer.sourceEdgeId === normalizedData.selectedLayerId) ?? null,
    [normalizedData.selectedLayerId, orderedLayers]
  );
  const selectedPlacedLayer = selectedLayer?.placed ? selectedLayer : null;
  const placedLayers = useMemo(
    () => orderedLayers.filter((layer) => layer.placed),
    [orderedLayers]
  );
  const hasPlacedLayers = placedLayers.length > 0;
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.imageCollage, normalizedData),
    [normalizedData]
  );
  const stagePixelRatio = useMemo(() => {
    const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const devicePixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : 1;

    return clamp(devicePixelRatio * Math.max(1, safeZoom), 1, 3);
  }, [zoom]);

  const incomingLayerSources = useMemo<IncomingLayerSource[]>(() => {
    return incomingSourceNodes.flatMap(({ edge, node }) => {
      const source = resolveSingleImageConnectionSource(node);
      if (!source) {
        return [];
      }

      return [{
        sourceNodeId: node.id,
        sourceEdgeId: edge.id,
        imageUrl: source.imageUrl,
        previewImageUrl: source.previewImageUrl,
      }];
    });
  }, [incomingSourceNodes]);

  const commitLayerCollection = useCallback((
    nextLayers: ImageCollageLayerItem[],
    nextSelectedLayerId: string | null,
    historyMode: 'push' | 'skip' = 'push'
  ) => {
    const normalizedNextData = normalizeImageCollageNodeData({
      ...normalizedData,
      layers: nextLayers,
      selectedLayerId: nextSelectedLayerId,
    });

    if (
      areLayersEqual(orderedLayers, normalizedNextData.layers)
      && normalizedData.selectedLayerId === normalizedNextData.selectedLayerId
    ) {
      return;
    }

    updateNodeData(
      id,
      {
        layers: normalizedNextData.layers,
        selectedLayerId: normalizedNextData.selectedLayerId,
      },
      { historyMode }
    );
  }, [id, normalizedData, orderedLayers, updateNodeData]);

  const selectLayer = useCallback((layerId: string | null) => {
    setSelectedNode(id);
    if (normalizedData.selectedLayerId === layerId) {
      return;
    }

    updateNodeData(id, { selectedLayerId: layerId }, { historyMode: 'skip' });
  }, [id, normalizedData.selectedLayerId, setSelectedNode, updateNodeData]);

  const updateLayer = useCallback((
    layerId: string,
    updater: (layer: ImageCollageLayerItem) => ImageCollageLayerItem,
    historyMode: 'push' | 'skip' = 'push',
    selectionLayerId: string | null = layerId
  ) => {
    const nextLayers = orderedLayers.map((layer) => (
      layer.sourceEdgeId === layerId ? updater(layer) : layer
    ));
    commitLayerCollection(nextLayers, selectionLayerId, historyMode);
  }, [commitLayerCollection, orderedLayers]);

  const placeLayerAtPosition = useCallback((
    layerId: string,
    clientX: number,
    clientY: number
  ) => {
    const hostElement = stageHostRef.current;
    if (!hostElement || canvasLayout.width <= 0 || canvasLayout.height <= 0) {
      return;
    }

    const hostRect = hostElement.getBoundingClientRect();
    const canvasX = clamp(clientX - hostRect.left, canvasLayout.x, canvasLayout.x + canvasLayout.width);
    const canvasY = clamp(clientY - hostRect.top, canvasLayout.y, canvasLayout.y + canvasLayout.height);
    const centerX = (canvasX - canvasLayout.x) / canvasLayout.width;
    const centerY = (canvasY - canvasLayout.y) / canvasLayout.height;

    updateLayer(
      layerId,
      (layer) => ({
        ...layer,
        placed: true,
        centerX,
        centerY,
      }),
      'push',
      layerId
    );
    setExportError(null);
  }, [canvasLayout, updateLayer]);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    const element = stageHostRef.current;
    if (!element) {
      return;
    }

    const updateViewport = () => {
      setStageViewport({
        width: Math.max(0, Math.round(element.clientWidth)),
        height: Math.max(0, Math.round(element.clientHeight)),
      });
    };

    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const existingByEdgeId = new Map(orderedLayers.map((layer) => [layer.sourceEdgeId, layer] as const));
    const nextLayers = incomingLayerSources.map((source, index) => {
      const existingLayer = existingByEdgeId.get(source.sourceEdgeId);
      if (!existingLayer) {
        return createDefaultLayer(source, orderedLayers.length + index);
      }

      return {
        ...existingLayer,
        sourceNodeId: source.sourceNodeId,
        imageUrl: source.imageUrl,
        previewImageUrl: source.previewImageUrl,
      };
    });
    const normalizedNextLayers = normalizeLayerOrdering(nextLayers);
    const nextSelectedLayerId = normalizedNextLayers.some(
      (layer) => layer.sourceEdgeId === normalizedData.selectedLayerId
    )
      ? normalizedData.selectedLayerId
      : null;

    if (
      areLayersEqual(orderedLayers, normalizedNextLayers)
      && normalizedData.selectedLayerId === nextSelectedLayerId
    ) {
      return;
    }

    updateNodeData(
      id,
      {
        layers: normalizedNextLayers,
        selectedLayerId: nextSelectedLayerId,
      },
      { historyMode: 'skip' }
    );
  }, [id, incomingLayerSources, normalizedData.selectedLayerId, orderedLayers, updateNodeData]);

  useEffect(() => {
    let cancelled = false;
    const activeLayerIds = new Set(orderedLayers.map((layer) => layer.sourceEdgeId));

    setImageElements((previous) => {
      let changed = false;
      const nextImages: Record<string, HTMLImageElement> = {};
      Object.entries(previous).forEach(([layerId, image]) => {
        if (activeLayerIds.has(layerId)) {
          nextImages[layerId] = image;
        } else {
          changed = true;
        }
      });
      return changed ? nextImages : previous;
    });

    orderedLayers.forEach((layer) => {
      const source = layer.imageUrl || layer.previewImageUrl || '';
      if (!source) {
        return;
      }

      const cachedEntry = imageCacheRef.current.get(layer.sourceEdgeId);
      if (cachedEntry && cachedEntry.source === source) {
        setImageElements((previous) => (
          previous[layer.sourceEdgeId] === cachedEntry.image
            ? previous
            : { ...previous, [layer.sourceEdgeId]: cachedEntry.image }
        ));
        return;
      }

      void loadImageElement(source)
        .then((image) => {
          if (cancelled) {
            return;
          }
          imageCacheRef.current.set(layer.sourceEdgeId, { source, image });
          setImageElements((previous) => ({
            ...previous,
            [layer.sourceEdgeId]: image,
          }));
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          imageCacheRef.current.delete(layer.sourceEdgeId);
          setImageElements((previous) => {
            if (!(layer.sourceEdgeId in previous)) {
              return previous;
            }

            const nextImages = { ...previous };
            delete nextImages[layer.sourceEdgeId];
            return nextImages;
          });
        });
    });

    return () => {
      cancelled = true;
    };
  }, [orderedLayers]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    const targetNode = selectedPlacedLayer
      ? imageNodeRefs.current.get(selectedPlacedLayer.sourceEdgeId) ?? null
      : null;

    transformer.nodes(targetNode ? [targetNode] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedPlacedLayer, imageElements, canvasLayout]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    stage.getLayers().forEach((layer) => {
      layer.getCanvas().setPixelRatio(stagePixelRatio);
      const hitCanvas = (layer as Konva.Layer & {
        getHitCanvas?: () => { setPixelRatio: (pixelRatio: number) => void };
      }).getHitCanvas?.();
      hitCanvas?.setPixelRatio(stagePixelRatio);
      layer.batchDraw();
    });
  }, [stagePixelRatio, stageViewport.height, stageViewport.width]);

  const handleCanvasDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const layerId = event.dataTransfer.getData(COLLAGE_LAYER_DRAG_MIME);
    setIsCanvasDropActive(false);
    if (!layerId) {
      return;
    }

    placeLayerAtPosition(layerId, event.clientX, event.clientY);
  }, [placeLayerAtPosition]);

  const handleLayerDrag = useCallback((
    event: KonvaEventObject<Event>,
    layer: ImageCollageLayerItem,
    historyMode: 'push' | 'skip'
  ) => {
    const imageNode = event.target;
    const centerX = canvasLayout.width > 0
      ? (imageNode.x() - canvasLayout.x) / canvasLayout.width
      : layer.centerX;
    const centerY = canvasLayout.height > 0
      ? (imageNode.y() - canvasLayout.y) / canvasLayout.height
      : layer.centerY;

    updateLayer(
      layer.sourceEdgeId,
      (currentLayer) => ({
        ...currentLayer,
        placed: true,
        centerX,
        centerY,
      }),
      historyMode
    );
  }, [canvasLayout.height, canvasLayout.width, canvasLayout.x, canvasLayout.y, updateLayer]);

  const handleLayerTransform = useCallback((
    event: KonvaEventObject<Event>,
    layer: ImageCollageLayerItem,
    historyMode: 'push' | 'skip'
  ) => {
    const imageNode = event.target as Konva.Image;
    const imageElement = imageElements[layer.sourceEdgeId];
    const baseScale = resolveImageBaseScale(imageElement, canvasLayout);
    const nextScale = clamp(Math.abs(imageNode.scaleX()) / Math.max(baseScale, 0.0001), 0.05, 12);
    const centerX = canvasLayout.width > 0
      ? (imageNode.x() - canvasLayout.x) / canvasLayout.width
      : layer.centerX;
    const centerY = canvasLayout.height > 0
      ? (imageNode.y() - canvasLayout.y) / canvasLayout.height
      : layer.centerY;

    updateLayer(
      layer.sourceEdgeId,
      (currentLayer) => ({
        ...currentLayer,
        placed: true,
        centerX,
        centerY,
        scale: nextScale,
        rotationDeg: imageNode.rotation(),
      }),
      historyMode
    );
  }, [canvasLayout, imageElements, updateLayer]);

  const handleFlip = useCallback((axis: 'x' | 'y') => {
    if (!selectedPlacedLayer) {
      return;
    }

    updateLayer(selectedPlacedLayer.sourceEdgeId, (layer) => ({
      ...layer,
      flipX: axis === 'x' ? !layer.flipX : layer.flipX,
      flipY: axis === 'y' ? !layer.flipY : layer.flipY,
    }));
  }, [selectedPlacedLayer, updateLayer]);

  const handleRotate = useCallback(() => {
    if (!selectedPlacedLayer) {
      return;
    }

    updateLayer(selectedPlacedLayer.sourceEdgeId, (layer) => ({
      ...layer,
      rotationDeg: (layer.rotationDeg + 90) % 360,
    }));
  }, [selectedPlacedLayer, updateLayer]);

  const handleToggleWhiteBackground = useCallback(() => {
    setExportError(null);
    updateNodeData(id, {
      backgroundMode: normalizedData.backgroundMode === 'white' ? 'transparent' : 'white',
    });
  }, [id, normalizedData.backgroundMode, updateNodeData]);

  const handleExport = useCallback(async () => {
    if (isExporting) {
      return;
    }

    if (!hasPlacedLayers) {
      setExportError(t('node.imageCollage.exportEmpty'));
      return;
    }

    setIsExporting(true);
    setExportError(null);

    try {
      const { width: exportWidth, height: exportHeight } = resolveCollageExportDimensions(
        normalizedData.aspectRatio,
        normalizedData.size
      );
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = exportWidth;
      exportCanvas.height = exportHeight;
      const context = exportCanvas.getContext('2d');
      if (!context) {
        throw new Error('2D context unavailable');
      }

      if (normalizedData.backgroundMode === 'white') {
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, exportWidth, exportHeight);
      }

      for (const layer of placedLayers) {
        const existingImage = imageElements[layer.sourceEdgeId];
        const image = existingImage ?? await loadImageElement(layer.imageUrl || layer.previewImageUrl || '');
        const baseScale = Math.min(
          exportWidth / Math.max(1, image.naturalWidth),
          exportHeight / Math.max(1, image.naturalHeight)
        );
        const scaledWidth = image.naturalWidth * baseScale * layer.scale;
        const scaledHeight = image.naturalHeight * baseScale * layer.scale;

        context.save();
        context.translate(layer.centerX * exportWidth, layer.centerY * exportHeight);
        context.rotate((layer.rotationDeg * Math.PI) / 180);
        context.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
        context.drawImage(
          image,
          -scaledWidth / 2,
          -scaledHeight / 2,
          scaledWidth,
          scaledHeight
        );
        context.restore();
      }

      const preparedImage = await prepareNodeImage(canvasToDataUrl(exportCanvas));
      addDerivedExportNode(
        id,
        preparedImage.imageUrl,
        preparedImage.aspectRatio,
        preparedImage.previewImageUrl,
        {
          defaultTitle: EXPORT_RESULT_DISPLAY_NAME.imageCollageExport,
          resultKind: 'imageCollageExport',
          aspectRatioStrategy: 'provided',
          sizeStrategy: 'generated',
          connectToSource: true,
        }
      );
    } catch (error) {
      console.error('[ImageCollageNode] export failed', error);
      setExportError(t('node.imageCollage.exportFailed'));
    } finally {
      setIsExporting(false);
    }
  }, [
    addDerivedExportNode,
    hasPlacedLayers,
    id,
    imageElements,
    isExporting,
    normalizedData.aspectRatio,
    normalizedData.backgroundMode,
    normalizedData.size,
    placedLayers,
    t,
  ]);

  const handleLayerReorder = useCallback((dragSourceLayerId: string, dropTargetLayerId: string) => {
    const nextLayers = reorderLayersByListPosition(orderedLayers, dragSourceLayerId, dropTargetLayerId);
    commitLayerCollection(nextLayers, normalizedData.selectedLayerId, 'push');
  }, [commitLayerCollection, normalizedData.selectedLayerId, orderedLayers]);

  return (
    <div
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.34)]'
          : 'border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<LayoutGrid className="h-3.5 w-3.5" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="flex min-h-0 flex-1 gap-3 pt-5">
        <div className="min-w-0 flex-1">
          <div
            ref={stageHostRef}
            className={`nodrag nowheel relative h-full min-h-[240px] overflow-hidden rounded-xl border ${
              isCanvasDropActive
                ? 'border-accent/65 bg-accent/8'
                : 'border-white/10 bg-[rgba(15,23,42,0.36)]'
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsCanvasDropActive(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsCanvasDropActive(false);
              }
            }}
            onDrop={handleCanvasDrop}
          >
            {stageViewport.width > 0 && stageViewport.height > 0 ? (
              <Stage
                ref={stageRef}
                width={stageViewport.width}
                height={stageViewport.height}
                className="nodrag nowheel"
              >
                <Layer>
                  <Rect
                    x={canvasLayout.x}
                    y={canvasLayout.y}
                    width={canvasLayout.width}
                    height={canvasLayout.height}
                    fill={normalizedData.backgroundMode === 'white' ? '#ffffff' : 'rgba(255,255,255,0.04)'}
                    cornerRadius={16}
                    onMouseDown={() => selectLayer(null)}
                  />
                  <Group
                    clipX={canvasLayout.x}
                    clipY={canvasLayout.y}
                    clipWidth={canvasLayout.width}
                    clipHeight={canvasLayout.height}
                  >
                    {placedLayers.map((layer) => {
                      const image = imageElements[layer.sourceEdgeId];
                      if (!image) {
                        return null;
                      }

                      const baseScale = resolveImageBaseScale(image, canvasLayout);
                      return (
                        <KonvaImage
                          key={layer.sourceEdgeId}
                          ref={(node) => {
                            if (node) {
                              imageNodeRefs.current.set(layer.sourceEdgeId, node);
                              return;
                            }

                            imageNodeRefs.current.delete(layer.sourceEdgeId);
                          }}
                          image={image}
                          x={canvasLayout.x + layer.centerX * canvasLayout.width}
                          y={canvasLayout.y + layer.centerY * canvasLayout.height}
                          offsetX={image.naturalWidth / 2}
                          offsetY={image.naturalHeight / 2}
                          scaleX={baseScale * layer.scale * (layer.flipX ? -1 : 1)}
                          scaleY={baseScale * layer.scale * (layer.flipY ? -1 : 1)}
                          rotation={layer.rotationDeg}
                          draggable
                          onMouseDown={() => selectLayer(layer.sourceEdgeId)}
                          onTap={() => selectLayer(layer.sourceEdgeId)}
                          onDragMove={(event) => handleLayerDrag(event, layer, 'skip')}
                          onDragEnd={(event) => handleLayerDrag(event, layer, 'push')}
                          onTransform={(event) => handleLayerTransform(event, layer, 'skip')}
                          onTransformEnd={(event) => handleLayerTransform(event, layer, 'push')}
                        />
                      );
                    })}
                  </Group>
                  {placedLayers.length === 0 ? (
                    <KonvaText
                      x={canvasLayout.x + 24}
                      y={canvasLayout.y + canvasLayout.height / 2 - 10}
                      width={Math.max(0, canvasLayout.width - 48)}
                      align="center"
                      text={t('node.imageCollage.canvasEmpty')}
                      fontSize={14}
                      fill={
                        normalizedData.backgroundMode === 'white'
                          ? 'rgba(15,23,42,0.55)'
                          : 'rgba(241,245,249,0.7)'
                      }
                    />
                  ) : null}
                  <Transformer
                    ref={transformerRef}
                    rotateEnabled={false}
                    keepRatio
                    enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
                    borderStroke="rgba(59,130,246,0.95)"
                    anchorStroke="rgba(59,130,246,0.95)"
                    anchorFill="#ffffff"
                    anchorSize={8}
                  />
                </Layer>
              </Stage>
            ) : null}
          </div>
        </div>

        <div className="flex w-[280px] max-w-[36%] min-w-[240px] flex-col rounded-xl border border-white/10 bg-black/10 p-2">
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="text-xs font-medium text-text-dark">
              {t('node.imageCollage.layersTitle')}
            </span>
            <span className="text-[11px] text-text-muted">
              {orderedLayers.length}
            </span>
          </div>

          <div className="ui-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {listLayers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/12 px-3 py-5 text-center text-xs text-text-muted">
                {t('node.imageCollage.empty')}
              </div>
            ) : null}

            {listLayers.map((layer, index) => {
              const isActive = layer.sourceEdgeId === normalizedData.selectedLayerId;
              const isDragTarget = dragOverLayerId === layer.sourceEdgeId && draggedLayerId !== layer.sourceEdgeId;
              const displayUrl = resolveImageDisplayUrl(layer.previewImageUrl || layer.imageUrl);

              return (
                <div
                  key={layer.sourceEdgeId}
                  draggable
                  onClick={(event) => {
                    event.stopPropagation();
                    selectLayer(layer.sourceEdgeId);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(COLLAGE_LAYER_DRAG_MIME, layer.sourceEdgeId);
                    event.dataTransfer.effectAllowed = 'move';
                    setDraggedLayerId(layer.sourceEdgeId);
                    setDragOverLayerId(null);
                    selectLayer(layer.sourceEdgeId);
                  }}
                  onDragOver={(event) => {
                    if (!draggedLayerId || draggedLayerId === layer.sourceEdgeId) {
                      return;
                    }
                    event.preventDefault();
                    setDragOverLayerId(layer.sourceEdgeId);
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                      setDragOverLayerId((current) => (
                        current === layer.sourceEdgeId ? null : current
                      ));
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const sourceLayerId = event.dataTransfer.getData(COLLAGE_LAYER_DRAG_MIME) || draggedLayerId;
                    if (sourceLayerId && sourceLayerId !== layer.sourceEdgeId) {
                      handleLayerReorder(sourceLayerId, layer.sourceEdgeId);
                    }
                    setDragOverLayerId(null);
                    setDraggedLayerId(null);
                  }}
                  onDragEnd={() => {
                    setIsCanvasDropActive(false);
                    setDragOverLayerId(null);
                    setDraggedLayerId(null);
                  }}
                  className={`nodrag flex w-full items-center gap-3 rounded-xl border px-2 py-2 text-left transition-colors ${
                    isDragTarget
                      ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                      : isActive
                      ? 'border-accent/60 bg-accent/12'
                      : 'border-white/10 bg-[rgba(15,23,42,0.34)] hover:border-white/18 hover:bg-[rgba(15,23,42,0.5)]'
                  }`}
                >
                  <img
                    src={displayUrl}
                    alt={t('node.imageCollage.layerLabel', { index: listLayers.length - index })}
                    className="h-14 w-14 rounded-lg object-cover"
                    draggable={false}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text-dark">
                      {t('node.imageCollage.layerLabel', { index: listLayers.length - index })}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                      <span>{layer.placed ? `#${layer.order + 1}` : t('node.imageCollage.notPlaced')}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    title={t('common.delete')}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-red-200"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteEdge(layer.sourceEdgeId);
                    }}
                    draggable={false}
                  >
                    <X className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-between gap-3">
        <div className="ui-scrollbar min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex w-max min-w-full items-center gap-1">
            <UiChipButton
              type="button"
              className={`${NODE_CONTROL_CHIP_CLASS} !h-8 shrink-0`}
              disabled={!selectedPlacedLayer}
              onClick={(event) => {
                event.stopPropagation();
                handleFlip('x');
              }}
            >
              {t('node.imageCollage.flipHorizontal')}
            </UiChipButton>
            <UiChipButton
              type="button"
              className={`${NODE_CONTROL_CHIP_CLASS} !h-8 shrink-0`}
              disabled={!selectedPlacedLayer}
              onClick={(event) => {
                event.stopPropagation();
                handleFlip('y');
              }}
            >
              {t('node.imageCollage.flipVertical')}
            </UiChipButton>
            <UiChipButton
              type="button"
              className={`${NODE_CONTROL_CHIP_CLASS} !h-8 shrink-0`}
              disabled={!selectedPlacedLayer}
              onClick={(event) => {
                event.stopPropagation();
                handleRotate();
              }}
            >
              {t('node.imageCollage.rotateClockwise')}
            </UiChipButton>
            <button
              type="button"
              aria-label={t('node.imageCollage.whiteBackground')}
              title={t('node.imageCollage.whiteBackground')}
              aria-pressed={normalizedData.backgroundMode === 'white'}
              className={`
                flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors
                ${normalizedData.backgroundMode === 'white'
                  ? 'border-accent/60 bg-accent/12'
                  : 'border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]'}
              `}
              onClick={(event) => {
                event.stopPropagation();
                handleToggleWhiteBackground();
              }}
            >
              <div className="h-3.5 w-3.5 rounded-sm bg-white/90 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.14)]" />
            </button>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            ref={aspectRatioControlRef}
            className="nodrag nowheel min-w-[86px]"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <UiSelect
              aria-label={t('node.imageCollage.aspectRatio')}
              menuAnchorRef={aspectRatioControlRef}
              className="nodrag !h-8 min-w-[86px]"
              value={normalizedData.aspectRatio}
              onChange={(event) => {
                setExportError(null);
                updateNodeData(id, { aspectRatio: event.target.value });
              }}
            >
              {IMAGE_ASPECT_RATIOS.map((aspectRatio) => (
                <option key={aspectRatio} value={aspectRatio}>
                  {aspectRatio}
                </option>
              ))}
            </UiSelect>
          </div>

          <div
            ref={sizeControlRef}
            className="nodrag nowheel min-w-[80px]"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <UiSelect
              aria-label={t('node.imageCollage.size')}
              menuAnchorRef={sizeControlRef}
              className="nodrag !h-8 min-w-[80px]"
              value={normalizedData.size}
              onChange={(event) => {
                updateNodeData(id, { size: event.target.value as ImageCollageNodeData['size'] });
              }}
            >
              {IMAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </UiSelect>
          </div>

          <UiButton
            type="button"
            variant="primary"
            className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
            disabled={!hasPlacedLayers || isExporting}
            onClick={(event) => {
              event.stopPropagation();
              void handleExport();
            }}
          >
            <Download className="h-4 w-4" strokeWidth={2.4} />
            {isExporting ? t('node.imageCollage.exporting') : t('node.imageCollage.export')}
          </UiButton>
        </div>
      </div>

      <div className={`mt-1 min-h-[18px] text-[10px] leading-4 ${exportError ? 'text-red-200' : 'text-text-muted'}`}>
        {exportError ?? t('node.imageCollage.dropHint')}
      </div>

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={IMAGE_COLLAGE_NODE_MIN_WIDTH}
        minHeight={IMAGE_COLLAGE_NODE_MIN_HEIGHT}
        maxWidth={IMAGE_COLLAGE_NODE_MAX_WIDTH}
        maxHeight={IMAGE_COLLAGE_NODE_MAX_HEIGHT}
        isVisible={selected}
      />
    </div>
  );
});

ImageCollageNode.displayName = 'ImageCollageNode';
