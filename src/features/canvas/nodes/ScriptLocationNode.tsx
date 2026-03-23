import { memo, useCallback, useState } from 'react';
import { Check, MapPin, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CANVAS_NODE_TYPES, type ScriptLocationNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
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

type ScriptLocationNodeProps = {
  id: string;
  data: ScriptLocationNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 300;

export const ScriptLocationNode = memo(({
  id,
  data,
  selected,
}: ScriptLocationNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: data.name || '',
    description: data.description || '',
    appearances: data.appearances || [],
  });

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptLocation, data);
  const hasContent = Boolean(data.description || data.appearances?.length);

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, editData);
    setIsEditing(false);
  }, [editData, id, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      name: data.name || '',
      description: data.description || '',
      appearances: data.appearances || [],
    });
    setIsEditing(false);
  }, [data.appearances, data.description, data.name]);

  return (
    <ScriptNodeCard
      accent="emerald"
      icon={<MapPin className="h-4 w-4" />}
      title={data.name || resolvedTitle}
      selected={selected}
      width={DEFAULT_WIDTH}
      minHeight={160}
      isEditing={isEditing}
      onToggleEdit={() => setIsEditing((previous) => !previous)}
      onDelete={() => deleteNode(id)}
      onClick={() => setSelectedNode(id)}
    >
      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.location.name')}</label>
            <input
              type="text"
              value={editData.name}
              onChange={(event) => setEditData((previous) => ({ ...previous, name: event.target.value }))}
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.location.namePlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.common.description')}</label>
            <textarea
              value={editData.description}
              onChange={(event) => setEditData((previous) => ({ ...previous, description: event.target.value }))}
              className={SCRIPT_NODE_TEXTAREA_CLASS}
              rows={3}
              placeholder={t('scriptNodes.location.descriptionPlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.common.appearances')}</label>
            <input
              type="text"
              value={editData.appearances.join(', ')}
              onChange={(event) =>
                setEditData((previous) => ({
                  ...previous,
                  appearances: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                }))
              }
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.common.appearancesPlaceholder')}
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
      ) : hasContent ? (
        <div className="space-y-3 text-sm text-text-dark/88">
          {data.description ? (
            <p className="leading-6 text-text-dark/84">{data.description}</p>
          ) : null}
          {data.appearances?.length ? (
            <div className="text-xs text-text-muted">
              <span className="mr-1.5">{t('scriptNodes.common.appearances')}:</span>
              <span className="text-text-dark/78">{data.appearances.join(', ')}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t('scriptNodes.location.emptyHint')}
        </div>
      )}
    </ScriptNodeCard>
  );
});

ScriptLocationNode.displayName = 'ScriptLocationNode';
