import { generateText } from '@/commands/textGen';
import {
  buildUserFacingLanguageInstruction,
  detectUserContentLanguage,
} from '@/features/app/contentLanguage';
import {
  AD_SCRIPT_TEMPLATE_DEFINITIONS,
  AD_SCRIPT_COLUMN_ORDER,
  createDefaultAdScriptRow,
  extractAdScriptCustomFields,
  formatAdShotNumber,
  normalizeAdScriptRows,
  normalizeDirectorSkillProfile,
  reindexAdScriptRows,
  type AdBrief,
  type AdBuiltInScriptColumnKey,
  type AdScriptColumnKey,
  type AdScriptTableRow,
  type AdScriptTemplateDefinition,
  type AdScriptTemplateId,
  type DirectorSkillProfile,
  isBuiltInAdScriptColumnKey,
} from '@/features/ad/types';

export const REQUIRED_AD_BRIEF_FIELDS: Array<keyof AdBrief> = [
  'brand',
  'product',
  'audience',
  'platform',
  'duration',
  'goal',
];

export interface AdScriptPromptColumn {
  key: AdScriptColumnKey;
  label: string;
}

const BUILT_IN_COLUMN_LABELS: Record<AdBuiltInScriptColumnKey, string> = {
  shotNumber: 'Shot Number',
  duration: 'Duration',
  objective: 'Objective',
  visual: 'Visual',
  dialogueOrVO: 'Dialogue / VO',
  camera: 'Camera',
  audio: 'Audio',
  productFocus: 'Product Focus',
  sellingPoint: 'Selling Point',
  cta: 'CTA',
  assetHint: 'Asset Hint',
  directorIntent: 'Director Intent',
  status: 'Status',
};

const BUILT_IN_COLUMN_DESCRIPTIONS: Record<AdBuiltInScriptColumnKey, string> = {
  shotNumber: 'Sequential shot number. Keep it as a simple ordered number string.',
  duration: 'Estimated shot duration or beat length.',
  objective: 'What this shot must achieve in the ad flow.',
  visual: 'What the audience sees on screen.',
  dialogueOrVO: 'Dialogue, voice-over, or on-screen spoken copy.',
  camera: 'Camera language, movement, framing, or shot design.',
  audio: 'Music, sound design, or key audio cues.',
  productFocus: 'What product feature, benefit, or usage moment is highlighted.',
  sellingPoint: 'The persuasive proof point or core selling angle.',
  cta: 'The user action or conversion direction.',
  assetHint: 'Production or asset cue needed for this shot.',
  directorIntent: 'Directing note about rhythm, performance, or emotional intent.',
  status: 'Workflow status. Use "draft" unless there is a strong reason to return "ready" or "locked".',
};

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function tryParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractJsonValue(text: string): unknown {
  const trimmed = text.trim();
  const direct = tryParseJson<unknown>(trimmed);
  if (direct !== null) {
    return direct;
  }

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    const parsed = tryParseJson<unknown>(fenceMatch[1].trim());
    if (parsed !== null) {
      return parsed;
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    const parsed = tryParseJson<unknown>(objectMatch[0]);
    if (parsed !== null) {
      return parsed;
    }
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const parsed = tryParseJson<unknown>(arrayMatch[0]);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => trim(item))
          .filter(Boolean)
      )
    );
  }

  if (typeof value === 'string') {
    return Array.from(
      new Set(
        value
          .split(/[\n,]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }

  return [];
}

function getTemplateDefinition(templateId: AdScriptTemplateId): AdScriptTemplateDefinition {
  return AD_SCRIPT_TEMPLATE_DEFINITIONS.find((template) => template.id === templateId)
    ?? AD_SCRIPT_TEMPLATE_DEFINITIONS[0];
}

function normalizePromptColumns(
  columns: AdScriptPromptColumn[] | undefined,
  fallbackRows: AdScriptTableRow[] = []
): AdScriptPromptColumn[] {
  const normalized: AdScriptPromptColumn[] = [];
  const seen = new Set<string>();

  (columns ?? []).forEach((column) => {
    const key = trim(column?.key);
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    normalized.push({
      key,
      label: trim(column?.label) || (
        isBuiltInAdScriptColumnKey(key)
          ? BUILT_IN_COLUMN_LABELS[key]
          : key
      ),
    });
  });

  AD_SCRIPT_COLUMN_ORDER.forEach((key) => {
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    normalized.push({
      key,
      label: BUILT_IN_COLUMN_LABELS[key],
    });
  });

  fallbackRows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (key === 'id' || seen.has(key)) {
        return;
      }

      seen.add(key);
      normalized.push({
        key,
        label: key,
      });
    });
  });

  return normalized;
}

function buildRowSchema(columns: AdScriptPromptColumn[]): string {
  const rowSchema = columns.reduce<Record<string, string>>((acc, column) => {
    if (column.key === 'shotNumber') {
      acc[column.key] = '1';
      return acc;
    }

    if (column.key === 'status') {
      acc[column.key] = 'draft';
      return acc;
    }

    acc[column.key] = '';
    return acc;
  }, {});

  return JSON.stringify({ rows: [rowSchema] });
}

function buildColumnGuide(columns: AdScriptPromptColumn[]): string[] {
  return columns.map((column) => {
    if (isBuiltInAdScriptColumnKey(column.key)) {
      return `- ${column.label} (${column.key}): ${BUILT_IN_COLUMN_DESCRIPTIONS[column.key]}`;
    }

    return `- ${column.label} (${column.key}): User-defined custom column. Fill it with concise, row-specific content that matches the shot intent.`;
  });
}

function ensureRowMatchesColumns(
  row: AdScriptTableRow,
  columns: AdScriptPromptColumn[]
): AdScriptTableRow {
  const nextRow = { ...row };

  columns.forEach((column) => {
    if (column.key === 'shotNumber' || column.key === 'status') {
      return;
    }

    if (typeof nextRow[column.key] !== 'string') {
      nextRow[column.key] = '';
    }
  });

  return nextRow;
}

function toRowCandidate(
  value: unknown,
  index: number,
  shotNumber?: string
): AdScriptTableRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const fallback = createDefaultAdScriptRow(index);
  const record = value as Partial<Record<keyof AdScriptTableRow, unknown>>;

  return {
    ...fallback,
    ...extractAdScriptCustomFields(record),
    shotNumber: trim(record.shotNumber) || shotNumber || formatAdShotNumber(index),
    duration: trim(record.duration),
    objective: trim(record.objective),
    visual: trim(record.visual),
    dialogueOrVO: trim(record.dialogueOrVO),
    camera: trim(record.camera),
    audio: trim(record.audio),
    productFocus: trim(record.productFocus),
    sellingPoint: trim(record.sellingPoint),
    cta: trim(record.cta),
    assetHint: trim(record.assetHint),
    directorIntent: trim(record.directorIntent),
    status:
      record.status === 'ready' || record.status === 'locked'
        ? record.status
        : 'draft',
  };
}

function normalizeRowCandidates(
  value: unknown,
  expectedCount: number,
  shotNumbers?: string[]
): AdScriptTableRow[] {
  const rawRows = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { rows?: unknown[] }).rows)
      ? (value as { rows: unknown[] }).rows
      : [];

  return reindexAdScriptRows(
    rawRows
      .map((item, index) => toRowCandidate(item, index, shotNumbers?.[index]))
      .filter((item): item is AdScriptTableRow => Boolean(item))
      .slice(0, expectedCount)
  );
}

function normalizeVariantStrings(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { variants?: unknown[] }).variants)
      ? (value as { variants: unknown[] }).variants
      : [];

  return raw
    .map((item) => trim(item))
    .filter(Boolean)
    .slice(0, 3);
}

export function getMissingAdBriefFields(brief: AdBrief): Array<keyof AdBrief> {
  return REQUIRED_AD_BRIEF_FIELDS.filter((field) => trim(brief[field]).length === 0);
}

export async function generateDirectorSkillPreview(
  profile: DirectorSkillProfile
): Promise<Pick<DirectorSkillProfile, 'profileSummary' | 'promptSnapshot'>> {
  const normalizedProfile = normalizeDirectorSkillProfile(profile);
  const outputLanguage = detectUserContentLanguage([normalizedProfile]);
  const prompt = [
    'You are an advertising creative director prompt architect.',
    'Turn the structured director profile into a concise summary and a reusable direction prompt.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    '{ "profileSummary": "", "promptSnapshot": "" }',
    '',
    'Constraints:',
    '- Keep the profile summary to 80-160 words.',
    '- Keep the prompt snapshot practical, reusable, and instruction-oriented.',
    '- Preserve the user intent and avoid inventing tools, plugins, or agent abilities.',
    `- ${buildUserFacingLanguageInstruction(outputLanguage, 'json-values')}`,
    '',
    'Structured profile:',
    JSON.stringify(normalizedProfile, null, 2),
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.45,
    maxTokens: 1400,
  });

  const parsed = extractJsonValue(result.text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Failed to parse the director skill preview.');
  }

  const record = parsed as Record<string, unknown>;
  return {
    profileSummary: trim(record.profileSummary),
    promptSnapshot: trim(record.promptSnapshot),
  };
}

export async function normalizeAdBriefWithAi(
  brief: AdBrief
): Promise<{ normalizedBrief: string; followUpQuestions: string[] }> {
  const missingFields = getMissingAdBriefFields(brief);
  if (missingFields.length > 0) {
    throw new Error(`Missing required brief fields: ${missingFields.join(', ')}`);
  }
  const outputLanguage = detectUserContentLanguage([brief]);

  const prompt = [
    'You are an ad strategist helping structure a production-ready advertising brief.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    '{ "normalizedBrief": "", "followUpQuestions": ["", ""] }',
    '',
    'Rules:',
    '- Keep the normalized brief compact and production-oriented.',
    '- Follow-up questions are optional and should be 0-3 items.',
    '- Do not replace the required user inputs. Only organize and clarify them.',
    `- ${buildUserFacingLanguageInstruction(outputLanguage, 'json-values')}`,
    '',
    'Input brief:',
    JSON.stringify(brief, null, 2),
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.35,
    maxTokens: 1600,
  });

  const parsed = extractJsonValue(result.text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Failed to parse the normalized ad brief.');
  }

  const record = parsed as Record<string, unknown>;
  return {
    normalizedBrief: trim(record.normalizedBrief),
    followUpQuestions: normalizeStringArray(record.followUpQuestions).slice(0, 3),
  };
}

interface GenerateAdScriptRowsInput {
  directorSkillProfile: DirectorSkillProfile;
  brief: AdBrief;
  templateId: AdScriptTemplateId;
  columns?: AdScriptPromptColumn[];
  rowCount?: number;
  currentRows?: AdScriptTableRow[];
  instruction?: string;
}

export async function generateAdScriptRows(
  input: GenerateAdScriptRowsInput
): Promise<AdScriptTableRow[]> {
  const template = getTemplateDefinition(input.templateId);
  const desiredCount = Math.max(1, input.rowCount ?? template.defaultRowCount);
  const existingRows = normalizeAdScriptRows(input.currentRows);
  const promptColumns = normalizePromptColumns(input.columns, existingRows);
  const outputLanguage = detectUserContentLanguage([
    input.directorSkillProfile,
    input.brief,
    input.instruction,
    existingRows,
    promptColumns,
  ]);

  const prompt = [
    'You are a commercial director creating a shot-level advertising script table.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    buildRowSchema(promptColumns),
    '',
    'Rules:',
    `- Generate exactly ${desiredCount} rows.`,
    '- Each row must represent one shot beat.',
    '- Keep the script within short-form ad pacing suitable for 15-60 seconds.',
    '- Make the rows practical for production and editable as a table later.',
    '- Use concise language.',
    '- Every returned row must include every listed column key, including custom columns.',
    `- ${buildUserFacingLanguageInstruction(outputLanguage, 'json-values')}`,
    '',
    `Template instruction: ${template.generationInstruction}`,
    input.instruction?.trim()
      ? `Additional instruction: ${input.instruction.trim()}`
      : '',
    '',
    'Columns to fill for every row:',
    ...buildColumnGuide(promptColumns),
    '',
    'Director skill:',
    JSON.stringify(input.directorSkillProfile, null, 2),
    '',
    'Ad brief:',
    JSON.stringify(input.brief, null, 2),
    existingRows.length > 0
      ? [
          '',
          'Existing rows for reference:',
          JSON.stringify(existingRows, null, 2),
        ].join('\n')
      : '',
  ]
    .filter((line) => line.length > 0)
    .join('\n');

  const result = await generateText({
    prompt,
    temperature: existingRows.length > 0 ? 0.5 : 0.65,
    maxTokens: 3200,
  });

  const parsed = extractJsonValue(result.text);
  const rows = normalizeRowCandidates(
    parsed,
    desiredCount,
    existingRows.length > 0 ? existingRows.map((row) => row.shotNumber) : undefined
  );

  if (rows.length === 0) {
    throw new Error('No ad script rows were generated.');
  }

  return rows.map((row, index) => ({
    ...ensureRowMatchesColumns({
      ...extractAdScriptCustomFields(existingRows[index]),
      ...row,
    }, promptColumns),
  }));
}

interface RewriteAdScriptCellInput {
  directorSkillProfile: DirectorSkillProfile;
  brief: AdBrief;
  row: AdScriptTableRow;
  columnKey: AdScriptColumnKey;
  columnLabel?: string;
  currentValue: string;
  instruction: string;
}

export async function rewriteAdScriptCell(
  input: RewriteAdScriptCellInput
): Promise<string[]> {
  const instruction = input.instruction.trim();
  if (!instruction) {
    return [];
  }
  const outputLanguage = detectUserContentLanguage([
    input.row,
    input.brief,
    input.directorSkillProfile,
    input.columnLabel,
    instruction,
  ]);

  const prompt = [
    'You are a commercial director revising one cell in an ad script table.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    '{ "variants": ["", "", ""] }',
    '',
    'Rules:',
    '- Return 1-3 variants.',
    '- Only rewrite the target cell.',
    '- Keep the shot intent consistent with the rest of the row.',
    `- ${buildUserFacingLanguageInstruction(outputLanguage, 'json-values')}`,
    '',
    `Target column: ${input.columnKey}`,
    input.columnLabel?.trim() ? `Target column label: ${input.columnLabel.trim()}` : '',
    `Instruction: ${instruction}`,
    `Current value: ${input.currentValue.trim() || '(empty)'}`,
    '',
    'Shot row context:',
    JSON.stringify(input.row, null, 2),
    '',
    'Project context:',
    JSON.stringify(
      {
        directorSkillProfile: input.directorSkillProfile,
        brief: input.brief,
      },
      null,
      2
    ),
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.5,
    maxTokens: 1200,
  });

  const parsed = extractJsonValue(result.text);
  const variants = normalizeVariantStrings(parsed);
  if (variants.length === 0) {
    throw new Error('No rewrite variants were returned for the selected cell.');
  }

  return variants;
}

interface RewriteAdScriptRowInput {
  directorSkillProfile: DirectorSkillProfile;
  brief: AdBrief;
  columns?: AdScriptPromptColumn[];
  row: AdScriptTableRow;
  instruction: string;
}

export async function rewriteAdScriptRow(
  input: RewriteAdScriptRowInput
): Promise<AdScriptTableRow[]> {
  const instruction = input.instruction.trim();
  if (!instruction) {
    return [];
  }
  const promptColumns = normalizePromptColumns(input.columns, [input.row]);
  const outputLanguage = detectUserContentLanguage([
    input.row,
    input.brief,
    input.directorSkillProfile,
    instruction,
    promptColumns,
  ]);

  const prompt = [
    'You are a commercial director revising one entire shot row in an ad script table.',
    'Return strict JSON only.',
    '',
    'JSON schema:',
    buildRowSchema(promptColumns),
    '',
    'Rules:',
    '- Return 1-3 candidate rows.',
    '- Keep the same shotNumber.',
    '- Each candidate should be fully replaceable in the table.',
    '- Every candidate row must include every listed column key, including custom columns.',
    `- ${buildUserFacingLanguageInstruction(outputLanguage, 'json-values')}`,
    '',
    `Instruction: ${instruction}`,
    '',
    'Columns to fill for every row:',
    ...buildColumnGuide(promptColumns),
    '',
    'Current row:',
    JSON.stringify(input.row, null, 2),
    '',
    'Project context:',
    JSON.stringify(
      {
        directorSkillProfile: input.directorSkillProfile,
        brief: input.brief,
      },
      null,
      2
    ),
  ].join('\n');

  const result = await generateText({
    prompt,
    temperature: 0.55,
    maxTokens: 2200,
  });

  const parsed = extractJsonValue(result.text);
  const rows = normalizeRowCandidates(parsed, 3).map((row) => ({
    ...ensureRowMatchesColumns({
      ...extractAdScriptCustomFields(input.row),
      ...row,
    }, promptColumns),
    shotNumber: input.row.shotNumber,
  }));

  if (rows.length === 0) {
    throw new Error('No row rewrite variants were returned.');
  }

  return rows;
}

interface RegenerateAdScriptTableInput {
  directorSkillProfile: DirectorSkillProfile;
  brief: AdBrief;
  templateId: AdScriptTemplateId;
  columns?: AdScriptPromptColumn[];
  currentRows: AdScriptTableRow[];
  instruction: string;
}

export async function regenerateAdScriptTable(
  input: RegenerateAdScriptTableInput
): Promise<AdScriptTableRow[]> {
  const currentRows = normalizeAdScriptRows(input.currentRows);
  if (currentRows.length === 0) {
    return await generateAdScriptRows({
      directorSkillProfile: input.directorSkillProfile,
      brief: input.brief,
      templateId: input.templateId,
      columns: input.columns,
      instruction: input.instruction,
    });
  }

  return await generateAdScriptRows({
    directorSkillProfile: input.directorSkillProfile,
    brief: input.brief,
    templateId: input.templateId,
    columns: input.columns,
    rowCount: currentRows.length,
    currentRows,
    instruction: input.instruction,
  });
}
