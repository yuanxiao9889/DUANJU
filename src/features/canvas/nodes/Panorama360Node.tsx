import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  AlertTriangle,
  Camera,
  Globe2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  PANORAMA360_NODE_DEFAULT_HEIGHT,
  PANORAMA360_NODE_DEFAULT_WIDTH,
  PANORAMA360_NODE_MIN_HEIGHT,
  PANORAMA360_NODE_MIN_WIDTH,
  resolveSingleImageConnectionSource,
  type Panorama360NodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { NodeStatusBadge } from '@/features/canvas/ui/NodeStatusBadge';
import { resolveImageDisplayUrl, prepareNodeImage } from '@/features/canvas/application/imageData';
import {
  NODE_CONTROL_ACTION_BUTTON_CLASS,
  NODE_CONTROL_ICON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { resolveNodeStyleDimension } from '@/features/canvas/ui/nodeDimensionUtils';
import {
  useCanvasIncomingSourceNodes,
  useCanvasNodeById,
} from '@/features/canvas/hooks/useCanvasNodeGraph';
import { useCanvasStore } from '@/stores/canvasStore';

type Panorama360NodeProps = NodeProps & {
  id: string;
  data: Panorama360NodeData;
  selected?: boolean;
};

interface PanoramaViewState {
  yaw: number;
  pitch: number;
  fov: number;
}

interface ActionStatus {
  tone: 'info' | 'success' | 'danger';
  message: string;
}

const PANORAMA_CAMERA_DISTANCE = 0.1;
const PANORAMA_SPHERE_RADIUS = 5;
const DEFAULT_VIEWER_STATE: PanoramaViewState = {
  yaw: 0,
  pitch: 0,
  fov: 75,
};
const MIN_VIEWER_FOV = 35;
const MAX_VIEWER_FOV = 95;
const MAX_PITCH = Math.PI / 2 - 0.02;
const VIEW_STATE_EPSILON = 0.0005;
const VIEWER_CONTROL_BAR_HEIGHT = 64;
const SCREENSHOT_LONG_SIDE_PX = 1920;

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

function clampPitch(value: number): number {
  return THREE.MathUtils.clamp(value, -MAX_PITCH, MAX_PITCH);
}

function clampFov(value: number): number {
  return THREE.MathUtils.clamp(value, MIN_VIEWER_FOV, MAX_VIEWER_FOV);
}

function normalizeViewerState(data: Panorama360NodeData): PanoramaViewState {
  const yaw = typeof data.viewerYaw === 'number' && Number.isFinite(data.viewerYaw)
    ? data.viewerYaw
    : DEFAULT_VIEWER_STATE.yaw;
  const pitch = typeof data.viewerPitch === 'number' && Number.isFinite(data.viewerPitch)
    ? clampPitch(data.viewerPitch)
    : DEFAULT_VIEWER_STATE.pitch;
  const fov = typeof data.viewerFov === 'number' && Number.isFinite(data.viewerFov)
    ? clampFov(data.viewerFov)
    : DEFAULT_VIEWER_STATE.fov;

  return { yaw, pitch, fov };
}

function buildDirectionFromAngles(yaw: number, pitch: number): THREE.Vector3 {
  const safePitch = clampPitch(pitch);
  return new THREE.Vector3(
    Math.sin(yaw) * Math.cos(safePitch),
    Math.sin(safePitch),
    Math.cos(yaw) * Math.cos(safePitch)
  ).normalize();
}

function resolveViewerStateFromCamera(camera: THREE.PerspectiveCamera): PanoramaViewState {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  return {
    yaw: Math.atan2(direction.x, direction.z),
    pitch: clampPitch(Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1))),
    fov: clampFov(camera.fov),
  };
}

function areViewStatesEqual(left: PanoramaViewState, right: PanoramaViewState): boolean {
  return (
    Math.abs(left.yaw - right.yaw) <= VIEW_STATE_EPSILON
    && Math.abs(left.pitch - right.pitch) <= VIEW_STATE_EPSILON
    && Math.abs(left.fov - right.fov) <= VIEW_STATE_EPSILON
  );
}

function applyViewStateToCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  viewState: PanoramaViewState
): void {
  const direction = buildDirectionFromAngles(viewState.yaw, viewState.pitch);
  camera.position.copy(direction.multiplyScalar(-PANORAMA_CAMERA_DISTANCE));
  camera.fov = clampFov(viewState.fov);
  camera.updateProjectionMatrix();
  controls.target.set(0, 0, 0);
  camera.lookAt(0, 0, 0);
  controls.update();
}

function resolveTextureLoadErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallbackMessage;
}

export const Panorama360Node = memo(({ id, data, selected, width }: Panorama360NodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const currentNode = useCanvasNodeById(id);
  const incomingSourceNodes = useCanvasIncomingSourceNodes(id);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);

  const viewerHostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sphereMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const persistViewStateTimerRef = useRef<number | null>(null);
  const actionStatusTimeoutRef = useRef<number | null>(null);
  const screenshotCountRef = useRef(0);
  const isApplyingExternalViewRef = useRef(false);
  const latestViewStateRef = useRef<PanoramaViewState>(normalizeViewerState(data));

  const [isTextureLoading, setIsTextureLoading] = useState(false);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);

  const isReferenceSourceHighlighted = useCanvasStore(
    (state) => state.highlightedReferenceSourceNodeId === id
  );

  const resolvedIncomingImageSource = useMemo(() => {
    for (let index = incomingSourceNodes.length - 1; index >= 0; index -= 1) {
      const resolvedSource = resolveSingleImageConnectionSource(incomingSourceNodes[index]?.node);
      if (resolvedSource) {
        return resolvedSource;
      }
    }
    return null;
  }, [incomingSourceNodes]);

  const resolvedWidth = Math.max(
    resolveNodeDimension(width, PANORAMA360_NODE_DEFAULT_WIDTH),
    PANORAMA360_NODE_MIN_WIDTH
  );
  const explicitHeight = resolveNodeStyleDimension(currentNode?.style?.height);
  const resolvedHeight = Math.max(
    explicitHeight ?? PANORAMA360_NODE_DEFAULT_HEIGHT,
    PANORAMA360_NODE_MIN_HEIGHT
  );
  const viewerHeight = Math.max(180, resolvedHeight - VIEWER_CONTROL_BAR_HEIGHT);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.panorama360, data),
    [data]
  );
  const panoramaImageSource = useMemo(() => {
    if (!data.imageUrl && !data.previewImageUrl) {
      return null;
    }

    return resolveImageDisplayUrl(data.imageUrl ?? data.previewImageUrl ?? '');
  }, [data.imageUrl, data.previewImageUrl]);

  const renderScene = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) {
      return;
    }

    renderer.render(scene, camera);
  }, []);

  const clearActionStatus = useCallback(() => {
    if (actionStatusTimeoutRef.current) {
      window.clearTimeout(actionStatusTimeoutRef.current);
      actionStatusTimeoutRef.current = null;
    }
    setActionStatus(null);
  }, []);

  const showActionStatus = useCallback(
    (tone: ActionStatus['tone'], message: string, durationMs = 2400) => {
      if (actionStatusTimeoutRef.current) {
        window.clearTimeout(actionStatusTimeoutRef.current);
        actionStatusTimeoutRef.current = null;
      }

      setActionStatus({ tone, message });
      if (durationMs > 0) {
        actionStatusTimeoutRef.current = window.setTimeout(() => {
          actionStatusTimeoutRef.current = null;
          setActionStatus(null);
        }, durationMs);
      }
    },
    []
  );

  const persistViewState = useCallback(
    (viewState: PanoramaViewState) => {
      updateNodeData(
        id,
        {
          viewerYaw: viewState.yaw,
          viewerPitch: viewState.pitch,
          viewerFov: viewState.fov,
        },
        { historyMode: 'skip' }
      );
    },
    [id, updateNodeData]
  );

  const schedulePersistViewState = useCallback(
    (viewState: PanoramaViewState) => {
      if (persistViewStateTimerRef.current) {
        window.clearTimeout(persistViewStateTimerRef.current);
      }

      persistViewStateTimerRef.current = window.setTimeout(() => {
        persistViewStateTimerRef.current = null;
        persistViewState(viewState);
      }, 180);
    },
    [persistViewState]
  );

  const syncViewStateFromCamera = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera || isApplyingExternalViewRef.current) {
      return;
    }

    const nextViewState = resolveViewerStateFromCamera(camera);
    latestViewStateRef.current = nextViewState;
    schedulePersistViewState(nextViewState);
  }, [schedulePersistViewState]);

  const handleNodeClick = useCallback(() => {
    setSelectedNode(id);
  }, [id, setSelectedNode]);

  const handleResetView = useCallback(
    (event?: ReactMouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation();
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls) {
        return;
      }

      const nextViewState = { ...DEFAULT_VIEWER_STATE };
      latestViewStateRef.current = nextViewState;
      isApplyingExternalViewRef.current = true;
      applyViewStateToCamera(camera, controls, nextViewState);
      renderScene();
      isApplyingExternalViewRef.current = false;
      persistViewState(nextViewState);
      clearActionStatus();
    },
    [clearActionStatus, persistViewState, renderScene]
  );

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

  useEffect(() => {
    const nextImageData = {
      imageUrl: resolvedIncomingImageSource?.imageUrl ?? null,
      previewImageUrl: resolvedIncomingImageSource?.previewImageUrl ?? null,
      aspectRatio: resolvedIncomingImageSource?.aspectRatio ?? DEFAULT_ASPECT_RATIO,
    };

    updateNodeData(id, nextImageData, { historyMode: 'skip' });
  }, [
    id,
    resolvedIncomingImageSource?.aspectRatio,
    resolvedIncomingImageSource?.imageUrl,
    resolvedIncomingImageSource?.previewImageUrl,
    updateNodeData,
  ]);

  useEffect(() => {
    const host = viewerHostRef.current;
    if (!host) {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(DEFAULT_VIEWER_STATE.fov, 1, 0.05, 100);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'h-full w-full';

    const geometry = new THREE.SphereGeometry(PANORAMA_SPHERE_RADIUS, 60, 40);
    geometry.scale(-1, 1, 1);
    const material = new THREE.MeshBasicMaterial({
      color: 0x111827,
    });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.rotateSpeed = -0.38;

    const resizeRenderer = () => {
      if (!viewerHostRef.current || !rendererRef.current || !cameraRef.current) {
        return;
      }

      const nextWidth = Math.max(1, Math.round(viewerHostRef.current.clientWidth));
      const nextHeight = Math.max(1, Math.round(viewerHostRef.current.clientHeight));
      rendererRef.current.setPixelRatio(window.devicePixelRatio);
      rendererRef.current.setSize(nextWidth, nextHeight, false);
      cameraRef.current.aspect = nextWidth / nextHeight;
      cameraRef.current.updateProjectionMatrix();
      renderScene();
    };

    const handleControlsChange = () => {
      renderScene();
      syncViewStateFromCamera();
    };

    controls.addEventListener('change', handleControlsChange);

    const resizeObserver = new ResizeObserver(() => {
      resizeRenderer();
    });
    resizeObserver.observe(host);

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    sphereMaterialRef.current = material;

    applyViewStateToCamera(camera, controls, latestViewStateRef.current);
    renderScene();

    return () => {
      resizeObserver.disconnect();
      controls.removeEventListener('change', handleControlsChange);
      controls.dispose();
      renderer.dispose();
      material.dispose();
      geometry.dispose();
      textureRef.current?.dispose();
      textureRef.current = null;
      if (host.contains(renderer.domElement)) {
        host.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      sphereMaterialRef.current = null;
    };
  }, [renderScene, syncViewStateFromCamera]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) {
      return;
    }

    const nextViewState = normalizeViewerState(data);
    if (areViewStatesEqual(latestViewStateRef.current, nextViewState)) {
      return;
    }

    latestViewStateRef.current = nextViewState;
    isApplyingExternalViewRef.current = true;
    applyViewStateToCamera(camera, controls, nextViewState);
    renderScene();
    isApplyingExternalViewRef.current = false;
  }, [data, renderScene]);

  useEffect(() => {
    const material = sphereMaterialRef.current;
    if (!material) {
      return;
    }

    if (!panoramaImageSource) {
      textureRef.current?.dispose();
      textureRef.current = null;
      material.map = null;
      material.color.setHex(0x111827);
      material.needsUpdate = true;
      setIsTextureLoading(false);
      setViewerError(null);
      renderScene();
      return;
    }

    let isDisposed = false;
    const loader = new THREE.TextureLoader();
    setIsTextureLoading(true);
    setViewerError(null);

    loader.load(
      panoramaImageSource,
      (texture) => {
        if (isDisposed) {
          texture.dispose();
          return;
        }

        textureRef.current?.dispose();
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        textureRef.current = texture;
        material.map = texture;
        material.color.setHex(0xffffff);
        material.needsUpdate = true;
        setIsTextureLoading(false);
        renderScene();
      },
      undefined,
      (error) => {
        if (isDisposed) {
          return;
        }

        textureRef.current?.dispose();
        textureRef.current = null;
        material.map = null;
        material.color.setHex(0x111827);
        material.needsUpdate = true;
        setIsTextureLoading(false);
        setViewerError(
          resolveTextureLoadErrorMessage(error, t('node.panorama360.loadFailed'))
        );
        renderScene();
      }
    );

    return () => {
      isDisposed = true;
    };
  }, [panoramaImageSource, renderScene, t]);

  useEffect(() => () => {
    if (persistViewStateTimerRef.current) {
      window.clearTimeout(persistViewStateTimerRef.current);
      persistViewStateTimerRef.current = null;
    }
    if (actionStatusTimeoutRef.current) {
      window.clearTimeout(actionStatusTimeoutRef.current);
      actionStatusTimeoutRef.current = null;
    }
  }, []);

  const handleViewerWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      handleNodeClick();

      const camera = cameraRef.current;
      if (!camera) {
        return;
      }

      const nextFov = clampFov(camera.fov + (event.deltaY > 0 ? 3 : -3));
      if (Math.abs(nextFov - camera.fov) <= VIEW_STATE_EPSILON) {
        return;
      }

      camera.fov = nextFov;
      camera.updateProjectionMatrix();
      latestViewStateRef.current = {
        ...latestViewStateRef.current,
        fov: nextFov,
      };
      renderScene();
      schedulePersistViewState(latestViewStateRef.current);
    },
    [handleNodeClick, renderScene, schedulePersistViewState]
  );

  const handleScreenshot = useCallback(
    async (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      handleNodeClick();

      if (!data.imageUrl || isCapturingScreenshot) {
        return;
      }

      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      const scene = sceneRef.current;
      const host = viewerHostRef.current;
      const currentNodePosition = currentNode?.position;
      if (!renderer || !camera || !scene || !host) {
        return;
      }

      try {
        setIsCapturingScreenshot(true);
        showActionStatus('info', t('node.panorama360.screenshotPending'), 0);

        const currentWidth = Math.max(1, Math.round(host.clientWidth));
        const currentHeight = Math.max(1, Math.round(host.clientHeight));
        const currentAspect = currentWidth / currentHeight;
        const captureWidth = currentAspect >= 1
          ? SCREENSHOT_LONG_SIDE_PX
          : Math.max(960, Math.round(SCREENSHOT_LONG_SIDE_PX * currentAspect));
        const captureHeight = currentAspect >= 1
          ? Math.max(960, Math.round(SCREENSHOT_LONG_SIDE_PX / currentAspect))
          : SCREENSHOT_LONG_SIDE_PX;
        const previousPixelRatio = renderer.getPixelRatio();
        const previousSize = renderer.getSize(new THREE.Vector2());
        const previousAspect = camera.aspect;
        let screenshotDataUrl = '';

        try {
          renderer.setPixelRatio(1);
          renderer.setSize(captureWidth, captureHeight, false);
          camera.aspect = captureWidth / captureHeight;
          camera.updateProjectionMatrix();
          renderer.render(scene, camera);
          screenshotDataUrl = renderer.domElement.toDataURL('image/jpeg', 0.95);
        } finally {
          renderer.setPixelRatio(previousPixelRatio);
          renderer.setSize(previousSize.x, previousSize.y, false);
          camera.aspect = previousAspect;
          camera.updateProjectionMatrix();
          renderScene();
        }

        const prepared = await prepareNodeImage(screenshotDataUrl);
        if (!currentNodePosition) {
          throw new Error(t('node.panorama360.screenshotFailed'));
        }

        const screenshotIndex = screenshotCountRef.current + 1;
        screenshotCountRef.current = screenshotIndex;

        const newNodeId = addNode(
          CANVAS_NODE_TYPES.upload,
          {
            x: currentNodePosition.x + resolvedWidth + 40,
            y: currentNodePosition.y + (screenshotIndex - 1) * 56,
          },
          {
            imageUrl: prepared.imageUrl,
            previewImageUrl: prepared.previewImageUrl,
            aspectRatio: prepared.aspectRatio,
            displayName: t('node.panorama360.screenshotName', {
              name: resolvedTitle,
              index: screenshotIndex,
            }),
          },
          { inheritParentFromNodeId: id }
        );
        addEdge(id, newNodeId);

        showActionStatus('success', t('node.panorama360.screenshotSuccess'));
      } catch (error) {
        console.error('Failed to capture panorama screenshot:', error);
        showActionStatus('danger', t('node.panorama360.screenshotFailed'), 3600);
      } finally {
        setIsCapturingScreenshot(false);
      }
    },
    [
      addEdge,
      addNode,
      currentNode?.position,
      data.imageUrl,
      handleNodeClick,
      id,
      isCapturingScreenshot,
      renderScene,
      resolvedTitle,
      resolvedWidth,
      showActionStatus,
      t,
    ]
  );

  const headerStatus = useMemo(() => {
    if (viewerError) {
      return (
        <NodeStatusBadge
          icon={<AlertTriangle className="h-3 w-3" />}
          label={t('nodeStatus.error')}
          tone="danger"
          title={viewerError}
        />
      );
    }

    if (isTextureLoading) {
      return (
        <NodeStatusBadge
          icon={<RefreshCw className="h-3 w-3" />}
          label={t('node.panorama360.loadingShort')}
          tone="processing"
          animate
        />
      );
    }

    return null;
  }, [isTextureLoading, t, viewerError]);

  const actionStatusClassName = useMemo(() => {
    if (!actionStatus) {
      return '';
    }

    if (actionStatus.tone === 'success') {
      return 'border border-emerald-400/15 bg-emerald-500/12 text-emerald-200 shadow-[0_10px_30px_rgba(16,185,129,0.18)]';
    }

    if (actionStatus.tone === 'danger') {
      return 'border border-red-400/15 bg-red-500/12 text-red-200 shadow-[0_10px_30px_rgba(239,68,68,0.18)]';
    }

    return 'border border-white/[0.08] bg-[rgba(8,10,16,0.92)] text-text-muted shadow-[0_10px_30px_rgba(0,0,0,0.28)]';
  }, [actionStatus]);

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
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<Globe2 className="h-4 w-4" />}
        titleText={resolvedTitle}
        rightSlot={headerStatus}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--node-radius)] bg-[linear-gradient(165deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))]">
        <div
          className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,rgba(71,85,105,0.45),rgba(2,6,23,0.95))]"
          style={{ height: viewerHeight }}
        >
          <div
            ref={viewerHostRef}
            className="nodrag nowheel h-full w-full cursor-grab active:cursor-grabbing"
            onMouseDown={(event) => {
              event.stopPropagation();
              handleNodeClick();
            }}
            onClick={(event) => event.stopPropagation()}
            onWheel={handleViewerWheel}
          />

          {!data.imageUrl ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-text-dark">
                <Globe2 className="h-7 w-7 text-accent/80" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-medium text-text-dark">
                  {t('node.panorama360.emptyTitle')}
                </div>
                <div className="text-xs leading-5 text-text-muted">
                  {t('node.panorama360.emptyHint')}
                </div>
              </div>
            </div>
          ) : null}

          {viewerError ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[rgba(15,23,42,0.46)] px-6 text-center">
              <div className="space-y-2">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-red-400/25 bg-red-500/12 text-red-200">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="text-sm font-medium text-text-dark">
                  {t('node.panorama360.loadFailed')}
                </div>
                <div className="text-xs leading-5 text-text-muted">{viewerError}</div>
              </div>
            </div>
          ) : null}

          {isTextureLoading ? (
            <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] text-text-dark">
              {t('node.panorama360.loading')}
            </div>
          ) : null}
        </div>

        <div
          className="relative border-t border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(8,10,16,0.88),rgba(8,10,16,0.96))] px-3 py-2.5"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {actionStatus ? (
            <div
              className={`pointer-events-none absolute bottom-full left-3 right-3 mb-2 truncate rounded-xl px-3 py-2 text-[11px] font-medium ${actionStatusClassName}`}
              title={actionStatus.message}
            >
              {actionStatus.message}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 rounded-[14px] border border-white/[0.05] bg-black/20 p-1">
            <button
              type="button"
              className={`${NODE_CONTROL_ACTION_BUTTON_CLASS} nodrag inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-accent/20 bg-accent/12 px-3 text-[12px] font-medium leading-none text-accent hover:border-accent/30 hover:bg-accent/18 disabled:cursor-not-allowed disabled:border-white/[0.06] disabled:bg-white/[0.04] disabled:text-text-muted disabled:opacity-55`}
              disabled={!data.imageUrl || isCapturingScreenshot || Boolean(viewerError)}
              onClick={(event) => {
                void handleScreenshot(event);
              }}
              title={t('node.panorama360.screenshot')}
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                {isCapturingScreenshot ? (
                  <RefreshCw className={`${NODE_CONTROL_ICON_CLASS} animate-spin`} />
                ) : (
                  <Camera className={NODE_CONTROL_ICON_CLASS} />
                )}
              </span>
              <span className="min-w-0 truncate">
                {isCapturingScreenshot
                  ? t('node.panorama360.screenshotPending')
                  : t('node.panorama360.screenshot')}
              </span>
            </button>

            <button
              type="button"
              className={`${NODE_CONTROL_ACTION_BUTTON_CLASS} nodrag inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 text-[12px] font-medium leading-none text-text-dark hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:border-white/[0.05] disabled:bg-white/[0.03] disabled:text-text-muted disabled:opacity-50`}
              disabled={!data.imageUrl}
              onClick={handleResetView}
              title={t('node.panorama360.resetView')}
            >
              <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                <RotateCcw className={NODE_CONTROL_ICON_CLASS} />
              </span>
              <span className="min-w-0 truncate">{t('node.panorama360.resetView')}</span>
            </button>
          </div>
        </div>
      </div>

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />

      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-white !bg-accent"
      />

      <NodeResizeHandle
        minWidth={PANORAMA360_NODE_MIN_WIDTH}
        minHeight={PANORAMA360_NODE_MIN_HEIGHT}
        maxWidth={1400}
        maxHeight={1200}
        isVisible={selected}
      />
    </div>
  );
});

Panorama360Node.displayName = 'Panorama360Node';
