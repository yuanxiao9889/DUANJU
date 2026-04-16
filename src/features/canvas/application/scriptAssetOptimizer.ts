import { generateText } from '@/commands/textGen';
import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type ScriptCharacterNodeData,
  type ScriptItemNodeData,
  type ScriptLocationNodeData,
  type ScriptWorldviewNodeData,
} from '@/features/canvas/domain/canvasNodes';

export interface OptimizedScriptCharacterFields {
  description: string;
  personality: string;
  appearance: string;
}

export interface OptimizedScriptLocationFields {
  description: string;
}

export interface OptimizedScriptItemFields {
  description: string;
}

interface ErrorWithDetails extends Error {
  details?: string;
}

export class ScriptAssetOptimizationParseError extends Error implements ErrorWithDetails {
  details?: string;

  constructor(message: string, details?: string) {
    super(message);
    this.name = 'ScriptAssetOptimizationParseError';
    this.details = details;
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    : '';
}

function formatList(values: string[]): string {
  const normalized = values
    .map((item) => normalizeText(item))
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join('、') : '无';
}

function readJsonObject(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  const candidates = [
    trimmed,
    trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? '',
    trimmed.match(/\{[\s\S]*\}/)?.[0]?.trim() ?? '',
  ].filter((candidate, index, source) => candidate && source.indexOf(candidate) === index);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new ScriptAssetOptimizationParseError(
    'Failed to parse optimized asset JSON.',
    rawText.trim().slice(0, 4000)
  );
}

function collectWorldviewContext(nodes: CanvasNode[]): string {
  const worldviewNodes = nodes.filter(
    (node): node is CanvasNode & { data: ScriptWorldviewNodeData } =>
      node.type === CANVAS_NODE_TYPES.scriptWorldview
  );

  if (worldviewNodes.length === 0) {
    return '未提供世界观节点，请仅基于当前资产信息做克制且一致的补全。';
  }

  return worldviewNodes
    .slice(0, 3)
    .map((node, index) => {
      const data = node.data;
      const title = normalizeText(data.worldviewName || data.displayName) || `世界观 ${index + 1}`;
      const lines = [
        `${title}`,
        `核心设定：${normalizeText(data.description) || '无'}`,
        `时代：${normalizeText(data.era) || '无'}`,
        `科技：${normalizeText(data.technology) || '无'}`,
        `魔法 / 超自然：${normalizeText(data.magic) || '无'}`,
        `社会结构：${normalizeText(data.society) || '无'}`,
        `地理：${normalizeText(data.geography) || '无'}`,
      ];
      const rules = Array.isArray(data.rules)
        ? data.rules.map((rule) => normalizeText(rule)).filter(Boolean)
        : [];
      if (rules.length > 0) {
        lines.push(`规则约束：${rules.join('；')}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function buildCharacterOptimizationPrompt(
  data: ScriptCharacterNodeData,
  worldviewContext: string
): string {
  return [
    '你是影视角色设定、美术开发和角色三视图前期设计顾问。',
    '请基于当前角色资料与世界观背景，对角色内容进行补全和润色。',
    '目标是让角色描述更丰满、更统一、更具可视化信息，尤其要强化后续可直接用于角色三视图绘制的外形描述。',
    '',
    '硬性要求：',
    '- 不要改动角色名称，不要推翻已明确的人物身份、关系、阵营、年龄感和既有设定。',
    '- 可以做克制补全，但补充内容必须与现有信息和世界观一致，不能写成完全陌生的新人物。',
    '- description 重点写角色定位、气质、行为方式和在世界中的存在感。',
    '- personality 请输出 3 到 6 个稳定且可表演的性格短语，用中文顿号或逗号分隔。',
    '- appearance 必须重点强化可视化外形信息，优先写年龄感、身材比例、脸部识别点、发型、服饰层次、材质、配色、标志性配件、使用痕迹与整体气场。',
    '- 不要写镜头、构图、提示词标签、markdown 或解释说明。',
    '- 只返回 JSON，不要包裹代码块。',
    '',
    'JSON 结构：',
    '{',
    '  "description": "string",',
    '  "personality": "string",',
    '  "appearance": "string"',
    '}',
    '',
    '当前角色资料：',
    `名称：${normalizeText(data.name) || '未命名角色'}`,
    `现有描述：${normalizeText(data.description) || '无'}`,
    `现有性格：${normalizeText(data.personality) || '无'}`,
    `现有外貌：${normalizeText(data.appearance) || '无'}`,
    '',
    '世界观背景：',
    worldviewContext,
  ].join('\n');
}

function buildLocationOptimizationPrompt(
  data: ScriptLocationNodeData,
  worldviewContext: string
): string {
  return [
    '你是影视场景设定与美术概念顾问。',
    '请基于当前场景资料和世界观背景，把场景描述补写得更完整、更可视化、更适合后续场景设计与镜头搭建。',
    '',
    '硬性要求：',
    '- 不要改动场景名称，不要推翻已明确的空间属性或故事事实。',
    '- 可以做克制补全，但必须与世界观一致，不能凭空改成另一种地点。',
    '- description 请重点补足空间结构、尺度感、主要材质、陈设、光线、氛围、可识别视觉锚点与故事使用感。',
    '- 如果已有“出场章节”，仅作为参考，不要原样复述成流水账。',
    '- 不要写镜头、构图、提示词标签、markdown 或解释说明。',
    '- 只返回 JSON，不要包裹代码块。',
    '',
    'JSON 结构：',
    '{',
    '  "description": "string"',
    '}',
    '',
    '当前场景资料：',
    `名称：${normalizeText(data.name) || '未命名场景'}`,
    `现有描述：${normalizeText(data.description) || '无'}`,
    `出场章节：${formatList(Array.isArray(data.appearances) ? data.appearances : [])}`,
    '',
    '世界观背景：',
    worldviewContext,
  ].join('\n');
}

function buildItemOptimizationPrompt(
  data: ScriptItemNodeData,
  worldviewContext: string
): string {
  return [
    '你是影视道具设定与美术开发顾问。',
    '请基于当前道具资料和世界观背景，把道具描述补写得更完整、更可视化，并适合后续做道具设定或正侧背等多角度设计参考。',
    '',
    '硬性要求：',
    '- 不要改动道具名称，不要推翻已明确的用途、归属或剧情事实。',
    '- 可以做克制补全，但必须与世界观一致，不能无端升级成完全不同的道具。',
    '- description 请重点补足尺寸感、材质、结构、做工、配色、磨损痕迹、功能线索和最有辨识度的外观特征。',
    '- 如果已有“出场章节”，仅作为上下文参考，不要写成章节列表。',
    '- 不要写镜头、构图、提示词标签、markdown 或解释说明。',
    '- 只返回 JSON，不要包裹代码块。',
    '',
    'JSON 结构：',
    '{',
    '  "description": "string"',
    '}',
    '',
    '当前道具资料：',
    `名称：${normalizeText(data.name) || '未命名道具'}`,
    `现有描述：${normalizeText(data.description) || '无'}`,
    `出场章节：${formatList(Array.isArray(data.appearances) ? data.appearances : [])}`,
    '',
    '世界观背景：',
    worldviewContext,
  ].join('\n');
}

export async function optimizeScriptCharacterFields(
  data: ScriptCharacterNodeData,
  nodes: CanvasNode[]
): Promise<OptimizedScriptCharacterFields> {
  const worldviewContext = collectWorldviewContext(nodes);
  const result = await generateText({
    prompt: buildCharacterOptimizationPrompt(data, worldviewContext),
    temperature: 0.55,
    maxTokens: 1400,
  });
  const payload = readJsonObject(result.text);

  return {
    description: normalizeText(payload.description) || normalizeText(data.description),
    personality: normalizeText(payload.personality) || normalizeText(data.personality),
    appearance: normalizeText(payload.appearance) || normalizeText(data.appearance),
  };
}

export async function optimizeScriptLocationFields(
  data: ScriptLocationNodeData,
  nodes: CanvasNode[]
): Promise<OptimizedScriptLocationFields> {
  const worldviewContext = collectWorldviewContext(nodes);
  const result = await generateText({
    prompt: buildLocationOptimizationPrompt(data, worldviewContext),
    temperature: 0.5,
    maxTokens: 1000,
  });
  const payload = readJsonObject(result.text);

  return {
    description: normalizeText(payload.description) || normalizeText(data.description),
  };
}

export async function optimizeScriptItemFields(
  data: ScriptItemNodeData,
  nodes: CanvasNode[]
): Promise<OptimizedScriptItemFields> {
  const worldviewContext = collectWorldviewContext(nodes);
  const result = await generateText({
    prompt: buildItemOptimizationPrompt(data, worldviewContext),
    temperature: 0.5,
    maxTokens: 1000,
  });
  const payload = readJsonObject(result.text);

  return {
    description: normalizeText(payload.description) || normalizeText(data.description),
  };
}
