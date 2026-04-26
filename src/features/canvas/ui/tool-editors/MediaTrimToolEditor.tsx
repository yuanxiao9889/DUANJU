import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Range, getTrackBackground } from 'react-range';
import { useTranslation } from 'react-i18next';

import { UiButton, UiInput } from '@/components/ui';
import {
  formatAudioDuration,
  resolveAudioDisplayUrl,
} from '@/features/canvas/application/audioData';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { formatVideoTime } from '@/features/canvas/application/videoData';
import type { MediaTrimToolEditorProps } from './types';

const TIME_STEP = 0.1;
const MIN_TRIM_DURATION = 0.1;
const TIME_EPSILON = 0.01;
const PREVIEW_SEEK_INTERVAL_MS = 80;
const TIME_STEP_DECIMALS = 1;
const RANGE_TRACK_COLORS = [
  'rgba(255,255,255,0.10)',
  'rgba(0,163,255,0.72)',
  'rgba(255,255,255,0.10)',
];

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampTime(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function roundTime(value: number): number {
  return Math.round(value * 100) / 100;
}

function snapTimeToStep(
  value: number,
  mode: 'nearest' | 'floor' | 'ceil' = 'nearest'
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const scaled = value / TIME_STEP;
  const roundedScaled = mode === 'floor'
    ? Math.floor(scaled + 1e-9)
    : mode === 'ceil'
      ? Math.ceil(scaled - 1e-9)
      : Math.round(scaled);

  return Number((roundedScaled * TIME_STEP).toFixed(TIME_STEP_DECIMALS));
}

function areTimesClose(left: number, right: number): boolean {
  return Math.abs(left - right) < TIME_EPSILON;
}

function formatMediaTime(value: number, mediaType: 'video' | 'audio'): string {
  const roundedValue = Math.max(0, Math.round(value * 10) / 10);
  const wholeSeconds = Math.floor(roundedValue);
  const fraction = Math.round((roundedValue - wholeSeconds) * 10);
  const base = mediaType === 'video'
    ? formatVideoTime(wholeSeconds)
    : formatAudioDuration(wholeSeconds);

  return `${base}.${fraction}`;
}

function normalizeTrimRange(startTime: number, endTime: number, duration: number): {
  startTime: number;
  endTime: number;
} {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (safeDuration <= 0) {
    return {
      startTime: 0,
      endTime: 0,
    };
  }

  const steppedDuration = Math.max(
    MIN_TRIM_DURATION,
    snapTimeToStep(safeDuration, 'floor')
  );
  const maxStart = Math.max(0, steppedDuration - MIN_TRIM_DURATION);
  const safeStart = snapTimeToStep(
    clampTime(startTime, 0, maxStart),
    'nearest'
  );
  const safeEnd = snapTimeToStep(
    clampTime(
      endTime,
      safeStart + MIN_TRIM_DURATION,
      steppedDuration
    ),
    'nearest'
  );

  return {
    startTime: safeStart,
    endTime: Math.max(
      snapTimeToStep(safeStart + MIN_TRIM_DURATION, 'nearest'),
      safeEnd
    ),
  };
}

export function MediaTrimToolEditor({
  options,
  onOptionsChange,
  sourceMediaUrl,
  mediaType,
}: MediaTrimToolEditorProps) {
  const { t } = useTranslation();
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const previewTargetTimeRef = useRef<number | null>(null);
  const previewSeekTimerRef = useRef<number | null>(null);
  const isRangeDraggingRef = useRef(false);

  const [duration, setDuration] = useState(() => toFiniteNumber(options.duration, 0));
  const [currentTime, setCurrentTime] = useState(0);
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const [activeHandleIndex, setActiveHandleIndex] = useState<0 | 1 | null>(null);
  const [isRangeDragging, setIsRangeDragging] = useState(false);

  const displaySourceUrl = useMemo(
    () => mediaType === 'video'
      ? resolveImageDisplayUrl(sourceMediaUrl)
      : resolveAudioDisplayUrl(sourceMediaUrl),
    [mediaType, sourceMediaUrl]
  );

  const committedRange = useMemo(
    () => {
      const rawStartTime = toFiniteNumber(options.startTime, 0);
      const rawEndTime = toFiniteNumber(options.endTime, duration);

      return normalizeTrimRange(
        rawStartTime,
        rawEndTime > 0 ? rawEndTime : duration,
        duration
      );
    },
    [duration, options.endTime, options.startTime]
  );

  const [draftRange, setDraftRange] = useState<[number, number]>([
    committedRange.startTime,
    committedRange.endTime,
  ]);

  useEffect(() => {
    const optionDuration = toFiniteNumber(options.duration, 0);
    if (!areTimesClose(optionDuration, duration)) {
      setDuration(optionDuration);
    }
  }, [duration, options.duration]);

  useEffect(() => {
    isRangeDraggingRef.current = isRangeDragging;
  }, [isRangeDragging]);

  useEffect(() => {
    if (isRangeDragging) {
      return;
    }

    setDraftRange((current) => {
      if (
        areTimesClose(current[0], committedRange.startTime)
        && areTimesClose(current[1], committedRange.endTime)
      ) {
        return current;
      }

      return [committedRange.startTime, committedRange.endTime];
    });
  }, [committedRange.endTime, committedRange.startTime, isRangeDragging]);

  useEffect(() => () => {
    if (previewSeekTimerRef.current !== null) {
      window.clearTimeout(previewSeekTimerRef.current);
    }
  }, []);

  const liveRange = useMemo(
    () => normalizeTrimRange(draftRange[0], draftRange[1], duration),
    [draftRange, duration]
  );
  const trimDuration = Math.max(0, liveRange.endTime - liveRange.startTime);
  const sliderMax = Math.max(duration, MIN_TRIM_DURATION);
  const displayedCurrentTime = isRangeDragging && previewTime !== null
    ? previewTime
    : currentTime;
  const startPercent = duration > 0 ? (liveRange.startTime / duration) * 100 : 0;
  const endPercent = duration > 0 ? (liveRange.endTime / duration) * 100 : 0;
  const currentPercent = duration > 0 ? (displayedCurrentTime / duration) * 100 : 0;

  const syncOptions = useCallback((nextStartTime: number, nextEndTime: number, nextDuration = duration) => {
    const nextRange = normalizeTrimRange(nextStartTime, nextEndTime, nextDuration);
    const optionDuration = toFiniteNumber(options.duration, 0);
    const optionStart = toFiniteNumber(options.startTime, 0);
    const optionEnd = toFiniteNumber(options.endTime, optionDuration);

    if (
      options.mediaType === mediaType
      && areTimesClose(optionDuration, nextDuration)
      && areTimesClose(optionStart, nextRange.startTime)
      && areTimesClose(optionEnd, nextRange.endTime)
    ) {
      return;
    }

    onOptionsChange({
      ...options,
      mediaType,
      duration: roundTime(nextDuration),
      startTime: nextRange.startTime,
      endTime: nextRange.endTime,
    });
  }, [duration, mediaType, onOptionsChange, options]);

  const seekTo = useCallback((time: number) => {
    const mediaElement = mediaRef.current;
    if (!mediaElement) {
      return;
    }

    const nextTime = clampTime(time, 0, duration > 0 ? duration : time);
    mediaElement.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [duration]);

  const flushPreviewSeek = useCallback((fallbackTime?: number) => {
    if (previewSeekTimerRef.current !== null) {
      window.clearTimeout(previewSeekTimerRef.current);
      previewSeekTimerRef.current = null;
    }

    const targetTime = Number.isFinite(previewTargetTimeRef.current)
      ? previewTargetTimeRef.current
      : fallbackTime;

    if (!Number.isFinite(targetTime)) {
      return;
    }

    const safeTargetTime = targetTime as number;

    const mediaElement = mediaRef.current;
    if (mediaElement) {
      mediaElement.pause();
    }

    seekTo(safeTargetTime);
  }, [seekTo]);

  const syncPreviewToTime = useCallback((time: number, immediate = false) => {
    const nextTime = clampTime(time, 0, duration > 0 ? duration : time);
    previewTargetTimeRef.current = nextTime;
    setPreviewTime(nextTime);

    if (immediate) {
      flushPreviewSeek(nextTime);
      return;
    }

    if (previewSeekTimerRef.current !== null) {
      return;
    }

    previewSeekTimerRef.current = window.setTimeout(() => {
      previewSeekTimerRef.current = null;
      flushPreviewSeek(nextTime);
    }, PREVIEW_SEEK_INTERVAL_MS);
  }, [duration, flushPreviewSeek]);

  const updateDraftTrimRange = useCallback((
    nextStartTime: number,
    nextEndTime: number,
    previewHandleIndex: 0 | 1 | null = null,
    immediatePreview = false,
  ) => {
    const nextRange = normalizeTrimRange(nextStartTime, nextEndTime, duration);

    setDraftRange((current) => {
      if (
        areTimesClose(current[0], nextRange.startTime)
        && areTimesClose(current[1], nextRange.endTime)
      ) {
        return current;
      }

      return [nextRange.startTime, nextRange.endTime];
    });

    if (previewHandleIndex === 0) {
      syncPreviewToTime(nextRange.startTime, immediatePreview);
    } else if (previewHandleIndex === 1) {
      syncPreviewToTime(nextRange.endTime, immediatePreview);
    }

    return nextRange;
  }, [duration, syncPreviewToTime]);

  const commitTrimRange = useCallback((
    nextStartTime: number,
    nextEndTime: number,
    previewHandleIndex: 0 | 1 | null = null,
    immediatePreview = true,
  ) => {
    const nextRange = updateDraftTrimRange(
      nextStartTime,
      nextEndTime,
      previewHandleIndex,
      immediatePreview
    );

    syncOptions(nextRange.startTime, nextRange.endTime, duration);
    return nextRange;
  }, [duration, syncOptions, updateDraftTrimRange]);

  const handleLoadedMetadata = useCallback(() => {
    const mediaElement = mediaRef.current;
    if (!mediaElement) {
      return;
    }

    const nextDuration = Number.isFinite(mediaElement.duration)
      ? Math.max(0, mediaElement.duration)
      : 0;
    setDuration(nextDuration);

    if (currentTime > nextDuration) {
      setCurrentTime(nextDuration);
    }

    const nextInitialRange = normalizeTrimRange(
      toFiniteNumber(options.startTime, 0),
      toFiniteNumber(options.endTime, nextDuration) > 0
        ? toFiniteNumber(options.endTime, nextDuration)
        : nextDuration,
      nextDuration
    );

    setDraftRange([nextInitialRange.startTime, nextInitialRange.endTime]);
    syncOptions(nextInitialRange.startTime, nextInitialRange.endTime, nextDuration);
  }, [currentTime, options.endTime, options.startTime, syncOptions]);

  const handleTimeUpdate = useCallback(() => {
    const mediaElement = mediaRef.current;
    if (!mediaElement) {
      return;
    }

    if (isRangeDraggingRef.current) {
      return;
    }

    setCurrentTime(mediaElement.currentTime);
    setPreviewTime(null);
  }, []);

  const handleTrimRangeChange = useCallback((nextValues: readonly number[]) => {
    const nextRange = normalizeTrimRange(nextValues[0] ?? 0, nextValues[1] ?? duration, duration);
    const startDelta = Math.abs(nextRange.startTime - liveRange.startTime);
    const endDelta = Math.abs(nextRange.endTime - liveRange.endTime);

    if (startDelta < TIME_EPSILON && endDelta < TIME_EPSILON) {
      return;
    }

    setIsRangeDragging(true);
    const changedHandleIndex: 0 | 1 = activeHandleIndex !== null
      ? activeHandleIndex
      : endDelta > startDelta ? 1 : 0;

    updateDraftTrimRange(nextRange.startTime, nextRange.endTime, changedHandleIndex);
  }, [
    activeHandleIndex,
    duration,
    liveRange.endTime,
    liveRange.startTime,
    updateDraftTrimRange,
  ]);

  const handleTrimRangeCommit = useCallback((finalValues: readonly number[]) => {
    commitTrimRange(finalValues[0] ?? 0, finalValues[1] ?? duration, activeHandleIndex, true);
    setIsRangeDragging(false);
    setActiveHandleIndex(null);
    setPreviewTime(null);
  }, [activeHandleIndex, commitTrimRange, duration]);

  const handleStartInput = useCallback((value: number) => {
    commitTrimRange(value, liveRange.endTime, 0);
  }, [commitTrimRange, liveRange.endTime]);

  const handleEndInput = useCallback((value: number) => {
    commitTrimRange(liveRange.startTime, value, 1);
  }, [commitTrimRange, liveRange.startTime]);

  const handleUseCurrentTimeAsStart = useCallback(() => {
    commitTrimRange(currentTime, liveRange.endTime, 0);
  }, [commitTrimRange, currentTime, liveRange.endTime]);

  const handleUseCurrentTimeAsEnd = useCallback(() => {
    commitTrimRange(liveRange.startTime, currentTime, 1);
  }, [commitTrimRange, currentTime, liveRange.startTime]);

  const handlePreviewSeek = useCallback((time: number) => {
    setPreviewTime(null);
    seekTo(time);
  }, [seekTo]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{t('toolDialog.mediaTrim.preview')}</span>
          <span>{t('toolDialog.mediaTrim.currentTime')}: {formatMediaTime(displayedCurrentTime, mediaType)}</span>
        </div>

        <div className="rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/70 p-3">
          {mediaType === 'video' ? (
            <video
              ref={(element) => {
                mediaRef.current = element;
              }}
              src={displaySourceUrl}
              controls
              playsInline
              className="mx-auto max-h-[min(300px,34vh)] w-full max-w-[640px] rounded-lg bg-black/30"
              onLoadedMetadata={handleLoadedMetadata}
              onDurationChange={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
            />
          ) : (
            <audio
              ref={(element) => {
                mediaRef.current = element;
              }}
              src={displaySourceUrl}
              controls
              className="w-full"
              onLoadedMetadata={handleLoadedMetadata}
              onDurationChange={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
            />
          )}

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-text-muted">
              <span>{t('toolDialog.mediaTrim.totalDuration')}: {formatMediaTime(duration, mediaType)}</span>
              <span>{t('toolDialog.mediaTrim.outputDuration')}: {formatMediaTime(trimDuration, mediaType)}</span>
            </div>

            <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-black/15 px-3 py-3">
              <div className="mb-3 flex items-center justify-between text-[11px] text-text-muted">
                <span>{t('toolDialog.mediaTrim.startTime')}: {formatMediaTime(liveRange.startTime, mediaType)}</span>
                <span>{t('toolDialog.mediaTrim.endTime')}: {formatMediaTime(liveRange.endTime, mediaType)}</span>
              </div>

              <Range
                label={t('toolDialog.mediaTrim.rangeLabel')}
                min={0}
                max={sliderMax}
                step={TIME_STEP}
                values={[liveRange.startTime, liveRange.endTime]}
                onChange={handleTrimRangeChange}
                onFinalChange={handleTrimRangeCommit}
                renderTrack={({ props, children }) => (
                  <div
                    {...props}
                    className="relative flex h-10 w-full items-center"
                  >
                    <div
                      className="relative h-3 w-full rounded-full border border-white/10 bg-white/5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.28)]"
                      style={{
                        background: getTrackBackground({
                          min: 0,
                          max: sliderMax,
                          values: [liveRange.startTime, liveRange.endTime],
                          colors: RANGE_TRACK_COLORS,
                        }),
                      }}
                    >
                      <div
                        className="absolute top-1/2 h-5 w-[2px] rounded-full bg-white/85 shadow-[0_0_8px_rgba(255,255,255,0.35)]"
                        style={{
                          left: `${currentPercent}%`,
                          transform: 'translate(-50%, -50%)',
                          opacity: currentPercent >= startPercent && currentPercent <= endPercent ? 1 : 0.45,
                        }}
                      />
                    </div>
                    {children}
                  </div>
                )}
                renderThumb={({ props, index, isDragged }) => (
                  <div
                    {...props}
                    key={props.key}
                    className="relative flex h-6 w-6 items-center justify-center outline-none"
                    onMouseDown={() => {
                      setIsRangeDragging(true);
                      setActiveHandleIndex(index === 0 ? 0 : 1);
                    }}
                    onTouchStart={() => {
                      setIsRangeDragging(true);
                      setActiveHandleIndex(index === 0 ? 0 : 1);
                    }}
                    onFocus={() => {
                      setActiveHandleIndex(index === 0 ? 0 : 1);
                    }}
                    onBlur={() => {
                      setActiveHandleIndex((current) => (current === index ? null : current));
                    }}
                  >
                    {(isDragged || activeHandleIndex === index) && (
                      <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-slate-950/90 px-2 py-1 text-[11px] font-medium text-white shadow-lg">
                        {formatMediaTime(index === 0 ? liveRange.startTime : liveRange.endTime, mediaType)}
                      </div>
                    )}
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 transition-[background-color,border-color,box-shadow] duration-150 ${
                        isDragged || activeHandleIndex === index
                          ? 'border-white bg-accent shadow-[0_0_0_5px_rgba(0,163,255,0.22)]'
                          : 'border-white/85 bg-accent shadow-[0_0_0_3px_rgba(15,23,42,0.24)]'
                      }`}
                    >
                      <div className="h-1.5 w-1.5 rounded-full bg-white/95" />
                    </div>
                  </div>
                )}
              />

              <div className="mt-3 flex items-center justify-between text-[11px] text-text-muted">
                <span>00:00.0</span>
                <span>{formatMediaTime(duration, mediaType)}</span>
              </div>
            </div>

            <div className="grid gap-2 text-[11px] text-text-muted sm:grid-cols-3">
              <div className="rounded-lg border border-white/8 bg-white/5 px-2.5 py-2">
                <div>{t('toolDialog.mediaTrim.startTime')}</div>
                <div className="mt-1 text-sm font-medium text-text-dark">
                  {formatMediaTime(liveRange.startTime, mediaType)}
                </div>
              </div>
              <div className="rounded-lg border border-accent/20 bg-accent/8 px-2.5 py-2">
                <div>{t('toolDialog.mediaTrim.outputDuration')}</div>
                <div className="mt-1 text-sm font-medium text-text-dark">
                  {formatMediaTime(trimDuration, mediaType)}
                </div>
              </div>
              <div className="rounded-lg border border-white/8 bg-white/5 px-2.5 py-2">
                <div>{t('toolDialog.mediaTrim.endTime')}</div>
                <div className="mt-1 text-sm font-medium text-text-dark">
                  {formatMediaTime(liveRange.endTime, mediaType)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/75 p-3.5">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{t('toolDialog.mediaTrim.startTime')}</span>
            <span>{formatMediaTime(liveRange.startTime, mediaType)}</span>
          </div>
          <div className="flex items-center gap-2">
            <UiInput
              type="number"
              min={0}
              max={sliderMax}
              step={TIME_STEP}
              value={liveRange.startTime}
              onChange={(event) => handleStartInput(Number(event.target.value))}
              className="h-9"
            />
            <UiButton
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleUseCurrentTimeAsStart}
              className="h-9 shrink-0 px-3"
            >
              {t('toolDialog.mediaTrim.useCurrentAsStart')}
            </UiButton>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/75 p-3.5">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>{t('toolDialog.mediaTrim.endTime')}</span>
            <span>{formatMediaTime(liveRange.endTime, mediaType)}</span>
          </div>
          <div className="flex items-center gap-2">
            <UiInput
              type="number"
              min={0}
              max={sliderMax}
              step={TIME_STEP}
              value={liveRange.endTime}
              onChange={(event) => handleEndInput(Number(event.target.value))}
              className="h-9"
            />
            <UiButton
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleUseCurrentTimeAsEnd}
              className="h-9 shrink-0 px-3"
            >
              {t('toolDialog.mediaTrim.useCurrentAsEnd')}
            </UiButton>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/70 px-3 py-2 text-xs text-text-muted">
        <span>{t('toolDialog.mediaTrim.quickSeek')}</span>
        <div className="flex items-center gap-2">
          <UiButton type="button" size="sm" variant="ghost" className="h-8 px-3" onClick={() => handlePreviewSeek(liveRange.startTime)}>
            {t('toolDialog.mediaTrim.previewStart')}
          </UiButton>
          <UiButton type="button" size="sm" variant="ghost" className="h-8 px-3" onClick={() => handlePreviewSeek(liveRange.endTime)}>
            {t('toolDialog.mediaTrim.previewEnd')}
          </UiButton>
        </div>
      </div>
    </div>
  );
}
