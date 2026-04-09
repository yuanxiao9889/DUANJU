import type { ReactNode } from 'react';

import type {
  AssetItemRecord,
  AssetLibraryRecord,
} from '@/features/assets/domain/types';
import {
  CANVAS_NODE_TYPES,
  type AudioNodeData,
  type CanvasEdge,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { resolveConnectedTtsText } from './qwenTtsShared';

export const DEFAULT_VOXCPM_CFG_VALUE = 1.3;
export const DEFAULT_VOXCPM_INFERENCE_TIMESTEPS = 10;

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
