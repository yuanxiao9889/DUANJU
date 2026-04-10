import {
  useEffect,
  useRef,
  useState,
  type CompositionEvent,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { Loader2, Undo2, Wand2 } from 'lucide-react';

import {
  isReusableVoicePresetAsset,
  resolveVoicePresetAssetMetadata,
  type AssetItemRecord,
  type AssetLibraryRecord,
  type VoicePresetAssetMetadata,
} from '@/features/assets/domain/types';
import { showErrorDialog } from '@/features/canvas/application/errorDialog';
import { optimizeCanvasPrompt } from '@/features/canvas/application/promptOptimization';
import {
  CANVAS_NODE_TYPES,
  type AudioNodeData,
  type CanvasEdge,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { resolveConnectedTtsText } from './qwenTtsShared';

export const DEFAULT_VOXCPM_CFG_VALUE = 1.3;
export const DEFAULT_VOXCPM_INFERENCE_TIMESTEPS = 10;

interface PromptOptimizationUndoState {
  previousPrompt: string;
  appliedPrompt: string;
}

export interface AudioAssetGroup {
  id: string;
  name: string;
  items: AssetItemRecord[];
}

export interface SliderFieldProps {
  label: string;
  valueLabel: string;
  helperText: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

interface OptimizableTextAreaFieldProps {
  label: string;
  value: string;
  placeholder: string;
  helperText: string;
  emptyMessage: string;
  optimizeFailedMessage: string;
  dialogTitle: string;
  optimizeTitle: string;
  optimizingTitle: string;
  undoTitle: string;
  onChange: (value: string) => void;
  minHeightClassName?: string;
}

interface CompositionSafeTextareaOptions {
  value: string;
  onCommit: (value: string) => void;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatGeneratedTime(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function resolveRuntimeTone(
  isExtensionReady: boolean,
  isExtensionStarting: boolean
): string {
  if (isExtensionReady) {
    return 'border-emerald-400/30 bg-emerald-400/12 text-emerald-100';
  }
  if (isExtensionStarting) {
    return 'border-amber-400/30 bg-amber-400/12 text-amber-100';
  }
  return 'border-white/10 bg-white/[0.05] text-text-muted';
}

export function collectAudioAssetGroups(libraries: AssetLibraryRecord[]): AudioAssetGroup[] {
  return libraries
    .map((library) => ({
      id: library.id,
      name: library.name,
      items: library.items.filter((item) => item.mediaType === 'audio'),
    }))
    .filter((library) => library.items.length > 0);
}

export function collectVoicePresetGroups(libraries: AssetLibraryRecord[]): AudioAssetGroup[] {
  return libraries
    .map((library) => ({
      id: library.id,
      name: library.name,
      items: library.items.filter(isReusableVoicePresetAsset),
    }))
    .filter((library) => library.items.length > 0);
}

export function findSelectedAudioAsset(
  libraries: AssetLibraryRecord[],
  assetId: string | null | undefined
): AssetItemRecord | null {
  const normalizedAssetId = typeof assetId === 'string' ? assetId.trim() : '';
  if (!normalizedAssetId) {
    return null;
  }

  return (
    libraries
      .flatMap((library) => library.items)
      .find((item) => item.id === normalizedAssetId) ?? null
  );
}

export function resolveConnectedReferenceAudio(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): AudioNodeData | null {
  const nodeMap = new Map(nodes.map((node) => [node.id, node] as const));
  const firstIncomingAudioEdge = edges.find((edge) => {
    if (edge.target !== nodeId) {
      return false;
    }

    const sourceNode = nodeMap.get(edge.source);
    return Boolean(
      sourceNode
      && sourceNode.type === CANVAS_NODE_TYPES.audio
      && typeof (sourceNode.data as AudioNodeData).audioUrl === 'string'
      && (sourceNode.data as AudioNodeData).audioUrl?.trim().length
    );
  });

  if (!firstIncomingAudioEdge) {
    return null;
  }

  const sourceAudioNode = nodeMap.get(firstIncomingAudioEdge.source);
  return sourceAudioNode ? (sourceAudioNode.data as AudioNodeData) : null;
}

export function resolveConnectedVoxText(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string {
  return resolveConnectedTtsText(nodeId, nodes, edges);
}

export function resolveVoicePresetHint(
  metadata: VoicePresetAssetMetadata | null,
  assetDescription: string | null | undefined
): string {
  return metadata?.controlText?.trim()
    || metadata?.voicePrompt?.trim()
    || (typeof assetDescription === 'string' ? assetDescription.trim() : '')
    || '';
}

export function resolveReferenceAudioPath(
  selectedPresetAsset: AssetItemRecord | null,
  selectedReferenceAsset: AssetItemRecord | null,
  connectedReferenceAudio: AudioNodeData | null
): string {
  return selectedPresetAsset?.sourcePath?.trim()
    ?? selectedReferenceAsset?.sourcePath?.trim()
    ?? connectedReferenceAudio?.audioUrl?.trim()
    ?? '';
}

export function resolveReferenceAudioName(
  selectedPresetAsset: AssetItemRecord | null,
  selectedReferenceAsset: AssetItemRecord | null,
  connectedReferenceAudio: AudioNodeData | null
): string {
  return selectedPresetAsset?.name?.trim()
    ?? selectedReferenceAsset?.name?.trim()
    ?? connectedReferenceAudio?.audioFileName?.trim()
    ?? '';
}

export function resolveReferenceSourceLabel(
  hasPreset: boolean,
  hasReferenceAsset: boolean,
  hasConnectedReferenceAudio: boolean,
  labels: {
    preset: string;
    asset: string;
    connected: string;
    missing: string;
  }
): string {
  if (hasPreset) {
    return labels.preset;
  }
  if (hasReferenceAsset) {
    return labels.asset;
  }
  if (hasConnectedReferenceAudio) {
    return labels.connected;
  }
  return labels.missing;
}

export function useCompositionSafeTextareaDraft({
  value,
  onCommit,
}: CompositionSafeTextareaOptions) {
  const [draftValue, setDraftValue] = useState(value);
  const isComposingRef = useRef(false);

  useEffect(() => {
    if (!isComposingRef.current) {
      setDraftValue(value);
    }
  }, [value]);

  const commitDraftValue = (nextValue: string) => {
    if (nextValue !== value) {
      onCommit(nextValue);
    }
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const handleCompositionEnd = (
    event: CompositionEvent<HTMLTextAreaElement>
  ) => {
    isComposingRef.current = false;
    const nextValue = event.currentTarget.value;
    setDraftValue(nextValue);
    commitDraftValue(nextValue);
  };

  const handleBlur = (
    event: FocusEvent<HTMLTextAreaElement>
  ) => {
    const nextValue = event.currentTarget.value;
    setDraftValue(nextValue);
    commitDraftValue(nextValue);
  };

  const handlePointerDown = (
    event: { stopPropagation: () => void }
  ) => {
    event.stopPropagation();
  };

  const handleChange = (nextValue: string) => {
    setDraftValue(nextValue);
    if (!isComposingRef.current) {
      commitDraftValue(nextValue);
    }
  };

  return {
    draftValue,
    handleChange,
    handleBlur,
    handleCompositionStart,
    handleCompositionEnd,
    handlePointerDown,
  };
}

export function OptimizableTextAreaField({
  label,
  value,
  placeholder,
  helperText,
  emptyMessage,
  optimizeFailedMessage,
  dialogTitle,
  optimizeTitle,
  optimizingTitle,
  undoTitle,
  onChange,
  minHeightClassName = 'min-h-[88px]',
}: OptimizableTextAreaFieldProps) {
  const promptValueRef = useRef(value);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [optimizationError, setOptimizationError] = useState<string | null>(null);
  const [lastUndoState, setLastUndoState] = useState<PromptOptimizationUndoState | null>(null);
  const {
    draftValue,
    handleBlur,
    handleChange,
    handleCompositionEnd,
    handleCompositionStart,
    handlePointerDown,
  } = useCompositionSafeTextareaDraft({
    value,
    onCommit: (nextValue) => {
      setOptimizationError(null);
      onChange(nextValue);
    },
  });

  useEffect(() => {
    promptValueRef.current = value;
  }, [value]);

  const handleOptimize = async () => {
    const sourcePrompt = promptValueRef.current;
    const trimmedPrompt = sourcePrompt.trim();
    if (!trimmedPrompt) {
      setOptimizationError(emptyMessage);
      await showErrorDialog(emptyMessage, dialogTitle);
      return;
    }

    setIsOptimizing(true);
    setOptimizationError(null);

    try {
      const result = await optimizeCanvasPrompt({
        mode: 'ttsVoice',
        prompt: trimmedPrompt,
      });

      if (promptValueRef.current !== sourcePrompt) {
        return;
      }

      setLastUndoState(
        result.prompt === sourcePrompt
          ? null
          : {
              previousPrompt: sourcePrompt,
              appliedPrompt: result.prompt,
            }
      );
      onChange(result.prompt);
    } catch (error) {
      const errorMessage =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : optimizeFailedMessage;
      setOptimizationError(errorMessage);
      await showErrorDialog(errorMessage, dialogTitle);
    } finally {
      setIsOptimizing(false);
    }
  };

  const handleUndo = () => {
    if (!lastUndoState) {
      return;
    }

    if (promptValueRef.current !== lastUndoState.appliedPrompt) {
      return;
    }

    setOptimizationError(null);
    setLastUndoState(null);
    onChange(lastUndoState.previousPrompt);
  };

  const canUndo = Boolean(
    lastUndoState && promptValueRef.current === lastUndoState.appliedPrompt
  );

  return (
    <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-text-muted">{label}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isOptimizing}
            title={isOptimizing ? optimizingTitle : optimizeTitle}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              void handleOptimize();
            }}
            className="nodrag inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text-muted transition-colors hover:border-accent/45 hover:bg-accent/14 hover:text-text-dark disabled:cursor-not-allowed disabled:border-white/8 disabled:bg-white/[0.02] disabled:text-text-muted/45"
          >
            {isOptimizing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" strokeWidth={2.25} />
            )}
          </button>
          {canUndo ? (
            <button
              type="button"
              title={undoTitle}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                handleUndo();
              }}
              className="nodrag inline-flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-text-muted transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-text-dark"
            >
              <Undo2 className="h-3.5 w-3.5" strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      </div>
      <textarea
        value={draftValue}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={handleBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onMouseDown={handlePointerDown}
        onPointerDown={handlePointerDown}
        placeholder={placeholder}
        className={`nodrag nowheel ${minHeightClassName} w-full resize-y rounded-lg border border-white/10 bg-black/10 px-3 py-2 text-sm text-text-dark outline-none transition-colors placeholder:text-text-muted/70 focus:border-accent`}
      />
      <div className="mt-2 text-[11px] leading-4 text-text-muted">{helperText}</div>
      {optimizationError ? (
        <div className="mt-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-[11px] leading-4 text-red-100">
          {optimizationError}
        </div>
      ) : null}
    </label>
  );
}

export function SliderField({
  label,
  valueLabel,
  helperText,
  min,
  max,
  step,
  value,
  onChange,
}: SliderFieldProps) {
  return (
    <label className="block rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-text-muted">
        <span>{label}</span>
        <span>{valueLabel}</span>
      </div>
      <div className="text-[11px] leading-4 text-text-muted">{helperText}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="nodrag nowheel mt-2 w-full accent-[var(--accent)]"
      />
    </label>
  );
}

export function SummaryCard({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-dark">{title}</div>
          <div className="mt-1 text-[11px] leading-4 text-text-muted">{subtitle}</div>
        </div>
      </div>
    </div>
  );
}

export function PresetDetailCard({
  title,
  value,
  actionLabel,
  onAction,
}: {
  title: string;
  value: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-text-dark">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-text-muted">{title}</div>
          <div className="mt-1 whitespace-pre-wrap break-words">{value}</div>
        </div>
        {actionLabel && onAction ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onAction();
            }}
            className="nodrag shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-text-dark"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function resolveSelectedPresetMetadata(
  selectedPresetAsset: AssetItemRecord | null
): VoicePresetAssetMetadata | null {
  return resolveVoicePresetAssetMetadata(selectedPresetAsset);
}
