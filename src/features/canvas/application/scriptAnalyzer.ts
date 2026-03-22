import { generateText } from '@/commands/textGen';
import { detectCharacterNames, detectLocations, type ParsedScriptContent } from './documentParser';
import { CANVAS_NODE_TYPES, type ScriptChapterNodeData, type ScriptCharacterNodeData, type ScriptLocationNodeData, type ScriptItemNodeData, type ScriptWorldviewNodeData } from '@/features/canvas/domain/canvasNodes';
import { v4 as uuidv4 } from 'uuid';

export interface ScriptAnalysisResult {
  chapters: ChapterAnalysis[];
  characters: CharacterAnalysis[];
  locations: LocationAnalysis[];
  items: ItemAnalysis[];
  worldview: WorldviewAnalysis | null;
  styleProfile: StyleProfile;
}

export interface ChapterAnalysis {
  chapterNumber: number;
  title: string;
  startLine: number;
  endLine: number;
  summary: string;
  setupPoints: string[];
  payoffPoints: string[];
  emotionalShift: string;
  characters: string[];
  locations: string[];
}

export interface CharacterAnalysis {
  name: string;
  description: string;
  personality: string;
  appearance: string;
  role: string;
}

export interface LocationAnalysis {
  name: string;
  description: string;
  type: string;
}

export interface ItemAnalysis {
  name: string;
  description: string;
  significance: string;
}

export interface WorldviewAnalysis {
  name: string;
  description: string;
  era: string;
  technology: string;
  magic: string;
  society: string;
  geography: string;
  rules: string[];
}

export interface StyleProfile {
  dialogueRatio: number;
  actionDetailLevel: string;
  slangTerms: string[];
}

export async function analyzeScript(
  content: ParsedScriptContent,
  options?: { model?: string; provider?: string }
): Promise<ScriptAnalysisResult> {
  const prompt = buildAnalysisPrompt(content);
  
  const result = await generateText({
    prompt,
    model: options?.model,
    provider: options?.provider,
    temperature: 0.3,
    maxTokens: 4096,
  });
  
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return normalizeAnalysisResult(parsed);
    }
  } catch (e) {
    console.error('[ScriptAnalyzer] Failed to parse analysis result', e);
  }
  
  return createDefaultAnalysis(content);
}

function buildAnalysisPrompt(content: ParsedScriptContent): string {
  const lines = content.rawText.split('\n');
  const maxLines = Math.min(lines.length, 500);
  
  const linesWithNumbers = lines
    .slice(0, maxLines)
    .map((line, index) => `${index + 1}: ${line}`)
    .join('\n');
  
  return `你是一位专业的剧本分析师。请分析以下剧本内容，判断如何分割章节。

重要规则：
1. 你需要返回每个章节的起始行号和结束行号（从1开始计数）
2. 章节数量控制在 20 个以内
3. 章节应该按照剧情逻辑分割，每个章节应该是一个完整的故事单元
4. 章节之间不应该有重叠，也不应该有遗漏
5. 最后一个章节的结束行号应该是 ${maxLines}

剧本名称: ${content.title}
总行数: ${lines.length}（仅分析前${maxLines}行）

原文（带行号）:
${linesWithNumbers}

请按以下JSON格式输出（不要添加任何解释）:
{
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "章节标题",
      "startLine": 1,
      "endLine": 50,
      "summary": "50-100字的剧情摘要，包含起因、冲突、结果",
      "setupPoints": ["伏笔点1", "伏笔点2"],
      "payoffPoints": ["响应点1"],
      "emotionalShift": "情感变化，如：紧张→恐惧",
      "characters": ["角色A", "角色B"],
      "locations": ["场景A", "场景B"]
    }
  ],
  "characters": [
    {
      "name": "角色名",
      "description": "角色描述（50字以内）",
      "personality": "性格特点",
      "appearance": "外貌特征",
      "role": "角色定位（主角/配角/反派等）"
    }
  ],
  "locations": [
    {
      "name": "场景名称",
      "description": "场景描述",
      "type": "场景类型（室内/室外/虚构等）"
    }
  ],
  "items": [
    {
      "name": "道具名称",
      "description": "道具描述",
      "significance": "道具在剧情中的重要性"
    }
  ],
  "worldview": {
    "name": "世界观名称",
    "description": "世界观概述",
    "era": "时代背景",
    "technology": "科技水平",
    "magic": "魔法/超自然元素",
    "society": "社会结构",
    "geography": "地理环境",
    "rules": ["世界规则1", "世界规则2"]
  },
  "styleProfile": {
    "dialogueRatio": 45,
    "actionDetailLevel": "详细",
    "slangTerms": ["黑话1", "术语2"]
  }
}`;
}

function normalizeAnalysisResult(parsed: Record<string, unknown>): ScriptAnalysisResult {
  return {
    chapters: (parsed.chapters as ChapterAnalysis[]) || [],
    characters: (parsed.characters as CharacterAnalysis[]) || [],
    locations: (parsed.locations as LocationAnalysis[]) || [],
    items: (parsed.items as ItemAnalysis[]) || [],
    worldview: (parsed.worldview as WorldviewAnalysis) || null,
    styleProfile: (parsed.styleProfile as StyleProfile) || {
      dialogueRatio: 50,
      actionDetailLevel: '中等',
      slangTerms: [],
    },
  };
}

function splitContentByChapters(
  rawText: string,
  chapters: ChapterAnalysis[]
): Array<{ chapter: ChapterAnalysis; content: string }> {
  const lines = rawText.split('\n');
  
  return chapters.map((chapter) => {
    const startLine = Math.max(0, chapter.startLine - 1);
    const endLine = Math.min(lines.length, chapter.endLine);
    const content = lines.slice(startLine, endLine).join('\n');
    
    return {
      chapter,
      content,
    };
  });
}

function createDefaultAnalysis(content: ParsedScriptContent): ScriptAnalysisResult {
  const characters = detectCharacterNames(content.scenes);
  const locations = detectLocations(content.scenes);
  
  const chapters: ChapterAnalysis[] = content.scenes.slice(0, 20).map((scene, index) => ({
    chapterNumber: index + 1,
    title: scene.heading,
    startLine: scene.lineStart,
    endLine: scene.lineEnd,
    summary: scene.content.slice(0, 100),
    setupPoints: [],
    payoffPoints: [],
    emotionalShift: '',
    characters: [],
    locations: [],
  }));
  
  return {
    chapters,
    characters: characters.slice(0, 10).map((name) => ({
      name,
      description: '',
      personality: '',
      appearance: '',
      role: '',
    })),
    locations: locations.map((name) => ({
      name,
      description: '',
      type: '',
    })),
    items: [],
    worldview: null,
    styleProfile: {
      dialogueRatio: 50,
      actionDetailLevel: '中等',
      slangTerms: [],
    },
  };
}

export function createChapterNodesFromAnalysis(
  analysis: ScriptAnalysisResult,
  parsedContent?: ParsedScriptContent
): Array<{ id: string; type: string; data: ScriptChapterNodeData; position: { x: number; y: number } }> {
  const baseX = 100;
  const baseY = 100;
  const NODE_BASE_HEIGHT = 200;
  const LINE_HEIGHT = 18;
  const GAP = 60;
  
  if (!parsedContent?.rawText || analysis.chapters.length === 0) {
    return [];
  }
  
  const chaptersWithContent = splitContentByChapters(
    parsedContent.rawText,
    analysis.chapters
  );
  
  let currentY = baseY;
  
  return chaptersWithContent.map(({ chapter, content }) => {
    const lineCount = content.split('\n').length;
    const nodeHeight = NODE_BASE_HEIGHT + lineCount * LINE_HEIGHT;
    
    const node = {
      id: uuidv4(),
      type: CANVAS_NODE_TYPES.scriptChapter,
      data: {
        displayName: `章节 ${chapter.chapterNumber}`,
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        content: content,
        summary: chapter.summary,
        sceneHeadings: [chapter.title],
        characters: chapter.characters,
        locations: chapter.locations,
        items: [],
        emotionalShift: chapter.emotionalShift,
        setupRef: chapter.setupPoints.join('; '),
        payoffRef: chapter.payoffPoints.join('; '),
        isBranchPoint: false,
        branchType: 'main',
        depth: 1,
        tables: [],
        plotPoints: [],
      } as ScriptChapterNodeData,
      position: {
        x: baseX,
        y: currentY,
      },
    };
    
    currentY += nodeHeight + GAP;
    
    return node;
  });
}

export async function generateChapterSummary(
  content: string,
  options?: { model?: string; provider?: string }
): Promise<string> {
  const prompt = `请为以下剧本内容生成50-100字的剧情摘要，包含：起因、关键冲突、结果、情感转向。

剧本内容:
${content.slice(0, 2000)}

请直接输出摘要，不要添加任何解释。`;

  const result = await generateText({
    prompt,
    model: options?.model,
    provider: options?.provider,
    temperature: 0.5,
    maxTokens: 500,
  });

  return result.text.trim();
}

export function createCharacterNodesFromAnalysis(
  analysis: ScriptAnalysisResult
): Array<{ id: string; type: string; data: ScriptCharacterNodeData; position: { x: number; y: number } }> {
  const baseX = 100;
  const baseY = 100;
  const NODE_WIDTH = 280;
  const GAP = 20;
  
  return analysis.characters.map((character, index) => ({
    id: uuidv4(),
    type: CANVAS_NODE_TYPES.scriptCharacter,
    data: {
      name: character.name,
      description: character.description,
      personality: character.personality,
      appearance: character.appearance,
      role: character.role,
      age: '',
      occupation: '',
      motivation: '',
      relationships: [],
      statusUpdates: [],
    } as ScriptCharacterNodeData,
    position: {
      x: baseX,
      y: baseY + index * (NODE_WIDTH + GAP),
    },
  }));
}

export function createLocationNodesFromAnalysis(
  analysis: ScriptAnalysisResult
): Array<{ id: string; type: string; data: ScriptLocationNodeData; position: { x: number; y: number } }> {
  const baseX = 450;
  const baseY = 100;
  const NODE_WIDTH = 280;
  const GAP = 20;
  
  return analysis.locations.map((location, index) => ({
    id: uuidv4(),
    type: CANVAS_NODE_TYPES.scriptLocation,
    data: {
      name: location.name,
      description: location.description,
      type: location.type,
      atmosphere: '',
      keyElements: [],
      appearances: [],
    } as ScriptLocationNodeData,
    position: {
      x: baseX,
      y: baseY + index * (NODE_WIDTH + GAP),
    },
  }));
}

export function createItemNodesFromAnalysis(
  analysis: ScriptAnalysisResult
): Array<{ id: string; type: string; data: ScriptItemNodeData; position: { x: number; y: number } }> {
  const baseX = 800;
  const baseY = 100;
  const NODE_WIDTH = 280;
  const GAP = 20;
  
  return analysis.items.map((item, index) => ({
    id: uuidv4(),
    type: CANVAS_NODE_TYPES.scriptItem,
    data: {
      name: item.name,
      description: item.description,
      significance: item.significance,
      owner: '',
      status: '',
      appearances: [],
    } as ScriptItemNodeData,
    position: {
      x: baseX,
      y: baseY + index * (NODE_WIDTH + GAP),
    },
  }));
}

export function createWorldviewNodeFromAnalysis(
  analysis: ScriptAnalysisResult
): { id: string; type: string; data: ScriptWorldviewNodeData; position: { x: number; y: number } } | null {
  if (!analysis.worldview) return null;
  
  return {
    id: uuidv4(),
    type: CANVAS_NODE_TYPES.scriptWorldview,
    data: {
      worldviewName: analysis.worldview.name,
      description: analysis.worldview.description,
      era: analysis.worldview.era,
      technology: analysis.worldview.technology,
      magic: analysis.worldview.magic,
      society: analysis.worldview.society,
      geography: analysis.worldview.geography,
      rules: analysis.worldview.rules,
    } as ScriptWorldviewNodeData,
    position: { x: 1150, y: 100 },
  };
}
