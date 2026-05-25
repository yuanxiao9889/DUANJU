import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Timeline,
  type TimelineState,
} from '@xzdarcy/react-timeline-editor';
import type { TimelineAction, TimelineEffect, TimelineRow } from '@xzdarcy/timeline-engine';
import '@xzdarcy/react-timeline-editor/dist/react-timeline-editor.css';
import {
  Diamond,
  Loader2,
  Minus,
  Radio,
  Send,
  StepBack,
  StepForward,
  Trash2,
  Play,
  Pause,
  Square,
} from 'lucide-react';

import type {
  DirectorStageCameraKeyframe,
  DirectorStageCameraPathSegmentEasing,
} from '../domain/types';
import { DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS } from '../domain/types';
import {
  createDirectorStageCameraPathSegmentKey,
  DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING,
} from '../engine/cameraPath';

const MOTION_ROW_ID = 'director-stage-motion-camera';
const MOTION_EFFECT_ID = 'camera-motion-keyframe';
const KEYFRAME_ACTION_DURATION_SECONDS = 0.18;
const SNAP_INTERVAL_SECONDS = 0.1;
const RULER_HEIGHT = 30;
const MOTION_ROW_HEIGHT = 56;
const TIMELINE_BODY_HEIGHT = RULER_HEIGHT + MOTION_ROW_HEIGHT;
const MIN_KEYFRAME_GAP_MS = 100;
const DEFAULT_SCALE_WIDTH = 82;
const MIN_SCALE_WIDTH = 36;
const MAX_SCALE_WIDTH = 260;
const TIMELINE_ZOOM_STEP = 1.14;

export interface DirectorStageCameraTimelineLabels {
  title: string;
  summary: string;
  emptyTitle: string;
  emptyHint: string;
  motionTrack: string;
  addKeyframe: string;
  deleteKeyframe: string;
  previousKeyframe: string;
  nextKeyframe: string;
  seconds: string;
  selected: string;
  locked: string;
  recordPath: string;
  stopRecording: string;
  recording: string;
  playPath: string;
  pausePlayback: string;
  exportPath: string;
  clearPath: string;
  totalDuration: string;
  maxDurationHint: string;
  clipRange: string;
}

interface DirectorStageCameraTimelineProps {
  durationMs: number;
  motionKeyframes: DirectorStageCameraKeyframe[];
  selectedKeyframeIndex: number | null;
  playheadMs: number;
  clipStartMs: number;
  clipDurationMs: number;
  segmentEasings?: Record<string, DirectorStageCameraPathSegmentEasing>;
  labels: DirectorStageCameraTimelineLabels;
  onPlayheadChange: (timeMs: number) => void;
  onSelectKeyframe: (index: number) => void;
  onMoveKeyframe: (index: number, timeMs: number) => void;
  onAddKeyframe: () => void;
  onDeleteKeyframe: () => void;
  onRecordToggle: () => void;
  onPlayToggle: () => void;
  onExport: () => void;
  onClear: () => void;
  onClipRangeChange: (clipStartMs: number, clipDurationMs: number) => void;
  hasCameraPath: boolean;
  isRecording: boolean;
  isPlaying: boolean;
  isExporting: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatSeconds(timeMs: number): string {
  return (Math.max(0, timeMs) / 1000).toFixed(1);
}

function actionId(index: number): string {
  return `motion-${index}`;
}

function parseMotionActionIndex(id: string): number | null {
  if (!id.startsWith('motion-')) {
    return null;
  }
  const value = Number(id.slice('motion-'.length));
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function timeMsToActionStart(timeMs: number, durationMs: number): number {
  const durationSeconds = Math.max(0.1, durationMs / 1000);
  return clamp(timeMs / 1000 - KEYFRAME_ACTION_DURATION_SECONDS / 2, 0, durationSeconds);
}

function actionStartToTimeMs(start: number): number {
  return clamp(
    Math.round((start + KEYFRAME_ACTION_DURATION_SECONDS / 2) / SNAP_INTERVAL_SECONDS) * SNAP_INTERVAL_SECONDS * 1000,
    0,
    Number.MAX_SAFE_INTEGER
  );
}

function snapMs(value: number): number {
  return Math.round(value / (SNAP_INTERVAL_SECONDS * 1000)) * SNAP_INTERVAL_SECONDS * 1000;
}

function timeMsToPixel(timeMs: number, scaleWidth: number): number {
  return Math.max(0, timeMs / 1000 * scaleWidth);
}

export function DirectorStageCameraTimeline({
  durationMs,
  motionKeyframes,
  selectedKeyframeIndex,
  playheadMs,
  clipStartMs,
  clipDurationMs,
  segmentEasings,
  labels,
  onPlayheadChange,
  onSelectKeyframe,
  onMoveKeyframe,
  onAddKeyframe,
  onDeleteKeyframe,
  onRecordToggle,
  onPlayToggle,
  onExport,
  onClear,
  onClipRangeChange,
  hasCameraPath,
  isRecording,
  isPlaying,
  isExporting,
}: DirectorStageCameraTimelineProps) {
  const timelineRef = useRef<TimelineState | null>(null);
  const timelineWrapRef = useRef<HTMLDivElement | null>(null);
  const [timelineWrapWidth, setTimelineWrapWidth] = useState(0);
  const [zoomScaleWidth, setZoomScaleWidth] = useState(DEFAULT_SCALE_WIDTH);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const effectiveClipDurationMs = Math.max(
    1,
    Math.min(
      DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS,
      clipDurationMs,
      Math.max(1, durationMs - clipStartMs)
    )
  );
  const routeDurationMs = Math.max(1000, durationMs, clipStartMs + effectiveClipDurationMs);
  const scaleCount = Math.max(1, Math.ceil(routeDurationMs / 1000));
  const fitScaleWidth = timelineWrapWidth > 0
    ? Math.max(DEFAULT_SCALE_WIDTH, timelineWrapWidth / scaleCount)
    : DEFAULT_SCALE_WIDTH;
  const scaleWidth = Math.max(fitScaleWidth, zoomScaleWidth);
  const timelineContentWidth = scaleCount * scaleWidth;
  const axisDurationMs = scaleCount * 1000;
  const durationSeconds = axisDurationMs / 1000;
  const selectedKeyframe = selectedKeyframeIndex !== null
    ? motionKeyframes[selectedKeyframeIndex] ?? null
    : null;
  const canDeleteSelected = selectedKeyframeIndex !== null
    && selectedKeyframeIndex > 0
    && selectedKeyframeIndex < motionKeyframes.length - 1
    && motionKeyframes.length > 2;
  const segmentOverlays = useMemo(() => {
    if (motionKeyframes.length < 2) {
      return [];
    }
    return motionKeyframes.slice(0, -1).map((keyframe, index) => {
      const nextKeyframe = motionKeyframes[index + 1];
      const leftPx = timeMsToPixel(keyframe.timeMs, scaleWidth);
      const rightPx = timeMsToPixel(nextKeyframe.timeMs, scaleWidth);
      const segmentKey = createDirectorStageCameraPathSegmentKey(keyframe, nextKeyframe);
      const legacySegmentKey = `${Math.round(keyframe.timeMs)}:${Math.round(nextKeyframe.timeMs)}`;
      const easing = segmentEasings?.[segmentKey]
        ?? segmentEasings?.[legacySegmentKey]
        ?? DIRECTOR_STAGE_CAMERA_PATH_DEFAULT_EASING;
      const speed = Math.max(0.1, Math.min(5, easing.speed ?? 1));
      return {
        index,
        leftPx,
        widthPx: Math.max(14, rightPx - leftPx),
        durationMs: Math.max(0, nextKeyframe.timeMs - keyframe.timeMs),
        speed,
        preset: easing.preset,
        selected: selectedKeyframeIndex === index,
      };
    });
  }, [motionKeyframes, scaleWidth, segmentEasings, selectedKeyframeIndex]);

  const effects = useMemo<Record<string, TimelineEffect>>(() => ({
    [MOTION_EFFECT_ID]: {
      id: MOTION_EFFECT_ID,
      name: labels.motionTrack,
    },
  }), [labels.motionTrack]);

  const editorData = useMemo<TimelineRow[]>(() => {
    const createAction = (
      keyframe: DirectorStageCameraKeyframe,
      index: number
    ): TimelineAction => {
      const start = timeMsToActionStart(keyframe.timeMs, axisDurationMs);
      return {
        id: actionId(index),
        start,
        end: Math.min(durationSeconds, start + KEYFRAME_ACTION_DURATION_SECONDS),
        effectId: MOTION_EFFECT_ID,
        selected: selectedKeyframeIndex === index,
        flexible: false,
        movable: index > 0,
        minStart: 0,
        maxEnd: durationSeconds + KEYFRAME_ACTION_DURATION_SECONDS,
      };
    };

    return [
      {
        id: MOTION_ROW_ID,
        rowHeight: MOTION_ROW_HEIGHT,
        actions: motionKeyframes.map((keyframe, index) => createAction(keyframe, index)),
      },
    ];
  }, [axisDurationMs, durationSeconds, motionKeyframes, selectedKeyframeIndex]);
  const clipLeftPx = timeMsToPixel(clipStartMs, scaleWidth);
  const clipWidthPx = Math.max(18, timeMsToPixel(effectiveClipDurationMs, scaleWidth));

  useEffect(() => {
    const element = timelineWrapRef.current;
    if (!element) {
      return;
    }

    const updateWidth = () => {
      setTimelineWrapWidth(element.clientWidth);
    };
    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const maxScrollLeft = Math.max(0, timelineContentWidth - timelineWrapWidth);
    if (timelineScrollLeft <= maxScrollLeft) {
      return;
    }
    setTimelineScrollLeft(maxScrollLeft);
    timelineRef.current?.setScrollLeft(maxScrollLeft);
  }, [timelineContentWidth, timelineScrollLeft, timelineWrapWidth]);

  useEffect(() => {
    timelineRef.current?.setTime(playheadMs / 1000);
  }, [playheadMs]);

  const selectAndJumpKeyframe = useCallback((index: number) => {
    const keyframe = motionKeyframes[index];
    if (!keyframe) {
      return;
    }
    onSelectKeyframe(index);
    onPlayheadChange(keyframe.timeMs);
  }, [motionKeyframes, onPlayheadChange, onSelectKeyframe]);

  const jumpAdjacentKeyframe = useCallback((direction: -1 | 1) => {
    if (motionKeyframes.length === 0) {
      return;
    }
    const currentIndex = selectedKeyframeIndex ?? motionKeyframes.findIndex(
      (keyframe) => keyframe.timeMs >= playheadMs
    );
    const fallbackIndex = direction > 0 ? 0 : motionKeyframes.length - 1;
    const nextIndex = clamp(
      (currentIndex >= 0 ? currentIndex : fallbackIndex) + direction,
      0,
      motionKeyframes.length - 1
    );
    selectAndJumpKeyframe(nextIndex);
  }, [motionKeyframes, playheadMs, selectAndJumpKeyframe, selectedKeyframeIndex]);

  const getActionRender = useCallback((action: TimelineAction) => {
    const motionIndex = parseMotionActionIndex(action.id);
    const isSelected = selectedKeyframeIndex === motionIndex;
    const isEndpoint = motionIndex !== null && motionIndex === 0;

    return (
      <div
        className={`director-stage-camera-timeline__action director-stage-camera-timeline__action--motion ${
          isSelected ? 'director-stage-camera-timeline__action--selected' : ''
        }`}
        title={`${formatSeconds(action.start * 1000)}s${isEndpoint ? ` / ${labels.locked}` : ''}`}
      >
        <span />
      </div>
    );
  }, [labels.locked, motionKeyframes.length, selectedKeyframeIndex]);

  const getScaleRender = useCallback((scale: number) => (
    <span className="director-stage-camera-timeline__scale">
      {scale.toFixed(0)}s
    </span>
  ), []);

  const dragPlayheadFromPointer = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!hasCameraPath) {
      return;
    }
    const wrap = event.currentTarget.parentElement;
    if (!wrap) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const updateFromClientX = (clientX: number) => {
      const rect = wrap.getBoundingClientRect();
      const contentX = clamp(clientX - rect.left + timelineScrollLeft, 0, timelineContentWidth);
      onPlayheadChange(Math.min(routeDurationMs, snapMs(contentX / scaleWidth * 1000)));
    };
    updateFromClientX(event.clientX);
    const onMove = (moveEvent: PointerEvent) => {
      updateFromClientX(moveEvent.clientX);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [
    hasCameraPath,
    onPlayheadChange,
    routeDurationMs,
    scaleWidth,
    timelineContentWidth,
    timelineScrollLeft,
  ]);

  const handleTimelineWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!hasCameraPath || timelineWrapWidth <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = clamp(event.clientX - rect.left, 0, rect.width);
    const zoomIn = event.deltaY < 0;
    const nextScaleWidth = clamp(
      scaleWidth * (zoomIn ? TIMELINE_ZOOM_STEP : 1 / TIMELINE_ZOOM_STEP),
      Math.max(MIN_SCALE_WIDTH, fitScaleWidth),
      MAX_SCALE_WIDTH
    );

    if (Math.abs(nextScaleWidth - scaleWidth) < 0.1) {
      return;
    }

    const pointerTimeSeconds = (timelineScrollLeft + pointerX) / scaleWidth;
    const nextContentWidth = scaleCount * nextScaleWidth;
    const nextMaxScrollLeft = Math.max(0, nextContentWidth - timelineWrapWidth);
    const nextScrollLeft = clamp(
      pointerTimeSeconds * nextScaleWidth - pointerX,
      0,
      nextMaxScrollLeft
    );

    setZoomScaleWidth(nextScaleWidth);
    setTimelineScrollLeft(nextScrollLeft);
    window.requestAnimationFrame(() => {
      timelineRef.current?.setScrollLeft(nextScrollLeft);
    });
  }, [
    fitScaleWidth,
    hasCameraPath,
    scaleCount,
    scaleWidth,
    timelineScrollLeft,
    timelineWrapWidth,
  ]);

  return (
    <div className="director-stage-camera-timeline col-start-2 row-start-2 min-h-0 border-t border-white/10 bg-[#121417]">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold uppercase text-white/52">
              {labels.title}
            </div>
            <div className="truncate text-[11px] text-white/34">
              {labels.summary}
            </div>
          </div>
          <div className="hidden h-5 items-center gap-2 border-l border-white/10 pl-3 text-[11px] text-white/42 lg:flex">
            <span>{formatSeconds(playheadMs)}s</span>
            <span>/</span>
            <span>{formatSeconds(durationMs)}s</span>
            <span className="text-white/18">|</span>
            <span>
              {labels.clipRange} {formatSeconds(effectiveClipDurationMs)}s
            </span>
            {selectedKeyframe ? (
              <>
                <span className="text-white/18">|</span>
                <span>{labels.selected} {formatSeconds(selectedKeyframe.timeMs)}s</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={isExporting}
            className={`flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              isRecording
                ? 'border-red-300/35 bg-red-400/16 text-red-100'
                : 'border-white/10 bg-white/[0.055] text-white/62 hover:bg-white/[0.1] hover:text-white'
            }`}
            title={isRecording ? labels.stopRecording : labels.recordPath}
            aria-label={isRecording ? labels.stopRecording : labels.recordPath}
            onClick={onRecordToggle}
          >
            {isRecording ? <Square className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
            <span>{isRecording ? labels.stopRecording : labels.recordPath}</span>
          </button>
          <button
            type="button"
            disabled={!hasCameraPath || isRecording || isExporting}
            className={`flex h-8 w-8 items-center justify-center rounded-md border border-white/10 transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
              isPlaying
                ? 'bg-emerald-300/14 text-emerald-100'
                : 'bg-white/[0.045] text-white/52 hover:bg-white/[0.09] hover:text-white'
            }`}
            title={isPlaying ? labels.pausePlayback : labels.playPath}
            aria-label={isPlaying ? labels.pausePlayback : labels.playPath}
            onClick={onPlayToggle}
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            disabled={!hasCameraPath || isRecording || isExporting}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            title={labels.exportPath}
            aria-label={labels.exportPath}
            onClick={onExport}
          >
            {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            disabled={!hasCameraPath || isRecording || isExporting}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-white/52 transition-colors hover:bg-red-400/12 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-35"
            title={labels.clearPath}
            aria-label={labels.clearPath}
            onClick={onClear}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!hasCameraPath}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            title={labels.previousKeyframe}
            aria-label={labels.previousKeyframe}
            onClick={() => jumpAdjacentKeyframe(-1)}
          >
            <StepBack className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!hasCameraPath}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            title={labels.nextKeyframe}
            aria-label={labels.nextKeyframe}
            onClick={() => jumpAdjacentKeyframe(1)}
          >
            <StepForward className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!hasCameraPath}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            title={labels.addKeyframe}
            aria-label={labels.addKeyframe}
            onClick={onAddKeyframe}
          >
            <Diamond className="h-3.5 w-3.5 fill-current" />
          </button>
          <button
            type="button"
            disabled={!canDeleteSelected}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-white/52 transition-colors hover:bg-red-400/12 hover:text-red-100 disabled:cursor-not-allowed disabled:opacity-35"
            title={labels.deleteKeyframe}
            aria-label={labels.deleteKeyframe}
            onClick={onDeleteKeyframe}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)]">
        <div className="border-r border-white/10 bg-[#15171a]">
          <div className="h-[30px] border-b border-white/10 px-3 text-[10px] uppercase leading-[30px] text-white/32">
            {labels.seconds}
          </div>
          <div className="flex h-14 items-center px-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-white/64">{labels.motionTrack}</div>
              <div className="mt-0.5 truncate text-[10px] text-white/30">
                {labels.totalDuration} {formatSeconds(durationMs)}s / {labels.clipRange} {formatSeconds(clipStartMs)}s-{formatSeconds(clipStartMs + effectiveClipDurationMs)}s
              </div>
            </div>
          </div>
        </div>
        <div
          ref={timelineWrapRef}
          className="director-stage-camera-timeline__timeline-wrap"
          onWheel={handleTimelineWheel}
        >
          {hasCameraPath ? (
            <button
              type="button"
              className="director-stage-camera-timeline__playhead"
              style={{ left: `${timeMsToPixel(playheadMs, scaleWidth) - timelineScrollLeft}px` }}
              title={`${formatSeconds(playheadMs)}s`}
              aria-label={`${labels.selected} ${formatSeconds(playheadMs)}s`}
              onPointerDown={dragPlayheadFromPointer}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <span className="director-stage-camera-timeline__playhead-handle" />
              <span className="director-stage-camera-timeline__playhead-line" />
            </button>
          ) : null}
          {!hasCameraPath ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#121417] text-center">
              <div className="max-w-[360px] px-4">
                <div className="text-xs font-semibold uppercase text-white/58">{labels.emptyTitle}</div>
                <div className="mt-1 text-xs text-white/34">{labels.emptyHint}</div>
              </div>
            </div>
          ) : null}
          <div className="director-stage-camera-timeline__scroll-layer" style={{ transform: `translateX(${-timelineScrollLeft}px)`, width: `${timelineContentWidth}px` }}>
            <div className="director-stage-camera-timeline__segments">
              {segmentOverlays.map((segment) => (
                <button
                  key={segment.index}
                  type="button"
                  className={`director-stage-camera-timeline__segment ${
                    segment.selected ? 'director-stage-camera-timeline__segment--selected' : ''
                  }`}
                  style={{
                    left: `${segment.leftPx}px`,
                    width: `${segment.widthPx}px`,
                  }}
                  onClick={() => onSelectKeyframe(segment.index)}
                  aria-label={`${labels.motionTrack} ${segment.index + 1}, ${formatSeconds(segment.durationMs)}s, ${segment.speed.toFixed(1)}x`}
                  title={`${formatSeconds(segment.durationMs)}s / ${segment.speed.toFixed(1)}x / ${segment.preset}`}
                />
              ))}
            </div>
            {hasCameraPath ? (
              <div
                className="director-stage-camera-timeline__clip"
                style={{ left: `${clipLeftPx}px`, width: `${clipWidthPx}px` }}
              >
                <button
                  type="button"
                  className="director-stage-camera-timeline__clip-handle director-stage-camera-timeline__clip-handle--left"
                  aria-label={labels.clipRange}
                  onClick={() => undefined}
                  onPointerDown={(event) => {
                    const startX = event.clientX;
                    const startClip = clipStartMs;
                    const startDuration = effectiveClipDurationMs;
                    const target = event.currentTarget;
                    target.setPointerCapture(event.pointerId);
                    const onMove = (moveEvent: PointerEvent) => {
                      const deltaMs = (moveEvent.clientX - startX) / scaleWidth * 1000;
                      const nextStart = clamp(startClip + deltaMs, 0, startClip + startDuration - MIN_KEYFRAME_GAP_MS);
                      const nextDuration = Math.min(DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS, startClip + startDuration - nextStart);
                      onClipRangeChange(snapMs(nextStart), snapMs(nextDuration));
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                <button
                  type="button"
                  className="director-stage-camera-timeline__clip-body"
                  aria-label={labels.clipRange}
                  onPointerDown={(event) => {
                    const startX = event.clientX;
                    const startClip = clipStartMs;
                    const target = event.currentTarget;
                    target.setPointerCapture(event.pointerId);
                    const onMove = (moveEvent: PointerEvent) => {
                      const deltaMs = (moveEvent.clientX - startX) / scaleWidth * 1000;
                      const nextStart = clamp(startClip + deltaMs, 0, Math.max(0, durationMs - effectiveClipDurationMs));
                      onClipRangeChange(snapMs(nextStart), effectiveClipDurationMs);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
                <button
                  type="button"
                  className="director-stage-camera-timeline__clip-handle director-stage-camera-timeline__clip-handle--right"
                  aria-label={labels.clipRange}
                  onPointerDown={(event) => {
                    const startX = event.clientX;
                    const startDuration = effectiveClipDurationMs;
                    const target = event.currentTarget;
                    target.setPointerCapture(event.pointerId);
                    const onMove = (moveEvent: PointerEvent) => {
                      const deltaMs = (moveEvent.clientX - startX) / scaleWidth * 1000;
                      const nextDuration = clamp(
                        startDuration + deltaMs,
                        MIN_KEYFRAME_GAP_MS,
                        Math.min(DIRECTOR_STAGE_CAMERA_PATH_CLIP_MAX_DURATION_MS, durationMs - clipStartMs)
                      );
                      onClipRangeChange(clipStartMs, snapMs(nextDuration));
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                />
              </div>
            ) : null}
            {hasCameraPath ? (
              <div className="director-stage-camera-timeline__keyframe-layer">
                {motionKeyframes.map((keyframe, index) => {
                  const isSelected = selectedKeyframeIndex === index;
                  const isEndpoint = index === 0;
                  return (
                    <button
                      key={keyframe.id ?? `${index}-${keyframe.timeMs}`}
                      type="button"
                      className={`director-stage-camera-timeline__keyframe ${
                        isSelected ? 'director-stage-camera-timeline__keyframe--selected' : ''
                      }`}
                      style={{ left: `${timeMsToPixel(keyframe.timeMs, scaleWidth)}px` }}
                      title={`${formatSeconds(keyframe.timeMs)}s${isEndpoint ? ` / ${labels.locked}` : ''}`}
                      aria-label={`${labels.motionTrack} ${index + 1}`}
                      onClick={() => selectAndJumpKeyframe(index)}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
          <Timeline
            ref={timelineRef}
            editorData={editorData}
            effects={effects}
            scale={1}
            scaleSplitCount={10}
            scaleWidth={scaleWidth}
            minScaleCount={scaleCount}
            maxScaleCount={scaleCount}
            startLeft={0}
            rowHeight={MOTION_ROW_HEIGHT}
            gridSnap
            dragLine
            autoScroll
            style={{ width: '100%', height: `${TIMELINE_BODY_HEIGHT}px` }}
            getActionRender={getActionRender}
            getScaleRender={getScaleRender}
            onScroll={(params) => {
              setTimelineScrollLeft(params.scrollLeft);
            }}
            onCursorDrag={(time) => onPlayheadChange(clamp(time * 1000, 0, routeDurationMs))}
            onCursorDragEnd={(time) => onPlayheadChange(clamp(time * 1000, 0, routeDurationMs))}
            onClickTimeArea={(time) => {
              onPlayheadChange(clamp(time * 1000, 0, routeDurationMs));
              return true;
            }}
            onClickActionOnly={(_, { action }) => {
              const index = parseMotionActionIndex(action.id);
              if (index !== null) {
                selectAndJumpKeyframe(index);
              }
            }}
            onActionMoving={({ action, start }) => {
              const index = parseMotionActionIndex(action.id);
              if (index === null) {
                return false;
              }
              const previous = motionKeyframes[index - 1];
              const next = motionKeyframes[index + 1];
              const min = index === 0 ? 0 : (previous?.timeMs ?? 0) + MIN_KEYFRAME_GAP_MS;
              const max = next
                ? next.timeMs - MIN_KEYFRAME_GAP_MS
                : routeDurationMs;
              const timeMs = index === 0 ? 0 : clamp(actionStartToTimeMs(start), min, max);
              onPlayheadChange(clamp(timeMs, 0, Math.max(durationMs, timeMs)));
              onMoveKeyframe(index, timeMs);
              return true;
            }}
            onActionMoveEnd={({ action, start }) => {
              const index = parseMotionActionIndex(action.id);
              if (index === null) {
                return;
              }
              const previous = motionKeyframes[index - 1];
              const next = motionKeyframes[index + 1];
              const min = index === 0 ? 0 : (previous?.timeMs ?? 0) + MIN_KEYFRAME_GAP_MS;
              const max = next
                ? next.timeMs - MIN_KEYFRAME_GAP_MS
                : routeDurationMs;
              const timeMs = index === 0 ? 0 : clamp(actionStartToTimeMs(start), min, max);
              onSelectKeyframe(index);
              onMoveKeyframe(index, timeMs);
              onPlayheadChange(timeMs);
            }}
          />
        </div>
      </div>
    </div>
  );
}
