import { memo, useCallback, useState } from 'react';
import { Check, Loader2, Package, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  mergeItemAssetData,
  toItemAsset,
  upsertAssetByName,
} from '@/features/canvas/application/scriptAssetLibrary';
import { optimizeScriptItemFields } from '@/features/canvas/application/scriptAssetOptimizer';
import {
  CANVAS_NODE_TYPES,
  type ScriptItemNodeData,
  type ScriptRootNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';

import {
  SCRIPT_NODE_EMPTY_HINT_CLASS,
  SCRIPT_NODE_INPUT_CLASS,
  SCRIPT_NODE_ICON_BUTTON_CLASS,
  SCRIPT_NODE_LABEL_CLASS,
  SCRIPT_NODE_PRIMARY_BUTTON_CLASS,
  SCRIPT_NODE_SCROLL_AREA_CLASS,
  SCRIPT_NODE_SECONDARY_BUTTON_CLASS,
  SCRIPT_NODE_SECTION_CARD_CLASS,
  SCRIPT_NODE_TEXTAREA_CLASS,
  ScriptNodeCard,
  resolveScriptNodeDimension,
} from './ScriptNodeCard';
import { useScriptAssetOptimization } from './useScriptAssetOptimization';

type ScriptItemNodeProps = {
  id: string;
  data: ScriptItemNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 300;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;
const MAX_WIDTH = 520;
const MAX_HEIGHT = 720;

export const ScriptItemNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ScriptItemNodeProps) => {
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

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptItem, data);
  const hasContent = Boolean(data.description || data.appearances?.length);
  const resolvedWidth = resolveScriptNodeDimension(width, DEFAULT_WIDTH);
  const resolvedHeight = resolveScriptNodeDimension(height, DEFAULT_HEIGHT);

  const getOptimizationSource = useCallback((): ScriptItemNodeData => ({
    ...data,
    name: isEditing ? editData.name : (data.name || ''),
    description: isEditing ? editData.description : (data.description || ''),
    appearances: isEditing ? editData.appearances : (data.appearances || []),
  }), [data, editData.appearances, editData.description, editData.name, isEditing]);

  const persistItemAssetLibrary = useCallback((nextData: {
    name: string;
    description: string;
    appearances: string[];
  }) => {
    const rootNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.scriptRoot
    ) as ({ id: string; data: ScriptRootNodeData } | undefined);
    const nextAsset = toItemAsset(nextData);
    if (rootNode && nextAsset.name) {
      updateNodeData(rootNode.id, {
        assetLibraryItems: upsertAssetByName(
          rootNode.data.assetLibraryItems ?? [],
          nextAsset,
          mergeItemAssetData,
          data.name || nextAsset.name
        ),
      });
    }
  }, [data.name, updateNodeData]);

  const handleSaveEdit = useCallback(() => {
    const nextData = {
      ...editData,
      displayName: editData.name || data.displayName,
    };
    updateNodeData(id, nextData);
    persistItemAssetLibrary(nextData);

    setIsEditing(false);
  }, [data.displayName, editData, id, persistItemAssetLibrary, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      name: data.name || '',
      description: data.description || '',
      appearances: data.appearances || [],
    });
    setIsEditing(false);
  }, [data.appearances, data.description, data.name]);

  const { isOptimizing, handleOptimize } = useScriptAssetOptimization({
    validateSource: () => {
      const source = getOptimizationSource();
      return source.name.trim() || source.description.trim() || source.appearances.length > 0
        ? null
        : t('scriptNodes.item.optimizeMissingSource');
    },
    onStart: () => setIsEditing(true),
    optimize: (nodes) => optimizeScriptItemFields(getOptimizationSource(), nodes),
    applyOptimizedResult: (result) => {
      const source = getOptimizationSource();
      persistItemAssetLibrary({
        name: source.name,
        description: result.description,
        appearances: source.appearances,
      });
      setIsEditing(true);
      setEditData({
        name: source.name,
        description: result.description,
        appearances: source.appearances,
      });
    },
  });

  return (
    <ScriptNodeCard
      accent="amber"
      icon={<Package className="h-4 w-4" />}
      title={data.name || resolvedTitle}
      selected={selected}
      width={resolvedWidth}
      height={resolvedHeight}
      minHeight={160}
      isEditing={isEditing}
      contentClassName="gap-3"
      headerActions={(
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void handleOptimize();
          }}
          className={`${SCRIPT_NODE_ICON_BUTTON_CLASS} ${
            isOptimizing
              ? 'border-accent/30 bg-accent/12 text-accent'
              : 'hover:border-accent/30 hover:bg-accent/10 hover:text-accent'
          }`}
          title={isOptimizing ? t('scriptNodes.common.optimizing') : t('scriptNodes.common.optimize')}
          disabled={isOptimizing}
        >
          {isOptimizing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </button>
      )}
      overlayContent={(
        <NodeResizeHandle
          minWidth={MIN_WIDTH}
          minHeight={MIN_HEIGHT}
          maxWidth={MAX_WIDTH}
          maxHeight={MAX_HEIGHT}
          isVisible={selected}
        />
      )}
      onToggleEdit={() => setIsEditing((previous) => !previous)}
      onDelete={() => deleteNode(id)}
      onClick={() => setSelectedNode(id)}
    >
      {isEditing ? (
        <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.item.name')}</label>
            <input
              type="text"
              value={editData.name}
              onChange={(event) => setEditData((previous) => ({ ...previous, name: event.target.value }))}
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.item.namePlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.common.description')}</label>
            <textarea
              value={editData.description}
              onChange={(event) => setEditData((previous) => ({ ...previous, description: event.target.value }))}
              className={SCRIPT_NODE_TEXTAREA_CLASS}
              rows={3}
              placeholder={t('scriptNodes.item.descriptionPlaceholder')}
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
        <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3 text-sm text-text-dark/88`}>
          {data.description ? (
            <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
              <div className="text-[11px] font-medium text-text-muted">
                {t('scriptNodes.common.description')}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-text-dark/84">
                {data.description}
              </p>
            </div>
          ) : null}
          {data.appearances?.length ? (
            <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
              <div className="text-[11px] font-medium text-text-muted">
                {t('scriptNodes.common.appearances')}
              </div>
              <p className="mt-1 break-words text-xs leading-5 text-text-dark/78">
                {data.appearances.join(', ')}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
          {t('scriptNodes.item.emptyHint')}
        </div>
      )}
    </ScriptNodeCard>
  );
});

ScriptItemNode.displayName = 'ScriptItemNode';
