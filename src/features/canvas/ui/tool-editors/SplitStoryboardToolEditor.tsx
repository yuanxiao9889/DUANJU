import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';

import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { UiInput, UiButton } from '@/components/ui';
import { createUiRangeStyle } from '@/components/ui/rangeStyle';
import type { VisualToolEditorProps } from './types';

const MIN_GRID_SIZE = 1;
const MAX_GRID_SIZE = 8;
const DEFAULT_LINE_THICKNESS_PERCENT = 0.5;
const MAX_LINE_THICKNESS_PERCENT = 20;
const LEGACY_DEFAULT_LINE_THICKNESS_PX = 6;
const PREVIEW_VIEWPORT_HEIGHT = 'h-[min(560px,60vh)]';
const PREVIEW_VIEWPORT_PADDING_PX = 24;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SplitLayout {
  lineRects: OverlayRect[];
  cellRects: CellRect[];
  minCellWidth: number;
  maxCellWidth: number;
  minCellHeight: number;
  maxCellHeight: number;
  verticalLineInfos: { index: number; x: number }[];
  horizontalLineInfos: { index: number; y: number }[];
}

function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return fallback;
}

function clampInteger(value: number, min: number, max: number, fallback = min): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, Math.round(safeValue)));
}

function clampDecimal(value: number, min: number, max: number, fallback = min, precision = 2): number {
  const safeValue = Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(min, Math.min(max, safeValue));
  const factor = 10 ** precision;
  return Math.round(clamped * factor) / factor;
}

function resolveMaxLineThicknessPx(rows: number, cols: number, width: number, height: number): number {
  const maxByWidth = cols > 1 ? Math.floor((width - cols) / (cols - 1)) : Number.MAX_SAFE_INTEGER;
  const maxByHeight = rows > 1 ? Math.floor((height - rows) / (rows - 1)) : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(maxByWidth, maxByHeight));
}

function resolveLineThicknessPxFromPercent(
  lineThicknessPercent: number,
  rows: number,
  cols: number,
  width: number,
  height: number
): number {
  if (lineThicknessPercent <= 0) {
    return 0;
  }

  const basis = Math.max(1, Math.min(width, height));
  const rawPixelThickness = Math.max(1, Math.round((basis * lineThicknessPercent) / 100));
  const maxAllowed = resolveMaxLineThicknessPx(rows, cols, width, height);
  return clampInteger(rawPixelThickness, 0, maxAllowed);
}

function splitSizes(total: number, segments: number): number[] {
  const base = Math.floor(total / segments);
  const remainder = total % segments;

  return Array.from({ length: segments }, (_value, index) => base + (index < remainder ? 1 : 0));
}

function computeSplitLayout(
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
  lineThickness: number,
  colRatios?: number[],
  rowRatios?: number[]
): SplitLayout | null {
  const usableWidth = imageWidth - (cols - 1) * lineThickness;
  const usableHeight = imageHeight - (rows - 1) * lineThickness;

  if (usableWidth < cols || usableHeight < rows) {
    return null;
  }

  const colWidths = colRatios && colRatios.length === cols
    ? colRatios.map(r => Math.max(1, Math.floor(usableWidth * r / 100)))
    : splitSizes(usableWidth, cols);
  const rowHeights = rowRatios && rowRatios.length === rows
    ? rowRatios.map(r => Math.max(1, Math.floor(usableHeight * r / 100)))
    : splitSizes(usableHeight, rows);

  const lineRects: OverlayRect[] = [];
  const xOffsets: number[] = [];
  const yOffsets: number[] = [];

  let cursorX = 0;
  for (let col = 0; col < cols; col += 1) {
    xOffsets.push(cursorX);
    cursorX += colWidths[col];
    if (col < cols - 1 && lineThickness > 0) {
      lineRects.push({
        x: cursorX,
        y: 0,
        width: lineThickness,
        height: imageHeight,
      });
      cursorX += lineThickness;
    }
  }

  let cursorY = 0;
  for (let row = 0; row < rows; row += 1) {
    yOffsets.push(cursorY);
    cursorY += rowHeights[row];
    if (row < rows - 1 && lineThickness > 0) {
      lineRects.push({
        x: 0,
        y: cursorY,
        width: imageWidth,
        height: lineThickness,
      });
      cursorY += lineThickness;
    }
  }

  const cellRects: CellRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cellRects.push({
        x: xOffsets[col],
        y: yOffsets[row],
        width: colWidths[col],
        height: rowHeights[row],
      });
    }
  }

  const verticalLineInfos: { index: number; x: number }[] = [];
  const horizontalLineInfos: { index: number; y: number }[] = [];
  
  for (let col = 0; col < cols - 1; col += 1) {
    const lineX = xOffsets[col] + colWidths[col] + lineThickness / 2;
    verticalLineInfos.push({ index: col, x: lineX });
  }
  
  for (let row = 0; row < rows - 1; row += 1) {
    const lineY = yOffsets[row] + rowHeights[row] + lineThickness / 2;
    horizontalLineInfos.push({ index: row, y: lineY });
  }

  return {
    lineRects,
    cellRects,
    minCellWidth: Math.min(...colWidths),
    maxCellWidth: Math.max(...colWidths),
    minCellHeight: Math.min(...rowHeights),
    maxCellHeight: Math.max(...rowHeights),
    verticalLineInfos,
    horizontalLineInfos,
  };
}

function toPercent(value: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }

  return `${(value / total) * 100}%`;
}

function splitSizeLabel(min: number, max: number): string {
  if (min === max) {
    return `${min}`;
  }
  return `${min} - ${max}`;
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function normalizeRatios(value: unknown, segments: number): number[] {
  if (!Array.isArray(value) || value.length !== segments) {
    return [];
  }

  const numericRatios = value.map((item) => toFiniteNumber(item, Number.NaN));
  if (numericRatios.some((ratio) => !Number.isFinite(ratio) || ratio <= 0)) {
    return [];
  }

  const total = numericRatios.reduce((sum, ratio) => sum + ratio, 0);
  if (!(total > 0)) {
    return [];
  }

  let allocated = 0;
  return numericRatios.map((ratio, index) => {
    if (index === numericRatios.length - 1) {
      return clampDecimal(100 - allocated, 0, 100, 0);
    }

    const normalized = clampDecimal((ratio / total) * 100, 0, 100, 0);
    allocated += normalized;
    return normalized;
  });
}

interface NumberStepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function NumberStepper({ label, value, min, max, onChange }: NumberStepperProps) {
  const decreaseDisabled = value <= min;
  const increaseDisabled = value >= max;

  return (
    <div className="space-y-1.5">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-9 w-9 rounded-lg border border-[rgba(255,255,255,0.14)] bg-bg-dark/60 text-sm text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => onChange(value - 1)}
          disabled={decreaseDisabled}
        >
          -
        </button>
        <UiInput
          type="number"
          value={value}
          min={min}
          max={max}
          step={1}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-9 text-center"
        />
        <button
          type="button"
          className="h-9 w-9 rounded-lg border border-[rgba(255,255,255,0.14)] bg-bg-dark/60 text-sm text-text-dark transition-colors hover:bg-bg-dark disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => onChange(value + 1)}
          disabled={increaseDisabled}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function SplitStoryboardToolEditor({ sourceImageUrl, options, onOptionsChange }: VisualToolEditorProps) {
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const displaySourceImageUrl = useMemo(() => resolveImageDisplayUrl(sourceImageUrl), [sourceImageUrl]);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [draggingLine, setDraggingLine] = useState<{
    type: 'horizontal' | 'vertical';
    index: number;
    startX: number;
    startY: number;
    startRatio: number;
  } | null>(null);

  useEffect(() => {
    setNaturalSize(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [displaySourceImageUrl]);

  useEffect(() => {
    const element = previewContainerRef.current;
    if (!element) {
      return;
    }

    const updateViewportSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };

    updateViewportSize();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const rows = clampInteger(toFiniteNumber(options.rows, 3), MIN_GRID_SIZE, MAX_GRID_SIZE);
  const cols = clampInteger(toFiniteNumber(options.cols, 3), MIN_GRID_SIZE, MAX_GRID_SIZE);
  const colRatios = useMemo(() => normalizeRatios(options.colRatios, cols), [cols, options.colRatios]);
  const rowRatios = useMemo(() => normalizeRatios(options.rowRatios, rows), [options.rowRatios, rows]);

  const legacyLineThicknessPx = Math.max(0, toFiniteNumber(options.lineThickness, LEGACY_DEFAULT_LINE_THICKNESS_PX));
  const maxLineThicknessPercent = useMemo(() => {
    if (!naturalSize) {
      return MAX_LINE_THICKNESS_PERCENT;
    }

    const maxLinePx = resolveMaxLineThicknessPx(rows, cols, naturalSize.width, naturalSize.height);
    const basis = Math.max(1, Math.min(naturalSize.width, naturalSize.height));
    return clampDecimal((maxLinePx / basis) * 100, 0, MAX_LINE_THICKNESS_PERCENT);
  }, [cols, naturalSize, rows]);

  const fallbackLineThicknessPercent = useMemo(() => {
    if (!naturalSize) {
      return DEFAULT_LINE_THICKNESS_PERCENT;
    }

    const basis = Math.max(1, Math.min(naturalSize.width, naturalSize.height));
    return clampDecimal(
      (legacyLineThicknessPx / basis) * 100,
      0,
      maxLineThicknessPercent,
      DEFAULT_LINE_THICKNESS_PERCENT
    );
  }, [legacyLineThicknessPx, maxLineThicknessPercent, naturalSize]);

  const rawLineThicknessPercent = Math.max(
    0,
    toFiniteNumber(options.lineThicknessPercent, fallbackLineThicknessPercent)
  );
  const lineThicknessPercent = clampDecimal(
    rawLineThicknessPercent,
    0,
    maxLineThicknessPercent,
    fallbackLineThicknessPercent
  );

  const lineThicknessPx = useMemo(() => {
    if (!naturalSize) {
      return 0;
    }

    return resolveLineThicknessPxFromPercent(
      lineThicknessPercent,
      rows,
      cols,
      naturalSize.width,
      naturalSize.height
    );
  }, [cols, lineThicknessPercent, naturalSize, rows]);

  const renderedImageSize = useMemo(() => {
    if (!naturalSize) {
      return null;
    }

    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return {
        width: naturalSize.width,
        height: naturalSize.height,
        fitScale: 1,
      };
    }

    const maxWidth = Math.max(1, viewportSize.width - PREVIEW_VIEWPORT_PADDING_PX);
    const maxHeight = Math.max(1, viewportSize.height - PREVIEW_VIEWPORT_PADDING_PX);
    const fitScale = Math.min(
      maxWidth / naturalSize.width,
      maxHeight / naturalSize.height,
      1
    );

    return {
      width: Math.max(1, Math.round(naturalSize.width * fitScale)),
      height: Math.max(1, Math.round(naturalSize.height * fitScale)),
      fitScale,
    };
  }, [naturalSize, viewportSize.height, viewportSize.width]);

  const displayedZoomPercent = useMemo(() => {
    if (!renderedImageSize) {
      return Math.round(zoom * 100);
    }

    return Math.round(renderedImageSize.fitScale * zoom * 100);
  }, [renderedImageSize, zoom]);

  const maxZoom = useMemo(() => {
    if (!renderedImageSize) {
      return MAX_ZOOM;
    }

    return Math.max(MAX_ZOOM, MAX_ZOOM / renderedImageSize.fitScale);
  }, [renderedImageSize]);

  const layout = useMemo(() => {
    if (!naturalSize) {
      return null;
    }

    return computeSplitLayout(
      naturalSize.width,
      naturalSize.height,
      rows,
      cols,
      lineThicknessPx,
      colRatios.length === cols ? colRatios : undefined,
      rowRatios.length === rows ? rowRatios : undefined
    );
  }, [cols, lineThicknessPx, naturalSize, rows, colRatios, rowRatios]);

  const commitRatios = useCallback(
    (nextColRatios: number[], nextRowRatios: number[]) => {
      onOptionsChange({
        ...options,
        colRatios: nextColRatios,
        rowRatios: nextRowRatios,
      });
    },
    [onOptionsChange, options]
  );

  const updateOptions = useCallback(
    (patch: Partial<Record<'rows' | 'cols' | 'lineThicknessPercent', number>>) => {
      const nextRows = clampInteger(
        patch.rows ?? rows,
        MIN_GRID_SIZE,
        MAX_GRID_SIZE
      );
      const nextCols = clampInteger(
        patch.cols ?? cols,
        MIN_GRID_SIZE,
        MAX_GRID_SIZE
      );

      const unresolvedLineThicknessPercent = Math.max(
        0,
        patch.lineThicknessPercent ?? lineThicknessPercent
      );

      const nextMaxLineThicknessPercent = naturalSize
        ? clampDecimal(
            (resolveMaxLineThicknessPx(nextRows, nextCols, naturalSize.width, naturalSize.height) /
              Math.max(1, Math.min(naturalSize.width, naturalSize.height))) *
              100,
            0,
            MAX_LINE_THICKNESS_PERCENT
          )
        : MAX_LINE_THICKNESS_PERCENT;

      const nextLineThicknessPercent = clampDecimal(
        unresolvedLineThicknessPercent,
        0,
        nextMaxLineThicknessPercent
      );

      onOptionsChange({
        ...options,
        rows: nextRows,
        cols: nextCols,
        lineThicknessPercent: nextLineThicknessPercent,
        colRatios: colRatios.length === nextCols ? colRatios : [],
        rowRatios: rowRatios.length === nextRows ? rowRatios : [],
      });
    },
    [cols, lineThicknessPercent, naturalSize, onOptionsChange, options, rows, colRatios, rowRatios]
  );

  const handleZoomIn = useCallback(() => {
    setZoom((z) => Math.min(maxZoom, z + ZOOM_STEP));
  }, [maxZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const newZoom = Math.max(MIN_ZOOM, Math.min(maxZoom, zoom + delta));
      
      if (previewContainerRef.current) {
        const rect = previewContainerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const scale = newZoom / zoom;
        setPan({
          x: mouseX - (mouseX - pan.x) * scale,
          y: mouseY - (mouseY - pan.y) * scale,
        });
      }
      
      setZoom(newZoom);
    }
  }, [maxZoom, zoom, pan]);

  const handlePanStart = useCallback((e: React.MouseEvent) => {
    if (zoom > 1 && e.button === 0) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [zoom, pan]);

  const handlePanMove = useCallback((e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    }
  }, [isPanning, panStart]);

  const handlePanEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleLineDragStart = useCallback((
    type: 'horizontal' | 'vertical',
    index: number,
    e: React.MouseEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const ratios = type === 'vertical' ? colRatios : rowRatios;
    const defaultRatios = type === 'vertical' 
      ? Array.from({ length: cols }, () => 100 / cols)
      : Array.from({ length: rows }, () => 100 / rows);
    const currentRatios = ratios.length > 0 ? ratios : defaultRatios;
    
    setDraggingLine({
      type,
      index,
      startX: e.clientX,
      startY: e.clientY,
      startRatio: currentRatios[index] || 100 / (type === 'vertical' ? cols : rows),
    });
  }, [colRatios, rowRatios, cols, rows]);

  const handleLineDragMove = useCallback((e: React.MouseEvent) => {
    if (!draggingLine || !previewContainerRef.current) return;

    const imageElement = previewContainerRef.current.querySelector('img');
    const imageRect = imageElement?.getBoundingClientRect();
    
    if (!imageRect) return;
    
    const imageDisplayWidth = imageRect.width;
    const imageDisplayHeight = imageRect.height;
    
    if (draggingLine.type === 'vertical') {
      const deltaX = e.clientX - draggingLine.startX;
      const deltaPercent = (deltaX / imageDisplayWidth) * 100;
      const defaultRatios = Array.from({ length: cols }, () => 100 / cols);
      const currentRatios = colRatios.length === cols ? [...colRatios] : [...defaultRatios];
      
      const newRatio = Math.max(5, Math.min(95, currentRatios[draggingLine.index] + deltaPercent));
      const diff = newRatio - currentRatios[draggingLine.index];
      
      if (draggingLine.index < cols - 1) {
        const nextRatio = currentRatios[draggingLine.index + 1] - diff;
        if (nextRatio >= 5) {
          currentRatios[draggingLine.index] = newRatio;
          currentRatios[draggingLine.index + 1] = nextRatio;
          commitRatios(currentRatios, rowRatios);
        }
      }
    } else {
      const deltaY = e.clientY - draggingLine.startY;
      const deltaPercent = (deltaY / imageDisplayHeight) * 100;
      const defaultRatios = Array.from({ length: rows }, () => 100 / rows);
      const currentRatios = rowRatios.length === rows ? [...rowRatios] : [...defaultRatios];
      
      const newRatio = Math.max(5, Math.min(95, currentRatios[draggingLine.index] + deltaPercent));
      const diff = newRatio - currentRatios[draggingLine.index];
      
      if (draggingLine.index < rows - 1) {
        const nextRatio = currentRatios[draggingLine.index + 1] - diff;
        if (nextRatio >= 5) {
          currentRatios[draggingLine.index] = newRatio;
          currentRatios[draggingLine.index + 1] = nextRatio;
          commitRatios(colRatios, currentRatios);
        }
      }
    }
    
    setDraggingLine(prev => prev ? { ...prev, startX: e.clientX, startY: e.clientY } : null);
  }, [colRatios, commitRatios, cols, draggingLine, rowRatios, rows]);

  const handleLineDragEnd = useCallback(() => {
    setDraggingLine(null);
  }, []);

  const handleResetRatios = useCallback(() => {
    commitRatios([], []);
  }, [commitRatios]);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (draggingLine) {
        handleLineDragMove(e as unknown as React.MouseEvent);
      }
    };
    const handleGlobalMouseUp = () => {
      handleLineDragEnd();
    };
    
    if (draggingLine) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingLine, handleLineDragMove, handleLineDragEnd]);

  const hasLayoutError = Boolean(naturalSize && !layout);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>原图 + 切割预览</span>
          <div className="flex items-center gap-2">
            {naturalSize && (
              <span>
                {naturalSize.width} x {naturalSize.height}px
              </span>
            )}
            <div className="flex items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.12)] bg-bg-dark/60 px-2 py-1">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= MIN_ZOOM}
                className="p-0.5 text-text-muted hover:text-text-dark disabled:opacity-40 disabled:cursor-not-allowed"
                title="缩小"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[40px] text-center text-[11px]">{displayedZoomPercent}%</span>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= maxZoom}
                className="p-0.5 text-text-muted hover:text-text-dark disabled:opacity-40 disabled:cursor-not-allowed"
                title="放大"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                className="ml-1 px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-dark disabled:opacity-40 disabled:cursor-not-allowed rounded border border-[rgba(255,255,255,0.08)]"
                title="重置视图"
              >
                重置
              </button>
            </div>
          </div>
        </div>

        <div
          ref={previewContainerRef}
          className={`flex ${PREVIEW_VIEWPORT_HEIGHT} items-center justify-center overflow-hidden rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/70 p-3 ${zoom > 1 ? 'cursor-grab' : ''} ${isPanning ? 'cursor-grabbing' : ''}`}
          onWheel={handleWheel}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
        >
          <div 
            className="relative flex-shrink-0"
            style={{
              width: renderedImageSize ? `${renderedImageSize.width}px` : undefined,
              height: renderedImageSize ? `${renderedImageSize.height}px` : undefined,
              transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
              transformOrigin: 'center center',
            }}
          >
            <img
              src={displaySourceImageUrl}
              alt="split-preview"
              className="block max-h-full max-w-full rounded-lg border border-[rgba(255,255,255,0.08)] object-contain"
              style={renderedImageSize ? { width: '100%', height: '100%' } : undefined}
              onLoad={(event) => {
                const target = event.currentTarget;
                setNaturalSize({
                  width: Math.max(1, target.naturalWidth),
                  height: Math.max(1, target.naturalHeight),
                });
              }}
              draggable={false}
            />

            {naturalSize && layout && (
              <div className="pointer-events-none absolute inset-0 rounded-lg">
                {layout.lineRects.map((rect, index) => {
                  const isVertical = rect.width < rect.height;
                  const lineIndex = isVertical 
                    ? layout.verticalLineInfos.findIndex(v => Math.abs(v.x - (rect.x + rect.width / 2)) < 2)
                    : layout.horizontalLineInfos.findIndex(h => Math.abs(h.y - (rect.y + rect.height / 2)) < 2);
                  
                  return (
                    <div
                      key={`line-${index}`}
                      className={`absolute ${isVertical ? 'cursor-ew-resize' : 'cursor-ns-resize'} pointer-events-auto group`}
                      style={{
                        left: toPercent(rect.x, naturalSize.width),
                        top: toPercent(rect.y, naturalSize.height),
                        width: toPercent(rect.width, naturalSize.width),
                        height: toPercent(rect.height, naturalSize.height),
                      }}
                      onMouseDown={(e) => {
                        if (lineIndex >= 0) {
                          handleLineDragStart(
                            isVertical ? 'vertical' : 'horizontal',
                            lineIndex,
                            e
                          );
                        }
                      }}
                    >
                      <div className="absolute inset-0 bg-red-400/35 group-hover:bg-yellow-400/50 transition-colors" />
                      {lineIndex >= 0 && (
                        <div className={`absolute ${isVertical ? 'top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2' : 'left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2'} hidden group-hover:flex items-center justify-center bg-black/70 rounded px-1 py-0.5 text-[9px] text-white whitespace-nowrap z-10`}>
                          {isVertical 
                            ? `${(colRatios[lineIndex] || (100 / cols)).toFixed(1)}%`
                            : `${(rowRatios[lineIndex] || (100 / rows)).toFixed(1)}%`
                          }
                        </div>
                      )}
                    </div>
                  );
                })}

                {layout.cellRects.map((cell, index) => (
                  <div
                    key={`cell-${index}`}
                    className="absolute border border-white/40"
                    style={{
                      left: toPercent(cell.x, naturalSize.width),
                      top: toPercent(cell.y, naturalSize.height),
                      width: toPercent(cell.width, naturalSize.width),
                      height: toPercent(cell.height, naturalSize.height),
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted">
          <div className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-400/70" />
            红色区域为切割时会丢弃的分割线像素
          </div>
          <div className="text-[11px]">
            Ctrl + 滚轮缩放 | 拖动分割线调整比例
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/75 p-3.5">
        <div className="text-sm font-medium text-text-dark">切割参数</div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <NumberStepper
            label="行数"
            value={rows}
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            onChange={(value) => {
              updateOptions({ rows: value });
            }}
          />
          <NumberStepper
            label="列数"
            value={cols}
            min={MIN_GRID_SIZE}
            max={MAX_GRID_SIZE}
            onChange={(value) => {
              updateOptions({ cols: value });
            }}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>分割线粗细</span>
            <span>
              {formatPercent(lineThicknessPercent)}
              {naturalSize ? ` (${lineThicknessPx}px)` : ''}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, maxLineThicknessPercent)}
            step={0.1}
            value={lineThicknessPercent}
            onChange={(event) => updateOptions({ lineThicknessPercent: Number(event.target.value) })}
            className="ui-range"
            style={createUiRangeStyle(lineThicknessPercent, 0, Math.max(0, maxLineThicknessPercent))}
          />
          <UiInput
            type="number"
            value={lineThicknessPercent}
            min={0}
            max={Math.max(0, maxLineThicknessPercent)}
            step={0.1}
            onChange={(event) => updateOptions({ lineThicknessPercent: Number(event.target.value) })}
            className="h-9"
          />
        </div>

        {(colRatios.length > 0 || rowRatios.length > 0) && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">自定义比例</span>
            <UiButton
              variant="ghost"
              size="sm"
              onClick={handleResetRatios}
              className="h-7 px-2 text-xs"
            >
              重置为等分
            </UiButton>
          </div>
        )}

        <div className="rounded-lg border border-[rgba(255,255,255,0.12)] bg-bg-dark/80 px-3 py-2 text-xs text-text-muted">
          <div className="flex items-center justify-between">
            <span>输出小格数量</span>
            <span className="font-medium text-text-dark">{rows * cols}</span>
          </div>
          {layout && (
            <>
              <div className="mt-1 flex items-center justify-between">
                <span>单格宽度(px)</span>
                <span>{splitSizeLabel(layout.minCellWidth, layout.maxCellWidth)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>单格高度(px)</span>
                <span>{splitSizeLabel(layout.minCellHeight, layout.maxCellHeight)}</span>
              </div>
            </>
          )}
        </div>

        {hasLayoutError && (
          <div className="rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            当前分割线过粗，导致可切割区域不足。请减少线宽或降低行列数。
          </div>
        )}
      </div>
    </div>
  );
}
