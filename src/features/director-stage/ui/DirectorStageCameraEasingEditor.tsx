import BezierEditor from 'bezier-easing-editor';

import type {
  DirectorStageCameraPathEasingCurve,
  DirectorStageCameraPathEasingPreset,
} from '../domain/types';
import { DIRECTOR_STAGE_CAMERA_PATH_EASING_PRESETS } from '../engine/cameraPath';

export interface DirectorStageCameraEasingEditorLabels {
  title: string;
  subtitle: string;
  presets: Record<DirectorStageCameraPathEasingPreset, string>;
  customHint: string;
  curveLabel: string;
  speedLabel: string;
  speedHint: string;
}

interface DirectorStageCameraEasingEditorProps {
  preset: DirectorStageCameraPathEasingPreset;
  curve: DirectorStageCameraPathEasingCurve;
  speed: number;
  labels: DirectorStageCameraEasingEditorLabels;
  onChange: (
    preset: DirectorStageCameraPathEasingPreset,
    curve: DirectorStageCameraPathEasingCurve
  ) => void;
  onSpeedChange: (speed: number) => void;
}

const PRESET_ORDER: DirectorStageCameraPathEasingPreset[] = [
  'easeInOut',
  'easeIn',
  'easeOut',
  'linear',
  'accelerate',
  'decelerate',
  'custom',
];

function clampCurve(value: DirectorStageCameraPathEasingCurve): DirectorStageCameraPathEasingCurve {
  return [
    Math.max(0, Math.min(1, value[0])),
    Math.max(-2, Math.min(2, value[1])),
    Math.max(0, Math.min(1, value[2])),
    Math.max(-2, Math.min(2, value[3])),
  ];
}

function formatCurve(value: DirectorStageCameraPathEasingCurve): string {
  return value.map((item) => Number(item.toFixed(2))).join(', ');
}

export function DirectorStageCameraEasingEditor({
  preset,
  curve,
  speed,
  labels,
  onChange,
  onSpeedChange,
}: DirectorStageCameraEasingEditorProps) {
  const normalizedCurve = clampCurve(curve);
  const normalizedSpeed = Math.max(0.1, Math.min(5, Number.isFinite(speed) ? speed : 1));

  return (
    <div className="space-y-3 rounded-md border border-white/10 bg-white/[0.035] p-3">
      <div>
        <div className="text-xs font-semibold uppercase text-white/52">{labels.title}</div>
        <div className="mt-1 text-[11px] leading-4 text-white/36">{labels.subtitle}</div>
      </div>

      <div className="grid grid-cols-2 gap-1">
        {PRESET_ORDER.map((item) => (
          <button
            key={item}
            type="button"
            className={`h-8 rounded-md border px-2 text-[11px] transition-colors ${
              preset === item
                ? 'border-emerald-300/45 bg-emerald-300/12 text-emerald-100'
                : 'border-white/10 bg-black/18 text-white/50 hover:bg-white/[0.07] hover:text-white'
            }`}
            onClick={() => {
              const nextCurve = DIRECTOR_STAGE_CAMERA_PATH_EASING_PRESETS[item];
              onChange(item, nextCurve);
            }}
          >
            {labels.presets[item]}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-white/10 bg-black/18 p-2">
        <label className="mb-3 block">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[11px] text-white/42">{labels.speedLabel}</span>
            <span className="font-mono text-[10px] text-emerald-100">{normalizedSpeed.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={normalizedSpeed}
            className="w-full accent-emerald-300"
            onChange={(event) => onSpeedChange(Number(event.target.value))}
          />
          <div className="mt-1 text-[10px] leading-4 text-white/30">
            {labels.speedHint}
          </div>
        </label>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-white/42">{labels.curveLabel}</span>
          <span className="truncate font-mono text-[10px] text-white/28">
            {formatCurve(normalizedCurve)}
          </span>
        </div>
        <div className="overflow-hidden rounded-md border border-white/10 bg-[#111316]">
          <BezierEditor
            value={normalizedCurve}
            width={252}
            height={150}
            padding={[18, 12, 18, 18]}
            background="#111316"
            gridColor="rgba(255,255,255,0.08)"
            curveColor="#34d399"
            progressColor="rgba(52,211,153,0.18)"
            handleColor="#fbbf24"
            color="rgba(255,255,255,0.42)"
            curveWidth={2}
            handleRadius={5}
            onChange={(value) => onChange('custom', clampCurve(value))}
          />
        </div>
        <div className="mt-2 text-[10px] leading-4 text-white/30">
          {labels.customHint}
        </div>
      </div>
    </div>
  );
}
