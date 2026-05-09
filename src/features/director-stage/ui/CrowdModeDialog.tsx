import { useEffect, useMemo, useState } from 'react';
import { Grid3X3, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiButton, UiModal } from '@/components/ui';
import type { DirectorStageBuiltInAsset } from '../domain/types';
import { DirectorStageNumberInput } from './DirectorStageNumberInput';
import {
  clampDirectorStageCrowdCenterRadius,
  clampDirectorStageCrowdCount,
  DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX,
  DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN,
  DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS,
  DIRECTOR_STAGE_CROWD_MAX_COUNT,
} from '../engine/crowdManager';

type CrowdModeDialogMode = 'formation' | 'crowd';

interface CrowdModeDialogSubmitPayload {
  mode: CrowdModeDialogMode;
  columns: number;
  rows: number;
  count: number;
  centerRadius: number;
}

interface CrowdModeDialogProps {
  asset: DirectorStageBuiltInAsset | null;
  isOpen: boolean;
  existingCrowdCount?: number | null;
  existingCrowdCenterRadius?: number | null;
  onClose: () => void;
  onSubmit: (payload: CrowdModeDialogSubmitPayload) => void;
}

function clampFormationAxis(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(DIRECTOR_STAGE_CROWD_MAX_COUNT, Math.floor(value)));
}

export function CrowdModeDialog({
  asset,
  isOpen,
  existingCrowdCount = null,
  existingCrowdCenterRadius = null,
  onClose,
  onSubmit,
}: CrowdModeDialogProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<CrowdModeDialogMode>('formation');
  const [columns, setColumns] = useState(4);
  const [rows, setRows] = useState(3);
  const [count, setCount] = useState(40);
  const [centerRadius, setCenterRadius] = useState(DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setMode('formation');
    setColumns(4);
    setRows(3);
    setCount(existingCrowdCount ?? 40);
    setCenterRadius(
      clampDirectorStageCrowdCenterRadius(
        existingCrowdCenterRadius ?? DIRECTOR_STAGE_CROWD_DEFAULT_CENTER_RADIUS
      )
    );
  }, [existingCrowdCenterRadius, existingCrowdCount, isOpen]);

  const formationCount = useMemo(() => columns * rows, [columns, rows]);
  const isFormationOverLimit = mode === 'formation' && formationCount > DIRECTOR_STAGE_CROWD_MAX_COUNT;
  const resolvedAssetName = asset ? t(asset.labelKey) : '';

  return (
    <UiModal
      isOpen={isOpen}
      title={t('directorStage.crowd.title', { name: resolvedAssetName })}
      widthClassName="w-[440px]"
      containerClassName="!z-[100100]"
      bodyClassName="space-y-4"
      onClose={onClose}
    >
      <div
        className="grid grid-cols-2 gap-1 rounded-md border border-white/10 bg-black/20 p-1"
        role="tablist"
        aria-label={t('directorStage.crowd.title', { name: resolvedAssetName })}
      >
        {(['formation', 'crowd'] as const).map((item) => {
          const Icon = item === 'formation' ? Grid3X3 : Users;
          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              className={`flex h-9 items-center justify-center gap-2 rounded-md text-xs font-medium transition-colors ${
                mode === item
                  ? 'bg-emerald-300/14 text-emerald-100'
                  : 'text-white/55 hover:bg-white/[0.06] hover:text-white'
              }`}
              onClick={() => setMode(item)}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`directorStage.crowd.modes.${item}`)}
            </button>
          );
        })}
      </div>

      {mode === 'formation' ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5 text-xs text-white/55">
            {t('directorStage.crowd.columns')}
            <DirectorStageNumberInput
              min={1}
              max={DIRECTOR_STAGE_CROWD_MAX_COUNT}
              value={columns}
              onValueChange={(value) => setColumns(clampFormationAxis(value, columns))}
              className="h-9 rounded-md border-white/10 bg-black/24 text-sm"
            />
          </label>
          <label className="space-y-1.5 text-xs text-white/55">
            {t('directorStage.crowd.rows')}
            <DirectorStageNumberInput
              min={1}
              max={DIRECTOR_STAGE_CROWD_MAX_COUNT}
              value={rows}
              onValueChange={(value) => setRows(clampFormationAxis(value, rows))}
              className="h-9 rounded-md border-white/10 bg-black/24 text-sm"
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5 text-xs text-white/55">
            {t('directorStage.crowd.count')}
            <DirectorStageNumberInput
              min={1}
              max={DIRECTOR_STAGE_CROWD_MAX_COUNT}
              value={count}
              onValueChange={(value) => setCount(clampDirectorStageCrowdCount(value, count))}
              className="h-9 rounded-md border-white/10 bg-black/24 text-sm"
            />
          </label>
          <label className="block space-y-1.5 text-xs text-white/55">
            {t('directorStage.crowd.centerRadius')}
            <DirectorStageNumberInput
              min={DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN}
              max={DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX}
              step={0.5}
              value={centerRadius}
              onValueChange={(value) => setCenterRadius(clampDirectorStageCrowdCenterRadius(value, centerRadius))}
              className="h-9 rounded-md border-white/10 bg-black/24 text-sm"
            />
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 text-xs text-white/42">
        <span>
          {mode === 'formation'
            ? t('directorStage.crowd.formationCount', { count: formationCount })
            : t('directorStage.crowd.centerRadiusHint', { min: DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MIN, max: DIRECTOR_STAGE_CROWD_CENTER_RADIUS_MAX })}
        </span>
        <span className={isFormationOverLimit ? 'text-red-300' : 'text-white/42'}>
          {t('directorStage.crowd.limitHint', { count: DIRECTOR_STAGE_CROWD_MAX_COUNT })}
        </span>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <UiButton type="button" variant="muted" onClick={onClose}>
          {t('common.cancel')}
        </UiButton>
        <UiButton
          type="button"
          variant="primary"
          disabled={!asset || isFormationOverLimit}
          onClick={() => {
            if (!asset) {
              return;
            }
            onSubmit({
              mode,
              columns,
              rows,
              count: mode === 'formation' ? formationCount : count,
              centerRadius,
            });
          }}
        >
          {mode === 'crowd' && existingCrowdCount
            ? t('directorStage.crowd.update')
            : t('directorStage.crowd.create')}
        </UiButton>
      </div>
    </UiModal>
  );
}
