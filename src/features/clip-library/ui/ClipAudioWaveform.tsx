import { useEffect, useMemo, useState } from 'react';

import { resolveAudioDisplayUrl } from '@/features/canvas/application/audioData';

interface ClipAudioWaveformProps {
  sourcePath: string;
  className?: string;
}

const WAVE_BAR_COUNT = 56;

function buildPlaceholderBars(): number[] {
  return Array.from({ length: WAVE_BAR_COUNT }, (_, index) => {
    const phase = index / 5;
    return 0.28 + ((Math.sin(phase) + 1) / 2) * 0.44;
  });
}

function sampleWaveform(channelData: Float32Array): number[] {
  if (channelData.length === 0) {
    return buildPlaceholderBars();
  }

  const blockSize = Math.max(1, Math.floor(channelData.length / WAVE_BAR_COUNT));
  const bars: number[] = [];

  for (let index = 0; index < WAVE_BAR_COUNT; index += 1) {
    const start = index * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    let peak = 0;

    for (let offset = start; offset < end; offset += 1) {
      peak = Math.max(peak, Math.abs(channelData[offset] ?? 0));
    }

    bars.push(Math.max(0.1, Math.min(1, peak * 1.8)));
  }

  return bars;
}

export function ClipAudioWaveform({ sourcePath, className = '' }: ClipAudioWaveformProps) {
  const [bars, setBars] = useState<number[]>(() => buildPlaceholderBars());

  useEffect(() => {
    const trimmedSource = sourcePath.trim();
    if (!trimmedSource) {
      setBars(buildPlaceholderBars());
      return;
    }

    let disposed = false;
    let audioContext: AudioContext | null = null;

    const loadWaveform = async () => {
      try {
        const response = await fetch(resolveAudioDisplayUrl(trimmedSource));
        if (!response.ok) {
          throw new Error(`Failed to load audio source (${response.status})`);
        }

        const buffer = await response.arrayBuffer();
        if (disposed) {
          return;
        }

        audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
        if (disposed) {
          return;
        }

        const primaryChannel = audioBuffer.getChannelData(0);
        setBars(sampleWaveform(primaryChannel));
      } catch (error) {
        if (!disposed) {
          console.warn('Failed to render clip audio waveform', error);
          setBars(buildPlaceholderBars());
        }
      }
    };

    void loadWaveform();

    return () => {
      disposed = true;
      if (audioContext) {
        void audioContext.close().catch(() => undefined);
      }
    };
  }, [sourcePath]);

  const normalizedBars = useMemo(() => {
    return bars.length > 0 ? bars : buildPlaceholderBars();
  }, [bars]);

  return (
    <div
      className={`flex h-20 items-end gap-1 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-white/[0.03] px-3 py-3 ${className}`}
    >
      {normalizedBars.map((value, index) => (
        <div
          key={`${index}-${value.toFixed(3)}`}
          className="flex-1 rounded-full bg-gradient-to-t from-emerald-500/55 via-cyan-400/65 to-white/85"
          style={{
            height: `${Math.max(10, Math.round(value * 100))}%`,
            opacity: 0.45 + value * 0.5,
          }}
        />
      ))}
    </div>
  );
}
