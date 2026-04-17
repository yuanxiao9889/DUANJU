import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Image as ImageIcon, Link2, MapPin, Package, RefreshCcw, TriangleAlert, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiLoadingOverlay, UiScrollArea, UiSelect } from '@/components/ui';
import { getProjectRecord } from '@/commands/projectState';
import {
  buildScriptCharacterReferenceSnapshot,
  buildScriptItemReferenceSnapshot,
  buildScriptLocationReferenceSnapshot,
  extractLinkedScriptAssetLibraries,
  findLinkedScriptCharacterAsset,
  findLinkedScriptItemAsset,
  findLinkedScriptLocationAsset,
  type LinkedScriptAssetLibraries,
} from '@/features/canvas/application/scriptAssetReferences';
import {
  CANVAS_NODE_TYPES,
  IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  IMAGE_EDIT_NODE_DEFAULT_WIDTH,
  SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT,
  SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH,
  type CanvasNodeType,
  type ScriptCharacterAsset,
  type ScriptCharacterReferenceNodeData,
  type ScriptCharacterReferenceSnapshot,
  type ScriptItemAsset,
  type ScriptItemReferenceNodeData,
  type ScriptItemReferenceSnapshot,
  type ScriptLocationAsset,
  type ScriptLocationReferenceNodeData,
  type ScriptLocationReferenceSnapshot,
} from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

type ScriptAssetReferenceKind = 'character' | 'location' | 'item';

type ScriptAssetReferenceNodeData =
  | ScriptCharacterReferenceNodeData
  | ScriptLocationReferenceNodeData
  | ScriptItemReferenceNodeData;

type ScriptAssetReferenceSnapshot =
  | ScriptCharacterReferenceSnapshot
  | ScriptLocationReferenceSnapshot
  | ScriptItemReferenceSnapshot;

type ScriptAssetReferenceAsset =
  | ScriptCharacterAsset
  | ScriptLocationAsset
  | ScriptItemAsset;

type ScriptAssetReferenceNodeProps<TData extends ScriptAssetReferenceNodeData> = {
  id: string;
  data: TData;
  selected?: boolean;
  width?: number;
  height?: number;
};

type ScriptAssetReferenceDownstreamTarget = 'image' | 'jimengImage';

const MIN_NODE_WIDTH = 520;
const MIN_NODE_HEIGHT = 460;
const MAX_NODE_WIDTH = 980;
const MAX_NODE_HEIGHT = 1080;
const JIMENG_IMAGE_NODE_DEFAULT_WIDTH = 640;
const JIMENG_IMAGE_NODE_DEFAULT_HEIGHT = 340;

const SCRIPT_ASSET_REFERENCE_DOWNSTREAM_TARGETS = {
  image: {
    type: CANVAS_NODE_TYPES.imageEdit,
    width: IMAGE_EDIT_NODE_DEFAULT_WIDTH,
    height: IMAGE_EDIT_NODE_DEFAULT_HEIGHT,
  },
  jimengImage: {
    type: CANVAS_NODE_TYPES.jimengImage,
    width: JIMENG_IMAGE_NODE_DEFAULT_WIDTH,
    height: JIMENG_IMAGE_NODE_DEFAULT_HEIGHT,
  },
} satisfies Record<
  ScriptAssetReferenceDownstreamTarget,
  {
    type: CanvasNodeType;
    width: number;
    height: number;
  }
>;

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

function formatAssetList(values: string[] | undefined, emptyValue: string): string {
  if (!Array.isArray(values) || values.length === 0) {
    return emptyValue;
  }

  return values.join(', ');
}

function getNodeTypeForKind(kind: ScriptAssetReferenceKind): CanvasNodeType {
  switch (kind) {
    case 'character':
      return CANVAS_NODE_TYPES.scriptCharacterReference;
    case 'location':
      return CANVAS_NODE_TYPES.scriptLocationReference;
    case 'item':
      return CANVAS_NODE_TYPES.scriptItemReference;
  }
}

function getKindIcon(kind: ScriptAssetReferenceKind) {
  switch (kind) {
    case 'character':
      return User;
    case 'location':
      return MapPin;
    case 'item':
      return Package;
  }
}

function getAssetTypeLabelKey(kind: ScriptAssetReferenceKind): string {
  return `node.scriptAssetReference.assetTypes.${kind}`;
}

function getBadgeLabelKey(kind: ScriptAssetReferenceKind): string {
  switch (kind) {
    case 'character':
      return 'node.menu.scriptCharacterReference';
    case 'location':
      return 'node.menu.scriptLocationReference';
    case 'item':
      return 'node.menu.scriptItemReference';
  }
}

function getAvailableAssets(
  kind: ScriptAssetReferenceKind,
  libraries: LinkedScriptAssetLibraries
): ScriptAssetReferenceAsset[] {
  switch (kind) {
    case 'character':
      return libraries.characters;
    case 'location':
      return libraries.locations;
    case 'item':
      return libraries.items;
  }
}

function findSelectedAsset(
  kind: ScriptAssetReferenceKind,
  libraries: LinkedScriptAssetLibraries,
  assetName: string | null | undefined
): ScriptAssetReferenceAsset | null {
  switch (kind) {
    case 'character':
      return findLinkedScriptCharacterAsset(libraries, assetName);
    case 'location':
      return findLinkedScriptLocationAsset(libraries, assetName);
    case 'item':
      return findLinkedScriptItemAsset(libraries, assetName);
  }
}

function buildAssetSnapshot(
  kind: ScriptAssetReferenceKind,
  asset: ScriptAssetReferenceAsset
): ScriptAssetReferenceSnapshot {
  switch (kind) {
    case 'character':
      return buildScriptCharacterReferenceSnapshot(asset as ScriptCharacterAsset);
    case 'location':
      return buildScriptLocationReferenceSnapshot(asset as ScriptLocationAsset);
    case 'item':
      return buildScriptItemReferenceSnapshot(asset as ScriptItemAsset);
  }
}

function isAssetSnapshotStale(
  kind: ScriptAssetReferenceKind,
  snapshot: ScriptAssetReferenceSnapshot | null,
  asset: ScriptAssetReferenceAsset
): boolean {
  if (!snapshot) {
    return true;
  }

  switch (kind) {
    case 'character': {
      const currentAsset = asset as ScriptCharacterAsset;
      const currentSnapshot = snapshot as ScriptCharacterReferenceSnapshot;
      return currentSnapshot.name !== currentAsset.name
        || currentSnapshot.description !== currentAsset.description
        || currentSnapshot.personality !== currentAsset.personality
        || currentSnapshot.appearance !== currentAsset.appearance;
    }
    case 'location': {
      const currentAsset = asset as ScriptLocationAsset;
      const currentSnapshot = snapshot as ScriptLocationReferenceSnapshot;
      return currentSnapshot.name !== currentAsset.name
        || currentSnapshot.description !== currentAsset.description
        || currentSnapshot.appearances.length !== currentAsset.appearances.length
        || currentSnapshot.appearances.some((item, index) => item !== currentAsset.appearances[index]);
    }
    case 'item': {
      const currentAsset = asset as ScriptItemAsset;
      const currentSnapshot = snapshot as ScriptItemReferenceSnapshot;
      return currentSnapshot.name !== currentAsset.name
        || currentSnapshot.description !== currentAsset.description
        || currentSnapshot.appearances.length !== currentAsset.appearances.length
        || currentSnapshot.appearances.some((item, index) => item !== currentAsset.appearances[index]);
    }
  }
}

function buildReferencePrompt(
  kind: ScriptAssetReferenceKind,
  snapshot: ScriptAssetReferenceSnapshot,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const emptyValue = t('node.scriptAssetReference.emptyValue');
  const lines = [t(`node.scriptAssetReference.prompt.${kind}.intro`)];

  if (kind === 'character') {
    const item = snapshot as ScriptCharacterReferenceSnapshot;
    lines.push(`${t('node.scriptAssetReference.fields.personality')}: ${item.personality || emptyValue}`);
    lines.push(`${t('node.scriptAssetReference.fields.appearance')}: ${item.appearance || emptyValue}`);
  } else if (kind === 'location') {
    const item = snapshot as ScriptLocationReferenceSnapshot;
    lines.push(`${t('node.scriptAssetReference.fields.name')}: ${item.name || emptyValue}`);
    lines.push(`${t('node.scriptAssetReference.fields.description')}: ${item.description || emptyValue}`);
    lines.push(`${t('node.scriptAssetReference.fields.appearances')}: ${formatAssetList(item.appearances, emptyValue)}`);
  } else {
    const item = snapshot as ScriptItemReferenceSnapshot;
    lines.push(`${t('node.scriptAssetReference.fields.name')}: ${item.name || emptyValue}`);
    lines.push(`${t('node.scriptAssetReference.fields.description')}: ${item.description || emptyValue}`);
    lines.push(`${t('node.scriptAssetReference.fields.appearances')}: ${formatAssetList(item.appearances, emptyValue)}`);
  }

  lines.push(`${t('node.scriptAssetReference.prompt.requirementLabel')}: ${t('node.scriptAssetReference.prompt.requirementValue')}`);
  return lines.join('\n');
}

function ScriptAssetReferenceNode({
  id,
  data,
  selected,
  width,
  height,
  kind,
}: ScriptAssetReferenceNodeProps<ScriptAssetReferenceNodeData> & {
  kind: ScriptAssetReferenceKind;
}) {
  const { t } = useTranslation();
  const currentProject = useProjectStore((state) => state.currentProject);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const findNodePosition = useCanvasStore((state) => state.findNodePosition);
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const [libraries, setLibraries] = useState<LinkedScriptAssetLibraries>({
    characters: [],
    locations: [],
    items: [],
  });
  const [linkedProjectName, setLinkedProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const linkedScriptProjectId = currentProject?.projectType === 'storyboard'
    ? (currentProject.linkedScriptProjectId ?? data.linkedScriptProjectId ?? null)
    : (data.linkedScriptProjectId ?? null);
  const resolvedWidth = resolveNodeDimension(width, SCRIPT_REFERENCE_NODE_DEFAULT_WIDTH);
  const resolvedHeight = resolveNodeDimension(height, SCRIPT_REFERENCE_NODE_DEFAULT_HEIGHT);
  const resolvedTitle = resolveNodeDisplayName(getNodeTypeForKind(kind), data);
  const assetTypeLabel = t(getAssetTypeLabelKey(kind));
  const badgeLabel = t(getBadgeLabelKey(kind));
  const Icon = getKindIcon(kind);

  const loadLinkedProject = useCallback(async () => {
    if (!linkedScriptProjectId) {
      setLibraries({ characters: [], locations: [], items: [] });
      setLinkedProjectName('');
      setLoadError('');
      return;
    }

    setIsLoading(true);
    setLoadError('');
    try {
      const record = await getProjectRecord(linkedScriptProjectId);
      if (!record) {
        setLibraries({ characters: [], locations: [], items: [] });
        setLinkedProjectName('');
        setLoadError(t('node.scriptAssetReference.missingProject'));
        return;
      }

      setLinkedProjectName(record.name);
      setLibraries(extractLinkedScriptAssetLibraries(record));
      if ((data.linkedScriptProjectId ?? null) !== linkedScriptProjectId) {
        updateNodeData(id, { linkedScriptProjectId }, { historyMode: 'skip' });
      }
    } catch (error) {
      setLibraries({ characters: [], locations: [], items: [] });
      setLinkedProjectName('');
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [data.linkedScriptProjectId, id, linkedScriptProjectId, t, updateNodeData]);

  useEffect(() => {
    void loadLinkedProject();
  }, [loadLinkedProject]);

  const availableAssets = useMemo(
    () => getAvailableAssets(kind, libraries),
    [kind, libraries]
  );
  const selectedAsset = useMemo(
    () => findSelectedAsset(kind, libraries, data.referencedAssetName),
    [data.referencedAssetName, kind, libraries]
  );
  const selectedSnapshot = useMemo<ScriptAssetReferenceSnapshot | null>(
    () => (selectedAsset ? buildAssetSnapshot(kind, selectedAsset) : (data.assetSnapshot ?? null)),
    [data.assetSnapshot, kind, selectedAsset]
  );
  const staleSnapshot = Boolean(
    selectedAsset && isAssetSnapshotStale(kind, data.assetSnapshot ?? null, selectedAsset)
  );

  const statusMessage = !linkedScriptProjectId
    ? t('node.scriptAssetReference.missingProjectLink')
    : loadError
      ? loadError
      : data.referencedAssetName && !selectedAsset
        ? t('node.scriptAssetReference.missingAsset', { assetType: assetTypeLabel })
        : staleSnapshot
          ? t('node.scriptAssetReference.staleSnapshot', { assetType: assetTypeLabel })
          : selectedAsset
            ? t('node.scriptAssetReference.ready')
            : t('node.scriptAssetReference.selectAssetHint', { assetType: assetTypeLabel });

  const derivedSyncStatus = !linkedScriptProjectId
    ? 'idle'
    : loadError
      ? 'missingProject'
      : data.referencedAssetName && !selectedAsset
        ? 'missingAsset'
        : staleSnapshot
          ? 'stale'
          : selectedAsset
            ? 'ready'
            : 'idle';
  const derivedSyncMessage = derivedSyncStatus === 'ready' || derivedSyncStatus === 'idle'
    ? null
    : statusMessage;

  useEffect(() => {
    const nextLinkedProjectId = linkedScriptProjectId ?? null;
    const nextSyncMessage = derivedSyncMessage ?? null;
    const currentSyncMessage = data.syncMessage ?? null;
    if (
      (data.linkedScriptProjectId ?? null) === nextLinkedProjectId
      && data.syncStatus === derivedSyncStatus
      && currentSyncMessage === nextSyncMessage
    ) {
      return;
    }

    updateNodeData(
      id,
      {
        linkedScriptProjectId: nextLinkedProjectId,
        syncStatus: derivedSyncStatus,
        syncMessage: nextSyncMessage,
      },
      { historyMode: 'skip' }
    );
  }, [
    data.linkedScriptProjectId,
    data.syncMessage,
    data.syncStatus,
    derivedSyncMessage,
    derivedSyncStatus,
    id,
    linkedScriptProjectId,
    updateNodeData,
  ]);

  const persistSelection = useCallback((asset: ScriptAssetReferenceAsset) => {
    updateNodeData(
      id,
      {
        linkedScriptProjectId,
        referencedAssetName: asset.name,
        assetSnapshot: buildAssetSnapshot(kind, asset),
        syncStatus: 'ready',
        syncMessage: null,
        lastSyncedAt: Date.now(),
      },
      { historyMode: 'skip' }
    );
  }, [id, kind, linkedScriptProjectId, updateNodeData]);

  const handleRefreshSelection = useCallback(() => {
    if (!selectedAsset) {
      return;
    }

    persistSelection(selectedAsset);
  }, [persistSelection, selectedAsset]);

  const createDownstreamNode = useCallback((target: ScriptAssetReferenceDownstreamTarget) => {
    if (!selectedAsset) {
      return;
    }

    const snapshot = buildAssetSnapshot(kind, selectedAsset);
    const downstreamTarget = SCRIPT_ASSET_REFERENCE_DOWNSTREAM_TARGETS[target];
    const prompt = buildReferencePrompt(kind, snapshot, t);
    const nextNodeId = addNode(
      downstreamTarget.type,
      findNodePosition(id, downstreamTarget.width, downstreamTarget.height),
      {
        displayName: `${selectedAsset.name}${t('node.scriptAssetReference.designImageSuffix')}`,
        nodeDescription: selectedAsset.description?.trim() || null,
        prompt,
      },
      { inheritParentFromNodeId: id }
    );

    if (nextNodeId) {
      addEdge(id, nextNodeId);
    }
  }, [addEdge, addNode, findNodePosition, id, kind, selectedAsset, t]);

  const promptPreview = useMemo(
    () => (selectedSnapshot ? buildReferencePrompt(kind, selectedSnapshot, t) : ''),
    [kind, selectedSnapshot, t]
  );

  return (
    <div
      className={`group relative overflow-visible rounded-[20px] border bg-surface-dark shadow-[0_20px_40px_rgba(2,6,23,0.22)] ${selected ? 'border-cyan-300/55' : 'border-cyan-300/18 hover:border-cyan-300/32'}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-3 !w-3 !-left-1.5 !rounded-full !border-surface-dark !bg-cyan-400"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-3 !w-3 !-right-1.5 !rounded-full !border-surface-dark !bg-teal-400"
      />

      <div className="relative flex h-full flex-col overflow-hidden rounded-[20px] p-3">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[20px]">
          <div className="absolute inset-x-0 top-0 h-[2px] bg-cyan-300/70" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-cyan-200/85">
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5">
                <Icon className="mr-1 inline h-3 w-3" />
                {badgeLabel}
              </span>
              {linkedProjectName ? (
                <span className="rounded-full bg-amber-500/12 px-2 py-0.5 text-amber-200">
                  <Link2 className="mr-1 inline h-3 w-3" />
                  {linkedProjectName}
                </span>
              ) : null}
            </div>
            <div className="mt-2 truncate text-sm font-semibold text-text-dark">{resolvedTitle}</div>
            <div className="mt-1 line-clamp-2 text-xs text-text-muted">{statusMessage}</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void loadLinkedProject();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-text-muted hover:border-cyan-400/25 hover:bg-cyan-500/10 hover:text-cyan-100"
              title={t('node.scriptAssetReference.refreshLibrary')}
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-bg-dark px-2.5 py-1 text-text-muted">
            {selectedAsset?.name || data.referencedAssetName || t('node.scriptAssetReference.unselected')}
          </span>
          {statusMessage !== t('node.scriptAssetReference.ready') ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-1 text-amber-200">
              <TriangleAlert className="h-3.5 w-3.5" />
              {t('node.scriptAssetReference.warning')}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!selectedAsset}
            onClick={(event) => {
              event.stopPropagation();
              createDownstreamNode('image');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 disabled:opacity-60"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {t('node.scriptAssetReference.generateImage')}
          </button>
          <button
            type="button"
            disabled={!selectedAsset}
            onClick={(event) => {
              event.stopPropagation();
              createDownstreamNode('jimengImage');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 disabled:opacity-60"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {t('node.scriptAssetReference.generateJimengImage')}
          </button>
        </div>

        <div
          className="nowheel mt-3 flex min-h-0 flex-1 flex-col gap-3"
          onWheelCapture={(event) => {
            event.stopPropagation();
          }}
        >
          {!linkedScriptProjectId ? (
            <div className="rounded-xl border border-dashed border-border-dark/70 bg-bg-dark px-3 py-6 text-center text-xs text-text-muted">
              {t('node.scriptAssetReference.missingProjectLink')}
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border-dark/70 bg-bg-dark px-3 py-3">
                <div className="grid gap-2">
                  <div className="grid grid-cols-[88px,minmax(0,1fr)] items-center gap-2">
                    <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-cyan-200">
                      {t('node.scriptAssetReference.selectLabel', { assetType: assetTypeLabel })}
                    </div>
                    {availableAssets.length > 0 ? (
                      <UiSelect
                        value={data.referencedAssetName ?? ''}
                        onChange={(event) => {
                          const nextAssetName = event.currentTarget.value.trim();
                          if (!nextAssetName) {
                            return;
                          }

                          const nextAsset = findSelectedAsset(kind, libraries, nextAssetName);
                          if (nextAsset) {
                            persistSelection(nextAsset);
                          }
                        }}
                        className="h-9 rounded-lg px-3 text-sm"
                        aria-label={t('node.scriptAssetReference.selectLabel', { assetType: assetTypeLabel })}
                      >
                        <option value="" disabled>
                          {t('node.scriptAssetReference.selectAssetHint', { assetType: assetTypeLabel })}
                        </option>
                        {availableAssets.map((asset) => (
                          <option key={asset.name} value={asset.name}>
                            {asset.name}
                          </option>
                        ))}
                      </UiSelect>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border-dark/70 bg-surface-dark px-3 py-2 text-xs text-text-muted">
                        {loadError || t('node.scriptAssetReference.emptyOptions', { assetType: assetTypeLabel })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 rounded-xl border border-border-dark/70 bg-bg-dark">
                {selectedSnapshot ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="flex items-center justify-between gap-3 border-b border-border-dark/70 px-3 py-3">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-cyan-200">{assetTypeLabel}</div>
                        <div className="truncate text-sm font-semibold text-text-dark">
                          {selectedSnapshot.name}
                        </div>
                        <div className="mt-1 truncate text-xs text-text-muted">
                          {t('node.scriptAssetReference.promptPreview')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRefreshSelection();
                        }}
                        disabled={!selectedAsset}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-dark bg-surface-dark px-3 py-1.5 text-xs font-medium text-text-dark hover:bg-bg-dark disabled:opacity-60"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        {t('node.scriptAssetReference.refreshSelection')}
                      </button>
                    </div>
                    <UiScrollArea
                      className="nowheel min-h-0 flex-1"
                      viewportClassName="nowheel h-full"
                      contentClassName="space-y-3 px-3 py-3 pr-5"
                    >
                      <div className="rounded-xl border border-border-dark/70 bg-surface-dark px-3 py-3">
                        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-cyan-200">
                          {t('node.scriptAssetReference.promptPreview')}
                        </div>
                        <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-6 text-text-dark">
                          {promptPreview}
                        </pre>
                      </div>
                    </UiScrollArea>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-muted">
                    {t('node.scriptAssetReference.selectAssetHint', { assetType: assetTypeLabel })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <NodeResizeHandle
        minWidth={MIN_NODE_WIDTH}
        minHeight={MIN_NODE_HEIGHT}
        maxWidth={MAX_NODE_WIDTH}
        maxHeight={MAX_NODE_HEIGHT}
        isVisible={selected}
      />
      <UiLoadingOverlay
        visible={isLoading}
        insetClassName="inset-3"
        backdropClassName="bg-transparent"
        variant="bare"
      />
    </div>
  );
}

export const ScriptCharacterReferenceNode = memo((props: ScriptAssetReferenceNodeProps<ScriptCharacterReferenceNodeData>) => (
  <ScriptAssetReferenceNode {...props} kind="character" />
));

export const ScriptLocationReferenceNode = memo((props: ScriptAssetReferenceNodeProps<ScriptLocationReferenceNodeData>) => (
  <ScriptAssetReferenceNode {...props} kind="location" />
));

export const ScriptItemReferenceNode = memo((props: ScriptAssetReferenceNodeProps<ScriptItemReferenceNodeData>) => (
  <ScriptAssetReferenceNode {...props} kind="item" />
));

ScriptCharacterReferenceNode.displayName = 'ScriptCharacterReferenceNode';
ScriptLocationReferenceNode.displayName = 'ScriptLocationReferenceNode';
ScriptItemReferenceNode.displayName = 'ScriptItemReferenceNode';
