import { memo, useCallback, useState } from 'react';
import { Check, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CANVAS_NODE_TYPES, type ScriptCharacterNodeData } from '@/features/canvas/domain/canvasNodes';
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

type ScriptCharacterNodeProps = {
  id: string;
  data: ScriptCharacterNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 300;

export const ScriptCharacterNode = memo(({
  id,
  data,
  selected,
}: ScriptCharacterNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: data.name || '',
    description: data.description || '',
    personality: data.personality || '',
    appearance: data.appearance || '',
  });

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptCharacter, data);
  const hasContent = Boolean(data.description || data.personality || data.appearance);

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, editData);
    setIsEditing(false);
  }, [editData, id, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      name: data.name || '',
      description: data.description || '',
      personality: data.personality || '',
      appearance: data.appearance || '',
    });
    setIsEditing(false);
  }, [data.appearance, data.description, data.name, data.personality]);

  return (
    <ScriptNodeCard
      accent="violet"
      icon={<User className="h-4 w-4" />}
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
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.character.name')}</label>
            <input
              type="text"
              value={editData.name}
              onChange={(event) => setEditData((previous) => ({ ...previous, name: event.target.value }))}
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.character.namePlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.common.description')}</label>
            <textarea
              value={editData.description}
              onChange={(event) => setEditData((previous) => ({ ...previous, description: event.target.value }))}
              className={SCRIPT_NODE_TEXTAREA_CLASS}
              rows={3}
              placeholder={t('scriptNodes.character.descriptionPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.character.personality')}</label>
              <input
                type="text"
                value={editData.personality}
                onChange={(event) => setEditData((previous) => ({ ...previous, personality: event.target.value }))}
                className={SCRIPT_NODE_INPUT_CLASS}
                placeholder={t('scriptNodes.character.personalityPlaceholder')}
              />
            </div>
            <div>
              <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.character.appearance')}</label>
              <input
                type="text"
                value={editData.appearance}
                onChange={(event) => setEditData((previous) => ({ ...previous, appearance: event.target.value }))}
                className={SCRIPT_NODE_INPUT_CLASS}
                placeholder={t('scriptNodes.character.appearancePlaceholder')}
              />
            </div>
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
          <div className="grid grid-cols-2 gap-3 text-xs text-text-muted">
            {data.personality ? (
              <div>
                <span className="mr-1.5">{t('scriptNodes.character.personality')}:</span>
                <span className="text-text-dark/78">{data.personality}</span>
              </div>
            ) : null}
            {data.appearance ? (
              <div>
                <span className="mr-1.5">{t('scriptNodes.character.appearance')}:</span>
                <span className="text-text-dark/78">{data.appearance}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t('scriptNodes.character.emptyHint')}
        </div>
      )}
    </ScriptNodeCard>
  );
});

ScriptCharacterNode.displayName = 'ScriptCharacterNode';
