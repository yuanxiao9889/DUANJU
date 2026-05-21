import * as THREE from 'three';

import { prepareNodeImageBinary } from '@/commands/image';
import { createCurrentProjectMediaContext } from '@/features/canvas/application/mediaPersistenceContext';
import {
  DIRECTOR_STAGE_SNAPSHOT_HELPER_USER_DATA_KEY,
  type DirectorStageSnapshotAspectRatio,
} from '../domain/types';

const SNAPSHOT_LONG_EDGE = 2048;
const SNAPSHOT_PREVIEW_MAX_DIMENSION = 512;
const FALLBACK_ASPECT_RATIO: DirectorStageSnapshotAspectRatio = '16:9';

export interface DirectorStageSnapshotViewport {
  width: number;
  height: number;
}

export interface DirectorStageSnapshotFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DirectorStageSnapshotTargetSize {
  width: number;
  height: number;
}

export interface ExportDirectorStageCanvasPngOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  viewport: DirectorStageSnapshotViewport;
  aspectRatio: DirectorStageSnapshotAspectRatio;
  hiddenObjects?: Array<THREE.Object3D | null | undefined>;
}

function parseSnapshotAspectRatio(aspectRatio: string): number {
  const [width, height] = aspectRatio.split(':').map((part) => Number(part));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return parseSnapshotAspectRatio(FALLBACK_ASPECT_RATIO);
  }
  return width / height;
}

function normalizeViewport(viewport: DirectorStageSnapshotViewport): DirectorStageSnapshotViewport {
  return {
    width: Math.max(1, Math.floor(viewport.width)),
    height: Math.max(1, Math.floor(viewport.height)),
  };
}

export function calculateDirectorStageSnapshotFrame(
  viewport: DirectorStageSnapshotViewport,
  aspectRatio: DirectorStageSnapshotAspectRatio
): DirectorStageSnapshotFrame {
  const normalizedViewport = normalizeViewport(viewport);
  const targetRatio = parseSnapshotAspectRatio(aspectRatio);
  const viewportRatio = normalizedViewport.width / normalizedViewport.height;
  const frameWidth = viewportRatio > targetRatio
    ? normalizedViewport.height * targetRatio
    : normalizedViewport.width;
  const frameHeight = viewportRatio > targetRatio
    ? normalizedViewport.height
    : normalizedViewport.width / targetRatio;

  return {
    left: (normalizedViewport.width - frameWidth) / 2,
    top: (normalizedViewport.height - frameHeight) / 2,
    width: frameWidth,
    height: frameHeight,
  };
}

export function calculateDirectorStageSnapshotTargetSize(
  aspectRatio: DirectorStageSnapshotAspectRatio
): DirectorStageSnapshotTargetSize {
  const ratio = parseSnapshotAspectRatio(aspectRatio);
  if (ratio >= 1) {
    return {
      width: SNAPSHOT_LONG_EDGE,
      height: Math.max(1, Math.round(SNAPSHOT_LONG_EDGE / ratio)),
    };
  }

  return {
    width: Math.max(1, Math.round(SNAPSHOT_LONG_EDGE * ratio)),
    height: SNAPSHOT_LONG_EDGE,
  };
}

function calculateOffscreenRenderSize(
  viewport: DirectorStageSnapshotViewport,
  frame: DirectorStageSnapshotFrame,
  targetSize: DirectorStageSnapshotTargetSize
): DirectorStageSnapshotViewport {
  const scale = Math.max(targetSize.width / frame.width, targetSize.height / frame.height);
  return {
    width: Math.max(1, Math.ceil(viewport.width * scale)),
    height: Math.max(1, Math.ceil(viewport.height * scale)),
  };
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  if (!blob) {
    throw new Error('Failed to export director stage canvas');
  }
  return blob;
}

function collectSnapshotHiddenObjects(
  scene: THREE.Scene,
  hiddenObjects: Array<THREE.Object3D | null | undefined>
): THREE.Object3D[] {
  const objects = new Set<THREE.Object3D>();
  hiddenObjects.forEach((object) => {
    if (object) {
      objects.add(object);
    }
  });
  scene.traverse((object) => {
    if (object.userData[DIRECTOR_STAGE_SNAPSHOT_HELPER_USER_DATA_KEY] === true) {
      objects.add(object);
    }
  });
  return [...objects];
}

function hideObjectsForSnapshot(objects: THREE.Object3D[]): () => void {
  const previousVisibility = objects.map((object) => ({
    object,
    visible: object.visible,
  }));
  objects.forEach((object) => {
    object.visible = false;
  });
  return () => {
    previousVisibility.forEach(({ object, visible }) => {
      object.visible = visible;
    });
  };
}

export async function exportDirectorStageCanvasPng({
  scene,
  camera,
  viewport,
  aspectRatio,
  hiddenObjects = [],
}: ExportDirectorStageCanvasPngOptions) {
  const normalizedViewport = normalizeViewport(viewport);
  const viewportFrame = calculateDirectorStageSnapshotFrame(normalizedViewport, aspectRatio);
  const targetSize = calculateDirectorStageSnapshotTargetSize(aspectRatio);
  const renderSize = calculateOffscreenRenderSize(normalizedViewport, viewportFrame, targetSize);
  const cropFrame = calculateDirectorStageSnapshotFrame(renderSize, aspectRatio);
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x15171b, 1);
  renderer.setPixelRatio(1);
  renderer.setSize(renderSize.width, renderSize.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const snapshotCamera = camera.clone() as THREE.PerspectiveCamera;
  snapshotCamera.aspect = normalizedViewport.width / normalizedViewport.height;
  snapshotCamera.updateProjectionMatrix();
  snapshotCamera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = targetSize.width;
  outputCanvas.height = targetSize.height;
  const context = outputCanvas.getContext('2d');
  if (!context) {
    renderer.dispose();
    throw new Error('Failed to create director stage snapshot canvas');
  }

  const restoreHiddenObjects = hideObjectsForSnapshot(
    collectSnapshotHiddenObjects(scene, hiddenObjects)
  );
  try {
    renderer.render(scene, snapshotCamera);
    context.drawImage(
      renderer.domElement,
      cropFrame.left,
      cropFrame.top,
      cropFrame.width,
      cropFrame.height,
      0,
      0,
      targetSize.width,
      targetSize.height
    );
  } finally {
    restoreHiddenObjects();
    renderer.dispose();
  }

  const blob = await canvasToPngBlob(outputCanvas);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return await prepareNodeImageBinary(
    bytes,
    'png',
    SNAPSHOT_PREVIEW_MAX_DIMENSION,
    undefined,
    createCurrentProjectMediaContext('image')
  );
}
