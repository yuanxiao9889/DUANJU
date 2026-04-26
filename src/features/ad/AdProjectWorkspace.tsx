import { Fragment, useEffect, useMemo, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clapperboard,
  Download,
  GripVertical,
  Import,
  LibraryBig,
  Loader2,
  Plus,
  RefreshCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import {
  buildAdDirectorSkillPackageData,
} from '@/features/ad/directorSkillLibrary';
import {
  exportAdScriptWorkbook,
} from '@/features/ad/application/adExport';
import {
  generateAdScriptRows,
  generateDirectorSkillPreview,
  getMissingAdBriefFields,
  normalizeAdBriefWithAi,
  regenerateAdScriptTable,
  rewriteAdScriptCell,
  rewriteAdScriptRow,
  type AdScriptPromptColumn,
} from '@/features/ad/application/adGeneration';
import {
  exportAdDirectorSkillPackage,
  importAdDirectorSkillPackage,
} from '@/commands/adDirectorSkillPackage';
import {
  AD_DIRECTOR_SKILL_PACKAGE_FILE_NAME,
  AD_SCRIPT_TEMPLATE_DEFINITIONS,
  createDefaultAdColumnLayout,
  createDefaultAdProjectRootState,
  createDefaultAdScriptRow,
  createDefaultDirectorSkillProfile,
  reindexAdScriptRows,
  type AdBrief,
  type AdBuiltInScriptColumnKey,
  type AdDirectorSkillCategory,
  type AdDirectorSkillTemplate,
  type AdWorkflowStep,
  type AdRewriteDraft,
  type AdScriptColumnKey,
  type AdScriptColumnLayoutItem,
  type AdScriptTableRow,
  type AdScriptTemplateId,
  type DirectorSkillProfile,
  isBuiltInAdScriptColumnKey,
} from '@/features/ad/types';
import { UiButton, UiCheckbox, UiInput, UiModal, UiPanel, UiSelect, UiTextAreaField } from '@/components/ui';
import {
  CANVAS_NODE_TYPES,
  normalizeAdProjectRootNodeData,
  type AdProjectRootNodeData,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';
import { DEFAULT_NODE_DISPLAY_NAME } from '@/features/canvas/domain/nodeDisplay';
import { useProjectStore } from '@/stores/projectStore';
import { useSettingsStore } from '@/stores/settingsStore';

interface ActionStatus {
  tone: 'success' | 'error';
  message: string;
}

interface SelectedCell {
  rowId: string;
  columnKey: AdScriptColumnKey;
}

interface SaveSkillTemplateModalState {
  open: boolean;
  name: string;
  categoryId: string | null;
}

const ROOT_NODE_POSITION = { x: 0, y: 0 };
const LOCKED_COLUMN_KEYS = new Set<AdBuiltInScriptColumnKey>([
  'shotNumber',
  'duration',
  'objective',
  'visual',
  'dialogueOrVO',
]);

const BRIEF_FIELD_LABEL_KEYS: Record<keyof AdBrief, string> = {
  brand: 'adProject.brief.fields.brand',
  product: 'adProject.brief.fields.product',
  audience: 'adProject.brief.fields.audience',
  platform: 'adProject.brief.fields.platform',
  duration: 'adProject.brief.fields.duration',
  goal: 'adProject.brief.fields.goal',
  cta: 'adProject.brief.fields.cta',
  mustInclude: 'adProject.brief.fields.mustInclude',
  constraints: 'adProject.brief.fields.constraints',
  references: 'adProject.brief.fields.references',
  normalizedBrief: 'adProject.brief.fields.normalizedBrief',
};

const COLUMN_LABEL_KEYS: Record<AdBuiltInScriptColumnKey, string> = {
  shotNumber: 'adProject.table.columns.shotNumber',
  duration: 'adProject.table.columns.duration',
  objective: 'adProject.table.columns.objective',
  visual: 'adProject.table.columns.visual',
  dialogueOrVO: 'adProject.table.columns.dialogueOrVO',
  camera: 'adProject.table.columns.camera',
  audio: 'adProject.table.columns.audio',
  productFocus: 'adProject.table.columns.productFocus',
  sellingPoint: 'adProject.table.columns.sellingPoint',
  cta: 'adProject.table.columns.cta',
  assetHint: 'adProject.table.columns.assetHint',
  directorIntent: 'adProject.table.columns.directorIntent',
  status: 'adProject.table.columns.status',
};

const STATUS_OPTIONS = ['draft', 'ready', 'locked'] as const;
const WORKFLOW_STEP_ORDER: AdWorkflowStep[] = ['directorSkill', 'brief', 'script'];

const BUILT_IN_SKILL_STARTERS: Array<{
  id: 'conversion' | 'problemSolver' | 'brandEmotion';
  nameKey: string;
  descriptionKey: string;
}> = [
  {
    id: 'conversion',
    nameKey: 'adProject.skillStarters.conversion.name',
    descriptionKey: 'adProject.skillStarters.conversion.description',
  },
  {
    id: 'problemSolver',
    nameKey: 'adProject.skillStarters.problemSolver.name',
    descriptionKey: 'adProject.skillStarters.problemSolver.description',
  },
  {
    id: 'brandEmotion',
    nameKey: 'adProject.skillStarters.brandEmotion.name',
    descriptionKey: 'adProject.skillStarters.brandEmotion.description',
  },
];

const TEMPLATE_VISIBLE_COLUMNS: Record<AdScriptTemplateId, AdBuiltInScriptColumnKey[]> = {
  performance: [
    'shotNumber',
    'duration',
    'objective',
    'visual',
    'dialogueOrVO',
    'audio',
    'productFocus',
    'sellingPoint',
    'cta',
    'status',
  ],
  problemSolution: [
    'shotNumber',
    'duration',
    'objective',
    'visual',
    'dialogueOrVO',
    'camera',
    'productFocus',
    'sellingPoint',
    'cta',
    'directorIntent',
    'status',
  ],
  brandStory: [
    'shotNumber',
    'duration',
    'objective',
    'visual',
    'dialogueOrVO',
    'camera',
    'audio',
    'assetHint',
    'directorIntent',
    'cta',
    'status',
  ],
};

function joinLines(values: string[]): string {
  return values.join('\n');
}

function splitLines(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildStarterProfile(
  starterId: typeof BUILT_IN_SKILL_STARTERS[number]['id'],
  t: TFunction
): DirectorSkillProfile {
  const keyPrefix = `adProject.skillStarters.${starterId}.profile`;

  return {
    identity: t(`${keyPrefix}.identity`),
    styleKeywords: splitLines(t(`${keyPrefix}.styleKeywords`)),
    rhythmPreference: t(`${keyPrefix}.rhythmPreference`),
    visualPreference: t(`${keyPrefix}.visualPreference`),
    narrativePrinciples: splitLines(t(`${keyPrefix}.narrativePrinciples`)),
    taboos: splitLines(t(`${keyPrefix}.taboos`)),
    brandPlatformPreferences: splitLines(t(`${keyPrefix}.brandPlatformPreferences`)),
    profileSummary: '',
    promptSnapshot: '',
  };
}

function hasDirectorSkillStructuredContent(profile: DirectorSkillProfile): boolean {
  return Boolean(
    profile.identity.trim()
    || profile.styleKeywords.length > 0
    || profile.rhythmPreference.trim()
    || profile.visualPreference.trim()
    || profile.narrativePrinciples.length > 0
    || profile.taboos.length > 0
    || profile.brandPlatformPreferences.length > 0
  );
}

function isDirectorSkillComplete(profile: DirectorSkillProfile): boolean {
  return hasDirectorSkillStructuredContent(profile)
    && profile.profileSummary.trim().length > 0
    && profile.promptSnapshot.trim().length > 0;
}

function isBriefComplete(brief: AdBrief, missingFields: Array<keyof AdBrief>): boolean {
  return missingFields.length === 0 && brief.normalizedBrief.trim().length > 0;
}

function getHighestUnlockedWorkflowStep(
  directorSkillComplete: boolean,
  briefComplete: boolean
): AdWorkflowStep {
  if (!directorSkillComplete) {
    return 'directorSkill';
  }

  if (!briefComplete) {
    return 'brief';
  }

  return 'script';
}

function createAdRootNode(
  projectId: string,
  data?: Partial<AdProjectRootNodeData>
): CanvasNode {
  return {
    id: `ad-project-root-${projectId}`,
    type: CANVAS_NODE_TYPES.adProjectRoot,
    position: ROOT_NODE_POSITION,
    draggable: false,
    selectable: false,
    data: normalizeAdProjectRootNodeData({
      displayName: DEFAULT_NODE_DISPLAY_NAME[CANVAS_NODE_TYPES.adProjectRoot],
      ...createDefaultAdProjectRootState(),
      ...data,
    }),
  };
}

function getAdRootNode(nodes: CanvasNode[]): CanvasNode | null {
  return nodes.find((node) => node.type === CANVAS_NODE_TYPES.adProjectRoot) ?? null;
}

function getAdRootNodeData(node: CanvasNode | null | undefined): Partial<AdProjectRootNodeData> | undefined {
  if (!node || node.type !== CANVAS_NODE_TYPES.adProjectRoot) {
    return undefined;
  }

  return node.data as Partial<AdProjectRootNodeData> | undefined;
}

function resolveColumnHeader(column: AdScriptColumnLayoutItem, t: TFunction): string {
  if (!isBuiltInAdScriptColumnKey(column.key)) {
    return column.label?.trim() || column.key;
  }

  return t(COLUMN_LABEL_KEYS[column.key]);
}

function reindexColumnLayout(layout: AdScriptColumnLayoutItem[]): AdScriptColumnLayoutItem[] {
  return [...layout]
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({
      ...item,
      order: index,
      label: isBuiltInAdScriptColumnKey(item.key)
        ? undefined
        : item.label?.trim() || item.key,
    }));
}

function buildTemplateColumnLayout(
  templateId: AdScriptTemplateId,
  currentLayout: AdScriptColumnLayoutItem[] = []
): AdScriptColumnLayoutItem[] {
  const visibleColumns = new Set(TEMPLATE_VISIBLE_COLUMNS[templateId]);
  const nextLayout = currentLayout.length > 0
    ? [...currentLayout].sort((left, right) => left.order - right.order)
    : createDefaultAdColumnLayout();
  const existingKeys = new Set(nextLayout.map((item) => item.key));

  const templateAdjusted = nextLayout.map((item) => (
    isBuiltInAdScriptColumnKey(item.key)
      ? {
          ...item,
          visible: LOCKED_COLUMN_KEYS.has(item.key) || visibleColumns.has(item.key),
          label: undefined,
        }
      : {
          ...item,
          label: item.label?.trim() || item.key,
        }
  ));

  createDefaultAdColumnLayout().forEach((item) => {
    if (existingKeys.has(item.key)) {
      return;
    }

    const builtInKey = item.key as AdBuiltInScriptColumnKey;
    templateAdjusted.push({
      ...item,
      visible: LOCKED_COLUMN_KEYS.has(builtInKey) || visibleColumns.has(builtInKey),
    });
  });

  return reindexColumnLayout(templateAdjusted);
}

function reorderLayout(
  layout: AdScriptColumnLayoutItem[],
  key: AdScriptColumnKey,
  direction: -1 | 1
): AdScriptColumnLayoutItem[] {
  const sorted = [...layout].sort((left, right) => left.order - right.order);
  const index = sorted.findIndex((item) => item.key === key);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
    return layout;
  }

  const next = [...sorted];
  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
  return reindexColumnLayout(next);
}

function createCustomColumnKey(
  layout: AdScriptColumnLayoutItem[],
  label: string
): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'column';
  let index = 1;
  let key = `custom-${slug}`;
  const existingKeys = new Set(layout.map((item) => item.key));

  while (existingKeys.has(key)) {
    index += 1;
    key = `custom-${slug}-${index}`;
  }

  return key;
}

function removeColumnFromRows(rows: AdScriptTableRow[], key: string): AdScriptTableRow[] {
  return rows.map((row) => {
    const { [key]: _omitted, ...nextRow } = row;
    return nextRow as AdScriptTableRow;
  });
}

function moveRow(
  rows: AdScriptTableRow[],
  sourceRowId: string,
  targetRowId: string
): AdScriptTableRow[] {
  if (sourceRowId === targetRowId) {
    return rows;
  }

  const sourceIndex = rows.findIndex((row) => row.id === sourceRowId);
  const targetIndex = rows.findIndex((row) => row.id === targetRowId);
  if (sourceIndex < 0 || targetIndex < 0) {
    return rows;
  }

  const next = [...rows];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return reindexAdScriptRows(next);
}

function replaceRow(
  rows: AdScriptTableRow[],
  rowId: string,
  replacement: AdScriptTableRow
): AdScriptTableRow[] {
  return rows.map((row) => (
    row.id === rowId
      ? {
          ...replacement,
          id: row.id,
          shotNumber: row.shotNumber,
        }
      : row
  ));
}

function insertRowAfter(rows: AdScriptTableRow[], rowId: string): AdScriptTableRow[] {
  const index = rows.findIndex((row) => row.id === rowId);
  if (index < 0) {
    return reindexAdScriptRows([...rows, createDefaultAdScriptRow(rows.length)]);
  }

  const next = [...rows];
  next.splice(index + 1, 0, createDefaultAdScriptRow(index + 1));
  return reindexAdScriptRows(next);
}

function formatErrorMessage(error: unknown, t: TFunction): string {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';

  if (!rawMessage) {
    return t('adProject.errors.unknown');
  }

  if (rawMessage.startsWith('Missing required brief fields:')) {
    const fieldList = rawMessage
      .replace('Missing required brief fields:', '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((field) => {
        const key = BRIEF_FIELD_LABEL_KEYS[field as keyof AdBrief];
        return key ? t(key) : field;
      })
      .join(' / ');

    return t('adProject.errors.missingBriefFields', {
      fields: fieldList || t('adProject.errors.unknownFieldSet'),
    });
  }

  switch (rawMessage) {
    case 'Failed to parse the director skill preview.':
      return t('adProject.errors.skillPreviewParse');
    case 'Failed to parse the normalized ad brief.':
      return t('adProject.errors.briefParse');
    case 'No ad script rows were generated.':
      return t('adProject.errors.rowsEmpty');
    case 'No rewrite variants were returned for the selected cell.':
      return t('adProject.errors.cellRewriteEmpty');
    case 'No row rewrite variants were returned.':
      return t('adProject.errors.rowRewriteEmpty');
    case 'Export path is required.':
      return t('adProject.errors.exportPathRequired');
    case 'At least one column must be visible for export.':
      return t('adProject.errors.noVisibleColumns');
    default:
      return rawMessage;
  }
}

function StatusBanner({ status }: { status: ActionStatus | null }) {
  if (!status) {
    return null;
  }

  return (
    <div
      className={`rounded-[18px] border px-4 py-3 text-sm ${
        status.tone === 'success'
          ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
          : 'border-rose-500/25 bg-rose-500/10 text-rose-100'
      }`}
    >
      {status.message}
    </div>
  );
}

function SaveSkillTemplateModal({
  categories,
  state,
  onClose,
  onChange,
  onConfirm,
}: {
  categories: AdDirectorSkillCategory[];
  state: SaveSkillTemplateModalState;
  onClose: () => void;
  onChange: (next: SaveSkillTemplateModalState) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <UiModal
      isOpen={state.open}
      title={t('adProject.skill.saveTemplateTitle')}
      onClose={onClose}
      widthClassName="w-[calc(100vw-32px)] max-w-[520px]"
      footer={(
        <>
          <UiButton variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </UiButton>
          <UiButton
            variant="primary"
            onClick={onConfirm}
            disabled={!state.name.trim()}
          >
            {t('common.save')}
          </UiButton>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
            {t('adProject.skill.templateName')}
          </label>
          <UiInput
            value={state.name}
            onChange={(event) => onChange({ ...state, name: event.target.value })}
            placeholder={t('adProject.skill.templateNamePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
            {t('adProject.skill.category')}
          </label>
          <UiSelect
            value={state.categoryId ?? ''}
            onChange={(event) => onChange({
              ...state,
              categoryId: event.target.value.trim() || null,
            })}
          >
            <option value="">{t('adProject.skill.noCategory')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </UiSelect>
        </div>
      </div>
    </UiModal>
  );
}

function SkillLibraryModal({
  isOpen,
  categories,
  templates,
  onClose,
  onApplyTemplate,
  onDeleteTemplate,
  onCreateCategory,
  onDeleteCategory,
  onImportLibrary,
  onExportLibrary,
}: {
  isOpen: boolean;
  categories: AdDirectorSkillCategory[];
  templates: AdDirectorSkillTemplate[];
  onClose: () => void;
  onApplyTemplate: (template: AdDirectorSkillTemplate) => void;
  onDeleteTemplate: (templateId: string) => void;
  onCreateCategory: (name: string) => void;
  onDeleteCategory: (categoryId: string) => void;
  onImportLibrary: () => void;
  onExportLibrary: () => void;
}) {
  const { t } = useTranslation();
  const [newCategoryName, setNewCategoryName] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setNewCategoryName('');
  }, [isOpen]);

  const templatesByCategory = useMemo(() => {
    const next = new Map<string | null, AdDirectorSkillTemplate[]>();
    templates.forEach((template) => {
      const key = template.categoryId ?? null;
      const bucket = next.get(key) ?? [];
      bucket.push(template);
      next.set(key, bucket);
    });
    return next;
  }, [templates]);

  return (
    <UiModal
      isOpen={isOpen}
      title={t('adProject.skill.libraryTitle')}
      onClose={onClose}
      widthClassName="w-[calc(100vw-40px)] max-w-[1040px]"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <UiButton variant="ghost" onClick={onImportLibrary} className="gap-2">
            <Upload className="h-4 w-4" />
            {t('adProject.skill.importLibrary')}
          </UiButton>
          <UiButton variant="ghost" onClick={onExportLibrary} className="gap-2">
            <Download className="h-4 w-4" />
            {t('adProject.skill.exportLibrary')}
          </UiButton>
        </div>

        <UiPanel className="space-y-3 rounded-[20px] p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1 space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                {t('adProject.skill.newCategory')}
              </label>
              <UiInput
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder={t('adProject.skill.newCategoryPlaceholder')}
              />
            </div>
            <UiButton
              variant="primary"
              onClick={() => {
                if (!newCategoryName.trim()) {
                  return;
                }
                onCreateCategory(newCategoryName.trim());
                setNewCategoryName('');
              }}
            >
              {t('common.add')}
            </UiButton>
          </div>
        </UiPanel>

        <div className="grid gap-4 lg:grid-cols-2">
          <UiPanel className="rounded-[20px] p-4">
            <div className="mb-3 text-sm font-medium text-text-dark">
              {t('adProject.skill.categoryList')}
            </div>
            <div className="space-y-2">
              <div className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-text-muted">
                {t('adProject.skill.noCategory')}
              </div>
              {categories.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-white/10 px-3 py-6 text-center text-sm text-text-muted">
                  {t('adProject.skill.emptyCategories')}
                </div>
              ) : categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2"
                >
                  <div>
                    <div className="text-sm font-medium text-text-dark">{category.name}</div>
                    <div className="text-xs text-text-muted">
                      {templatesByCategory.get(category.id)?.length ?? 0} {t('adProject.skill.templatesUnit')}
                    </div>
                  </div>
                  <UiButton
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteCategory(category.id)}
                    className="gap-1 text-rose-200 hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('common.delete')}
                  </UiButton>
                </div>
              ))}
            </div>
          </UiPanel>

          <UiPanel className="rounded-[20px] p-4">
            <div className="mb-3 text-sm font-medium text-text-dark">
              {t('adProject.skill.templateLibrary')}
            </div>
            <div className="space-y-3">
              {templates.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-white/10 px-3 py-10 text-center text-sm text-text-muted">
                  {t('adProject.skill.emptyLibrary')}
                </div>
              ) : templates.map((template) => (
                <div
                  key={template.id}
                  className="rounded-[16px] border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-dark">
                        {template.name}
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        {categories.find((category) => category.id === template.categoryId)?.name
                          ?? t('adProject.skill.noCategory')}
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs text-text-muted">
                        {template.profile.profileSummary || template.profile.identity || t('adProject.skill.noSummary')}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <UiButton
                        variant="ghost"
                        size="sm"
                        onClick={() => onApplyTemplate(template)}
                        className="gap-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t('adProject.skill.applyTemplate')}
                      </UiButton>
                      <UiButton
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeleteTemplate(template.id)}
                        className="gap-1 text-rose-200 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('common.delete')}
                      </UiButton>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </UiPanel>
        </div>
      </div>
    </UiModal>
  );
}

export function AdProjectWorkspace() {
  const { t } = useTranslation();
  const currentProject = useProjectStore((state) => state.currentProject);
  const saveCurrentProject = useProjectStore((state) => state.saveCurrentProject);

  const adDirectorSkillCategories = useSettingsStore((state) => state.adDirectorSkillCategories);
  const adDirectorSkillTemplates = useSettingsStore((state) => state.adDirectorSkillTemplates);
  const addAdDirectorSkillCategory = useSettingsStore((state) => state.addAdDirectorSkillCategory);
  const deleteAdDirectorSkillCategory = useSettingsStore((state) => state.deleteAdDirectorSkillCategory);
  const addAdDirectorSkillTemplate = useSettingsStore((state) => state.addAdDirectorSkillTemplate);
  const deleteAdDirectorSkillTemplate = useSettingsStore((state) => state.deleteAdDirectorSkillTemplate);
  const markAdDirectorSkillTemplateUsed = useSettingsStore((state) => state.markAdDirectorSkillTemplateUsed);
  const importAdDirectorSkillPackageData = useSettingsStore(
    (state) => state.importAdDirectorSkillPackageData
  );

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [customColumnName, setCustomColumnName] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveSkillTemplateState, setSaveSkillTemplateState] = useState<SaveSkillTemplateModalState>({
    open: false,
    name: '',
    categoryId: null,
  });

  const commitRootState = (
    nextState:
      | Partial<AdProjectRootNodeData>
      | ((previous: AdProjectRootNodeData) => Partial<AdProjectRootNodeData>)
  ) => {
    const storeState = useProjectStore.getState();
    const project = storeState.currentProject;
    if (!project || project.projectType !== 'ad') {
      return;
    }

    const currentRoot = getAdRootNode(project.nodes);
    const previousData = normalizeAdProjectRootNodeData(getAdRootNodeData(currentRoot));
    const nextData = normalizeAdProjectRootNodeData({
      ...previousData,
      ...(typeof nextState === 'function' ? nextState(previousData) : nextState),
    });

    const nextRootNode: CanvasNode = currentRoot
      ? {
          ...currentRoot,
          type: CANVAS_NODE_TYPES.adProjectRoot,
          position: currentRoot.position ?? ROOT_NODE_POSITION,
          draggable: false,
          selectable: false,
          data: nextData,
        }
      : createAdRootNode(project.id, nextData);

    const remainingNodes = project.nodes.filter((node) => node.id !== currentRoot?.id);
    storeState.saveCurrentProject(
      [nextRootNode, ...remainingNodes.filter((node) => node.type !== CANVAS_NODE_TYPES.adProjectRoot)],
      project.edges,
      project.viewport,
      project.history
    );
  };

  useEffect(() => {
    if (!currentProject || currentProject.projectType !== 'ad') {
      return;
    }

    const rootNodes = currentProject.nodes.filter(
      (node) => node.type === CANVAS_NODE_TYPES.adProjectRoot
    );
    const currentRoot = rootNodes[0] ?? null;
    const normalizedRootData = normalizeAdProjectRootNodeData(getAdRootNodeData(currentRoot));
    const hasNormalizedChange =
      JSON.stringify(currentRoot?.data ?? null) !== JSON.stringify(normalizedRootData);

    if (rootNodes.length === 1 && !hasNormalizedChange) {
      return;
    }

    const nextRoot = currentRoot
      ? {
          ...currentRoot,
          type: CANVAS_NODE_TYPES.adProjectRoot,
          position: currentRoot.position ?? ROOT_NODE_POSITION,
          draggable: false,
          selectable: false,
          data: normalizedRootData,
        }
      : createAdRootNode(currentProject.id);
    const otherNodes = currentProject.nodes.filter(
      (node) => node.type !== CANVAS_NODE_TYPES.adProjectRoot
    );

    saveCurrentProject(
      [nextRoot, ...otherNodes],
      currentProject.edges,
      currentProject.viewport,
      currentProject.history
    );
  }, [currentProject, saveCurrentProject]);

  const rootNode = useMemo(
    () => (currentProject ? getAdRootNode(currentProject.nodes) : null),
    [currentProject]
  );
  const rootState = useMemo<AdProjectRootNodeData>(
    () => normalizeAdProjectRootNodeData(getAdRootNodeData(rootNode)),
    [rootNode]
  );

  useEffect(() => {
    if (!selectedCell) {
      return;
    }

    const rowExists = rootState.rows.some((row) => row.id === selectedCell.rowId);
    const columnExists = rootState.columnLayout.some((column) => column.key === selectedCell.columnKey);
    if (!rowExists || !columnExists) {
      setSelectedCell(null);
    }
  }, [rootState.columnLayout, rootState.rows, selectedCell]);

  useEffect(() => {
    if (!selectedRowId) {
      return;
    }

    const rowExists = rootState.rows.some((row) => row.id === selectedRowId);
    if (!rowExists) {
      setSelectedRowId(null);
    }
  }, [rootState.rows, selectedRowId]);

  const missingBriefFields = getMissingAdBriefFields(rootState.brief);
  const directorSkillCompleted = isDirectorSkillComplete(rootState.directorSkillProfile);
  const briefCompleted = isBriefComplete(rootState.brief, missingBriefFields);
  const highestUnlockedWorkflowStep = getHighestUnlockedWorkflowStep(
    directorSkillCompleted,
    briefCompleted
  );
  const highestUnlockedWorkflowStepIndex = WORKFLOW_STEP_ORDER.indexOf(highestUnlockedWorkflowStep);

  useEffect(() => {
    if (!currentProject || currentProject.projectType !== 'ad') {
      return;
    }

    const currentStepIndex = WORKFLOW_STEP_ORDER.indexOf(rootState.workflowStep);
    if (currentStepIndex <= highestUnlockedWorkflowStepIndex) {
      return;
    }

    commitRootState({
      workflowStep: highestUnlockedWorkflowStep,
    });
  }, [
    currentProject,
    highestUnlockedWorkflowStep,
    highestUnlockedWorkflowStepIndex,
    rootState.workflowStep,
  ]);

  if (!currentProject || currentProject.projectType !== 'ad') {
    return null;
  }

  const visibleColumns = [...rootState.columnLayout]
    .sort((left, right) => left.order - right.order)
    .filter((item) => item.visible);
  const promptColumns = [...rootState.columnLayout]
    .sort((left, right) => left.order - right.order)
    .map<AdScriptPromptColumn>((column) => ({
      key: column.key,
      label: resolveColumnHeader(column, t),
    }));
  const columnHeaders = rootState.columnLayout.reduce<Record<string, string>>(
    (acc, column) => {
      acc[column.key] = resolveColumnHeader(column, t);
      return acc;
    },
    {}
  );
  const templateDefinition = AD_SCRIPT_TEMPLATE_DEFINITIONS.find(
    (template) => template.id === rootState.selectedAdTemplateId
  ) ?? AD_SCRIPT_TEMPLATE_DEFINITIONS[0];
  const rewriteDraft = rootState.rewriteDraft;
  const scriptCompleted = rootState.rows.length > 0;

  const handleWorkflowStepChange = (step: AdWorkflowStep) => {
    if (step === 'directorSkill') {
      commitRootState({ workflowStep: step });
      return;
    }

    if (step === 'brief' && !directorSkillCompleted) {
      setActionStatus({
        tone: 'error',
        message: t('adProject.messages.completeDirectorSkillFirst'),
      });
      return;
    }

    if (step === 'script') {
      if (!directorSkillCompleted) {
        setActionStatus({
          tone: 'error',
          message: t('adProject.messages.completeDirectorSkillFirst'),
        });
        return;
      }

      if (!briefCompleted) {
        setActionStatus({
          tone: 'error',
          message: t('adProject.messages.completeBriefFirst'),
        });
        return;
      }
    }

    commitRootState({ workflowStep: step });
  };

  const setLastError = (message: string | null) => {
    commitRootState({
      lastError: message,
    });
  };

  const runAction = async (
    actionKey: string,
    task: () => Promise<void>,
    successMessage?: string
  ) => {
    setBusyAction(actionKey);
    setActionStatus(null);
    try {
      await task();
      setLastError(null);
      if (successMessage) {
        setActionStatus({
          tone: 'success',
          message: successMessage,
        });
      }
    } catch (error) {
      const message = formatErrorMessage(error, t);
      setLastError(message);
      setActionStatus({
        tone: 'error',
        message,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const applyProjectSkillTemplate = (template: AdDirectorSkillTemplate) => {
    markAdDirectorSkillTemplateUsed(template.id);
    commitRootState({
      directorSkillProfile: template.profile,
      selectedSkillTemplateId: template.id,
    });
    setActionStatus({
      tone: 'success',
      message: t('adProject.messages.templateApplied', { name: template.name }),
    });
  };

  const exportLibrary = async () => {
    const selectedPath = await save({
      defaultPath: AD_DIRECTOR_SKILL_PACKAGE_FILE_NAME,
      filters: [{ name: t('adProject.skill.packageFileType'), extensions: ['adskill'] }],
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    await exportAdDirectorSkillPackage({
      targetPath: selectedPath,
      data: buildAdDirectorSkillPackageData(
        adDirectorSkillCategories,
        adDirectorSkillTemplates
      ),
    });
  };

  const importLibrary = async () => {
    const selectedPath = await open({
      multiple: false,
      filters: [{ name: t('adProject.skill.packageFileType'), extensions: ['adskill'] }],
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    const importedPackage = await importAdDirectorSkillPackage(selectedPath);
    const summary = importAdDirectorSkillPackageData(importedPackage.data);
    const templateToApply = importedPackage.data.templates[0] ?? null;

    if (templateToApply) {
      commitRootState({
        directorSkillProfile: templateToApply.profile,
        selectedSkillTemplateId: templateToApply.id,
      });
    }

    setActionStatus({
      tone: 'success',
      message: t('adProject.messages.libraryImported', {
        templates: summary.addedTemplates + summary.updatedTemplates,
      }),
    });
  };

  const exportCurrentSkill = async () => {
    const selectedPath = await save({
      defaultPath: AD_DIRECTOR_SKILL_PACKAGE_FILE_NAME,
      filters: [{ name: t('adProject.skill.packageFileType'), extensions: ['adskill'] }],
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    const currentTemplate = adDirectorSkillTemplates.find(
      (template) => template.id === rootState.selectedSkillTemplateId
    ) ?? null;
    const currentCategory = currentTemplate?.categoryId
      ? adDirectorSkillCategories.find((category) => category.id === currentTemplate.categoryId) ?? null
      : null;
    const exportedTemplate: AdDirectorSkillTemplate = {
      id: currentTemplate?.id ?? crypto.randomUUID(),
      name:
        currentTemplate?.name
        ?? `${currentProject.name} ${t('adProject.skill.projectSnapshotTemplate')}`,
      categoryId: currentCategory?.id ?? null,
      profile: rootState.directorSkillProfile,
      sortOrder: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    await exportAdDirectorSkillPackage({
      targetPath: selectedPath,
      data: buildAdDirectorSkillPackageData(
        currentCategory ? [currentCategory] : [],
        [exportedTemplate]
      ),
    });
  };

  const updateProfile = (updates: Partial<DirectorSkillProfile>) => {
    commitRootState((previous) => ({
      directorSkillProfile: {
        ...previous.directorSkillProfile,
        ...updates,
      },
    }));
  };

  const updateBrief = (updates: Partial<AdBrief>) => {
    commitRootState((previous) => ({
      brief: {
        ...previous.brief,
        ...updates,
      },
    }));
  };

  const updateRows = (nextRows: AdScriptTableRow[]) => {
    commitRootState({
      rows: reindexAdScriptRows(nextRows),
      lastGeneratedAt: Date.now(),
    });
  };

  const clearRewriteDraft = () => {
    commitRootState({
      rewriteDraft: null,
    });
  };

  const handleGenerateSkillPreview = async () => {
    await runAction('skillPreview', async () => {
      const preview = await generateDirectorSkillPreview(rootState.directorSkillProfile);
      updateProfile(preview);
    }, t('adProject.messages.skillPreviewGenerated'));
  };

  const handleNormalizeBrief = async () => {
    await runAction('normalizeBrief', async () => {
      const normalized = await normalizeAdBriefWithAi(rootState.brief);
      updateBrief({
        normalizedBrief: normalized.normalizedBrief,
      });
      if (normalized.followUpQuestions.length > 0) {
        setActionStatus({
          tone: 'success',
          message: normalized.followUpQuestions.join(' / '),
        });
      }
    }, t('adProject.messages.briefNormalized'));
  };

  const handleGenerateRows = async () => {
    await runAction('generateRows', async () => {
      const nextRows = await generateAdScriptRows({
        directorSkillProfile: rootState.directorSkillProfile,
        brief: rootState.brief,
        templateId: rootState.selectedAdTemplateId,
        columns: promptColumns,
        rowCount: rootState.rows.length > 0 ? rootState.rows.length : templateDefinition.defaultRowCount,
      });
      commitRootState({
        rows: nextRows,
        columnLayout:
          rootState.rows.length === 0
            ? buildTemplateColumnLayout(rootState.selectedAdTemplateId, rootState.columnLayout)
            : rootState.columnLayout,
        rewriteDraft: null,
        lastGeneratedAt: Date.now(),
      });
    }, t('adProject.messages.tableGenerated'));
  };

  const handleRewriteCell = async () => {
    if (!selectedCell) {
      setActionStatus({
        tone: 'error',
        message: t('adProject.messages.selectCellFirst'),
      });
      return;
    }

    const row = rootState.rows.find((item) => item.id === selectedCell.rowId);
    if (!row) {
      return;
    }

    await runAction('rewriteCell', async () => {
      const variants = await rewriteAdScriptCell({
        directorSkillProfile: rootState.directorSkillProfile,
        brief: rootState.brief,
        row,
        columnKey: selectedCell.columnKey,
        columnLabel: columnHeaders[selectedCell.columnKey],
        currentValue: row[selectedCell.columnKey] ?? '',
        instruction: rewriteInstruction,
      });

      const nextDraft: AdRewriteDraft = {
        scope: 'cell',
        rowId: row.id,
        columnKey: selectedCell.columnKey,
        instruction: rewriteInstruction.trim(),
        variants,
        rowVariants: [],
        previewRows: null,
      };
      commitRootState({
        rewriteDraft: nextDraft,
      });
    });
  };

  const handleRewriteRow = async () => {
    if (!selectedRowId) {
      setActionStatus({
        tone: 'error',
        message: t('adProject.messages.selectRowFirst'),
      });
      return;
    }

    const row = rootState.rows.find((item) => item.id === selectedRowId);
    if (!row) {
      return;
    }

    await runAction('rewriteRow', async () => {
      const rowVariants = await rewriteAdScriptRow({
        directorSkillProfile: rootState.directorSkillProfile,
        brief: rootState.brief,
        columns: promptColumns,
        row,
        instruction: rewriteInstruction,
      });

      commitRootState({
        rewriteDraft: {
          scope: 'row',
          rowId: row.id,
          columnKey: null,
          instruction: rewriteInstruction.trim(),
          variants: [],
          rowVariants,
          previewRows: null,
        },
      });
    });
  };

  const handleRegenerateTablePreview = async () => {
    await runAction('regenerateTable', async () => {
      const previewRows = await regenerateAdScriptTable({
        directorSkillProfile: rootState.directorSkillProfile,
        brief: rootState.brief,
        templateId: rootState.selectedAdTemplateId,
        columns: promptColumns,
        currentRows: rootState.rows,
        instruction: rewriteInstruction,
      });

      commitRootState({
        rewriteDraft: {
          scope: 'table',
          rowId: null,
          columnKey: null,
          instruction: rewriteInstruction.trim(),
          variants: [],
          rowVariants: [],
          previewRows,
        },
      });
    });
  };

  const handleExportWorkbook = async () => {
    const selectedPath = await save({
      defaultPath: `${currentProject.name}.xlsx`,
      filters: [{ name: t('adProject.table.workbookFileType'), extensions: ['xlsx'] }],
    });

    if (typeof selectedPath !== 'string') {
      return;
    }

    await runAction('exportWorkbook', async () => {
      await exportAdScriptWorkbook({
        rows: rootState.rows,
        columnLayout: rootState.columnLayout,
        filePath: selectedPath,
        headers: columnHeaders,
      });
    }, t('adProject.messages.workbookExported'));
  };

  const handleAddCustomColumn = () => {
    const label = customColumnName.replace(/\s+/g, ' ').trim();
    if (!label) {
      setActionStatus({
        tone: 'error',
        message: t('adProject.errors.customColumnNameRequired'),
      });
      return;
    }

    const duplicateExists = rootState.columnLayout.some((column) => (
      resolveColumnHeader(column, t).trim().toLocaleLowerCase()
        === label.toLocaleLowerCase()
    ));
    if (duplicateExists) {
      setActionStatus({
        tone: 'error',
        message: t('adProject.errors.customColumnNameDuplicate'),
      });
      return;
    }

    const key = createCustomColumnKey(rootState.columnLayout, label);
    const nextLayout = reindexColumnLayout([
      ...rootState.columnLayout,
      {
        key,
        label,
        visible: true,
        order: rootState.columnLayout.length,
      },
    ]);

    commitRootState({
      columnLayout: nextLayout,
      rows: rootState.rows.map((row) => ({
        ...row,
        [key]: row[key] ?? '',
      })),
    });
    setCustomColumnName('');
    setActionStatus({
      tone: 'success',
      message: t('adProject.messages.customColumnAdded', { name: label }),
    });
  };

  const handleRemoveCustomColumn = (key: string) => {
    const targetColumn = rootState.columnLayout.find((column) => column.key === key);
    if (!targetColumn || isBuiltInAdScriptColumnKey(key)) {
      return;
    }

    commitRootState({
      columnLayout: reindexColumnLayout(rootState.columnLayout.filter((column) => column.key !== key)),
      rows: removeColumnFromRows(rootState.rows, key),
      rewriteDraft:
        rootState.rewriteDraft?.columnKey === key
          ? null
          : rootState.rewriteDraft,
    });
    setActionStatus({
      tone: 'success',
      message: t('adProject.messages.customColumnRemoved', {
        name: resolveColumnHeader(targetColumn, t),
      }),
    });
  };

  const applyCellVariant = (variant: string) => {
    if (rewriteDraft?.scope !== 'cell' || !rewriteDraft.rowId || !rewriteDraft.columnKey) {
      return;
    }

    updateRows(
      rootState.rows.map((row) => (
        row.id === rewriteDraft.rowId
          ? {
              ...row,
              [rewriteDraft.columnKey!]: variant,
            }
          : row
      ))
    );
    clearRewriteDraft();
  };

  const applyRowVariant = (variant: AdScriptTableRow) => {
    if (rewriteDraft?.scope !== 'row' || !rewriteDraft.rowId) {
      return;
    }

    updateRows(replaceRow(rootState.rows, rewriteDraft.rowId, variant));
    clearRewriteDraft();
  };

  const applyTablePreview = () => {
    if (rewriteDraft?.scope !== 'table' || !rewriteDraft.previewRows) {
      return;
    }

    commitRootState({
      rows: rewriteDraft.previewRows,
      rewriteDraft: null,
      lastGeneratedAt: Date.now(),
    });
    setActionStatus({
      tone: 'success',
      message: t('adProject.messages.previewApplied'),
    });
  };

  return (
    <div className="ui-scrollbar h-full overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_32%),linear-gradient(180deg,_rgba(10,14,20,0.96),_rgba(8,10,15,1))]">
      <div className="mx-auto flex max-w-[1640px] flex-col gap-6 px-6 py-6">
        <UiPanel className="rounded-[28px] border border-white/10 bg-black/25 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-emerald-200">
                <Clapperboard className="h-3.5 w-3.5" />
                {t('project.types.ad')}
              </div>
              <h1 className="text-3xl font-semibold text-text-dark">{currentProject.name}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted">
                {t('adProject.heroDescription')}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <UiButton variant="ghost" onClick={() => setLibraryOpen(true)} className="gap-2">
                <LibraryBig className="h-4 w-4" />
                {t('adProject.skill.libraryTitle')}
              </UiButton>
              <UiButton
                variant="ghost"
                onClick={() => setSaveSkillTemplateState({
                  open: true,
                  name: `${currentProject.name} ${t('adProject.skill.defaultTemplateNameSuffix')}`,
                  categoryId: null,
                })}
                className="gap-2"
              >
                <Save className="h-4 w-4" />
                {t('adProject.skill.saveAsTemplate')}
              </UiButton>
              <UiButton variant="ghost" onClick={() => void exportCurrentSkill()} className="gap-2">
                <Download className="h-4 w-4" />
                {t('adProject.skill.exportCurrent')}
              </UiButton>
            </div>
          </div>
        </UiPanel>

        <UiPanel className="rounded-[24px] p-4">
          <div className="grid gap-3 md:grid-cols-3">
            {(['directorSkill', 'brief', 'script'] as const).map((step) => {
              const isActive = rootState.workflowStep === step;
              const isUnlocked =
                step === 'directorSkill'
                  ? true
                  : step === 'brief'
                    ? directorSkillCompleted
                    : briefCompleted;
              const isCompleted =
                step === 'directorSkill'
                  ? directorSkillCompleted
                  : step === 'brief'
                    ? briefCompleted
                    : scriptCompleted;

              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => handleWorkflowStepChange(step)}
                  className={`rounded-[18px] border px-4 py-4 text-left transition-colors ${
                    isActive
                      ? 'border-emerald-400/30 bg-emerald-500/12'
                      : !isUnlocked
                        ? 'border-white/10 bg-white/[0.02] opacity-60'
                        : isCompleted
                          ? 'border-emerald-400/20 bg-emerald-500/8 hover:bg-emerald-500/12'
                          : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.14em] text-text-muted">
                      {t(`adProject.steps.${step}.eyebrow`)}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      isActive
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : isCompleted
                          ? 'bg-emerald-500/10 text-emerald-200'
                          : 'bg-white/5 text-text-muted'
                    }`}>
                      {isActive
                        ? t('adProject.steps.status.current')
                        : isCompleted
                          ? t('adProject.steps.status.completed')
                          : !isUnlocked
                            ? t('adProject.steps.status.locked')
                            : t('adProject.steps.status.ready')}
                    </span>
                  </div>
                  <div className="mt-1 text-base font-medium text-text-dark">
                    {t(`adProject.steps.${step}.title`)}
                  </div>
                  <div className="mt-2 text-sm text-text-muted">
                    {t(`adProject.steps.${step}.description`)}
                  </div>
                  {!isUnlocked && step !== 'directorSkill' ? (
                    <div className="mt-3 text-xs text-amber-200">
                      {step === 'brief'
                        ? t('adProject.steps.gates.brief')
                        : t('adProject.steps.gates.script')}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </UiPanel>

        <StatusBanner status={actionStatus} />

        {rootState.lastError ? (
          <UiPanel className="rounded-[20px] border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-100">
            {rootState.lastError}
          </UiPanel>
        ) : null}

        <UiPanel className="rounded-[24px] border border-amber-500/15 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">
          {t('adProject.limitNote')}
        </UiPanel>

        {rootState.workflowStep === 'directorSkill' ? (
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <UiPanel className="rounded-[24px] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-text-dark">
                    {t('adProject.skill.starterTitle')}
                  </div>
                  <div className="mt-1 text-sm text-text-muted">
                    {t('adProject.skill.starterDescription')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <UiButton
                    variant="ghost"
                    onClick={() => commitRootState({
                      directorSkillProfile: createDefaultDirectorSkillProfile(),
                      selectedSkillTemplateId: null,
                    })}
                  >
                    {t('adProject.skill.blankCreate')}
                  </UiButton>
                  <UiButton variant="ghost" onClick={() => void importLibrary()} className="gap-2">
                    <Import className="h-4 w-4" />
                    {t('adProject.skill.importCurrent')}
                  </UiButton>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {BUILT_IN_SKILL_STARTERS.map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    className="rounded-[18px] border border-white/10 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.05]"
                    onClick={() => commitRootState({
                      directorSkillProfile: buildStarterProfile(starter.id, t),
                      selectedSkillTemplateId: null,
                    })}
                  >
                    <div className="text-sm font-medium text-text-dark">
                      {t(starter.nameKey)}
                    </div>
                    <div className="mt-2 text-xs leading-5 text-text-muted">
                      {t(starter.descriptionKey)}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.identity')}
                  </label>
                  <UiInput
                    value={rootState.directorSkillProfile.identity}
                    onChange={(event) => updateProfile({ identity: event.target.value })}
                    placeholder={t('adProject.skill.placeholders.identity')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.rhythmPreference')}
                  </label>
                  <UiInput
                    value={rootState.directorSkillProfile.rhythmPreference}
                    onChange={(event) => updateProfile({ rhythmPreference: event.target.value })}
                    placeholder={t('adProject.skill.placeholders.rhythmPreference')}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.styleKeywords')}
                  </label>
                  <UiTextAreaField
                    rows={3}
                    value={joinLines(rootState.directorSkillProfile.styleKeywords)}
                    onChange={(event) => updateProfile({ styleKeywords: splitLines(event.target.value) })}
                    placeholder={t('adProject.skill.placeholders.styleKeywords')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.visualPreference')}
                  </label>
                  <UiTextAreaField
                    rows={4}
                    value={rootState.directorSkillProfile.visualPreference}
                    onChange={(event) => updateProfile({ visualPreference: event.target.value })}
                    placeholder={t('adProject.skill.placeholders.visualPreference')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.brandPlatformPreferences')}
                  </label>
                  <UiTextAreaField
                    rows={4}
                    value={joinLines(rootState.directorSkillProfile.brandPlatformPreferences)}
                    onChange={(event) => updateProfile({
                      brandPlatformPreferences: splitLines(event.target.value),
                    })}
                    placeholder={t('adProject.skill.placeholders.brandPlatformPreferences')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.narrativePrinciples')}
                  </label>
                  <UiTextAreaField
                    rows={4}
                    value={joinLines(rootState.directorSkillProfile.narrativePrinciples)}
                    onChange={(event) => updateProfile({
                      narrativePrinciples: splitLines(event.target.value),
                    })}
                    placeholder={t('adProject.skill.placeholders.narrativePrinciples')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.taboos')}
                  </label>
                  <UiTextAreaField
                    rows={4}
                    value={joinLines(rootState.directorSkillProfile.taboos)}
                    onChange={(event) => updateProfile({ taboos: splitLines(event.target.value) })}
                    placeholder={t('adProject.skill.placeholders.taboos')}
                  />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <UiButton
                  variant="primary"
                  onClick={() => void handleGenerateSkillPreview()}
                  disabled={busyAction !== null}
                  className="gap-2"
                >
                  {busyAction === 'skillPreview' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {t('adProject.skill.generatePreview')}
                </UiButton>
                <UiButton
                  variant="ghost"
                  onClick={() => handleWorkflowStepChange('brief')}
                  disabled={!directorSkillCompleted}
                >
                  {t('adProject.skill.nextStep')}
                </UiButton>
              </div>

              {!directorSkillCompleted ? (
                <div className="mt-3 text-sm text-amber-200">
                  {t('adProject.skill.completeHint')}
                </div>
              ) : null}
            </UiPanel>

            <UiPanel className="rounded-[24px] p-5">
              <div className="mb-4">
                <div className="text-sm font-medium text-text-dark">
                  {t('adProject.skill.previewTitle')}
                </div>
                <div className="mt-1 text-sm text-text-muted">
                  {t('adProject.skill.previewDescription')}
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.profileSummary')}
                  </label>
                  <UiTextAreaField
                    rows={8}
                    value={rootState.directorSkillProfile.profileSummary}
                    onChange={(event) => updateProfile({ profileSummary: event.target.value })}
                    placeholder={t('adProject.skill.placeholders.profileSummary')}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                    {t('adProject.skill.fields.promptSnapshot')}
                  </label>
                  <UiTextAreaField
                    rows={12}
                    value={rootState.directorSkillProfile.promptSnapshot}
                    onChange={(event) => updateProfile({ promptSnapshot: event.target.value })}
                    placeholder={t('adProject.skill.placeholders.promptSnapshot')}
                  />
                </div>
              </div>
            </UiPanel>
          </div>
        ) : null}

        {rootState.workflowStep === 'brief' ? (
          <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <UiPanel className="rounded-[24px] p-5">
              <div className="mb-4">
                <div className="text-sm font-medium text-text-dark">
                  {t('adProject.brief.title')}
                </div>
                <div className="mt-1 text-sm text-text-muted">
                  {t('adProject.brief.description')}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {(['brand', 'product', 'audience', 'platform', 'duration', 'goal'] as const).map((field) => (
                  <div key={field} className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                      {t(BRIEF_FIELD_LABEL_KEYS[field])}
                    </label>
                    <UiInput
                      value={rootState.brief[field]}
                      onChange={(event) => updateBrief({ [field]: event.target.value })}
                      placeholder={t(`adProject.brief.placeholders.${field}`)}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-4">
                {(['cta', 'mustInclude', 'constraints', 'references'] as const).map((field) => (
                  <div key={field} className="space-y-2">
                    <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                      {t(BRIEF_FIELD_LABEL_KEYS[field])}
                    </label>
                    <UiTextAreaField
                      rows={field === 'references' ? 4 : 3}
                      value={rootState.brief[field]}
                      onChange={(event) => updateBrief({ [field]: event.target.value })}
                      placeholder={t(`adProject.brief.placeholders.${field}`)}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <UiButton
                  variant="primary"
                  onClick={() => void handleNormalizeBrief()}
                  disabled={busyAction !== null}
                  className="gap-2"
                >
                  {busyAction === 'normalizeBrief' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {t('adProject.brief.normalize')}
                </UiButton>
                <UiButton variant="ghost" onClick={() => handleWorkflowStepChange('directorSkill')}>
                  {t('adProject.brief.backStep')}
                </UiButton>
                <UiButton
                  variant="ghost"
                  onClick={() => handleWorkflowStepChange('script')}
                  disabled={!briefCompleted}
                >
                  {t('adProject.brief.nextStep')}
                </UiButton>
              </div>

              {!briefCompleted ? (
                <div className="mt-3 text-sm text-amber-200">
                  {t('adProject.brief.completeHint')}
                </div>
              ) : null}
            </UiPanel>

            <UiPanel className="rounded-[24px] p-5">
              <div className="mb-4">
                <div className="text-sm font-medium text-text-dark">
                  {t('adProject.brief.guideTitle')}
                </div>
                <div className="mt-1 text-sm text-text-muted">
                  {t('adProject.brief.guideDescription')}
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {(['brand', 'product', 'audience', 'platform', 'duration', 'goal'] as const).map((field) => (
                  <div
                    key={field}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      missingBriefFields.includes(field)
                        ? 'border-rose-500/25 bg-rose-500/10 text-rose-100'
                        : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-100'
                    }`}
                  >
                    {t(BRIEF_FIELD_LABEL_KEYS[field])}
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.12em] text-text-muted">
                  {t('adProject.brief.fields.normalizedBrief')}
                </label>
                <UiTextAreaField
                  rows={16}
                  value={rootState.brief.normalizedBrief}
                  onChange={(event) => updateBrief({ normalizedBrief: event.target.value })}
                  placeholder={t('adProject.brief.placeholders.normalizedBrief')}
                />
              </div>
            </UiPanel>
          </div>
        ) : null}

        {rootState.workflowStep === 'script' ? (
          <div className="space-y-6">
            <UiPanel className="rounded-[24px] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-text-dark">
                    {t('adProject.table.templateTitle')}
                  </div>
                  <div className="mt-1 text-sm text-text-muted">
                    {t('adProject.table.templateDescription')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <UiButton
                    variant="primary"
                    onClick={() => void handleGenerateRows()}
                    disabled={busyAction !== null || missingBriefFields.length > 0}
                    className="gap-2"
                  >
                    {busyAction === 'generateRows' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {t('adProject.table.generate')}
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    onClick={() => void handleExportWorkbook()}
                    disabled={rootState.rows.length === 0 || busyAction !== null}
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    {t('adProject.table.export')}
                  </UiButton>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {AD_SCRIPT_TEMPLATE_DEFINITIONS.map((template) => {
                  const isActive = template.id === rootState.selectedAdTemplateId;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => commitRootState({
                        selectedAdTemplateId: template.id,
                        columnLayout: buildTemplateColumnLayout(template.id, rootState.columnLayout),
                      })}
                      className={`rounded-[18px] border p-4 text-left transition-colors ${
                        isActive
                          ? 'border-emerald-400/30 bg-emerald-500/10'
                          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="text-sm font-medium text-text-dark">
                        {t(template.nameKey)}
                      </div>
                      <div className="mt-2 text-xs leading-5 text-text-muted">
                        {t(template.descriptionKey)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </UiPanel>

            <div className="space-y-6">
              <UiPanel className="rounded-[24px] p-3.5">
                <div className="mb-2.5">
                  <div className="text-sm font-medium text-text-dark">
                    {t('adProject.table.columnLayoutTitle')}
                  </div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {t('adProject.table.columnLayoutDescription')}
                  </div>
                </div>

                <div className="mb-3 flex flex-col gap-2 md:flex-row">
                  <UiInput
                    value={customColumnName}
                    onChange={(event) => setCustomColumnName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleAddCustomColumn();
                      }
                    }}
                    placeholder={t('adProject.table.customColumnPlaceholder')}
                    className="h-10"
                  />
                  <UiButton
                    variant="ghost"
                    onClick={handleAddCustomColumn}
                    className="h-10 shrink-0 gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    {t('adProject.table.addCustomColumn')}
                  </UiButton>
                </div>

                <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
                  {[...rootState.columnLayout]
                    .sort((left, right) => left.order - right.order)
                    .map((column) => (
                      <div
                        key={column.key}
                        className="flex items-center justify-between rounded-[12px] border border-white/10 bg-white/[0.03] px-2.5 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <UiCheckbox
                            checked={column.visible}
                            onCheckedChange={(checked) => {
                              if (
                                isBuiltInAdScriptColumnKey(column.key)
                                && LOCKED_COLUMN_KEYS.has(column.key)
                              ) {
                                return;
                              }
                              commitRootState({
                                columnLayout: rootState.columnLayout.map((item) =>
                                  item.key === column.key
                                    ? { ...item, visible: checked }
                                    : item
                                ),
                              });
                            }}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-[12px] font-medium text-text-dark">{columnHeaders[column.key]}</div>
                            {isBuiltInAdScriptColumnKey(column.key) && LOCKED_COLUMN_KEYS.has(column.key) ? (
                              <div className="text-[9px] leading-3.5 text-text-muted">
                                {t('adProject.table.lockedColumn')}
                              </div>
                            ) : !isBuiltInAdScriptColumnKey(column.key) ? (
                              <div className="text-[9px] leading-3.5 text-text-muted">
                                {t('adProject.table.customColumn')}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="ml-1.5 flex items-center gap-0.5">
                          <UiButton
                            variant="ghost"
                            size="sm"
                            onClick={() => commitRootState({
                              columnLayout: reorderLayout(rootState.columnLayout, column.key, -1),
                            })}
                            className="h-6 w-6 px-0 text-text-muted hover:bg-white/[0.06] hover:text-text-dark"
                          >
                            <ArrowUp className="h-3.5 w-3.5 shrink-0 stroke-[2.4]" />
                          </UiButton>
                          <UiButton
                            variant="ghost"
                            size="sm"
                            onClick={() => commitRootState({
                              columnLayout: reorderLayout(rootState.columnLayout, column.key, 1),
                            })}
                            className="h-6 w-6 px-0 text-text-muted hover:bg-white/[0.06] hover:text-text-dark"
                          >
                            <ArrowDown className="h-3.5 w-3.5 shrink-0 stroke-[2.4]" />
                          </UiButton>
                          {!isBuiltInAdScriptColumnKey(column.key) ? (
                            <UiButton
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveCustomColumn(column.key)}
                              className="h-6 w-6 px-0 text-text-muted hover:bg-rose-500/10 hover:text-rose-200"
                            >
                              <Trash2 className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />
                            </UiButton>
                          ) : null}
                        </div>
                      </div>
                    ))}
                </div>
              </UiPanel>

              <UiPanel className="rounded-[24px] p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium text-text-dark">
                      {t('adProject.table.rowsTitle')}
                    </div>
                    <div className="mt-1 text-sm text-text-muted">
                      {t('adProject.table.rowsDescription')}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <UiButton
                      variant="ghost"
                      onClick={() => updateRows([...rootState.rows, createDefaultAdScriptRow(rootState.rows.length)])}
                      className="gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      {t('adProject.table.addRow')}
                    </UiButton>
                  </div>
                </div>

                {rootState.rows.length === 0 ? (
                  <div className="rounded-[18px] border border-dashed border-white/10 px-4 py-16 text-center text-sm text-text-muted">
                    {missingBriefFields.length > 0
                      ? t('adProject.table.missingBriefHint')
                      : t('adProject.table.emptyTable')}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-[20px] border border-white/10 bg-[#06080d]/85">
                    <div className="min-h-[360px] max-h-[62vh] overflow-auto">
                      <table className="min-w-max border-separate border-spacing-0">
                      <thead>
                        <tr>
                          <th className="sticky left-0 top-0 z-30 border-b border-white/10 bg-[#0a0d12] px-3 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-text-muted">
                            {t('adProject.table.drag')}
                          </th>
                          {visibleColumns.map((column) => (
                            <th
                              key={column.key}
                              className="sticky top-0 z-20 border-b border-white/10 bg-[#0a0d12] px-3 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] text-text-muted"
                            >
                              {columnHeaders[column.key]}
                            </th>
                          ))}
                          <th className="sticky top-0 z-20 min-w-[132px] border-b border-white/10 bg-[#0a0d12] px-3 py-3 text-left text-xs font-medium uppercase tracking-[0.14em] whitespace-nowrap text-text-muted">
                            {t('adProject.table.actions')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rootState.rows.map((row) => {
                          const isSelectedRow = selectedRowId === row.id;
                          const isInlineRowRewriteVisible =
                            rewriteDraft?.scope === 'row'
                            && rewriteDraft.rowId === row.id
                            && rewriteDraft.rowVariants.length > 0;

                          return (
                            <Fragment key={row.id}>
                              <tr
                                draggable
                                onClick={() => setSelectedRowId(row.id)}
                                onDragStart={() => setDraggedRowId(row.id)}
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => {
                                  if (!draggedRowId) {
                                    return;
                                  }
                                  updateRows(moveRow(rootState.rows, draggedRowId, row.id));
                                  setDraggedRowId(null);
                                }}
                                className="align-top"
                              >
                                <td className={`sticky left-0 z-[1] border-b border-white/6 px-3 py-3 ${
                                  isSelectedRow
                                    ? 'bg-emerald-500/[0.14] shadow-[inset_3px_0_0_0_rgba(52,211,153,0.95)]'
                                    : 'bg-[#090c11]'
                                }`}>
                                  <div className="flex items-center gap-2 text-text-muted">
                                    <GripVertical className={`h-4 w-4 ${isSelectedRow ? 'text-emerald-200' : ''}`} />
                                    <span className={`text-xs ${isSelectedRow ? 'font-medium text-emerald-100' : ''}`}>
                                      {row.shotNumber}
                                    </span>
                                    {isSelectedRow ? (
                                      <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                                        {t('adProject.table.selectedRowBadge')}
                                      </span>
                                    ) : null}
                                  </div>
                                </td>
                                {visibleColumns.map((column) => (
                                  <td
                                    key={column.key}
                                    className={`border-b border-white/6 px-2 py-2 ${
                                      selectedCell?.rowId === row.id && selectedCell.columnKey === column.key
                                        ? 'bg-emerald-500/18'
                                        : isSelectedRow
                                          ? 'bg-emerald-500/[0.09]'
                                          : ''
                                    }`}
                                    onClick={() => {
                                      setSelectedRowId(row.id);
                                      setSelectedCell({ rowId: row.id, columnKey: column.key });
                                    }}
                                  >
                                    {column.key === 'status' ? (
                                      <UiSelect
                                        value={row.status}
                                        onChange={(event) => {
                                          updateRows(rootState.rows.map((item) => (
                                            item.id === row.id
                                              ? {
                                                  ...item,
                                                  status: event.target.value as AdScriptTableRow['status'],
                                                }
                                              : item
                                          )));
                                        }}
                                      >
                                        {STATUS_OPTIONS.map((status) => (
                                          <option key={status} value={status}>
                                            {t(`adProject.table.status.${status}`)}
                                          </option>
                                        ))}
                                      </UiSelect>
                                    ) : (
                                      <UiTextAreaField
                                        rows={4}
                                        value={row[column.key] ?? ''}
                                        onFocus={() => {
                                          setSelectedRowId(row.id);
                                          setSelectedCell({ rowId: row.id, columnKey: column.key });
                                        }}
                                        onChange={(event) => {
                                          updateRows(rootState.rows.map((item) => (
                                            item.id === row.id
                                              ? {
                                                  ...item,
                                                  [column.key]: event.target.value,
                                                }
                                              : item
                                          )));
                                        }}
                                        className={`min-w-[180px] ${isSelectedRow ? 'bg-emerald-500/[0.04]' : 'bg-transparent'}`}
                                      />
                                    )}
                                  </td>
                                ))}
                                <td className={`min-w-[132px] border-b border-white/6 px-3 py-2 align-top ${
                                  isSelectedRow ? 'bg-emerald-500/[0.09]' : ''
                                }`}>
                                  <div className="flex min-w-[108px] flex-col gap-2">
                                    <UiButton
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => updateRows(insertRowAfter(rootState.rows, row.id))}
                                      className="w-full justify-start gap-1 whitespace-nowrap"
                                    >
                                      <Plus className="h-3.5 w-3.5" />
                                      {t('adProject.table.insertBelow')}
                                    </UiButton>
                                    <UiButton
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        updateRows(rootState.rows.filter((item) => item.id !== row.id));
                                      }}
                                      className="w-full justify-start gap-1 whitespace-nowrap text-rose-200 hover:bg-rose-500/10"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      {t('common.delete')}
                                    </UiButton>
                                  </div>
                                </td>
                              </tr>

                              {isInlineRowRewriteVisible ? (
                                <tr>
                                  <td
                                    colSpan={visibleColumns.length + 2}
                                    className="border-b border-white/6 bg-emerald-500/[0.05] px-3 py-4"
                                  >
                                    <div className="rounded-[18px] border border-emerald-400/20 bg-black/20 p-4">
                                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-sm font-medium text-emerald-100">
                                          {t('adProject.table.rowVariantsTitle', {
                                            count: rewriteDraft.rowVariants.length,
                                          })}
                                        </div>
                                        <div className="text-xs text-emerald-200/80">
                                          {t('adProject.table.rowVariantsDescription')}
                                        </div>
                                      </div>

                                      <div className="space-y-3">
                                        {rewriteDraft.rowVariants.map((variant, index) => (
                                          <button
                                            key={`${variant.id}-${index}`}
                                            type="button"
                                            onClick={() => applyRowVariant(variant)}
                                            className="w-full rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-4 text-left transition-colors hover:bg-white/[0.06]"
                                          >
                                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                              <div className="flex items-center gap-2">
                                                <span className="rounded-full bg-emerald-500/12 px-2 py-1 text-[11px] font-medium text-emerald-100">
                                                  {t('adProject.table.rowVariantCandidate', { index: index + 1 })}
                                                </span>
                                                <span className="text-sm font-medium text-text-dark">
                                                  {variant.shotNumber} · {variant.objective || t('adProject.table.noObjective')}
                                                </span>
                                              </div>
                                              <span className="text-xs text-emerald-200/80">
                                                {t('adProject.table.applyVariant')}
                                              </span>
                                            </div>

                                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                              {visibleColumns.map((column) => (
                                                <div key={column.key} className="space-y-1">
                                                  <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                                                    {columnHeaders[column.key]}
                                                  </div>
                                                  <div className="rounded-[12px] border border-white/8 bg-black/15 px-3 py-2 text-sm leading-6 text-text-dark">
                                                    {column.key === 'status'
                                                      ? t(`adProject.table.status.${variant.status}`)
                                                      : variant[column.key] || t('adProject.table.emptyValue')}
                                                  </div>
                                                </div>
                                              ))}
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {rewriteDraft?.scope === 'table' && rewriteDraft.previewRows && false ? (
                  <UiPanel className="mt-6 rounded-[20px] border border-emerald-500/20 bg-emerald-500/8 p-4">
                    <div className="mb-3 text-sm font-medium text-emerald-100">
                      {t('adProject.table.previewTableTitle')}
                    </div>
                    <div className="space-y-2">
                      {rewriteDraft?.previewRows?.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-[14px] border border-white/10 bg-black/15 px-3 py-3"
                        >
                          <div className="text-sm font-medium text-text-dark">
                            {row.shotNumber} · {row.objective || t('adProject.table.noObjective')}
                          </div>
                          <div className="mt-1 text-xs text-text-muted">
                            {row.visual || t('adProject.table.noVisual')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </UiPanel>
                ) : null}
              </UiPanel>

              <UiPanel className="rounded-[24px] p-5">
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-medium text-text-dark">
                      {t('adProject.table.askDirectorTitle')}
                    </div>
                    <div className="mt-1 text-sm text-text-muted">
                      {t('adProject.table.askDirectorDescription')}
                    </div>
                  </div>
                  <UiTextAreaField
                    rows={5}
                    value={rewriteInstruction}
                    onChange={(event) => setRewriteInstruction(event.target.value)}
                    placeholder={t('adProject.table.askDirectorPlaceholder')}
                  />
                  <div className="flex flex-wrap gap-2">
                    <UiButton
                      variant="ghost"
                      onClick={() => void handleRewriteCell()}
                      disabled={!selectedCell || !rewriteInstruction.trim() || busyAction !== null}
                      className="gap-2"
                    >
                      {busyAction === 'rewriteCell' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {t('adProject.table.askSelectedCell')}
                    </UiButton>
                    <UiButton
                      variant="ghost"
                      onClick={() => void handleRewriteRow()}
                      disabled={!selectedRowId || !rewriteInstruction.trim() || busyAction !== null}
                      className="gap-2"
                    >
                      {busyAction === 'rewriteRow' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {t('adProject.table.askSelectedRow')}
                    </UiButton>
                    <UiButton
                      variant="ghost"
                      onClick={() => void handleRegenerateTablePreview()}
                      disabled={rootState.rows.length === 0 || !rewriteInstruction.trim() || busyAction !== null}
                      className="gap-2"
                    >
                      {busyAction === 'regenerateTable' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-4 w-4" />
                      )}
                      {t('adProject.table.regeneratePreview')}
                    </UiButton>
                  </div>
                </div>

                {rewriteDraft ? (
                  <UiPanel className="mt-6 rounded-[18px] border border-white/10 bg-black/15 p-4">
                    <div className="mb-3 text-sm font-medium text-text-dark">
                      {t(`adProject.table.rewriteScopes.${rewriteDraft.scope}`)}
                    </div>

                    {rewriteDraft.scope === 'cell' && rewriteDraft.variants.length > 0 ? (
                      <div className="space-y-2">
                        {rewriteDraft.variants.map((variant, index) => (
                          <button
                            key={`${variant}-${index}`}
                            type="button"
                            onClick={() => applyCellVariant(variant)}
                            className="w-full rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-3 text-left text-sm text-text-dark transition-colors hover:bg-white/[0.05]"
                          >
                            {variant}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {rewriteDraft.scope === 'row' && rewriteDraft.rowVariants.length > 0 ? (
                      <div className="rounded-[14px] border border-emerald-400/20 bg-emerald-500/8 px-3 py-3 text-sm text-emerald-100">
                        {t('adProject.table.inlineRowVariantsHint')}
                      </div>
                    ) : null}

                    {rewriteDraft.scope === 'table' && rewriteDraft.previewRows ? (
                      <div className="space-y-3">
                        <div className="text-sm text-text-muted">
                          {t('adProject.table.previewReady', { count: rewriteDraft.previewRows.length })}
                        </div>
                        <div className="flex gap-2">
                          <UiButton variant="primary" onClick={applyTablePreview}>
                            {t('adProject.table.applyPreview')}
                          </UiButton>
                          <UiButton variant="ghost" onClick={clearRewriteDraft}>
                            {t('adProject.table.discardPreview')}
                          </UiButton>
                        </div>
                      </div>
                    ) : null}

                    {rewriteDraft.scope !== 'table' ? (
                      <div className="mt-3">
                        <UiButton variant="ghost" onClick={clearRewriteDraft}>
                          {t('common.clear')}
                        </UiButton>
                      </div>
                    ) : null}
                  </UiPanel>
                ) : null}

                {rewriteDraft?.scope === 'table' && rewriteDraft.previewRows ? (
                  <UiPanel className="mt-6 rounded-[20px] border border-emerald-500/20 bg-emerald-500/8 p-4">
                    <div className="mb-3 text-sm font-medium text-emerald-100">
                      {t('adProject.table.previewTableTitle')}
                    </div>
                    <div className="space-y-2">
                      {rewriteDraft.previewRows.map((row) => (
                        <div
                          key={row.id}
                          className="rounded-[14px] border border-white/10 bg-black/15 px-3 py-3"
                        >
                          <div className="text-sm font-medium text-text-dark">
                            {row.shotNumber} / {row.objective || t('adProject.table.noObjective')}
                          </div>
                          <div className="mt-1 text-xs text-text-muted">
                            {row.visual || t('adProject.table.noVisual')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </UiPanel>
                ) : null}

              </UiPanel>
            </div>
          </div>
        ) : null}

        <SaveSkillTemplateModal
          categories={adDirectorSkillCategories}
          state={saveSkillTemplateState}
          onClose={() => setSaveSkillTemplateState((previous) => ({ ...previous, open: false }))}
          onChange={setSaveSkillTemplateState}
          onConfirm={() => {
            const name = saveSkillTemplateState.name.trim();
            if (!name) {
              return;
            }

            addAdDirectorSkillTemplate({
              name,
              categoryId: saveSkillTemplateState.categoryId,
              profile: rootState.directorSkillProfile,
            });
            setSaveSkillTemplateState((previous) => ({ ...previous, open: false }));
            setActionStatus({
              tone: 'success',
              message: t('adProject.messages.templateSaved', { name }),
            });
          }}
        />

        <SkillLibraryModal
          isOpen={libraryOpen}
          categories={adDirectorSkillCategories}
          templates={adDirectorSkillTemplates}
          onClose={() => setLibraryOpen(false)}
          onApplyTemplate={applyProjectSkillTemplate}
          onDeleteTemplate={(templateId) => deleteAdDirectorSkillTemplate(templateId)}
          onCreateCategory={(name) => addAdDirectorSkillCategory({ name })}
          onDeleteCategory={(categoryId) => deleteAdDirectorSkillCategory(categoryId)}
          onImportLibrary={() => void importLibrary()}
          onExportLibrary={() => void exportLibrary()}
        />
      </div>
    </div>
  );
}
