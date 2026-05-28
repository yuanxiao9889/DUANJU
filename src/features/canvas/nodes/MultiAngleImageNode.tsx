import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { CanvasHandle } from "@/features/canvas/ui/CanvasHandle";
import {
  AlertTriangle,
  Camera,
  Loader2,
  Move3D,
  Rotate3D,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { UiButton, UiChipButton, UiLoadingOverlay } from "@/components/ui";
import {
  AUTO_REQUEST_ASPECT_RATIO,
  CANVAS_NODE_TYPES,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  MULTI_ANGLE_IMAGE_NODE_DEFAULT_HEIGHT,
  MULTI_ANGLE_IMAGE_NODE_DEFAULT_WIDTH,
  type ExportImageGenerationSummary,
  type ImageSize,
  type MultiAngleImageNodeData,
  resolveSingleImageConnectionSource,
} from "@/features/canvas/domain/canvasNodes";
import { resolveNodeDisplayName } from "@/features/canvas/domain/nodeDisplay";
import { useIsOverviewCanvasRender } from "@/features/canvas/CanvasPerformanceContext";
import { canvasAiGateway } from "@/features/canvas/application/canvasServices";
import {
  loadImageElement,
  parseAspectRatio,
  resolveReadableImageSource,
} from "@/features/canvas/application/imageData";
import { resolveMinEdgeFittedSize } from "@/features/canvas/application/imageNodeSizing";
import {
  resolveErrorContent,
  showErrorDialog,
} from "@/features/canvas/application/errorDialog";
import { recordImageGenerationErrorLog } from "@/features/canvas/application/errorLog";
import {
  buildGenerationErrorReport,
  CURRENT_RUNTIME_SESSION_ID,
  createReferenceImagePlaceholders,
  getRuntimeDiagnostics,
  type GenerationDebugContext,
} from "@/features/canvas/application/generationErrorReport";
import {
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  isStoryboardApi2OkModelId,
  isStoryboardCompatibleModelId,
  isStoryboardNewApiModelId,
  isStoryboardOopiiModelId,
  listImageModels,
  resolveImageModelExtraParams,
  resolveImageModelResolution,
  resolveImageModelResolutions,
  resolveStoryboardApi2OkModelConfigForModel,
  resolveStoryboardCompatibleModelConfigForModel,
  resolveStoryboardNewApiModelConfigForModel,
  resolveStoryboardOopiiModelConfigForModel,
  toStoryboardApi2OkExtraParamsPayload,
  toStoryboardCompatibleExtraParamsPayload,
  toStoryboardNewApiExtraParamsPayload,
  type AspectRatioOption,
} from "@/features/canvas/models";
import {
  GRSAI_GPT_IMAGE_2_MODEL_ID,
  normalizeGrsaiGptImage2AspectRatio,
} from "@/features/canvas/models/image/grsai/gptImage2";
import { GRSAI_NANO_BANANA_PRO_MODEL_ID } from "@/features/canvas/models/image/grsai/nanoBananaPro";
import {
  NodeHeader,
  NODE_HEADER_FLOATING_POSITION_CLASS,
} from "@/features/canvas/ui/NodeHeader";
import { NodeResizeHandle } from "@/features/canvas/ui/NodeResizeHandle";
import { ModelParamsControls } from "@/features/canvas/ui/ModelParamsControls";
import { CanvasNodeImage } from "@/features/canvas/ui/CanvasNodeImage";
import { NodeStatusBadge } from "@/features/canvas/ui/NodeStatusBadge";
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_GENERATE_ICON_CLASS,
  NODE_CONTROL_MODEL_CHIP_CLASS,
  NODE_CONTROL_PARAMS_CHIP_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from "@/features/canvas/ui/nodeControlStyles";
import { openSettingsDialog } from "@/features/settings/settingsEvents";
import { useCanvasIncomingSourceNodes } from "@/features/canvas/hooks/useCanvasNodeGraph";
import { useCanvasStore } from "@/stores/canvasStore";
import { useSettingsStore } from "@/stores/settingsStore";

type MultiAngleImageNodeProps = NodeProps & {
  id: string;
  data: MultiAngleImageNodeData;
  selected?: boolean;
};

interface MultiAngleSceneProps {
  sourceImageUrl: string | null;
  fallbackImageUrl?: string | null;
  horizontalAngle: number;
  verticalAngle: number;
  zoom: number;
  cameraView: boolean;
  onActivate: () => void;
  onAnglesChange: (nextValue: {
    horizontalAngle?: number;
    verticalAngle?: number;
    zoom?: number;
  }) => void;
}

interface AngleLabelSet {
  prompt: string;
  labelKey: string;
  shortEn: string;
}

const MULTI_ANGLE_NODE_MIN_WIDTH = 520;
const MULTI_ANGLE_NODE_MIN_HEIGHT = 360;
const MULTI_ANGLE_NODE_MAX_WIDTH = 1200;
const MULTI_ANGLE_NODE_MAX_HEIGHT = 900;

const AZIMUTH_PRESETS = [
  { key: "front", value: 0 },
  { key: "frontRight", value: 45 },
  { key: "right", value: 90 },
  { key: "backRight", value: 135 },
  { key: "back", value: 180 },
  { key: "backLeft", value: 225 },
  { key: "left", value: 270 },
  { key: "frontLeft", value: 315 },
] as const;

const ELEVATION_PRESETS = [
  { key: "low", value: -25 },
  { key: "eye", value: 0 },
  { key: "elevated", value: 30 },
  { key: "high", value: 55 },
] as const;

const DISTANCE_PRESETS = [
  { key: "wide", value: 1 },
  { key: "medium", value: 4 },
  { key: "close", value: 8 },
] as const;

const SCENE_CENTER = new THREE.Vector3(0, 0.5, 0);
const AZIMUTH_RADIUS = 1.8;
const ELEVATION_RADIUS = 1.4;
const ELEVATION_ARC_X = -0.8;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function normalizeAzimuth(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(((value % 360) + 360) % 360);
}

function normalizeElevation(value: number): number {
  return Math.round(clamp(value, -30, 60));
}

function normalizeZoom(value: number): number {
  return Math.round(clamp(value, 0, 10) * 10) / 10;
}

function resolveDirection(angle: number): AngleLabelSet {
  const normalized = normalizeAzimuth(angle);
  if (normalized < 22.5 || normalized >= 337.5) {
    return { prompt: "front view", labelKey: "front", shortEn: "front" };
  }
  if (normalized < 67.5) {
    return {
      prompt: "front-right quarter view",
      labelKey: "frontRight",
      shortEn: "front-right",
    };
  }
  if (normalized < 112.5) {
    return {
      prompt: "right side view",
      labelKey: "right",
      shortEn: "right side",
    };
  }
  if (normalized < 157.5) {
    return {
      prompt: "back-right quarter view",
      labelKey: "backRight",
      shortEn: "back-right",
    };
  }
  if (normalized < 202.5) {
    return { prompt: "back view", labelKey: "back", shortEn: "back" };
  }
  if (normalized < 247.5) {
    return {
      prompt: "back-left quarter view",
      labelKey: "backLeft",
      shortEn: "back-left",
    };
  }
  if (normalized < 292.5) {
    return { prompt: "left side view", labelKey: "left", shortEn: "left side" };
  }
  return {
    prompt: "front-left quarter view",
    labelKey: "frontLeft",
    shortEn: "front-left",
  };
}

function resolveElevation(value: number): AngleLabelSet {
  const normalized = normalizeElevation(value);
  if (normalized < -15) {
    return { prompt: "low-angle shot", labelKey: "low", shortEn: "low angle" };
  }
  if (normalized < 15) {
    return { prompt: "eye-level shot", labelKey: "eye", shortEn: "eye level" };
  }
  if (normalized < 45) {
    return {
      prompt: "elevated shot",
      labelKey: "elevated",
      shortEn: "elevated",
    };
  }
  return { prompt: "high-angle shot", labelKey: "high", shortEn: "high angle" };
}

function resolveDistance(value: number): AngleLabelSet {
  const normalized = normalizeZoom(value);
  if (normalized < 2) {
    return { prompt: "wide shot", labelKey: "wide", shortEn: "wide shot" };
  }
  if (normalized < 6) {
    return {
      prompt: "medium shot",
      labelKey: "medium",
      shortEn: "medium shot",
    };
  }
  return { prompt: "close-up", labelKey: "close", shortEn: "close-up" };
}

function pickClosestAspectRatio(
  targetRatio: number,
  supportedAspectRatios: string[],
): string {
  const supported =
    supportedAspectRatios.length > 0 ? supportedAspectRatios : ["1:1"];
  let bestValue = supported[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const aspectRatio of supported) {
    const ratio = parseAspectRatio(aspectRatio);
    const distance = Math.abs(Math.log(ratio / targetRatio));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestValue = aspectRatio;
    }
  }

  return bestValue;
}

function buildMultiAnglePrompt(options: {
  horizontalAngle: number;
  verticalAngle: number;
  zoom: number;
}): string {
  const azimuth = normalizeAzimuth(options.horizontalAngle);
  const elevation = normalizeElevation(options.verticalAngle);
  const zoom = normalizeZoom(options.zoom);
  const direction = resolveDirection(azimuth);
  const elevationLabel = resolveElevation(elevation);
  const distance = resolveDistance(zoom);

  return [
    `<sks> ${direction.prompt} ${elevationLabel.prompt} ${distance.prompt}.`,
    `Rotate the subject to a ${azimuth}-degree ${direction.prompt}, with a ${elevation}-degree ${elevationLabel.prompt}, ${distance.prompt}.`,
    "Keep the same subject identity, outfit, materials, art style, lighting mood, and background continuity from the reference image.",
    "Generate a coherent new camera angle rather than simply warping or cropping the original image.",
  ].join(" ");
}

function resolveCameraPosition(
  horizontalAngle: number,
  verticalAngle: number,
  zoom: number,
): THREE.Vector3 {
  const azimuth = THREE.MathUtils.degToRad(normalizeAzimuth(horizontalAngle));
  const elevation = THREE.MathUtils.degToRad(normalizeElevation(verticalAngle));
  const distance = 2.6 - (normalizeZoom(zoom) / 10) * 2.0;
  return new THREE.Vector3(
    distance * Math.sin(azimuth) * Math.cos(elevation),
    SCENE_CENTER.y + distance * Math.sin(elevation),
    distance * Math.cos(azimuth) * Math.cos(elevation),
  );
}

function createGridTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  const size = 256;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  context.fillStyle = "#15151f";
  context.fillRect(0, 0, size, size);
  context.strokeStyle = "#2a2a3a";
  context.lineWidth = 1;
  for (let position = 0; position <= size; position += 16) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, position);
    context.lineTo(size, position);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  return texture;
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((item) => disposeMaterial(item));
    return;
  }
  const maybeTexturedMaterial = material as THREE.Material & {
    map?: THREE.Texture | null;
  };
  maybeTexturedMaterial.map?.dispose();
  material.dispose();
}

function stopCanvasEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  if ("stopImmediatePropagation" in event) {
    event.stopImmediatePropagation();
  }
}

function resolveUnscaledElementSize(element: HTMLElement): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(
      1,
      Math.round(element.clientWidth || element.offsetWidth || 1),
    ),
    height: Math.max(
      1,
      Math.round(element.clientHeight || element.offsetHeight || 1),
    ),
  };
}

function MultiAngleScene({
  sourceImageUrl,
  fallbackImageUrl,
  horizontalAngle,
  verticalAngle,
  zoom,
  cameraView,
  onActivate,
  onAnglesChange,
}: MultiAngleSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const anglesRef = useRef({
    horizontalAngle,
    verticalAngle,
    zoom,
    cameraView,
  });
  const onActivateRef = useRef(onActivate);
  const onAnglesChangeRef = useRef(onAnglesChange);

  useEffect(() => {
    anglesRef.current = { horizontalAngle, verticalAngle, zoom, cameraView };
  }, [cameraView, horizontalAngle, verticalAngle, zoom]);

  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    onAnglesChangeRef.current = onAnglesChange;
  }, [onAnglesChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return undefined;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.classList.add("nodrag", "nowheel");
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.inset = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(4, 3.5, 4);
    camera.lookAt(SCENE_CENTER);
    const previewCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    let activeCamera: THREE.Camera = camera;

    const ambient = new THREE.AmbientLight(0xffffff, 0.52);
    scene.add(ambient);
    const mainLight = new THREE.DirectionalLight(0xffffff, 0.9);
    mainLight.position.set(5, 8, 5);
    scene.add(mainLight);
    const accentLight = new THREE.DirectionalLight(0xe93d82, 0.26);
    accentLight.position.set(-5, 4, -5);
    scene.add(accentLight);

    const gridHelper = new THREE.GridHelper(5, 20, 0x242437, 0x14141f);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    const cardGeometry = new THREE.BoxGeometry(1.2, 1.2, 0.025);
    const frontMaterial = new THREE.MeshBasicMaterial({ color: 0x3a3a4a });
    const backMaterial = new THREE.MeshBasicMaterial({
      map: createGridTexture(),
    });
    const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x14141f });
    const card = new THREE.Mesh(cardGeometry, [
      edgeMaterial,
      edgeMaterial,
      edgeMaterial,
      edgeMaterial,
      frontMaterial,
      backMaterial,
    ]);
    card.position.copy(SCENE_CENTER);
    scene.add(card);

    const cardFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(cardGeometry),
      new THREE.LineBasicMaterial({
        color: 0xe93d82,
        transparent: true,
        opacity: 0.9,
      }),
    );
    cardFrame.position.copy(SCENE_CENTER);
    scene.add(cardFrame);

    const glowRing = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.58, 64),
      new THREE.MeshBasicMaterial({
        color: 0xe93d82,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      }),
    );
    glowRing.rotation.x = -Math.PI / 2;
    glowRing.position.y = 0.01;
    scene.add(glowRing);

    const groundRing = new THREE.Mesh(
      new THREE.TorusGeometry(AZIMUTH_RADIUS, 0.04, 16, 100),
      new THREE.MeshBasicMaterial({
        color: 0xe93d82,
        transparent: true,
        opacity: 0.72,
      }),
    );
    groundRing.rotation.x = Math.PI / 2;
    groundRing.position.y = 0.02;
    scene.add(groundRing);

    const azimuthHandle = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xe93d82,
        emissive: 0xe93d82,
        emissiveIntensity: 0.55,
        metalness: 0.25,
        roughness: 0.35,
      }),
    );
    scene.add(azimuthHandle);

    const azimuthGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xe93d82,
        transparent: true,
        opacity: 0.22,
      }),
    );
    scene.add(azimuthGlow);

    const elevationArcPoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 40; index += 1) {
      const angle = THREE.MathUtils.degToRad(-30 + (90 * index) / 40);
      elevationArcPoints.push(
        new THREE.Vector3(
          ELEVATION_ARC_X,
          SCENE_CENTER.y + ELEVATION_RADIUS * Math.sin(angle),
          ELEVATION_RADIUS * Math.cos(angle),
        ),
      );
    }
    const elevationArcCurve = new THREE.CatmullRomCurve3(elevationArcPoints);
    const elevationArc = new THREE.Mesh(
      new THREE.TubeGeometry(elevationArcCurve, 40, 0.04, 8, false),
      new THREE.MeshBasicMaterial({
        color: 0x00ffd0,
        transparent: true,
        opacity: 0.82,
      }),
    );
    scene.add(elevationArc);

    const elevationHandle = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0x00ffd0,
        emissive: 0x00ffd0,
        emissiveIntensity: 0.55,
        metalness: 0.25,
        roughness: 0.35,
      }),
    );
    scene.add(elevationHandle);

    const elevationGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0x00ffd0,
        transparent: true,
        opacity: 0.22,
      }),
    );
    scene.add(elevationGlow);

    const cameraMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.4, 4),
      new THREE.MeshStandardMaterial({
        color: 0xe93d82,
        emissive: 0xe93d82,
        emissiveIntensity: 0.5,
        metalness: 0.55,
        roughness: 0.25,
      }),
    );
    scene.add(cameraMarker);

    const cameraGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xff6ba8,
        transparent: true,
        opacity: 0.8,
      }),
    );
    scene.add(cameraGlow);

    const distanceHandle = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0xffb800,
        emissive: 0xffb800,
        emissiveIntensity: 0.65,
        metalness: 0.35,
        roughness: 0.25,
      }),
    );
    scene.add(distanceHandle);

    const distanceGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffb800,
        transparent: true,
        opacity: 0.26,
      }),
    );
    scene.add(distanceGlow);

    let distanceTube: THREE.Mesh | null = null;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    let frontTexture: THREE.Texture | null = null;
    let disposed = false;

    const updateImage = async (
      primaryUrl: string | null,
      fallbackUrl?: string | null,
    ) => {
      frontTexture?.dispose();
      frontTexture = null;
      frontMaterial.map = null;
      frontMaterial.color.set(0x3a3a4a);
      frontMaterial.needsUpdate = true;
      card.scale.set(1, 1, 1);
      cardFrame.scale.set(1, 1, 1);

      const imageCandidates = [primaryUrl, fallbackUrl]
        .map((candidate) =>
          typeof candidate === "string" ? candidate.trim() : "",
        )
        .filter(
          (candidate, index, list) =>
            candidate && list.indexOf(candidate) === index,
        );

      if (imageCandidates.length === 0) {
        return;
      }

      for (const candidate of imageCandidates) {
        try {
          const image = await loadImageElement(candidate);
          if (disposed) {
            return;
          }

          frontTexture?.dispose();
          frontTexture = new THREE.Texture(image);
          frontTexture.colorSpace = THREE.SRGBColorSpace;
          frontTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
          frontTexture.minFilter = THREE.LinearMipmapLinearFilter;
          frontTexture.magFilter = THREE.LinearFilter;
          frontTexture.needsUpdate = true;
          frontMaterial.map = frontTexture;
          frontMaterial.color.set(0xffffff);
          frontMaterial.needsUpdate = true;

          const imageAspectRatio = image.naturalWidth / image.naturalHeight;
          const maxSize = 1.55;
          const scaleX =
            imageAspectRatio > 1 ? maxSize : maxSize * imageAspectRatio;
          const scaleY =
            imageAspectRatio > 1 ? maxSize / imageAspectRatio : maxSize;
          card.scale.set(scaleX, scaleY, 1);
          cardFrame.scale.set(scaleX, scaleY, 1);
          return;
        } catch {
          // Try the next source candidate. The thumbnail overlay still shows
          // the image if the browser can resolve a later fallback.
        }
      }

      if (!disposed) {
        frontMaterial.map = null;
        frontMaterial.color.set(0x3a3a4a);
        frontMaterial.needsUpdate = true;
      }
    };
    void updateImage(sourceImageUrl, fallbackImageUrl);

    const resize = () => {
      const { width, height } = resolveUnscaledElementSize(host);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      previewCamera.aspect = width / height;
      previewCamera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    window.addEventListener("resize", resize);
    resize();

    let dragging = false;
    let dragTarget: "azimuth" | "elevation" | "distance" | "orbit" | null =
      null;
    let startX = 0;
    let startY = 0;
    let startHorizontal = 0;
    let startVertical = 0;

    const handles = [
      { mesh: azimuthHandle, glow: azimuthGlow, name: "azimuth" as const },
      {
        mesh: elevationHandle,
        glow: elevationGlow,
        name: "elevation" as const,
      },
      { mesh: distanceHandle, glow: distanceGlow, name: "distance" as const },
    ];

    const updateMouse = (event: PointerEvent | WheelEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const setHandleScale = (
      handle: THREE.Mesh,
      glow: THREE.Mesh,
      scale: number,
    ) => {
      handle.scale.setScalar(scale);
      glow.scale.setScalar(scale);
    };

    const handlePointerDown = (event: PointerEvent) => {
      onActivateRef.current();
      stopCanvasEvent(event);
      updateMouse(event);
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startHorizontal = anglesRef.current.horizontalAngle;
      startVertical = anglesRef.current.verticalAngle;
      dragTarget = "orbit";
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture?.(event.pointerId);

      if (!anglesRef.current.cameraView) {
        raycaster.setFromCamera(mouse, camera);
        for (const handle of handles) {
          if (raycaster.intersectObject(handle.mesh).length > 0) {
            dragTarget = handle.name;
            setHandleScale(handle.mesh, handle.glow, 1.3);
            return;
          }
        }
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      event.stopPropagation();
      updateMouse(event);
      if (!dragging) {
        if (!anglesRef.current.cameraView) {
          raycaster.setFromCamera(mouse, camera);
          let hovered = false;
          for (const handle of handles) {
            if (raycaster.intersectObject(handle.mesh).length > 0) {
              setHandleScale(handle.mesh, handle.glow, 1.15);
              renderer.domElement.style.cursor = "grab";
              hovered = true;
            } else {
              setHandleScale(handle.mesh, handle.glow, 1);
            }
          }
          if (!hovered) {
            renderer.domElement.style.cursor = "grab";
          }
        }
        return;
      }

      raycaster.setFromCamera(mouse, camera);
      const intersect = new THREE.Vector3();

      if (dragTarget === "azimuth") {
        const azimuthPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        if (raycaster.ray.intersectPlane(azimuthPlane, intersect)) {
          let nextAngle = THREE.MathUtils.radToDeg(
            Math.atan2(intersect.x, intersect.z),
          );
          if (nextAngle < 0) {
            nextAngle += 360;
          }
          onAnglesChangeRef.current({
            horizontalAngle: normalizeAzimuth(nextAngle),
          });
        }
        return;
      }

      if (dragTarget === "elevation") {
        const elevationPlane = new THREE.Plane(
          new THREE.Vector3(1, 0, 0),
          -ELEVATION_ARC_X,
        );
        if (raycaster.ray.intersectPlane(elevationPlane, intersect)) {
          const relativeY = intersect.y - SCENE_CENTER.y;
          const nextAngle = THREE.MathUtils.radToDeg(
            Math.atan2(relativeY, intersect.z),
          );
          onAnglesChangeRef.current({
            verticalAngle: normalizeElevation(nextAngle),
          });
        }
        return;
      }

      if (dragTarget === "distance") {
        onAnglesChangeRef.current({
          zoom: normalizeZoom(5 - mouse.y * 5),
        });
        return;
      }

      onAnglesChangeRef.current({
        horizontalAngle: normalizeAzimuth(
          startHorizontal - (event.clientX - startX) * 0.5,
        ),
        verticalAngle: normalizeElevation(
          startVertical + (event.clientY - startY) * 0.5,
        ),
      });
    };

    const handlePointerUp = (event: PointerEvent) => {
      event.stopPropagation();
      dragging = false;
      dragTarget = null;
      renderer.domElement.style.cursor = anglesRef.current.cameraView
        ? "grab"
        : "grab";
      handles.forEach((handle) => setHandleScale(handle.mesh, handle.glow, 1));
      renderer.domElement.releasePointerCapture?.(event.pointerId);
    };

    const handleWheel = (event: WheelEvent) => {
      stopCanvasEvent(event);
      const delta = event.deltaY > 0 ? -0.4 : 0.4;
      onAnglesChangeRef.current({
        zoom: normalizeZoom(anglesRef.current.zoom + delta),
      });
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    renderer.domElement.addEventListener("wheel", handleWheel, {
      passive: false,
    });

    let animationFrame = 0;
    let lastDistanceLineKey = "";
    const updateDistanceLine = (start: THREE.Vector3, end: THREE.Vector3) => {
      if (distanceTube) {
        scene.remove(distanceTube);
        distanceTube.geometry.dispose();
        disposeMaterial(distanceTube.material);
      }
      const path = new THREE.LineCurve3(start, end);
      distanceTube = new THREE.Mesh(
        new THREE.TubeGeometry(path, 1, 0.025, 8, false),
        new THREE.MeshBasicMaterial({
          color: 0xffb800,
          transparent: true,
          opacity: 0.82,
        }),
      );
      scene.add(distanceTube);
    };

    const render = () => {
      const { width, height } = resolveUnscaledElementSize(host);
      const canvas = renderer.domElement;
      const targetPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      if (
        renderer.getPixelRatio() !== targetPixelRatio ||
        canvas.width !== Math.round(width * targetPixelRatio) ||
        canvas.height !== Math.round(height * targetPixelRatio)
      ) {
        resize();
      }

      const current = anglesRef.current;
      const azimuth = THREE.MathUtils.degToRad(
        normalizeAzimuth(current.horizontalAngle),
      );
      const elevation = THREE.MathUtils.degToRad(
        normalizeElevation(current.verticalAngle),
      );
      const markerPosition = resolveCameraPosition(
        current.horizontalAngle,
        current.verticalAngle,
        current.zoom,
      );
      cameraMarker.position.copy(markerPosition);
      cameraMarker.lookAt(SCENE_CENTER);
      cameraMarker.rotateX(Math.PI / 2);
      cameraGlow.position.copy(markerPosition);

      const azimuthX = AZIMUTH_RADIUS * Math.sin(azimuth);
      const azimuthZ = AZIMUTH_RADIUS * Math.cos(azimuth);
      azimuthHandle.position.set(azimuthX, 0.16, azimuthZ);
      azimuthGlow.position.copy(azimuthHandle.position);

      const elevationY =
        SCENE_CENTER.y + ELEVATION_RADIUS * Math.sin(elevation);
      const elevationZ = ELEVATION_RADIUS * Math.cos(elevation);
      elevationHandle.position.set(ELEVATION_ARC_X, elevationY, elevationZ);
      elevationGlow.position.copy(elevationHandle.position);

      const distanceT = 0.15 + ((10 - normalizeZoom(current.zoom)) / 10) * 0.7;
      distanceHandle.position.lerpVectors(
        SCENE_CENTER,
        markerPosition,
        distanceT,
      );
      distanceGlow.position.copy(distanceHandle.position);
      const distanceLineKey = [
        markerPosition.x.toFixed(3),
        markerPosition.y.toFixed(3),
        markerPosition.z.toFixed(3),
      ].join(":");
      if (distanceLineKey !== lastDistanceLineKey) {
        lastDistanceLineKey = distanceLineKey;
        updateDistanceLine(SCENE_CENTER.clone(), markerPosition.clone());
      }

      previewCamera.position.copy(markerPosition);
      previewCamera.lookAt(SCENE_CENTER);

      glowRing.rotation.z += 0.003;

      if (current.cameraView) {
        activeCamera = previewCamera;
        groundRing.visible = false;
        azimuthHandle.visible = false;
        azimuthGlow.visible = false;
        elevationArc.visible = false;
        elevationHandle.visible = false;
        elevationGlow.visible = false;
        distanceHandle.visible = false;
        distanceGlow.visible = false;
        cameraMarker.visible = false;
        cameraGlow.visible = false;
        glowRing.visible = false;
        gridHelper.visible = false;
        cardFrame.visible = false;
        if (distanceTube) {
          distanceTube.visible = false;
        }
      } else {
        activeCamera = camera;
        groundRing.visible = true;
        azimuthHandle.visible = true;
        azimuthGlow.visible = true;
        elevationArc.visible = true;
        elevationHandle.visible = true;
        elevationGlow.visible = true;
        distanceHandle.visible = true;
        distanceGlow.visible = true;
        cameraMarker.visible = true;
        cameraGlow.visible = true;
        glowRing.visible = true;
        gridHelper.visible = true;
        cardFrame.visible = true;
        if (distanceTube) {
          distanceTube.visible = true;
        }
      }

      renderer.render(scene, activeCamera);
      animationFrame = window.requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      renderer.domElement.removeEventListener("wheel", handleWheel);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        const material = mesh.material;
        if (material) {
          disposeMaterial(material);
        }
      });
      frontTexture?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.width = 1;
      renderer.domElement.height = 1;
      renderer.domElement.remove();
    };
  }, [fallbackImageUrl, sourceImageUrl]);

  return (
    <div
      ref={hostRef}
      className="nodrag nowheel relative h-full w-full cursor-grab touch-none active:cursor-grabbing"
      onClick={(event) => {
        onActivate();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        onActivate();
        event.stopPropagation();
      }}
      onWheel={(event) => event.stopPropagation()}
    />
  );
}

export const MultiAngleImageNode = memo(
  ({ id, data, selected, width, height }: MultiAngleImageNodeProps) => {
    const { t } = useTranslation();
    const updateNodeInternals = useUpdateNodeInternals();
    const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
    const updateNodeData = useCanvasStore((state) => state.updateNodeData);
    const addNode = useCanvasStore((state) => state.addNode);
    const addEdge = useCanvasStore((state) => state.addEdge);
    const findNodePosition = useCanvasStore((state) => state.findNodePosition);
    const incomingSourceNodes = useCanvasIncomingSourceNodes(id);
    const storyboardApiKeys = useSettingsStore(
      (state) => state.storyboardApiKeys,
    );
    const storyboardCompatibleModelConfig = useSettingsStore(
      (state) => state.storyboardCompatibleModelConfig,
    );
    const storyboardApi2OkModelConfig = useSettingsStore(
      (state) => state.storyboardApi2OkModelConfig,
    );
    const storyboardNewApiModelConfig = useSettingsStore(
      (state) => state.storyboardNewApiModelConfig,
    );
    const storyboardNewApiModelConfigs = useSettingsStore(
      (state) => state.storyboardNewApiModelConfigs,
    );
    const storyboardProviderCustomModels = useSettingsStore(
      (state) => state.storyboardProviderCustomModels,
    );
    const hrsaiNanoBananaProModel = useSettingsStore(
      (state) => state.hrsaiNanoBananaProModel,
    );
    const lastImageGenerationExtraParams = useSettingsStore(
      (state) => state.lastImageGenerationExtraParams,
    );
    const setLastImageGenerationExtraParams = useSettingsStore(
      (state) => state.setLastImageGenerationExtraParams,
    );
    const setLastImageEditDefaults = useSettingsStore(
      (state) => state.setLastImageEditDefaults,
    );
    const isOverviewRender = useIsOverviewCanvasRender();

    const [error, setError] = useState<string | null>(null);

    const imageModels = useMemo(
      () =>
        listImageModels(
          storyboardCompatibleModelConfig,
          storyboardNewApiModelConfig,
          storyboardApi2OkModelConfig,
          storyboardProviderCustomModels,
          storyboardNewApiModelConfigs,
        ),
      [
        storyboardApi2OkModelConfig,
        storyboardCompatibleModelConfig,
        storyboardNewApiModelConfig,
        storyboardProviderCustomModels,
        storyboardNewApiModelConfigs,
      ],
    );

    const selectedModel = useMemo(
      () =>
        getImageModel(
          data.model ?? DEFAULT_IMAGE_MODEL_ID,
          storyboardCompatibleModelConfig,
          storyboardNewApiModelConfig,
          storyboardApi2OkModelConfig,
          storyboardProviderCustomModels,
          storyboardNewApiModelConfigs,
        ),
      [
        data.model,
        storyboardApi2OkModelConfig,
        storyboardCompatibleModelConfig,
        storyboardNewApiModelConfig,
        storyboardProviderCustomModels,
        storyboardNewApiModelConfigs,
      ],
    );

    const sourceImages = useMemo(
      () =>
        incomingSourceNodes
          .map(({ node }) => resolveSingleImageConnectionSource(node))
          .filter((source): source is NonNullable<typeof source> =>
            Boolean(source),
          ),
      [incomingSourceNodes],
    );
    const sourceImage = sourceImages[0] ?? null;
    const hasMultipleSourceImages = sourceImages.length > 1;

    const resolvedCompatibleModelConfig = useMemo(
      () =>
        isStoryboardCompatibleModelId(selectedModel.id)
          ? resolveStoryboardCompatibleModelConfigForModel(
              selectedModel.id,
              storyboardCompatibleModelConfig,
              storyboardProviderCustomModels,
            )
          : storyboardCompatibleModelConfig,
      [
        selectedModel.id,
        storyboardCompatibleModelConfig,
        storyboardProviderCustomModels,
        storyboardNewApiModelConfigs,
      ],
    );
    const resolvedApi2OkModelConfig = useMemo(
      () =>
        isStoryboardApi2OkModelId(selectedModel.id)
          ? resolveStoryboardApi2OkModelConfigForModel(
              selectedModel.id,
              storyboardApi2OkModelConfig,
              storyboardProviderCustomModels,
            )
          : storyboardApi2OkModelConfig,
      [
        selectedModel.id,
        storyboardApi2OkModelConfig,
        storyboardProviderCustomModels,
        storyboardNewApiModelConfigs,
      ],
    );
    const resolvedModelExtraParams = useMemo(
      () =>
        resolveImageModelExtraParams(
          selectedModel,
          selectedModel.defaultExtraParams,
          lastImageGenerationExtraParams,
          data.extraParams,
        ),
      [data.extraParams, lastImageGenerationExtraParams, selectedModel],
    );
    const requestedNewApiResolution = useMemo(
      () =>
        isStoryboardNewApiModelId(selectedModel.id)
          ? resolveImageModelResolution(selectedModel, data.size, {
              extraParams: resolvedModelExtraParams,
            }).value
          : null,
      [data.size, resolvedModelExtraParams, selectedModel],
    );
    const resolvedNewApiModelConfig = useMemo(
      () =>
        isStoryboardNewApiModelId(selectedModel.id)
          ? resolveStoryboardNewApiModelConfigForModel(
              selectedModel.id,
              storyboardNewApiModelConfig,
              storyboardProviderCustomModels,
              storyboardNewApiModelConfigs,
              {
                resolution: requestedNewApiResolution,
                extraParams: resolvedModelExtraParams,
              },
            )
          : storyboardNewApiModelConfig,
      [
        requestedNewApiResolution,
        resolvedModelExtraParams,
        selectedModel.id,
        storyboardNewApiModelConfig,
        storyboardNewApiModelConfigs,
        storyboardProviderCustomModels,
        storyboardNewApiModelConfigs,
      ],
    );
    const requestedOopiiResolution = useMemo(
      () =>
        isStoryboardOopiiModelId(selectedModel.id)
          ? resolveImageModelResolution(selectedModel, data.size, {
              extraParams: resolvedModelExtraParams,
            }).value
          : null,
      [data.size, resolvedModelExtraParams, selectedModel],
    );
    const resolvedOopiiModelConfig = useMemo(
      () =>
        isStoryboardOopiiModelId(selectedModel.id)
          ? resolveStoryboardOopiiModelConfigForModel(
              selectedModel.id,
              storyboardProviderCustomModels,
              {
                resolution: requestedOopiiResolution,
                extraParams: resolvedModelExtraParams,
              },
            )
          : resolveStoryboardOopiiModelConfigForModel(
              null,
              storyboardProviderCustomModels,
            ),
      [
        requestedOopiiResolution,
        resolvedModelExtraParams,
        selectedModel.id,
        storyboardProviderCustomModels,
        storyboardNewApiModelConfigs,
      ],
    );
    const effectiveExtraParams = useMemo(
      () => ({
        ...resolvedModelExtraParams,
        ...(selectedModel.id === GRSAI_NANO_BANANA_PRO_MODEL_ID
          ? { grsai_pro_model: hrsaiNanoBananaProModel }
          : {}),
        ...(isStoryboardCompatibleModelId(selectedModel.id)
          ? {
              compatible_config: toStoryboardCompatibleExtraParamsPayload(
                resolvedCompatibleModelConfig,
              ),
            }
          : isStoryboardOopiiModelId(selectedModel.id)
            ? {
                newapi_config: toStoryboardNewApiExtraParamsPayload(
                  resolvedOopiiModelConfig,
                ),
              }
            : isStoryboardNewApiModelId(selectedModel.id)
              ? {
                  newapi_config: toStoryboardNewApiExtraParamsPayload(
                    resolvedNewApiModelConfig,
                  ),
                }
              : isStoryboardApi2OkModelId(selectedModel.id)
                ? {
                    api2ok_config: toStoryboardApi2OkExtraParamsPayload(
                      resolvedApi2OkModelConfig,
                    ),
                  }
                : {}),
      }),
      [
        hrsaiNanoBananaProModel,
        resolvedApi2OkModelConfig,
        resolvedCompatibleModelConfig,
        resolvedModelExtraParams,
        resolvedNewApiModelConfig,
        resolvedOopiiModelConfig,
        selectedModel.id,
      ],
    );

    const resolutionOptions = useMemo(
      () =>
        resolveImageModelResolutions(selectedModel, {
          extraParams: effectiveExtraParams,
        }),
      [effectiveExtraParams, selectedModel],
    );
    const selectedResolution = useMemo(
      () =>
        resolveImageModelResolution(selectedModel, data.size, {
          extraParams: effectiveExtraParams,
        }),
      [data.size, effectiveExtraParams, selectedModel],
    );
    const aspectRatioOptions = useMemo<AspectRatioOption[]>(
      () => [
        {
          value: AUTO_REQUEST_ASPECT_RATIO,
          label: t("modelParams.autoAspectRatio"),
        },
        ...selectedModel.aspectRatios,
      ],
      [selectedModel.aspectRatios, t],
    );
    const normalizedRequestAspectRatio = useMemo(
      () =>
        selectedModel.id === GRSAI_GPT_IMAGE_2_MODEL_ID
          ? (normalizeGrsaiGptImage2AspectRatio(data.requestAspectRatio) ??
            AUTO_REQUEST_ASPECT_RATIO)
          : data.requestAspectRatio,
      [data.requestAspectRatio, selectedModel.id],
    );
    const selectedAspectRatio = useMemo(
      () =>
        aspectRatioOptions.find(
          (item) => item.value === normalizedRequestAspectRatio,
        ) ?? aspectRatioOptions[0],
      [aspectRatioOptions, normalizedRequestAspectRatio],
    );
    const supportedAspectRatioValues = useMemo(
      () => selectedModel.aspectRatios.map((item) => item.value),
      [selectedModel.aspectRatios],
    );
    const requestResolution = selectedModel.resolveRequest({
      referenceImageCount: 1,
    });
    const debugRequestModel = useMemo(
      () =>
        isStoryboardCompatibleModelId(selectedModel.id)
          ? resolvedCompatibleModelConfig.requestModel
          : isStoryboardOopiiModelId(selectedModel.id)
            ? resolvedOopiiModelConfig.requestModel
            : isStoryboardNewApiModelId(selectedModel.id)
              ? resolvedNewApiModelConfig.requestModel
              : isStoryboardApi2OkModelId(selectedModel.id)
                ? resolvedApi2OkModelConfig.requestModel
                : requestResolution.requestModel,
      [
        requestResolution.requestModel,
        resolvedApi2OkModelConfig.requestModel,
        resolvedCompatibleModelConfig.requestModel,
        resolvedNewApiModelConfig.requestModel,
        resolvedOopiiModelConfig.requestModel,
        selectedModel.id,
      ],
    );

    const horizontalAngle = normalizeAzimuth(data.horizontalAngle);
    const verticalAngle = normalizeElevation(data.verticalAngle);
    const zoom = normalizeZoom(data.zoom);
    const direction = resolveDirection(horizontalAngle);
    const elevation = resolveElevation(verticalAngle);
    const distance = resolveDistance(zoom);
    const providerApiKey = storyboardApiKeys[selectedModel.providerId] ?? "";
    const resolvedWidth = Math.max(
      MULTI_ANGLE_NODE_MIN_WIDTH,
      Math.round(width ?? MULTI_ANGLE_IMAGE_NODE_DEFAULT_WIDTH),
    );
    const resolvedHeight = Math.max(
      MULTI_ANGLE_NODE_MIN_HEIGHT,
      Math.round(height ?? MULTI_ANGLE_IMAGE_NODE_DEFAULT_HEIGHT),
    );
    const resolvedTitle = useMemo(
      () => resolveNodeDisplayName(CANVAS_NODE_TYPES.multiAngleImage, data),
      [data],
    );
    const prompt = useMemo(
      () => buildMultiAnglePrompt({ horizontalAngle, verticalAngle, zoom }),
      [horizontalAngle, verticalAngle, zoom],
    );
    const statusText =
      error ??
      (hasMultipleSourceImages
        ? t("node.multiAngleImage.multiInputHint")
        : null) ??
      (sourceImage
        ? t("node.multiAngleImage.statusHint")
        : t("node.multiAngleImage.noInput"));
    const showBlockingOverlay = Boolean(data.isGenerating);
    const headerRightSlot = data.isGenerating ? (
      <NodeStatusBadge
        icon={<Loader2 className="h-3 w-3" />}
        label={t("nodeStatus.submitting")}
        tone="processing"
        animate
      />
    ) : error ? (
      <NodeStatusBadge
        icon={<AlertTriangle className="h-3 w-3" />}
        label={t("nodeStatus.error")}
        tone="danger"
        title={error}
      />
    ) : undefined;
    const activateNode = useCallback(() => {
      setSelectedNode(id);
    }, [id, setSelectedNode]);

    useEffect(() => {
      updateNodeInternals(id);
    }, [id, resolvedHeight, resolvedWidth, updateNodeInternals]);

    const handleAnglesChange = useCallback(
      (nextValue: {
        horizontalAngle?: number;
        verticalAngle?: number;
        zoom?: number;
      }) => {
        updateNodeData(
          id,
          {
            ...(typeof nextValue.horizontalAngle === "number"
              ? { horizontalAngle: normalizeAzimuth(nextValue.horizontalAngle) }
              : {}),
            ...(typeof nextValue.verticalAngle === "number"
              ? { verticalAngle: normalizeElevation(nextValue.verticalAngle) }
              : {}),
            ...(typeof nextValue.zoom === "number"
              ? { zoom: normalizeZoom(nextValue.zoom) }
              : {}),
          },
          { historyMode: "skip" },
        );
      },
      [id, updateNodeData],
    );

    const handleModelChange = useCallback(
      (modelId: string) => {
        const nextModel = getImageModel(
          modelId,
          storyboardCompatibleModelConfig,
          storyboardNewApiModelConfig,
          storyboardApi2OkModelConfig,
          storyboardProviderCustomModels,
          storyboardNewApiModelConfigs,
        );
        const nextExtraParams = {
          ...(data.extraParams ?? {}),
          ...(nextModel.id === GRSAI_NANO_BANANA_PRO_MODEL_ID
            ? { grsai_pro_model: hrsaiNanoBananaProModel }
            : {}),
        };
        const nextResolution = resolveImageModelResolution(
          nextModel,
          data.size,
          {
            extraParams: nextExtraParams,
          },
        );
        const normalizedNextRequestAspectRatio =
          nextModel.id === GRSAI_GPT_IMAGE_2_MODEL_ID
            ? normalizeGrsaiGptImage2AspectRatio(data.requestAspectRatio)
            : data.requestAspectRatio;
        const nextRequestAspectRatio =
          normalizedNextRequestAspectRatio === AUTO_REQUEST_ASPECT_RATIO ||
          nextModel.aspectRatios.some(
            (aspectRatio) =>
              aspectRatio.value === normalizedNextRequestAspectRatio,
          )
            ? (normalizedNextRequestAspectRatio ?? AUTO_REQUEST_ASPECT_RATIO)
            : AUTO_REQUEST_ASPECT_RATIO;

        updateNodeData(id, {
          model: nextModel.id,
          size: nextResolution.value as ImageSize,
          requestAspectRatio: nextRequestAspectRatio,
        });
        setLastImageEditDefaults({
          modelId: nextModel.id,
          size: nextResolution.value as ImageSize,
          requestAspectRatio: nextRequestAspectRatio,
        });
      },
      [
        data.extraParams,
        data.requestAspectRatio,
        data.size,
        hrsaiNanoBananaProModel,
        id,
        setLastImageEditDefaults,
        storyboardApi2OkModelConfig,
        storyboardCompatibleModelConfig,
        storyboardNewApiModelConfig,
        storyboardProviderCustomModels,
        updateNodeData,
      ],
    );

    const handleGenerate = useCallback(async () => {
      if (!sourceImage) {
        const errorMessage = t("node.multiAngleImage.sourceRequired");
        setError(errorMessage);
        void showErrorDialog(errorMessage, t("common.error"));
        return;
      }

      if (!providerApiKey) {
        const errorMessage = t("node.multiAngleImage.apiKeyRequired");
        setError(errorMessage);
        openSettingsDialog({
          category: "providers",
          providerTab: "storyboard",
          providerId: selectedModel.providerId,
        });
        void showErrorDialog(errorMessage, t("common.error"));
        return;
      }

      const generationDurationMs = selectedModel.expectedDurationMs ?? 60000;
      const generationStartedAt = Date.now();
      const sourceAspectRatioValue = parseAspectRatio(sourceImage.aspectRatio);
      const initialRequestAspectRatio =
        selectedAspectRatio.value === AUTO_REQUEST_ASPECT_RATIO
          ? pickClosestAspectRatio(
              sourceAspectRatioValue,
              supportedAspectRatioValues,
            )
          : selectedAspectRatio.value;
      const resultNodeTitle = t("node.multiAngleImage.resultTitle", {
        azimuth: horizontalAngle,
        direction: t(`node.multiAngleImage.presets.${direction.labelKey}`),
        elevation: verticalAngle,
        elevationLabel: t(`node.multiAngleImage.presets.${elevation.labelKey}`),
        distance: t(`node.multiAngleImage.presets.${distance.labelKey}`),
      });
      const generationSummary: ExportImageGenerationSummary = {
        sourceType: "multiAngleImage",
        providerId: selectedModel.providerId,
        requestModel: debugRequestModel,
        prompt,
        generatedAt: null,
      };
      const predictedResultSize = resolveMinEdgeFittedSize(
        initialRequestAspectRatio,
        {
          minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
          minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
        },
      );
      const newNodePosition = findNodePosition(
        id,
        predictedResultSize.width,
        predictedResultSize.height,
      );
      const newNodeId = addNode(
        CANVAS_NODE_TYPES.exportImage,
        newNodePosition,
        {
          isGenerating: true,
          generationPhase: "submitting",
          generationFailureStage: null,
          generationStartedAt,
          generationDurationMs,
          resultKind: "generic",
          displayName: resultNodeTitle,
          aspectRatio: initialRequestAspectRatio,
          generationSummary,
        },
        { inheritParentFromNodeId: id },
      );
      addEdge(id, newNodeId);
      updateNodeData(
        id,
        {
          isGenerating: true,
          generationStartedAt,
          generationDurationMs,
          lastError: null,
        },
        { historyMode: "skip" },
      );
      setError(null);

      const runtimeDiagnosticsPromise = getRuntimeDiagnostics();
      let effectiveRequestSize = selectedResolution.value;
      let referenceImageOptimization: GenerationDebugContext["referenceImageOptimization"];
      let resolutionDowngrade: GenerationDebugContext["resolutionDowngrade"];

      try {
        const requestImage = await resolveReadableImageSource(
          sourceImage.imageUrl,
          sourceImage.previewImageUrl,
        );
        await canvasAiGateway.setApiKey(
          selectedModel.providerId,
          providerApiKey,
        );
        const resolvedGeneratePayload =
          await canvasAiGateway.resolveGenerateImagePayload({
            prompt,
            model: requestResolution.requestModel,
            size: selectedResolution.value,
            aspectRatio: initialRequestAspectRatio,
            referenceImages: [requestImage],
            extraParams: effectiveExtraParams,
          });
        effectiveRequestSize = resolvedGeneratePayload.effectiveSize;
        referenceImageOptimization =
          resolvedGeneratePayload.referenceImageOptimization;
        resolutionDowngrade = resolvedGeneratePayload.resolutionDowngrade;
        const generationStatusText = resolutionDowngrade
          ? t("node.imageNode.optimizedReferenceRequestDowngraded")
          : referenceImageOptimization?.applied
            ? t("node.imageNode.optimizedReferenceRequest")
            : null;
        const jobId = await canvasAiGateway.submitGenerateImageJob(
          resolvedGeneratePayload,
        );
        const runtimeDiagnostics = await runtimeDiagnosticsPromise;
        const generationDebugContext: GenerationDebugContext = {
          sourceType: "multiAngleImage",
          providerId: selectedModel.providerId,
          requestModel: debugRequestModel,
          requestSize: selectedResolution.value,
          effectiveRequestSize,
          requestAspectRatio: initialRequestAspectRatio,
          prompt,
          extraParams: effectiveExtraParams,
          referenceImageCount: 1,
          referenceImagePlaceholders: createReferenceImagePlaceholders(1),
          referenceImageOptimization,
          resolutionDowngrade,
          appVersion: runtimeDiagnostics.appVersion,
          osName: runtimeDiagnostics.osName,
          osVersion: runtimeDiagnostics.osVersion,
          osBuild: runtimeDiagnostics.osBuild,
          networkProxySummary: runtimeDiagnostics.networkProxySummary,
          userAgent: runtimeDiagnostics.userAgent,
        };
        updateNodeData(newNodeId, {
          isGenerating: true,
          generationJobId: jobId,
          generationPhase: "queued",
          generationFailureStage: null,
          generationStartedAt,
          generationSourceType: "multiAngleImage",
          generationProviderId: selectedModel.providerId,
          generationClientSessionId: CURRENT_RUNTIME_SESSION_ID,
          generationStatusText,
          generationError: null,
          generationErrorDetails: null,
          generationDebugContext,
        });
      } catch (generationError) {
        const resolvedError = resolveErrorContent(
          generationError,
          t("ai.error"),
        );
        const runtimeDiagnostics = await runtimeDiagnosticsPromise;
        const generationDebugContext: GenerationDebugContext = {
          sourceType: "multiAngleImage",
          providerId: selectedModel.providerId,
          requestModel: debugRequestModel,
          requestSize: selectedResolution.value,
          effectiveRequestSize,
          requestAspectRatio: initialRequestAspectRatio,
          prompt,
          extraParams: effectiveExtraParams,
          referenceImageCount: 1,
          referenceImagePlaceholders: createReferenceImagePlaceholders(1),
          referenceImageOptimization,
          resolutionDowngrade,
          appVersion: runtimeDiagnostics.appVersion,
          osName: runtimeDiagnostics.osName,
          osVersion: runtimeDiagnostics.osVersion,
          osBuild: runtimeDiagnostics.osBuild,
          networkProxySummary: runtimeDiagnostics.networkProxySummary,
          userAgent: runtimeDiagnostics.userAgent,
        };
        const reportText = buildGenerationErrorReport({
          errorMessage: resolvedError.message,
          errorDetails: resolvedError.details,
          context: generationDebugContext,
          errorCategory: resolvedError.category,
          statusCode: resolvedError.statusCode,
          traceId: resolvedError.traceId,
          requestId: resolvedError.requestId,
        });
        setError(resolvedError.message);
        void showErrorDialog(
          resolvedError.message,
          t("common.error"),
          resolvedError.details,
          reportText,
        );
        void recordImageGenerationErrorLog({
          nodeId: newNodeId,
          sourceType: "multiAngleImage",
          failureStage: "submit",
          errorMessage: resolvedError.message,
          errorDetails: resolvedError.details,
          context: generationDebugContext,
          errorCategory: resolvedError.category,
          statusCode: resolvedError.statusCode,
          traceId: resolvedError.traceId,
          requestId: resolvedError.requestId,
          providerId: selectedModel.providerId,
          startedAt: generationStartedAt,
        }).catch((error) => {
          console.warn(
            "[MultiAngleImageNode] failed to record error log",
            error,
          );
        });
        updateNodeData(newNodeId, {
          isGenerating: false,
          generationPhase: "failed",
          generationFailureStage: "submit",
          generationStartedAt: null,
          generationJobId: null,
          generationProviderId: null,
          generationClientSessionId: null,
          generationStatusText: null,
          generationError: resolvedError.message,
          generationErrorDetails: resolvedError.details ?? null,
          generationDebugContext,
        });
        updateNodeData(
          id,
          {
            isGenerating: false,
            generationStartedAt: null,
            lastError: resolvedError.message,
          },
          { historyMode: "skip" },
        );
        return;
      }

      updateNodeData(
        id,
        {
          isGenerating: false,
          generationStartedAt: null,
          lastError: null,
        },
        { historyMode: "skip" },
      );
    }, [
      addEdge,
      addNode,
      debugRequestModel,
      direction.labelKey,
      distance.labelKey,
      effectiveExtraParams,
      elevation.labelKey,
      findNodePosition,
      horizontalAngle,
      id,
      prompt,
      providerApiKey,
      requestResolution.requestModel,
      selectedAspectRatio.value,
      selectedModel.expectedDurationMs,
      selectedModel.providerId,
      selectedResolution.value,
      sourceImage,
      supportedAspectRatioValues,
      t,
      updateNodeData,
      verticalAngle,
    ]);

    return (
      <div
        className={`canvas-node-selection-pass-through group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] bg-transparent p-0 transition-all duration-150 ${
          selected ? "shadow-[0_4px_20px_rgba(59,130,246,0.16)]" : ""
        }`}
        style={{ width: `${resolvedWidth}px`, height: `${resolvedHeight}px` }}
        onClick={activateNode}
      >
        <NodeHeader
          className={NODE_HEADER_FLOATING_POSITION_CLASS}
          icon={<Rotate3D className="h-4 w-4" />}
          titleText={resolvedTitle}
          rightSlot={headerRightSlot}
          editable
          onTitleChange={(nextTitle) =>
            updateNodeData(id, { displayName: nextTitle })
          }
        />

        <div
          className={`relative min-h-0 flex-1 overflow-hidden rounded-[var(--node-radius)] border bg-surface-dark/90 ${
            selected
              ? "border-accent shadow-[0_0_0_2px_rgba(59,130,246,0.5),0_4px_20px_rgba(59,130,246,0.2)]"
              : "border-[rgba(15,23,42,0.22)] hover:border-[rgba(15,23,42,0.34)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.12)] dark:border-[rgba(255,255,255,0.22)] dark:hover:border-[rgba(255,255,255,0.34)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
          }`}
        >
          {isOverviewRender ? (
            <div className="relative h-full w-full overflow-hidden bg-bg-dark/70">
              {sourceImage ? (
                <CanvasNodeImage
                  src={sourceImage.previewImageUrl || sourceImage.imageUrl}
                  alt={t("node.multiAngleImage.sourceAlt")}
                  viewerSourceUrl={sourceImage.imageUrl}
                  className="h-full w-full object-cover opacity-80"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-bg-dark/72 px-4 text-text-muted">
                  <Move3D className="h-7 w-7 opacity-70" />
                  <span className="text-center text-xs leading-5">
                    {t("node.multiAngleImage.noInput")}
                  </span>
                </div>
              )}
              <div className="absolute bottom-2 left-2 right-2 truncate rounded-md bg-black/55 px-2 py-1 text-[10px] leading-4 text-white">
                {statusText}
              </div>
            </div>
          ) : (
            <MultiAngleScene
              sourceImageUrl={
                sourceImage?.imageUrl ?? sourceImage?.previewImageUrl ?? null
              }
              fallbackImageUrl={sourceImage?.previewImageUrl ?? null}
              horizontalAngle={horizontalAngle}
              verticalAngle={verticalAngle}
              zoom={zoom}
              cameraView={data.cameraView === true}
              onActivate={activateNode}
              onAnglesChange={handleAnglesChange}
            />
          )}

          {!isOverviewRender && sourceImage ? (
            <div className="pointer-events-auto absolute left-2 top-2 h-16 w-20 overflow-hidden rounded-md border border-[rgba(255,255,255,0.18)] bg-black/20 shadow-lg">
              <CanvasNodeImage
                src={sourceImage.previewImageUrl || sourceImage.imageUrl}
                alt={t("node.multiAngleImage.sourceAlt")}
                viewerSourceUrl={sourceImage.imageUrl}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </div>
          ) : !isOverviewRender ? (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-dark/72 px-4 text-text-muted">
              <Move3D className="h-7 w-7 opacity-70" />
              <span className="text-center text-xs leading-5">
                {t("node.multiAngleImage.noInput")}
              </span>
            </div>
          ) : null}

          {!isOverviewRender ? (
            <div className="absolute bottom-2 left-2 right-2 grid grid-cols-3 gap-2 rounded-lg border border-[rgba(255,255,255,0.12)] bg-black/35 p-2 backdrop-blur">
              <label className="nodrag nowheel min-w-0 text-[10px] leading-4 text-text-muted">
                <span className="mb-1 flex items-center gap-1 text-text-dark">
                  <Rotate3D className="h-3 w-3" />
                  {t("node.multiAngleImage.horizontalAngle")} {horizontalAngle}
                </span>
                <input
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={horizontalAngle}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    handleAnglesChange({
                      horizontalAngle: Number(event.currentTarget.value),
                    })
                  }
                  className="w-full accent-accent"
                />
              </label>
              <label className="nodrag nowheel min-w-0 text-[10px] leading-4 text-text-muted">
                <span className="mb-1 flex items-center gap-1 text-text-dark">
                  <Camera className="h-3 w-3" />
                  {t("node.multiAngleImage.elevation")} {verticalAngle}
                </span>
                <input
                  type="range"
                  min={-30}
                  max={60}
                  step={1}
                  value={verticalAngle}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    handleAnglesChange({
                      verticalAngle: Number(event.currentTarget.value),
                    })
                  }
                  className="w-full accent-accent"
                />
              </label>
              <label className="nodrag nowheel min-w-0 text-[10px] leading-4 text-text-muted">
                <span className="mb-1 flex items-center gap-1 text-text-dark">
                  <Move3D className="h-3 w-3" />
                  {t("node.multiAngleImage.distance")} {zoom.toFixed(1)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.1}
                  value={zoom}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    handleAnglesChange({
                      zoom: Number(event.currentTarget.value),
                    })
                  }
                  className="w-full accent-accent"
                />
              </label>
            </div>
          ) : null}
        </div>

        {selected && !isOverviewRender ? (
          <div
            className="nodrag nowheel nopan pointer-events-auto absolute left-0 right-0 top-[calc(100%+10px)] z-30 rounded-[var(--node-radius)] border border-[rgba(15,23,42,0.24)] bg-surface-dark/95 p-2 shadow-[0_16px_34px_rgba(15,23,42,0.18)] dark:border-[rgba(255,255,255,0.22)] dark:shadow-[0_18px_42px_rgba(0,0,0,0.34)]"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onWheelCapture={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2">
              <div className="ui-scrollbar nodrag nowheel nopan min-w-0 flex-1 cursor-default overflow-x-auto overflow-y-hidden">
                <div className="flex w-max items-center gap-1.5 pr-1">
                  <ModelParamsControls
                    imageModels={imageModels}
                    selectedModel={selectedModel}
                    resolutionOptions={resolutionOptions}
                    selectedResolution={selectedResolution}
                    selectedAspectRatio={selectedAspectRatio}
                    aspectRatioOptions={aspectRatioOptions}
                    onModelChange={handleModelChange}
                    onResolutionChange={(resolution) => {
                      const normalizedResolution = resolution as ImageSize;
                      updateNodeData(id, { size: normalizedResolution });
                      setLastImageEditDefaults({
                        modelId: selectedModel.id,
                        size: normalizedResolution,
                        requestAspectRatio: selectedAspectRatio.value,
                      });
                    }}
                    onAspectRatioChange={(aspectRatio) => {
                      updateNodeData(id, { requestAspectRatio: aspectRatio });
                      setLastImageEditDefaults({
                        modelId: selectedModel.id,
                        size: selectedResolution.value as ImageSize,
                        requestAspectRatio: aspectRatio,
                      });
                    }}
                    extraParams={resolvedModelExtraParams}
                    onExtraParamChange={(key, value) => {
                      updateNodeData(id, {
                        extraParams: {
                          ...(data.extraParams ?? {}),
                          [key]: value,
                        },
                      });
                      setLastImageGenerationExtraParams({ [key]: value });
                    }}
                    triggerSize="sm"
                    chipClassName={NODE_CONTROL_CHIP_CLASS}
                    modelChipClassName={NODE_CONTROL_MODEL_CHIP_CLASS}
                    paramsChipClassName={NODE_CONTROL_PARAMS_CHIP_CLASS}
                    styleTemplateDisabled
                  />
                  <UiChipButton
                    type="button"
                    active={data.cameraView === true}
                    className={`${NODE_CONTROL_CHIP_CLASS} w-auto shrink-0 justify-center`}
                    title={t("node.multiAngleImage.cameraView")}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateNodeData(
                        id,
                        { cameraView: data.cameraView !== true },
                        { historyMode: "skip" },
                      );
                    }}
                  >
                    <Camera className="h-4 w-4" />
                    <span className="text-[11px]">
                      {t("node.multiAngleImage.cameraView")}
                    </span>
                  </UiChipButton>
                </div>
              </div>

              <UiButton
                onClick={(event) => {
                  event.stopPropagation();
                  void handleGenerate();
                }}
                disabled={!sourceImage || data.isGenerating === true}
                variant="primary"
                className={NODE_CONTROL_PRIMARY_BUTTON_CLASS}
              >
                <Sparkles
                  className={NODE_CONTROL_GENERATE_ICON_CLASS}
                  strokeWidth={2.5}
                />
                {t("canvas.generate")}
              </UiButton>
            </div>

            <div className="mt-2 flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {AZIMUTH_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className="nodrag rounded-md border border-[rgba(255,255,255,0.1)] bg-bg-dark/55 px-1.5 py-1 text-[10px] leading-none text-text-muted transition-colors hover:border-accent/40 hover:text-text-dark"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAnglesChange({ horizontalAngle: preset.value });
                    }}
                  >
                    {t(`node.multiAngleImage.presets.${preset.key}`)}
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 flex-wrap justify-center gap-1">
                {ELEVATION_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className="nodrag rounded-md border border-[rgba(255,255,255,0.1)] bg-bg-dark/55 px-1.5 py-1 text-[10px] leading-none text-text-muted transition-colors hover:border-accent/40 hover:text-text-dark"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAnglesChange({ verticalAngle: preset.value });
                    }}
                  >
                    {t(`node.multiAngleImage.presets.${preset.key}`)}
                  </button>
                ))}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {DISTANCE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className="nodrag rounded-md border border-[rgba(255,255,255,0.1)] bg-bg-dark/55 px-1.5 py-1 text-[10px] leading-none text-text-muted transition-colors hover:border-accent/40 hover:text-text-dark"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAnglesChange({ zoom: preset.value });
                    }}
                  >
                    {t(`node.multiAngleImage.presets.${preset.key}`)}
                  </button>
                ))}
              </div>
            </div>

            <div
              className={`mt-1 min-h-[18px] truncate text-[10px] leading-4 ${
                error ? "text-red-200" : "text-text-muted"
              }`}
              title={statusText}
            >
              {statusText}
            </div>
          </div>
        ) : null}

        <CanvasHandle
          type="target"
          id="target"
          position={Position.Left}
          className="!border-2 !border-surface-dark !bg-accent"
        />
        <CanvasHandle
          type="source"
          id="source"
          position={Position.Right}
          className="!border-2 !border-surface-dark !bg-accent"
        />
        <NodeResizeHandle
          minWidth={MULTI_ANGLE_NODE_MIN_WIDTH}
          minHeight={MULTI_ANGLE_NODE_MIN_HEIGHT}
          maxWidth={MULTI_ANGLE_NODE_MAX_WIDTH}
          maxHeight={MULTI_ANGLE_NODE_MAX_HEIGHT}
          isVisible={selected}
        />
        <UiLoadingOverlay
          visible={showBlockingOverlay}
          insetClassName="inset-3"
          backdropClassName="bg-transparent"
          variant="bare"
        />
      </div>
    );
  },
);

MultiAngleImageNode.displayName = "MultiAngleImageNode";
