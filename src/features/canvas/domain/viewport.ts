import type { Viewport } from "@xyflow/react";

export const CANVAS_MIN_ZOOM = 0.1;
export const CANVAS_MAX_ZOOM = 5;
export const CANVAS_VIEWPORT_COORDINATE_LIMIT = 10_000_000;

export const DEFAULT_CANVAS_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  zoom: 1,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readFiniteNumber(
  value: unknown,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

export function sanitizeCanvasViewport(
  viewport: Partial<Viewport> | null | undefined,
  fallback: Viewport = DEFAULT_CANVAS_VIEWPORT,
): Viewport {
  const safeFallback = {
    x: readFiniteNumber(fallback.x, DEFAULT_CANVAS_VIEWPORT.x),
    y: readFiniteNumber(fallback.y, DEFAULT_CANVAS_VIEWPORT.y),
    zoom: clamp(
      readFiniteNumber(fallback.zoom, DEFAULT_CANVAS_VIEWPORT.zoom),
      CANVAS_MIN_ZOOM,
      CANVAS_MAX_ZOOM,
    ),
  };

  return {
    x: clamp(
      readFiniteNumber(viewport?.x, safeFallback.x),
      -CANVAS_VIEWPORT_COORDINATE_LIMIT,
      CANVAS_VIEWPORT_COORDINATE_LIMIT,
    ),
    y: clamp(
      readFiniteNumber(viewport?.y, safeFallback.y),
      -CANVAS_VIEWPORT_COORDINATE_LIMIT,
      CANVAS_VIEWPORT_COORDINATE_LIMIT,
    ),
    zoom: clamp(
      readFiniteNumber(viewport?.zoom, safeFallback.zoom),
      CANVAS_MIN_ZOOM,
      CANVAS_MAX_ZOOM,
    ),
  };
}

export function normalizeCanvasViewportForPersistence(
  viewport: Partial<Viewport> | null | undefined,
  fallback: Viewport = DEFAULT_CANVAS_VIEWPORT,
): Viewport {
  const safeViewport = sanitizeCanvasViewport(viewport, fallback);
  return {
    x: Number(safeViewport.x.toFixed(2)),
    y: Number(safeViewport.y.toFixed(2)),
    zoom: Number(safeViewport.zoom.toFixed(4)),
  };
}
