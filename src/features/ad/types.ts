export const AD_DIRECTOR_SKILL_PACKAGE_SCHEMA =
  'storyboard-copilot/ad-director-skill-package';
export const AD_DIRECTOR_SKILL_PACKAGE_KIND = 'ad-director-skill';
export const AD_DIRECTOR_SKILL_PACKAGE_VERSION = 1;
export const AD_DIRECTOR_SKILL_PACKAGE_FILE_NAME = 'director-skills.adskill';

export type AdWorkflowStep = 'directorSkill' | 'brief' | 'script';
export type AdScriptTemplateId = 'performance' | 'problemSolution' | 'brandStory';
export type AdScriptRowStatus = 'draft' | 'ready' | 'locked';
export type AdRewriteScope = 'cell' | 'row' | 'table';
export type AdBuiltInScriptColumnKey =
  | 'shotNumber'
  | 'duration'
  | 'objective'
  | 'visual'
  | 'dialogueOrVO'
  | 'camera'
  | 'audio'
  | 'productFocus'
  | 'sellingPoint'
  | 'cta'
  | 'assetHint'
  | 'directorIntent'
  | 'status';
export type AdScriptColumnKey = string;

export interface DirectorSkillProfile {
  identity: string;
  styleKeywords: string[];
  rhythmPreference: string;
  visualPreference: string;
  narrativePrinciples: string[];
  taboos: string[];
  brandPlatformPreferences: string[];
  profileSummary: string;
  promptSnapshot: string;
}

export interface AdBrief {
  brand: string;
  product: string;
  audience: string;
  platform: string;
  duration: string;
  goal: string;
  cta: string;
  mustInclude: string;
  constraints: string;
  references: string;
  normalizedBrief: string;
}

export interface AdScriptTemplateDefinition {
  id: AdScriptTemplateId;
  nameKey: string;
  descriptionKey: string;
  defaultRowCount: number;
  generationInstruction: string;
}

export interface AdScriptTableRow {
  id: string;
  shotNumber: string;
  duration: string;
  objective: string;
  visual: string;
  dialogueOrVO: string;
  camera: string;
  audio: string;
  productFocus: string;
  sellingPoint: string;
  cta: string;
  assetHint: string;
  directorIntent: string;
  status: AdScriptRowStatus;
  [key: string]: string;
}

export interface AdScriptColumnLayoutItem {
  key: AdScriptColumnKey;
  visible: boolean;
  order: number;
  label?: string;
}

export interface AdRewriteDraft {
  scope: AdRewriteScope;
  rowId: string | null;
  columnKey: AdScriptColumnKey | null;
  instruction: string;
  variants: string[];
  rowVariants: AdScriptTableRow[];
  previewRows: AdScriptTableRow[] | null;
}

export interface AdProjectRootState {
  workflowStep: AdWorkflowStep;
  directorSkillProfile: DirectorSkillProfile;
  selectedSkillTemplateId: string | null;
  brief: AdBrief;
  selectedAdTemplateId: AdScriptTemplateId;
  columnLayout: AdScriptColumnLayoutItem[];
  rows: AdScriptTableRow[];
  rewriteDraft: AdRewriteDraft | null;
  lastGeneratedAt: number | null;
  lastError: string | null;
}

export interface AdDirectorSkillCategory {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface AdDirectorSkillTemplate {
  id: string;
  name: string;
  categoryId: string | null;
  profile: DirectorSkillProfile;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface AdDirectorSkillPackageManifest {
  schema: string;
  version: number;
  exportedAt: string;
  appVersion: string | null;
  packageKind: string;
  categoryCount: number;
  templateCount: number;
}

export interface AdDirectorSkillPackageData {
  categories: AdDirectorSkillCategory[];
  templates: AdDirectorSkillTemplate[];
}

export interface ImportedAdDirectorSkillPackageResult {
  packagePath: string;
  manifest: AdDirectorSkillPackageManifest;
  data: AdDirectorSkillPackageData;
}

export interface AdDirectorSkillImportSummary {
  added: number;
  updated: number;
  skipped: number;
  addedCategories: number;
  updatedCategories: number;
  skippedCategories: number;
  addedTemplates: number;
  updatedTemplates: number;
  skippedTemplates: number;
}

export const AD_SCRIPT_COLUMN_ORDER: AdBuiltInScriptColumnKey[] = [
  'shotNumber',
  'duration',
  'objective',
  'visual',
  'dialogueOrVO',
  'camera',
  'audio',
  'productFocus',
  'sellingPoint',
  'cta',
  'assetHint',
  'directorIntent',
  'status',
];

const AD_SCRIPT_COLUMN_KEY_SET = new Set<string>(AD_SCRIPT_COLUMN_ORDER);
const AD_SCRIPT_RESERVED_ROW_KEYS = new Set<string>(['id', ...AD_SCRIPT_COLUMN_ORDER]);

export function isBuiltInAdScriptColumnKey(value: string): value is AdBuiltInScriptColumnKey {
  return AD_SCRIPT_COLUMN_KEY_SET.has(value);
}

export function extractAdScriptCustomFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const customFields: Record<string, string> = {};
  Object.entries(record).forEach(([key, rawValue]) => {
    if (AD_SCRIPT_RESERVED_ROW_KEYS.has(key) || typeof rawValue !== 'string') {
      return;
    }

    customFields[key] = rawValue.trim();
  });

  return customFields;
}

export const AD_SCRIPT_TEMPLATE_DEFINITIONS: AdScriptTemplateDefinition[] = [
  {
    id: 'performance',
    nameKey: 'adProject.templates.performance.name',
    descriptionKey: 'adProject.templates.performance.description',
    defaultRowCount: 6,
    generationInstruction:
      'Focus on fast-paced performance advertising for short-video feeds. Each row should clearly advance hook, proof, and conversion momentum.',
  },
  {
    id: 'problemSolution',
    nameKey: 'adProject.templates.problemSolution.name',
    descriptionKey: 'adProject.templates.problemSolution.description',
    defaultRowCount: 7,
    generationInstruction:
      'Structure the ad around a concrete user pain point, escalation, solution reveal, proof, and CTA.',
  },
  {
    id: 'brandStory',
    nameKey: 'adProject.templates.brandStory.name',
    descriptionKey: 'adProject.templates.brandStory.description',
    defaultRowCount: 8,
    generationInstruction:
      'Lean toward emotional brand storytelling, atmosphere, character beats, and a softer but memorable CTA.',
  },
];

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => normalizeString(item))
          .filter((item) => item.length > 0)
      )
    );
  }

  if (typeof value === 'string') {
    return Array.from(
      new Set(
        value
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      )
    );
  }

  return [];
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function createDefaultDirectorSkillProfile(): DirectorSkillProfile {
  return {
    identity: '',
    styleKeywords: [],
    rhythmPreference: '',
    visualPreference: '',
    narrativePrinciples: [],
    taboos: [],
    brandPlatformPreferences: [],
    profileSummary: '',
    promptSnapshot: '',
  };
}

export function normalizeDirectorSkillProfile(value: unknown): DirectorSkillProfile {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<DirectorSkillProfile>)
      : {};

  return {
    identity: normalizeString(record.identity),
    styleKeywords: normalizeStringArray(record.styleKeywords),
    rhythmPreference: normalizeString(record.rhythmPreference),
    visualPreference: normalizeString(record.visualPreference),
    narrativePrinciples: normalizeStringArray(record.narrativePrinciples),
    taboos: normalizeStringArray(record.taboos),
    brandPlatformPreferences: normalizeStringArray(record.brandPlatformPreferences),
    profileSummary: normalizeString(record.profileSummary),
    promptSnapshot: normalizeString(record.promptSnapshot),
  };
}

export function createDefaultAdBrief(): AdBrief {
  return {
    brand: '',
    product: '',
    audience: '',
    platform: '',
    duration: '',
    goal: '',
    cta: '',
    mustInclude: '',
    constraints: '',
    references: '',
    normalizedBrief: '',
  };
}

export function normalizeAdBrief(value: unknown): AdBrief {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<AdBrief>)
      : {};

  return {
    brand: normalizeString(record.brand),
    product: normalizeString(record.product),
    audience: normalizeString(record.audience),
    platform: normalizeString(record.platform),
    duration: normalizeString(record.duration),
    goal: normalizeString(record.goal),
    cta: normalizeString(record.cta),
    mustInclude: normalizeString(record.mustInclude),
    constraints: normalizeString(record.constraints),
    references: normalizeString(record.references),
    normalizedBrief: normalizeString(record.normalizedBrief),
  };
}

export function formatAdShotNumber(index: number): string {
  return `${index + 1}`;
}

export function createDefaultAdScriptRow(order = 0): AdScriptTableRow {
  return {
    id: `ad-script-row-${order + 1}-${Math.random().toString(36).slice(2, 8)}`,
    shotNumber: formatAdShotNumber(order),
    duration: '',
    objective: '',
    visual: '',
    dialogueOrVO: '',
    camera: '',
    audio: '',
    productFocus: '',
    sellingPoint: '',
    cta: '',
    assetHint: '',
    directorIntent: '',
    status: 'draft',
  };
}

export function normalizeAdScriptRows(value: unknown): AdScriptTableRow[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    const fallback = createDefaultAdScriptRow(index);
    const record =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Partial<AdScriptTableRow>)
        : {};

    return {
      ...fallback,
      ...extractAdScriptCustomFields(record),
      id: normalizeString(record.id) || fallback.id,
      shotNumber: normalizeString(record.shotNumber) || fallback.shotNumber,
      duration: normalizeString(record.duration),
      objective: normalizeString(record.objective),
      visual: normalizeString(record.visual),
      dialogueOrVO: normalizeString(record.dialogueOrVO),
      camera: normalizeString(record.camera),
      audio: normalizeString(record.audio),
      productFocus: normalizeString(record.productFocus),
      sellingPoint: normalizeString(record.sellingPoint),
      cta: normalizeString(record.cta),
      assetHint: normalizeString(record.assetHint),
      directorIntent: normalizeString(record.directorIntent),
      status:
        record.status === 'ready' || record.status === 'locked'
          ? record.status
          : 'draft',
    };
  });
}

export function reindexAdScriptRows(rows: AdScriptTableRow[]): AdScriptTableRow[] {
  return rows.map((row, index) => ({
    ...row,
    shotNumber: formatAdShotNumber(index),
  }));
}

export function createDefaultAdColumnLayout(): AdScriptColumnLayoutItem[] {
  return AD_SCRIPT_COLUMN_ORDER.map((key, index) => ({
    key,
    order: index,
    visible: true,
  }));
}

export function normalizeAdColumnLayout(value: unknown): AdScriptColumnLayoutItem[] {
  if (!Array.isArray(value)) {
    return createDefaultAdColumnLayout();
  }

  const byKey = new Map<AdScriptColumnKey, AdScriptColumnLayoutItem>();
  value.forEach((item, index) => {
    const record =
      item && typeof item === 'object' && !Array.isArray(item)
        ? (item as Partial<AdScriptColumnLayoutItem>)
        : {};

    const key = normalizeString(record.key);
    if (!key) {
      return;
    }

    byKey.set(key, {
      key,
      visible: typeof record.visible === 'boolean' ? record.visible : true,
      order:
        typeof record.order === 'number' && Number.isFinite(record.order)
          ? record.order
          : index,
      label: isBuiltInAdScriptColumnKey(key)
        ? undefined
        : normalizeString(record.label) || key,
    });
  });

  const builtInColumns = AD_SCRIPT_COLUMN_ORDER.map((key, index) => (
    byKey.get(key) ?? {
      key,
      visible: true,
      order: index,
    }
  ));
  const customColumns = [...byKey.values()].filter((item) => !isBuiltInAdScriptColumnKey(item.key));

  return [...builtInColumns, ...customColumns]
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({
      ...item,
      order: index,
      label: isBuiltInAdScriptColumnKey(item.key)
        ? undefined
        : normalizeString(item.label) || item.key,
    }));
}

export function normalizeAdRewriteDraft(value: unknown): AdRewriteDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<AdRewriteDraft>;
  const scope =
    record.scope === 'cell' || record.scope === 'row' || record.scope === 'table'
      ? record.scope
      : null;

  if (!scope) {
    return null;
  }

  return {
    scope,
    rowId: normalizeNullableString(record.rowId),
    columnKey: normalizeNullableString(record.columnKey),
    instruction: normalizeString(record.instruction),
    variants: normalizeStringArray(record.variants),
    rowVariants: normalizeAdScriptRows(record.rowVariants),
    previewRows: record.previewRows ? normalizeAdScriptRows(record.previewRows) : null,
  };
}

export function createDefaultAdProjectRootState(): AdProjectRootState {
  return {
    workflowStep: 'directorSkill',
    directorSkillProfile: createDefaultDirectorSkillProfile(),
    selectedSkillTemplateId: null,
    brief: createDefaultAdBrief(),
    selectedAdTemplateId: 'performance',
    columnLayout: createDefaultAdColumnLayout(),
    rows: [],
    rewriteDraft: null,
    lastGeneratedAt: null,
    lastError: null,
  };
}

export function normalizeAdProjectRootState(value: unknown): AdProjectRootState {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<AdProjectRootState>)
      : {};

  const workflowStep =
    record.workflowStep === 'brief' || record.workflowStep === 'script'
      ? record.workflowStep
      : 'directorSkill';
  const selectedAdTemplateId = AD_SCRIPT_TEMPLATE_DEFINITIONS.some(
    (template) => template.id === record.selectedAdTemplateId
  )
    ? (record.selectedAdTemplateId as AdScriptTemplateId)
    : 'performance';

  return {
    workflowStep,
    directorSkillProfile: normalizeDirectorSkillProfile(record.directorSkillProfile),
    selectedSkillTemplateId: normalizeNullableString(record.selectedSkillTemplateId),
    brief: normalizeAdBrief(record.brief),
    selectedAdTemplateId,
    columnLayout: normalizeAdColumnLayout(record.columnLayout),
    rows: normalizeAdScriptRows(record.rows),
    rewriteDraft: normalizeAdRewriteDraft(record.rewriteDraft),
    lastGeneratedAt: normalizeTimestamp(record.lastGeneratedAt),
    lastError: normalizeNullableString(record.lastError),
  };
}

export function sortAdDirectorSkillCategories(
  categories: AdDirectorSkillCategory[]
): AdDirectorSkillCategory[] {
  return [...categories].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt;
    }
    return left.createdAt - right.createdAt;
  });
}

export function sortAdDirectorSkillTemplates(
  templates: AdDirectorSkillTemplate[]
): AdDirectorSkillTemplate[] {
  return [...templates].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    if (left.updatedAt !== right.updatedAt) {
      return left.updatedAt - right.updatedAt;
    }
    return left.createdAt - right.createdAt;
  });
}

export function normalizeAdDirectorSkillCategories(value: unknown): AdDirectorSkillCategory[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  return value
    .map((item, index) => {
      const record =
        item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Partial<AdDirectorSkillCategory>)
          : null;
      if (!record) {
        return null;
      }
      const id = normalizeString(record.id);
      const name = normalizeString(record.name);
      if (!id || !name || seenIds.has(id)) {
        return null;
      }
      seenIds.add(id);
      const createdAt =
        typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
          ? record.createdAt
          : Date.now() + index;
      const updatedAt =
        typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : createdAt;
      const sortOrder =
        typeof record.sortOrder === 'number' && Number.isFinite(record.sortOrder)
          ? record.sortOrder
          : index;

      return {
        id,
        name,
        sortOrder,
        createdAt,
        updatedAt,
      } satisfies AdDirectorSkillCategory;
    })
    .filter((item): item is AdDirectorSkillCategory => Boolean(item));
}

export function normalizeAdDirectorSkillTemplates(
  value: unknown,
  validCategoryIds?: Set<string>
): AdDirectorSkillTemplate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenIds = new Set<string>();
  return value
    .map((item, index) => {
      const record =
        item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Partial<AdDirectorSkillTemplate>)
          : null;
      if (!record) {
        return null;
      }
      const id = normalizeString(record.id);
      const name = normalizeString(record.name);
      if (!id || !name || seenIds.has(id)) {
        return null;
      }
      seenIds.add(id);
      const createdAt =
        typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
          ? record.createdAt
          : Date.now() + index;
      const updatedAt =
        typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
          ? record.updatedAt
          : createdAt;
      const sortOrder =
        typeof record.sortOrder === 'number' && Number.isFinite(record.sortOrder)
          ? record.sortOrder
          : index;
      const categoryId =
        typeof record.categoryId === 'string' &&
        record.categoryId.trim().length > 0 &&
        (!validCategoryIds || validCategoryIds.has(record.categoryId.trim()))
          ? record.categoryId.trim()
          : null;
      const lastUsedAt =
        typeof record.lastUsedAt === 'number' && Number.isFinite(record.lastUsedAt)
          ? record.lastUsedAt
          : null;

      return {
        id,
        name,
        categoryId,
        profile: normalizeDirectorSkillProfile(record.profile),
        sortOrder,
        createdAt,
        updatedAt,
        lastUsedAt,
      } satisfies AdDirectorSkillTemplate;
    })
    .filter((item): item is AdDirectorSkillTemplate => Boolean(item));
}
