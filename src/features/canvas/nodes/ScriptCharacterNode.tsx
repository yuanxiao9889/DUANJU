import { memo, useCallback, useState } from 'react';
import { Check, Loader2, Sparkles, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  mergeCharacterAssetData,
  toCharacterAsset,
  upsertAssetByName,
} from '@/features/canvas/application/scriptAssetLibrary';
import { optimizeScriptCharacterFields } from '@/features/canvas/application/scriptAssetOptimizer';
import {
  CANVAS_NODE_TYPES,
  type ScriptCharacterNodeData,
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

type ScriptCharacterNodeProps = {
  id: string;
  data: ScriptCharacterNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 360;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 240;
const MAX_WIDTH = 560;
const MAX_HEIGHT = 820;

export const ScriptCharacterNode = memo(({
  id,
  data,
  selected,
  width,
  height,
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
  const resolvedWidth = resolveScriptNodeDimension(width, DEFAULT_WIDTH);
  const resolvedHeight = resolveScriptNodeDimension(height, DEFAULT_HEIGHT);

  const getOptimizationSource = useCallback((): ScriptCharacterNodeData => ({
    ...data,
    name: isEditing ? editData.name : (data.name || ''),
    description: isEditing ? editData.description : (data.description || ''),
    personality: isEditing ? editData.personality : (data.personality || ''),
    appearance: isEditing ? editData.appearance : (data.appearance || ''),
  }), [data, editData.appearance, editData.description, editData.name, editData.personality, isEditing]);

  const persistCharacterAssetLibrary = useCallback((nextData: {
    name: string;
    description: string;
    personality: string;
    appearance: string;
  }) => {
    const rootNode = useCanvasStore.getState().nodes.find(
      (node) => node.type === CANVAS_NODE_TYPES.scriptRoot
    ) as ({ id: string; data: ScriptRootNodeData } | undefined);
    const nextAsset = toCharacterAsset(nextData);
    if (rootNode && nextAsset.name) {
      updateNodeData(rootNode.id, {
        assetLibraryCharacters: upsertAssetByName(
          rootNode.data.assetLibraryCharacters ?? [],
          nextAsset,
          mergeCharacterAssetData,
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
    persistCharacterAssetLibrary(nextData);

    setIsEditing(false);
  }, [data.displayName, editData, id, persistCharacterAssetLibrary, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      name: data.name || '',
      description: data.description || '',
      personality: data.personality || '',
      appearance: data.appearance || '',
    });
    setIsEditing(false);
  }, [data.appearance, data.description, data.name, data.personality]);

  const { isOptimizing, handleOptimize } = useScriptAssetOptimization({
    validateSource: () => {
      const source = getOptimizationSource();
      return source.name.trim() || source.description.trim() || source.personality.trim() || source.appearance.trim()
        ? null
        : t('scriptNodes.character.optimizeMissingSource');
    },
    onStart: () => setIsEditing(true),
    optimize: (nodes) => optimizeScriptCharacterFields(getOptimizationSource(), nodes),
    applyOptimizedResult: (result) => {
      const source = getOptimizationSource();
      persistCharacterAssetLibrary({
        name: source.name,
        description: result.description,
        personality: result.personality,
        appearance: result.appearance,
      });
      setIsEditing(true);
      setEditData({
        name: source.name,
        description: result.description,
        personality: result.personality,
        appearance: result.appearance,
      });
    },
  });

  return (
    <ScriptNodeCard
      accent="violet"
      icon={<User className="h-4 w-4" />}
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
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.character.personality')}</label>
            <textarea
              value={editData.personality}
              onChange={(event) => setEditData((previous) => ({ ...previous, personality: event.target.value }))}
              className={SCRIPT_NODE_TEXTAREA_CLASS}
              rows={2}
              placeholder={t('scriptNodes.character.personalityPlaceholder')}
            />
          </div>
          <div>
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.character.appearance')}</label>
            <textarea
              value={editData.appearance}
              onChange={(event) => setEditData((previous) => ({ ...previous, appearance: event.target.value }))}
              className={SCRIPT_NODE_TEXTAREA_CLASS}
              rows={4}
              placeholder={t('scriptNodes.character.appearancePlaceholder')}
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
          {data.personality ? (
            <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
              <div className="text-[11px] font-medium text-text-muted">
                {t('scriptNodes.character.personality')}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-text-dark/80">
                {data.personality}
              </p>
            </div>
          ) : null}
          {data.appearance ? (
            <div className={SCRIPT_NODE_SECTION_CARD_CLASS}>
              <div className="text-[11px] font-medium text-text-muted">
                {t('scriptNodes.character.appearance')}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-text-dark/82">
                {data.appearance}
              </p>
            </div>
          ) : null}
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
