import { memo, useCallback, useState } from 'react';
import { Check, Globe, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CANVAS_NODE_TYPES, type ScriptWorldviewNodeData } from '@/features/canvas/domain/canvasNodes';
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

type ScriptWorldviewNodeProps = {
  id: string;
  data: ScriptWorldviewNodeData;
  selected?: boolean;
};

const DEFAULT_WIDTH = 340;

export const ScriptWorldviewNode = memo(({
  id,
  data,
  selected,
}: ScriptWorldviewNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    worldviewName: data.worldviewName || '',
    description: data.description || '',
    era: data.era || '',
    technology: data.technology || '',
    magic: data.magic || '',
    society: data.society || '',
    geography: data.geography || '',
  });

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptWorldview, data);
  const hasContent = Boolean(
    data.description || data.era || data.technology || data.magic || data.society || data.geography
  );

  const handleSaveEdit = useCallback(() => {
    updateNodeData(id, editData);
    setIsEditing(false);
  }, [editData, id, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      worldviewName: data.worldviewName || '',
      description: data.description || '',
      era: data.era || '',
      technology: data.technology || '',
      magic: data.magic || '',
      society: data.society || '',
      geography: data.geography || '',
    });
    setIsEditing(false);
  }, [data.description, data.era, data.geography, data.magic, data.society, data.technology, data.worldviewName]);

  return (
    <ScriptNodeCard
      accent="cyan"
      icon={<Globe className="h-4 w-4" />}
      title={data.worldviewName || resolvedTitle}
      selected={selected}
      width={DEFAULT_WIDTH}
      minHeight={200}
      isEditing={isEditing}
      onToggleEdit={() => setIsEditing((previous) => !previous)}
      onDelete={() => deleteNode(id)}
      onClick={() => setSelectedNode(id)}
    >
      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.worldview.name')}</label>
            <input
              type="text"
              value={editData.worldviewName}
              onChange={(event) => setEditData((previous) => ({ ...previous, worldviewName: event.target.value }))}
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.worldview.namePlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.common.description')}</label>
            <textarea
              value={editData.description}
              onChange={(event) => setEditData((previous) => ({ ...previous, description: event.target.value }))}
              className={SCRIPT_NODE_TEXTAREA_CLASS}
              rows={3}
              placeholder={t('scriptNodes.worldview.descriptionPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.worldview.era')}</label>
              <input
                type="text"
                value={editData.era}
                onChange={(event) => setEditData((previous) => ({ ...previous, era: event.target.value }))}
                className={SCRIPT_NODE_INPUT_CLASS}
                placeholder={t('scriptNodes.worldview.eraPlaceholder')}
              />
            </div>
            <div>
              <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.worldview.technology')}</label>
              <input
                type="text"
                value={editData.technology}
                onChange={(event) => setEditData((previous) => ({ ...previous, technology: event.target.value }))}
                className={SCRIPT_NODE_INPUT_CLASS}
                placeholder={t('scriptNodes.worldview.technologyPlaceholder')}
              />
            </div>
            <div>
              <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.worldview.magic')}</label>
              <input
                type="text"
                value={editData.magic}
                onChange={(event) => setEditData((previous) => ({ ...previous, magic: event.target.value }))}
                className={SCRIPT_NODE_INPUT_CLASS}
                placeholder={t('scriptNodes.worldview.magicPlaceholder')}
              />
            </div>
            <div>
              <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.worldview.society')}</label>
              <input
                type="text"
                value={editData.society}
                onChange={(event) => setEditData((previous) => ({ ...previous, society: event.target.value }))}
                className={SCRIPT_NODE_INPUT_CLASS}
                placeholder={t('scriptNodes.worldview.societyPlaceholder')}
              />
            </div>
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.worldview.geography')}</label>
            <input
              type="text"
              value={editData.geography}
              onChange={(event) => setEditData((previous) => ({ ...previous, geography: event.target.value }))}
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.worldview.geographyPlaceholder')}
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
        <div className="space-y-3">
          {data.description ? (
            <p className="text-sm leading-6 text-text-dark/84">{data.description}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-text-muted">
            {data.era ? (
              <div>
                <span className="mr-1.5">{t('scriptNodes.worldview.era')}:</span>
                <span className="text-text-dark/78">{data.era}</span>
              </div>
            ) : null}
            {data.technology ? (
              <div>
                <span className="mr-1.5">{t('scriptNodes.worldview.technology')}:</span>
                <span className="text-text-dark/78">{data.technology}</span>
              </div>
            ) : null}
            {data.magic ? (
              <div>
                <span className="mr-1.5">{t('scriptNodes.worldview.magic')}:</span>
                <span className="text-text-dark/78">{data.magic}</span>
              </div>
            ) : null}
            {data.society ? (
              <div>
                <span className="mr-1.5">{t('scriptNodes.worldview.society')}:</span>
                <span className="text-text-dark/78">{data.society}</span>
              </div>
            ) : null}
            {data.geography ? (
              <div className="col-span-2">
                <span className="mr-1.5">{t('scriptNodes.worldview.geography')}:</span>
                <span className="text-text-dark/78">{data.geography}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t('scriptNodes.worldview.emptyHint')}
        </div>
      )}
    </ScriptNodeCard>
  );
});

ScriptWorldviewNode.displayName = 'ScriptWorldviewNode';
