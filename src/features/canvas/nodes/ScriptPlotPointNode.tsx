import { memo, useCallback, useState } from 'react';
import { Check, Link2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ScriptPlotPointNodeData } from '@/features/canvas/domain/canvasNodes';
import { useCanvasStore } from '@/stores/canvasStore';

import {
  SCRIPT_NODE_EMPTY_HINT_CLASS,
  SCRIPT_NODE_INPUT_CLASS,
  SCRIPT_NODE_LABEL_CLASS,
  SCRIPT_NODE_PRIMARY_BUTTON_CLASS,
  SCRIPT_NODE_SECONDARY_BUTTON_CLASS,
  SCRIPT_NODE_TEXTAREA_CLASS,
  ScriptNodeCard,
} from './ScriptNodeCard';

type ScriptPlotPointNodeProps = {
  id: string;
  data: ScriptPlotPointNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 300;

export const ScriptPlotPointNode = memo(({
  id,
  data,
  selected,
}: ScriptPlotPointNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    pointType: data.pointType || 'setup',
    description: data.description || '',
  });

  const title = editData.pointType === 'payoff'
    ? t('scriptNodes.plotPoint.payoff')
    : t('scriptNodes.plotPoint.setup');
  const displayTitle = data.displayName?.trim() || (data.pointType === 'payoff'
    ? t('scriptNodes.plotPoint.payoff')
    : t('scriptNodes.plotPoint.setup'));

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, editData);
    setIsEditing(false);
  }, [editData, id, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      pointType: data.pointType || 'setup',
      description: data.description || '',
    });
    setIsEditing(false);
  }, [data.description, data.pointType]);

  return (
    <ScriptNodeCard
      accent="rose"
      icon={<Link2 className="h-4 w-4" />}
      title={displayTitle}
      selected={selected}
      width={DEFAULT_WIDTH}
      minHeight={150}
      isEditing={isEditing}
      onToggleEdit={() => setIsEditing((previous) => !previous)}
      onDelete={() => deleteNode(id)}
      onClick={() => setSelectedNode(id)}
    >
      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.plotPoint.type')}</label>
            <select
              value={editData.pointType}
              onChange={(event) =>
                setEditData((previous) => ({
                  ...previous,
                  pointType: event.target.value as ScriptPlotPointNodeData['pointType'],
                }))
              }
              className={SCRIPT_NODE_INPUT_CLASS}
            >
              <option value="setup">{t('scriptNodes.plotPoint.setup')}</option>
              <option value="payoff">{t('scriptNodes.plotPoint.payoff')}</option>
            </select>
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.common.description')}</label>
            <textarea
              value={editData.description}
              onChange={(event) => setEditData((previous) => ({ ...previous, description: event.target.value }))}
              className={SCRIPT_NODE_TEXTAREA_CLASS}
              rows={4}
              placeholder={t('scriptNodes.plotPoint.descriptionPlaceholder', { type: title })}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={handleCancelEdit}
              className={SCRIPT_NODE_SECONDARY_BUTTON_CLASS}
            >
              <X className="h-3.5 w-3.5" />
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              className={SCRIPT_NODE_PRIMARY_BUTTON_CLASS}
            >
              <Check className="h-3.5 w-3.5" />
              {t('common.save')}
            </button>
          </div>
        </div>
      ) : data.description ? (
        <p className="text-sm leading-6 text-text-dark/84">{data.description}</p>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t('scriptNodes.plotPoint.emptyHint', { type: displayTitle })}
        </div>
      )}
    </ScriptNodeCard>
  );
});

ScriptPlotPointNode.displayName = 'ScriptPlotPointNode';
