import { memo, useCallback, useState, type MouseEvent } from 'react';
import {
  BookText,
  Check,
  Loader2,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  clampScriptStoryNoteContent,
  SCRIPT_STORY_NOTE_MAX_LENGTH,
} from '@/features/canvas/application/scriptStoryNotes';
import { optimizeScriptStoryNoteContent } from '@/features/canvas/application/scriptStoryNoteOptimizer';
import {
  CANVAS_NODE_TYPES,
  type ScriptStoryNoteNodeData,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';

import {
  SCRIPT_NODE_EMPTY_HINT_CLASS,
  SCRIPT_NODE_ICON_BUTTON_CLASS,
  SCRIPT_NODE_INPUT_CLASS,
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

type ScriptStoryNoteNodeProps = {
  id: string;
  data: ScriptStoryNoteNodeData;
  selected?: boolean;
  width?: number;
  height?: number;
};

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 340;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 240;
const MAX_WIDTH = 640;
const MAX_HEIGHT = 900;

function countCharacters(text: string): number {
  return Array.from(text).length;
}

export const ScriptStoryNoteNode = memo(({
  id,
  data,
  selected,
  width,
  height,
}: ScriptStoryNoteNodeProps) => {
  const { t } = useTranslation();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const deleteNode = useCanvasStore((state) => state.deleteNode);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    title: data.title || '',
    content: data.content || '',
  });

  const resolvedTitle = resolveNodeDisplayName(CANVAS_NODE_TYPES.scriptStoryNote, data);
  const cardTitle = (isEditing ? editData.title : data.title) || resolvedTitle;
  const hasContent = data.content.trim().length > 0;
  const resolvedWidth = resolveScriptNodeDimension(width, DEFAULT_WIDTH);
  const resolvedHeight = resolveScriptNodeDimension(height, DEFAULT_HEIGHT);

  const getOptimizationSource = useCallback(() => ({
    title: isEditing ? editData.title : (data.title || ''),
    content: isEditing ? editData.content : (data.content || ''),
  }), [data.content, data.title, editData.content, editData.title, isEditing]);

  const handleSaveEdit = useCallback(() => {
    const nextTitle = editData.title.trim();
    updateNodeData(id, {
      title: nextTitle,
      content: clampScriptStoryNoteContent(editData.content),
      displayName: nextTitle || resolvedTitle,
    });
    setIsEditing(false);
  }, [editData.content, editData.title, id, resolvedTitle, updateNodeData]);

  const handleCancelEdit = useCallback(() => {
    setEditData({
      title: data.title || '',
      content: data.content || '',
    });
    setIsEditing(false);
  }, [data.content, data.title]);

  const handleToggleEnabled = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    updateNodeData(id, {
      isEnabled: !data.isEnabled,
    });
  }, [data.isEnabled, id, updateNodeData]);

  const { isOptimizing, handleOptimize } = useScriptAssetOptimization({
    validateSource: () => (
      getOptimizationSource().content.trim()
        ? null
        : t('scriptNodes.storyNote.optimizeMissingSource')
    ),
    onStart: () => setIsEditing(true),
    optimize: async () => optimizeScriptStoryNoteContent(getOptimizationSource().content),
    applyOptimizedResult: (result) => {
      const source = getOptimizationSource();
      setIsEditing(true);
      setEditData({
        title: source.title,
        content: clampScriptStoryNoteContent(result),
      });
    },
  });

  return (
    <ScriptNodeCard
      accent="amber"
      icon={<BookText className="h-4 w-4" />}
      title={cardTitle}
      selected={selected}
      width={resolvedWidth}
      height={resolvedHeight}
      minHeight={180}
      isEditing={isEditing}
      contentClassName="gap-3"
      headerActions={(
        <>
          <button
            type="button"
            onClick={handleToggleEnabled}
            className={`${SCRIPT_NODE_ICON_BUTTON_CLASS} ${
              data.isEnabled
                ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/35 hover:bg-emerald-500/16'
                : 'border-border-dark/70 bg-bg-dark/60 text-text-muted hover:border-border-dark hover:bg-bg-dark'
            }`}
            title={data.isEnabled ? t('scriptNodes.storyNote.disable') : t('scriptNodes.storyNote.enable')}
          >
            {data.isEnabled ? (
              <ToggleRight className="h-4 w-4" />
            ) : (
              <ToggleLeft className="h-4 w-4" />
            )}
          </button>
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
        </>
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
            <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.storyNote.title')}</label>
            <input
              type="text"
              value={editData.title}
              onChange={(event) => setEditData((previous) => ({ ...previous, title: event.target.value }))}
              className={SCRIPT_NODE_INPUT_CLASS}
              placeholder={t('scriptNodes.storyNote.titlePlaceholder')}
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <label className={SCRIPT_NODE_LABEL_CLASS}>{t('scriptNodes.storyNote.content')}</label>
              <span className="text-[11px] text-text-muted">
                {t('scriptNodes.storyNote.charCount', {
                  current: countCharacters(editData.content),
                  max: SCRIPT_STORY_NOTE_MAX_LENGTH,
                })}
              </span>
            </div>
            <textarea
              value={editData.content}
              onChange={(event) => setEditData((previous) => ({
                ...previous,
                content: clampScriptStoryNoteContent(event.target.value),
              }))}
              className={`${SCRIPT_NODE_TEXTAREA_CLASS} min-h-[180px]`}
              rows={10}
              placeholder={t('scriptNodes.storyNote.contentPlaceholder')}
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
      ) : (
        <div className={`${SCRIPT_NODE_SCROLL_AREA_CLASS} space-y-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${
              data.isEnabled
                ? 'bg-emerald-500/14 text-emerald-200'
                : 'bg-white/8 text-text-muted'
            }`}>
              {data.isEnabled
                ? t('scriptNodes.storyNote.enabled')
                : t('scriptNodes.storyNote.disabled')}
            </span>
            {!data.isEnabled ? (
              <span className="text-[11px] text-text-muted">
                {t('scriptNodes.storyNote.inactiveHint')}
              </span>
            ) : null}
          </div>

          {hasContent ? (
            <div className={`${SCRIPT_NODE_SECTION_CARD_CLASS} ${data.isEnabled ? '' : 'opacity-65'}`}>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-text-dark/84">
                {data.content}
              </p>
            </div>
          ) : (
            <div className={SCRIPT_NODE_EMPTY_HINT_CLASS}>
              {t('scriptNodes.storyNote.emptyHint')}
            </div>
          )}
        </div>
      )}
    </ScriptNodeCard>
  );
});

ScriptStoryNoteNode.displayName = 'ScriptStoryNoteNode';
