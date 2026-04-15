import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { useReactFlow } from '@xyflow/react';
import { ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ExpandIcon, Users, MapPin, Package, Link2, FileText, Plus, Pencil, Download, Sparkles, Globe, Eye, FilePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { UiScrollArea } from '@/components/ui';
import { useProjectStore } from '@/stores/projectStore';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  buildAssetExtractionChunks,
  extractAssetsFromChunk,
} from '../application/assetExtractor';
import { AssetEditDialog, type AssetEditFormData, type AssetType } from './AssetEditDialog';
import {
  AssetExtractionProgressDialog,
  type AssetExtractionProgressState,
} from './AssetExtractionProgressDialog';
import { BranchSelectionDialog } from './BranchSelectionDialog';
import { PlotTreeView } from './PlotTreeView';
import { ScriptImportDialog } from './ScriptImportDialog';
import {
  buildDefaultNativePackageFileName,
  exportNativeScriptPackage,
} from '../application/scriptExporter';
import {
  CANVAS_NODE_TYPES,
  type ScriptCharacterAsset,
  type ScriptRootNodeData,
  type ScriptChapterNodeData,
  type ScriptCharacterNodeData,
  type ScriptItemAsset,
  type ScriptLocationNodeData,
  type ScriptLocationAsset,
  type ScriptItemNodeData,
  type ScriptPlotPointNodeData,
  type ScriptWorldviewNodeData,
} from '../domain/canvasNodes';

interface PanelAssetEntry<TAsset> {
  key: string;
  data: TAsset;
  nodeId?: string;
}

const SCRIPT_BIBLE_PANEL_WIDTH_STORAGE_KEY = 'script-bible-panel-width';
const SCRIPT_BIBLE_PANEL_COLLAPSED_STORAGE_KEY = 'script-bible-panel-collapsed';
const SCRIPT_BIBLE_PANEL_DEFAULT_WIDTH = 272;
const SCRIPT_BIBLE_PANEL_MIN_WIDTH = 220;
const SCRIPT_BIBLE_PANEL_MAX_WIDTH = 520;
const SCRIPT_BIBLE_PANEL_COLLAPSED_WIDTH = 52;

function clampPanelWidth(value: number): number {
  return Math.min(
    SCRIPT_BIBLE_PANEL_MAX_WIDTH,
    Math.max(SCRIPT_BIBLE_PANEL_MIN_WIDTH, Math.round(value))
  );
}

function readPanelWidth(): number {
  if (typeof window === 'undefined') {
    return SCRIPT_BIBLE_PANEL_DEFAULT_WIDTH;
  }

  const raw = Number(window.localStorage.getItem(SCRIPT_BIBLE_PANEL_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(raw) || raw <= 0) {
    return SCRIPT_BIBLE_PANEL_DEFAULT_WIDTH;
  }

  return clampPanelWidth(raw);
}

function readPanelCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(SCRIPT_BIBLE_PANEL_COLLAPSED_STORAGE_KEY) === 'true';
}

function normalizeAssetName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function getAssetLookupKey(value: string): string {
  return normalizeAssetName(value).toLowerCase();
}

function summarizeAssetDescription(value?: string, maxLength = 84): string {
  const normalized = typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';

  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function pickLongerText(primary: string, secondary: string): string {
  return primary.length >= secondary.length ? primary : secondary;
}

function mergeStringArray(primary: string[], secondary: string[]): string[] {
  return Array.from(
    new Set(
      [...primary, ...secondary]
        .map((item) => normalizeAssetName(item))
        .filter((item) => item.length > 0)
    )
  );
}

function mergeCharacterAssetData(
  primary: ScriptCharacterAsset,
  secondary: ScriptCharacterAsset
): ScriptCharacterAsset {
  return {
    name: primary.name,
    description: pickLongerText(primary.description, secondary.description),
    personality: pickLongerText(primary.personality, secondary.personality),
    appearance: pickLongerText(primary.appearance, secondary.appearance),
  };
}

function mergeLocationAssetData(
  primary: ScriptLocationAsset,
  secondary: ScriptLocationAsset
): ScriptLocationAsset {
  return {
    name: primary.name,
    description: pickLongerText(primary.description, secondary.description),
    appearances: mergeStringArray(primary.appearances, secondary.appearances),
  };
}

function mergeItemAssetData(
  primary: ScriptItemAsset,
  secondary: ScriptItemAsset
): ScriptItemAsset {
  return {
    name: primary.name,
    description: pickLongerText(primary.description, secondary.description),
    appearances: mergeStringArray(primary.appearances, secondary.appearances),
  };
}

function mergeNamedAssets<TAsset extends { name: string }>(
  items: TAsset[],
  mergeFn: (primary: TAsset, secondary: TAsset) => TAsset
): TAsset[] {
  const map = new Map<string, TAsset>();

  items.forEach((item) => {
    const name = normalizeAssetName(item.name);
    const key = getAssetLookupKey(name);
    if (!key) {
      return;
    }

    const normalizedItem = {
      ...item,
      name,
    };
    const existing = map.get(key);
    map.set(key, existing ? mergeFn(existing, normalizedItem) : normalizedItem);
  });

  return Array.from(map.values());
}

function countNewAssets<TAsset extends { name: string }>(items: TAsset[], existingNames: Set<string>): number {
  return mergeNamedAssets(items, (primary) => primary)
    .filter((item) => !existingNames.has(getAssetLookupKey(item.name)))
    .length;
}

function removeAssetByName<TAsset extends { name: string }>(items: TAsset[], name: string): TAsset[] {
  const targetKey = getAssetLookupKey(name);
  return items.filter((item) => getAssetLookupKey(item.name) !== targetKey);
}

function upsertAssetByName<TAsset extends { name: string }>(
  items: TAsset[],
  nextItem: TAsset,
  mergeFn: (primary: TAsset, secondary: TAsset) => TAsset,
  originalName?: string
): TAsset[] {
  const filteredItems = originalName
    ? removeAssetByName(items, originalName)
    : items;
  return mergeNamedAssets([...filteredItems, nextItem], mergeFn);
}

function toCharacterAsset(data: Pick<ScriptCharacterNodeData, 'name' | 'description' | 'personality' | 'appearance'>): ScriptCharacterAsset {
  return {
    name: normalizeAssetName(data.name || ''),
    description: data.description || '',
    personality: data.personality || '',
    appearance: data.appearance || '',
  };
}

function toLocationAsset(data: Pick<ScriptLocationNodeData, 'name' | 'description' | 'appearances'>): ScriptLocationAsset {
  return {
    name: normalizeAssetName(data.name || ''),
    description: data.description || '',
    appearances: Array.isArray(data.appearances) ? data.appearances : [],
  };
}

function toItemAsset(data: Pick<ScriptItemNodeData, 'name' | 'description' | 'appearances'>): ScriptItemAsset {
  return {
    name: normalizeAssetName(data.name || ''),
    description: data.description || '',
    appearances: Array.isArray(data.appearances) ? data.appearances : [],
  };
}

function buildPanelAssetEntries<TAsset extends { name: string }>(
  libraryAssets: TAsset[],
  nodeAssets: Array<{ id: string; data: TAsset }>,
  mergeFn: (primary: TAsset, secondary: TAsset) => TAsset
): Array<PanelAssetEntry<TAsset>> {
  const map = new Map<string, PanelAssetEntry<TAsset>>();

  libraryAssets.forEach((asset) => {
    const key = getAssetLookupKey(asset.name);
    if (!key) {
      return;
    }

    const existing = map.get(key);
    map.set(key, {
      key,
      nodeId: existing?.nodeId,
      data: existing ? mergeFn(existing.data, asset) : asset,
    });
  });

  nodeAssets.forEach((node) => {
    const key = getAssetLookupKey(node.data.name);
    if (!key) {
      return;
    }

    const existing = map.get(key);
    map.set(key, {
      key,
      nodeId: node.id,
      data: existing ? mergeFn(existing.data, node.data) : node.data,
    });
  });

  return Array.from(map.values()).sort((left, right) => left.data.name.localeCompare(right.data.name, 'zh-Hans-CN'));
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  onAdd?: () => void;
  children: React.ReactNode;
}

const EMPTY_ASSET_EXTRACTION_PROGRESS: AssetExtractionProgressState = {
  isOpen: false,
  isRunning: false,
  totalBatches: 0,
  completedBatches: 0,
  currentLabel: '',
  summary: {
    characters: 0,
    locations: 0,
    items: 0,
  },
  logs: [],
  error: '',
};

function CollapsibleSection({ title, icon, count, onAdd, children }: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="border-b border-border-dark">
      <div className="flex items-center justify-between px-3 py-2 hover:bg-bg-dark transition-colors">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1"
        >
          {isExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
          {icon}
          <span className="text-sm font-medium text-text-dark">{title}</span>
          <span className="text-xs text-text-muted">({count})</span>
        </button>
        {onAdd && (
          <button
            onClick={onAdd}
            className="p-1 rounded hover:bg-border-dark text-text-muted hover:text-text-dark"
            title={`添加${title}`}
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>
      {isExpanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

interface AssetItemProps {
  label: string;
  description?: string;
  onClick?: () => void;
  onEdit?: () => void;
  onShowOnCanvas?: () => void;
  showOnCanvasDisabled?: boolean;
}

function AssetItem({ label, description, onClick, onEdit, onShowOnCanvas, showOnCanvasDisabled }: AssetItemProps) {
  const summarizedDescription = summarizeAssetDescription(description);

  return (
    <div className="group flex min-w-0 items-start gap-1">
      <button
        onClick={onClick}
        className="min-w-0 flex-1 rounded p-2 text-left transition-colors hover:bg-bg-dark"
        title={description || label}
      >
        <div className="break-words text-sm font-medium leading-5 text-text-dark whitespace-pre-wrap">
          {label}
        </div>
        {summarizedDescription ? (
          <div className="mt-1 break-words text-xs leading-5 text-text-muted">
            {summarizedDescription}
          </div>
        ) : null}
      </button>
      {onShowOnCanvas && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onShowOnCanvas();
          }}
          disabled={showOnCanvasDisabled}
          className="mt-2 shrink-0 rounded p-1 text-cyan-400 opacity-0 hover:bg-cyan-500/20 group-hover:opacity-100 disabled:opacity-50"
          title="显示到画布"
        >
          <Eye className="w-3 h-3" />
        </button>
      )}
      {onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="mt-2 shrink-0 rounded p-1 text-text-muted opacity-0 hover:bg-border-dark hover:text-text-dark group-hover:opacity-100"
          title="编辑"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

export function ScriptBiblePanel() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((state) => state.getCurrentProject());
  const { nodes, edges, addNode, updateNodeData, deleteNode, setSelectedNode } = useCanvasStore();
  const { setCenter } = useReactFlow();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => readPanelWidth());
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(() => readPanelCollapsed());
  const [isPanelResizing, setIsPanelResizing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [assetExtractionProgress, setAssetExtractionProgress] = useState<AssetExtractionProgressState>(
    EMPTY_ASSET_EXTRACTION_PROGRESS
  );
  const panelResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [editDialogState, setEditDialogState] = useState<{
    isOpen: boolean;
    assetType: AssetType;
    target: 'node' | 'library';
    mode: 'create' | 'edit';
    nodeId?: string;
    linkedNodeId?: string;
    originalName?: string;
    editData?: any;
  }>({ isOpen: false, assetType: 'character', target: 'library', mode: 'create' });

  const projectType = currentProject?.projectType;

  const scriptNodes = useMemo(() => {
    return {
      roots: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptRoot) as Array<{ id: string; data: ScriptRootNodeData; position: { x: number; y: number } }>,
      chapters: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptChapter) as Array<{ id: string; data: ScriptChapterNodeData; position: { x: number; y: number } }>,
      characters: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptCharacter) as Array<{ id: string; data: ScriptCharacterNodeData; position: { x: number; y: number } }>,
      locations: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptLocation) as Array<{ id: string; data: ScriptLocationNodeData; position: { x: number; y: number } }>,
      items: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptItem) as Array<{ id: string; data: ScriptItemNodeData; position: { x: number; y: number } }>,
      plotPoints: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptPlotPoint) as Array<{ id: string; data: ScriptPlotPointNodeData; position: { x: number; y: number } }>,
      worldviews: nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptWorldview) as Array<{ id: string; data: ScriptWorldviewNodeData; position: { x: number; y: number } }>,
    };
  }, [nodes]);

  const rootNode = scriptNodes.roots[0] ?? null;
  const panelAssets = useMemo(() => {
    const characterNodes = scriptNodes.characters.map((node) => ({
      id: node.id,
      data: toCharacterAsset(node.data),
    }));
    const locationNodes = scriptNodes.locations.map((node) => ({
      id: node.id,
      data: toLocationAsset(node.data),
    }));
    const itemNodes = scriptNodes.items.map((node) => ({
      id: node.id,
      data: toItemAsset(node.data),
    }));

    return {
      characters: buildPanelAssetEntries(
        rootNode?.data.assetLibraryCharacters ?? [],
        characterNodes,
        mergeCharacterAssetData
      ),
      locations: buildPanelAssetEntries(
        rootNode?.data.assetLibraryLocations ?? [],
        locationNodes,
        mergeLocationAssetData
      ),
      items: buildPanelAssetEntries(
        rootNode?.data.assetLibraryItems ?? [],
        itemNodes,
        mergeItemAssetData
      ),
    };
  }, [rootNode, scriptNodes.characters, scriptNodes.locations, scriptNodes.items]);

  const storyProfileItems = useMemo(() => {
    if (!rootNode) {
      return [];
    }

    return [
      { label: t('script.storyStart.premise'), value: rootNode.data.premise },
      { label: t('script.storyStart.theme'), value: rootNode.data.theme },
      { label: t('script.storyStart.protagonist'), value: rootNode.data.protagonist },
      { label: t('script.storyStart.want'), value: rootNode.data.want },
      { label: t('script.storyStart.stakes'), value: rootNode.data.stakes },
      { label: t('script.storyStart.directorVision'), value: rootNode.data.directorVision },
    ].filter((item) => item.value?.trim().length);
  }, [rootNode, t]);

  const getNextPosition = useCallback((baseX: number, baseY: number, index: number) => {
    const offsetX = (index % 3) * 350;
    const offsetY = Math.floor(index / 3) * 250;
    return { x: baseX + offsetX, y: baseY + offsetY };
  }, []);

  const handleShowOnCanvas = useCallback((type: AssetType, data: any, existingNodeId?: string) => {
    const normalizedName = normalizeAssetName(
      type === 'worldview' ? data.worldviewName || data.name || '' : data.name || ''
    );
    const resolvedNodeId = existingNodeId ?? nodes.find((node) => {
      if (type === 'worldview') {
        return node.type === CANVAS_NODE_TYPES.scriptWorldview
          && getAssetLookupKey((node.data as ScriptWorldviewNodeData).worldviewName || '') === getAssetLookupKey(normalizedName);
      }

      if (type === 'character') {
        return node.type === CANVAS_NODE_TYPES.scriptCharacter
          && getAssetLookupKey((node.data as ScriptCharacterNodeData).name || '') === getAssetLookupKey(normalizedName);
      }

      if (type === 'location') {
        return node.type === CANVAS_NODE_TYPES.scriptLocation
          && getAssetLookupKey((node.data as ScriptLocationNodeData).name || '') === getAssetLookupKey(normalizedName);
      }

      return node.type === CANVAS_NODE_TYPES.scriptItem
        && getAssetLookupKey((node.data as ScriptItemNodeData).name || '') === getAssetLookupKey(normalizedName);
    })?.id;

    if (resolvedNodeId) {
      const node = nodes.find(n => n.id === resolvedNodeId);
      if (node) {
        setSelectedNode(node.id);
        const nodeWidth = node.measured?.width ?? 200;
        const nodeHeight = node.measured?.height ?? 150;
        setCenter(
          node.position.x + nodeWidth / 2,
          node.position.y + nodeHeight / 2,
          { zoom: 1, duration: 300 }
        );
      }
      return;
    }

    const existingNodes = nodes.filter(n => 
      n.type === CANVAS_NODE_TYPES.scriptCharacter ||
      n.type === CANVAS_NODE_TYPES.scriptLocation ||
      n.type === CANVAS_NODE_TYPES.scriptItem ||
      n.type === CANVAS_NODE_TYPES.scriptWorldview
    );
    const position = getNextPosition(900, 100, existingNodes.length);
    let createdNodeId: string | undefined;

    switch (type) {
      case 'character':
        createdNodeId = addNode(CANVAS_NODE_TYPES.scriptCharacter, position, {
          displayName: data.name || '新角色',
          name: data.name || '',
          description: data.description || '',
          personality: data.personality || '',
          appearance: data.appearance || '',
        });
        break;
      case 'location':
        createdNodeId = addNode(CANVAS_NODE_TYPES.scriptLocation, position, {
          displayName: data.name || '新场景',
          name: data.name || '',
          description: data.description || '',
          appearances: data.appearances || [],
        });
        break;
      case 'item':
        createdNodeId = addNode(CANVAS_NODE_TYPES.scriptItem, position, {
          displayName: data.name || '新道具',
          name: data.name || '',
          description: data.description || '',
          appearances: data.appearances || [],
        });
        break;
      case 'worldview':
        createdNodeId = addNode(CANVAS_NODE_TYPES.scriptWorldview, position, {
          displayName: data.worldviewName || '世界观',
          worldviewName: data.worldviewName || '',
          description: data.description || '',
          era: data.era || '',
          technology: data.technology || '',
          magic: data.magic || '',
          society: data.society || '',
          geography: data.geography || '',
          rules: data.rules || [],
        });
        break;
    }

    if (createdNodeId) {
      setSelectedNode(createdNodeId);
      setCenter(position.x + 150, position.y + 90, { zoom: 1, duration: 300 });
    }
  }, [nodes, addNode, getNextPosition, setCenter, setSelectedNode]);

  const handleSaveLibraryAsset = useCallback((formData: AssetEditFormData) => {
    if (!rootNode) {
      return;
    }

    const normalizedName = normalizeAssetName(formData.name);
    const originalName = editDialogState.originalName || normalizedName;

    switch (editDialogState.assetType) {
      case 'character': {
        const nextAsset: ScriptCharacterAsset = {
          name: normalizedName,
          description: formData.description || '',
          personality: formData.personality || '',
          appearance: formData.appearance || '',
        };
        updateNodeData(rootNode.id, {
          assetLibraryCharacters: upsertAssetByName(
            rootNode.data.assetLibraryCharacters,
            nextAsset,
            mergeCharacterAssetData,
            originalName
          ),
        });

        if (editDialogState.linkedNodeId) {
          updateNodeData(editDialogState.linkedNodeId, {
            displayName: nextAsset.name,
            name: nextAsset.name,
            description: nextAsset.description,
            personality: nextAsset.personality,
            appearance: nextAsset.appearance,
          });
        }
        break;
      }
      case 'location': {
        const nextAsset: ScriptLocationAsset = {
          name: normalizedName,
          description: formData.description || '',
          appearances: Array.isArray(formData.appearances) ? formData.appearances : [],
        };
        updateNodeData(rootNode.id, {
          assetLibraryLocations: upsertAssetByName(
            rootNode.data.assetLibraryLocations,
            nextAsset,
            mergeLocationAssetData,
            originalName
          ),
        });

        if (editDialogState.linkedNodeId) {
          updateNodeData(editDialogState.linkedNodeId, {
            displayName: nextAsset.name,
            name: nextAsset.name,
            description: nextAsset.description,
            appearances: nextAsset.appearances,
          });
        }
        break;
      }
      case 'item': {
        const nextAsset: ScriptItemAsset = {
          name: normalizedName,
          description: formData.description || '',
          appearances: Array.isArray(formData.appearances) ? formData.appearances : [],
        };
        updateNodeData(rootNode.id, {
          assetLibraryItems: upsertAssetByName(
            rootNode.data.assetLibraryItems,
            nextAsset,
            mergeItemAssetData,
            originalName
          ),
        });

        if (editDialogState.linkedNodeId) {
          updateNodeData(editDialogState.linkedNodeId, {
            displayName: nextAsset.name,
            name: nextAsset.name,
            description: nextAsset.description,
            appearances: nextAsset.appearances,
          });
        }
        break;
      }
      default:
        break;
    }
  }, [editDialogState, rootNode, updateNodeData]);

  const handleDeleteLibraryAsset = useCallback(() => {
    if (!rootNode || !editDialogState.originalName) {
      if (editDialogState.linkedNodeId) {
        deleteNode(editDialogState.linkedNodeId);
      }
      return;
    }

    switch (editDialogState.assetType) {
      case 'character':
        updateNodeData(rootNode.id, {
          assetLibraryCharacters: removeAssetByName(rootNode.data.assetLibraryCharacters, editDialogState.originalName),
        });
        break;
      case 'location':
        updateNodeData(rootNode.id, {
          assetLibraryLocations: removeAssetByName(rootNode.data.assetLibraryLocations, editDialogState.originalName),
        });
        break;
      case 'item':
        updateNodeData(rootNode.id, {
          assetLibraryItems: removeAssetByName(rootNode.data.assetLibraryItems, editDialogState.originalName),
        });
        break;
      default:
        break;
    }

    if (editDialogState.linkedNodeId) {
      deleteNode(editDialogState.linkedNodeId);
    }
  }, [deleteNode, editDialogState, rootNode, updateNodeData]);

  const handleExtractAssets = useCallback(() => {
    const initialNodes = useCanvasStore.getState().nodes;
    const chunks = buildAssetExtractionChunks(initialNodes);

    if (chunks.length === 0) {
      setAssetExtractionProgress({
        ...EMPTY_ASSET_EXTRACTION_PROGRESS,
        isOpen: true,
        error: t('script.assetExtraction.noContent'),
        currentLabel: t('script.assetExtraction.noContent'),
      });
      return;
    }

    setIsExtracting(true);
    setAssetExtractionProgress({
      ...EMPTY_ASSET_EXTRACTION_PROGRESS,
      isOpen: true,
      isRunning: true,
      totalBatches: chunks.length,
      currentLabel: t('script.assetExtraction.preparing'),
      logs: chunks.map((chunk) => ({
        id: chunk.id,
        label: chunk.label,
        detail: t('script.assetExtraction.batchPending', { chars: chunk.charCount }),
        status: 'pending',
      })),
    });

    void (async () => {
      const totalSummary = {
        characters: 0,
        locations: 0,
        items: 0,
      };
      let activeChunkId = '';

      try {
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          activeChunkId = chunk.id;

          setAssetExtractionProgress((current) => ({
            ...current,
            currentLabel: t('script.assetExtraction.submittingBatch', {
              current: index + 1,
              total: chunks.length,
              label: chunk.label,
            }),
            logs: current.logs.map((log) => (
              log.id === chunk.id
                ? {
                    ...log,
                    status: 'running',
                    detail: t('script.assetExtraction.batchRunning', {
                      chars: chunk.charCount,
                    }),
                  }
                : log
            )),
          }));

          const extractedAssets = await extractAssetsFromChunk(chunk);
          const store = useCanvasStore.getState();
          const currentRoot = store.nodes.find((node) => node.type === CANVAS_NODE_TYPES.scriptRoot) as
            | { id: string; data: ScriptRootNodeData }
            | undefined;
          if (!currentRoot) {
            throw new Error('请先保留剧本根节点，才能把提取结果写入左侧资产面板。');
          }

          const existingCharacterNames = new Set(
            [
              ...(currentRoot.data.assetLibraryCharacters ?? []).map((item) => item.name),
              ...store.nodes
                .filter((node) => node.type === CANVAS_NODE_TYPES.scriptCharacter)
                .map((node) => (node.data as ScriptCharacterNodeData).name || ''),
            ]
              .map((item) => getAssetLookupKey(item))
              .filter((item) => item.length > 0)
          );
          const existingLocationNames = new Set(
            [
              ...(currentRoot.data.assetLibraryLocations ?? []).map((item) => item.name),
              ...store.nodes
                .filter((node) => node.type === CANVAS_NODE_TYPES.scriptLocation)
                .map((node) => (node.data as ScriptLocationNodeData).name || ''),
            ]
              .map((item) => getAssetLookupKey(item))
              .filter((item) => item.length > 0)
          );
          const existingItemNames = new Set(
            [
              ...(currentRoot.data.assetLibraryItems ?? []).map((item) => item.name),
              ...store.nodes
                .filter((node) => node.type === CANVAS_NODE_TYPES.scriptItem)
                .map((node) => (node.data as ScriptItemNodeData).name || ''),
            ]
              .map((item) => getAssetLookupKey(item))
              .filter((item) => item.length > 0)
          );

          const nextCharacterAssets = extractedAssets.characters.map((item) => toCharacterAsset(item));
          const nextLocationAssets = extractedAssets.locations.map((item) => ({
            name: normalizeAssetName(item.name),
            description: item.description || '',
            appearances: [],
          }));
          const nextItemAssets = extractedAssets.items.map((item) => ({
            name: normalizeAssetName(item.name),
            description: item.description || '',
            appearances: [],
          }));

          store.updateNodeData(currentRoot.id, {
            assetLibraryCharacters: mergeNamedAssets(
              [...(currentRoot.data.assetLibraryCharacters ?? []), ...nextCharacterAssets],
              mergeCharacterAssetData
            ),
            assetLibraryLocations: mergeNamedAssets(
              [...(currentRoot.data.assetLibraryLocations ?? []), ...nextLocationAssets],
              mergeLocationAssetData
            ),
            assetLibraryItems: mergeNamedAssets(
              [...(currentRoot.data.assetLibraryItems ?? []), ...nextItemAssets],
              mergeItemAssetData
            ),
          });

          const applied = {
            characters: countNewAssets(nextCharacterAssets, existingCharacterNames),
            locations: countNewAssets(nextLocationAssets, existingLocationNames),
            items: countNewAssets(nextItemAssets, existingItemNames),
          };

          totalSummary.characters += applied.characters;
          totalSummary.locations += applied.locations;
          totalSummary.items += applied.items;

          setAssetExtractionProgress((current) => ({
            ...current,
            completedBatches: index + 1,
            summary: { ...totalSummary },
            currentLabel: index + 1 < chunks.length
              ? t('script.assetExtraction.waitingNextBatch')
              : t('script.assetExtraction.completedHint'),
            logs: current.logs.map((log) => (
              log.id === chunk.id
                ? {
                    ...log,
                    status: 'completed',
                    detail: t('script.assetExtraction.batchCompleted', {
                      characters: applied.characters,
                      locations: applied.locations,
                      items: applied.items,
                    }),
                  }
                : log
            )),
          }));
        }

        setAssetExtractionProgress((current) => ({
          ...current,
          isRunning: false,
          currentLabel: t('script.assetExtraction.completedHint'),
          summary: { ...totalSummary },
        }));
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : t('script.assetExtraction.unknownError');

        setAssetExtractionProgress((current) => ({
          ...current,
          isRunning: false,
          error: message,
          currentLabel: t('script.assetExtraction.failedTitle'),
          logs: current.logs.map((log) => (
            log.id === activeChunkId
              ? {
                  ...log,
                  status: 'failed',
                  detail: message,
                }
              : log
          )),
        }));
      } finally {
        setIsExtracting(false);
      }
    })();
  }, [t]);

  const handleCloseAssetExtractionProgress = useCallback(() => {
    setAssetExtractionProgress((current) => (
      current.isRunning
        ? current
        : EMPTY_ASSET_EXTRACTION_PROGRESS
    ));
  }, []);

  const handlePanelCollapse = useCallback(() => {
    setIsPanelCollapsed(true);
  }, []);

  const handlePanelExpand = useCallback(() => {
    setIsPanelCollapsed(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SCRIPT_BIBLE_PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
  }, [panelWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SCRIPT_BIBLE_PANEL_COLLAPSED_STORAGE_KEY,
      isPanelCollapsed ? 'true' : 'false'
    );
  }, [isPanelCollapsed]);

  useEffect(() => {
    if (!isPanelResizing) {
      return;
    }

    if (typeof document !== 'undefined') {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.getSelection()?.removeAllRanges();
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = panelResizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const nextWidth = clampPanelWidth(
        resizeState.startWidth + (event.clientX - resizeState.startX)
      );
      setPanelWidth(nextWidth);
    };

    const handlePointerUp = () => {
      panelResizeStateRef.current = null;
      setIsPanelResizing(false);
    };

    const handleSelectStart = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('selectstart', handleSelectStart);
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('selectstart', handleSelectStart);
    };
  }, [isPanelResizing]);

  const handleNodeClick = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      setSelectedNode(nodeId);
      const nodeWidth = node.measured?.width ?? 200;
      const nodeHeight = node.measured?.height ?? 150;
      setCenter(
        node.position.x + nodeWidth / 2,
        node.position.y + nodeHeight / 2,
        { zoom: 1, duration: 300 }
      );
    }
  }, [nodes, setCenter, setSelectedNode]);

  const handleImportScript = useCallback(() => {
    setShowImportDialog(true);
  }, []);

  const handleExportNativePackage = useCallback(async () => {
    const rootTitle = rootNode?.data.title?.trim() || 'Untitled Script';
    const selectedPath = await save({
      defaultPath: buildDefaultNativePackageFileName(rootTitle),
      filters: [{ name: 'Script Package', extensions: ['json'] }],
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    await exportNativeScriptPackage(nodes as any, edges as any, selectedPath);
  }, [edges, nodes, rootNode]);

  const handleAddAsset = useCallback((type: AssetType) => {
    setEditDialogState({
      isOpen: true,
      assetType: type,
      target: type === 'worldview' ? 'node' : 'library',
      mode: 'create',
    });
  }, []);

  const handleEditNodeAsset = useCallback((type: AssetType, nodeId: string, data: any) => {
    setEditDialogState({
      isOpen: true,
      assetType: type,
      target: 'node',
      mode: 'edit',
      nodeId,
      editData: data,
    });
  }, []);

  const handleEditLibraryAsset = useCallback((
    type: Extract<AssetType, 'character' | 'location' | 'item'>,
    data: ScriptCharacterAsset | ScriptLocationAsset | ScriptItemAsset,
    linkedNodeId?: string
  ) => {
    setEditDialogState({
      isOpen: true,
      assetType: type,
      target: 'library',
      mode: 'edit',
      linkedNodeId,
      originalName: data.name,
      editData: data,
    });
  }, []);

  const handleCloseEditDialog = useCallback(() => {
    setEditDialogState({
      isOpen: false,
      assetType: 'character',
      target: 'library',
      mode: 'create',
    });
  }, []);

  if (projectType !== 'script') {
    return null;
  }

  if (isPanelCollapsed) {
    return (
      <div
        className="flex h-full shrink-0 flex-col bg-surface-dark border-r border-border-dark transition-all duration-300"
        style={{ width: SCRIPT_BIBLE_PANEL_COLLAPSED_WIDTH }}
      >
        <button
          onClick={handlePanelExpand}
          className="flex flex-col items-center justify-center py-4 px-1 hover:bg-bg-dark transition-colors group"
          title="展开资产栏"
        >
          <ExpandIcon className="w-5 h-5 text-text-muted group-hover:text-amber-400 transition-colors" />
          <FileText className="w-4 h-4 text-amber-400 mt-2" />
          <span className="text-xs text-text-muted mt-1">资产</span>
        </button>
      </div>
    );
  }

  const panelWidthStyle = panelWidth;

  return (
    <aside
      className={`relative h-full shrink-0 border-r border-border-dark bg-surface-dark ${
        isPanelResizing ? 'transition-none' : 'transition-[width] duration-300'
      }`}
      style={{ width: panelWidthStyle }}
    >
      <div
        className="absolute right-0 top-0 z-10 h-full w-[4px] translate-x-full cursor-col-resize touch-none transition-colors hover:bg-amber-400/25"
        onPointerDown={(event) => {
          event.preventDefault();
          panelResizeStateRef.current = {
            startX: event.clientX,
            startWidth: panelWidth,
          };
          setIsPanelResizing(true);
        }}
      />
      <div className="h-full overflow-hidden flex flex-col">
      <div className="sticky top-0 bg-surface-dark border-b border-border-dark px-3 py-2 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 flex-1">
          <FileText className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-text-dark">剧本资产</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExtractAssets}
            disabled={isExtracting}
            className="p-1 rounded hover:bg-bg-dark text-amber-400 hover:text-amber-300"
            title="一键提取资产"
          >
            <Sparkles className={`w-4 h-4 ${isExtracting ? 'animate-pulse' : ''}`} />
          </button>
          <button
            onClick={() => setShowExportDialog(true)}
            className="p-1 rounded hover:bg-bg-dark text-text-muted hover:text-text-dark"
            title="导出剧本"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handleExportNativePackage}
            className="p-1 rounded hover:bg-bg-dark text-cyan-300 hover:text-cyan-200"
            title={t('scriptExportDialog.exportPackage')}
          >
            <Package className="w-4 h-4" />
          </button>
          <button
                onClick={handleImportScript}
                className="p-1 rounded hover:bg-bg-dark cursor-pointer"
                title="导入剧本"
              >
                <FilePlus className="w-4 h-4 text-text-muted" />
              </button>
          <button
            onClick={handlePanelCollapse}
            className="p-1 rounded hover:bg-bg-dark text-text-muted hover:text-text-dark"
            title="收起面板"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </div>

      <UiScrollArea
        className="flex-1"
        viewportClassName="h-full"
        contentClassName="pb-3"
      >
        {rootNode ? (
          <CollapsibleSection
            title={t('script.storyStart.storyProfile')}
            icon={<Sparkles className="w-4 h-4 text-amber-400" />}
            count={storyProfileItems.length || 1}
          >
            <button
              onClick={() => handleNodeClick(rootNode.id)}
              className="w-full rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-left transition-colors hover:border-amber-500/40 hover:bg-amber-500/10"
            >
              <div className="text-sm font-semibold text-text-dark">
                {rootNode.data.title || rootNode.data.displayName}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-text-muted">
                {rootNode.data.genre ? (
                  <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-amber-300">
                    {rootNode.data.genre}
                  </span>
                ) : null}
                <span className="rounded-full border border-border-dark bg-bg-dark/60 px-2 py-1">
                  {t('script.storyStart.chapterCount')}: {rootNode.data.totalChapters || scriptNodes.chapters.length}
                </span>
              </div>
            </button>

            {storyProfileItems.length ? (
              <div className="mt-3 space-y-2">
                {storyProfileItems.map((item) => (
                  <div key={item.label} className="rounded-lg border border-border-dark bg-bg-dark/40 px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.08em] text-text-muted">
                      {item.label}
                    </div>
                    <div className="mt-1 text-sm leading-5 text-text-dark">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {rootNode.data.beats?.length ? (
              <div className="mt-3">
                <div className="mb-2 text-[11px] uppercase tracking-[0.08em] text-text-muted">
                  {t('script.storyStart.beats')}
                </div>
                <div className="space-y-2">
                  {rootNode.data.beats.map((beat) => (
                    <div key={beat.id ?? beat.key} className="rounded-lg border border-border-dark bg-bg-dark/40 px-3 py-2">
                      <div className="text-sm font-medium text-text-dark">{beat.title}</div>
                      {beat.summary ? (
                        <div className="mt-1 text-xs leading-5 text-text-muted">{beat.summary}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CollapsibleSection>
        ) : null}
        <CollapsibleSection
            title="剧情摘要"
            icon={<FileText className="w-4 h-4 text-text-muted" />}
            count={scriptNodes.chapters.length}
          >
            <PlotTreeView 
              chapters={scriptNodes.chapters} 
              onNodeClick={handleNodeClick}
            />
          </CollapsibleSection>

          <CollapsibleSection
            title="世界观"
            icon={<Globe className="w-4 h-4 text-cyan-400" />}
            count={scriptNodes.worldviews.length}
            onAdd={() => handleAddAsset('worldview')}
          >
            {scriptNodes.worldviews.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无世界观设定</p>
            ) : (
              <div className="space-y-1">
                {scriptNodes.worldviews.map((node) => (
                  <AssetItem
                    key={node.id}
                    label={node.data.worldviewName || node.data.displayName || '未命名'}
                    description={node.data.description}
                    onClick={() => handleNodeClick(node.id)}
                    onEdit={() => handleEditNodeAsset('worldview', node.id, node.data)}
                    onShowOnCanvas={() => handleShowOnCanvas('worldview', node.data, node.id)}
                    showOnCanvasDisabled={true}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="角色档案"
            icon={<Users className="w-4 h-4 text-text-muted" />}
            count={panelAssets.characters.length}
            onAdd={() => handleAddAsset('character')}
          >
            {panelAssets.characters.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无角色</p>
            ) : (
              <div className="space-y-1">
                {panelAssets.characters.map((asset) => (
                  <AssetItem
                    key={asset.key}
                    label={asset.data.name || '未命名'}
                    description={asset.data.description}
                    onClick={asset.nodeId ? () => handleNodeClick(asset.nodeId as string) : undefined}
                    onEdit={() => handleEditLibraryAsset('character', asset.data, asset.nodeId)}
                    onShowOnCanvas={() => handleShowOnCanvas('character', asset.data, asset.nodeId)}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="场景地点"
            icon={<MapPin className="w-4 h-4 text-text-muted" />}
            count={panelAssets.locations.length}
            onAdd={() => handleAddAsset('location')}
          >
            {panelAssets.locations.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无场景</p>
            ) : (
              <div className="space-y-1">
                {panelAssets.locations.map((asset) => (
                  <AssetItem
                    key={asset.key}
                    label={asset.data.name || '未命名'}
                    description={asset.data.description}
                    onClick={asset.nodeId ? () => handleNodeClick(asset.nodeId as string) : undefined}
                    onEdit={() => handleEditLibraryAsset('location', asset.data, asset.nodeId)}
                    onShowOnCanvas={() => handleShowOnCanvas('location', asset.data, asset.nodeId)}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="关键道具"
            icon={<Package className="w-4 h-4 text-text-muted" />}
            count={panelAssets.items.length}
            onAdd={() => handleAddAsset('item')}
          >
            {panelAssets.items.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无道具</p>
            ) : (
              <div className="space-y-1">
                {panelAssets.items.map((asset) => (
                  <AssetItem
                    key={asset.key}
                    label={asset.data.name || '未命名'}
                    description={asset.data.description}
                    onClick={asset.nodeId ? () => handleNodeClick(asset.nodeId as string) : undefined}
                    onEdit={() => handleEditLibraryAsset('item', asset.data, asset.nodeId)}
                    onShowOnCanvas={() => handleShowOnCanvas('item', asset.data, asset.nodeId)}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="埋点追踪"
            icon={<Link2 className="w-4 h-4 text-text-muted" />}
            count={scriptNodes.plotPoints.length}
          >
            {scriptNodes.plotPoints.length === 0 ? (
              <p className="text-xs text-text-muted py-2">暂无埋点</p>
            ) : (
              <div className="space-y-1">
                {scriptNodes.plotPoints.map((node) => (
                  <AssetItem
                    key={node.id}
                    label={node.data.pointType === 'setup' ? '🔗 伏笔' : '✅ 响应'}
                    description={node.data.description}
                    onClick={() => handleNodeClick(node.id)}
                  />
                ))}
              </div>
            )}
          </CollapsibleSection>
      </UiScrollArea>

      <AssetEditDialog
        isOpen={editDialogState.isOpen}
        assetType={editDialogState.assetType}
        editData={editDialogState.editData}
        nodeId={editDialogState.target === 'node' ? editDialogState.nodeId : undefined}
        mode={editDialogState.mode}
        onSaveAsset={editDialogState.target === 'library' ? handleSaveLibraryAsset : undefined}
        onDeleteAsset={
          editDialogState.target === 'library' && editDialogState.mode === 'edit'
            ? handleDeleteLibraryAsset
            : undefined
        }
        onClose={handleCloseEditDialog}
      />

      {showImportDialog ? (
        <ScriptImportDialog
          isOpen={showImportDialog}
          onClose={() => setShowImportDialog(false)}
        />
      ) : null}

      {showExportDialog ? (
        <BranchSelectionDialog
          isOpen={showExportDialog}
          onClose={() => setShowExportDialog(false)}
        />
      ) : null}

      <AssetExtractionProgressDialog
        progress={assetExtractionProgress}
        onClose={handleCloseAssetExtractionProgress}
      />
      </div>
    </aside>
  );
}
