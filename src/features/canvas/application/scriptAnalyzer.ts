import { generateText } from '@/commands/textGen';
import { detectCharacterNames, detectLocations, type ParsedScriptContent } from './documentParser';
import { CANVAS_NODE_TYPES, type ScriptChapterNodeData } from '@/features/canvas/domain/canvasNodes';
import { v4 as uuidv4 } from 'uuid';

export interface ScriptAnalysisResult {
  chapters: ChapterAnalysis[];
  characters: CharacterAnalysis[];
  locations: string[];
  styleProfile: StyleProfile;
}

export interface ChapterAnalysis {
  chapterNumber: number;
  title: string;
  summary: string;
  setupPoints: string[];
  payoffPoints: string[];
  emotionalShift: string;
  characters: string[];
}

export interface CharacterAnalysis {
  name: string;
  description: string;
  personality: string;
  appearance: string;
}

export interface StyleProfile {
  dialogueRatio: number;
  actionDetailLevel: string;
  slangTerms: string[];
}

export async function analyzeScript(
  content: ParsedScriptContent,
  options?: { model?: string }
): Promise<ScriptAnalysisResult> {
  const prompt = buildAnalysisPrompt(content);
  
  const result = await generateText({
    prompt,
    model: options?.model || 'gemini-2.0-flash',
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
  const scenesText = content.scenes
    .slice(0, 10)
    .map((s, i) => `场景${i + 1}: ${s.heading}\n${s.content.slice(0, 500)}`)
    .join('\n\n');
  
  return `你是一位专业的剧本分析师。请分析以下剧本内容，提取结构化信息。

剧本名称: ${content.title}
场景数量: ${content.scenes.length}

前10个场景内容:
${scenesText}

请按以下JSON格式输出（不要添加任何解释）:
{
  "chapters": [
    {
      "chapterNumber": 1,
      "title": "章节标题",
      "summary": "50-100字的剧情摘要，包含起因、冲突、结果",
      "setupPoints": ["伏笔点1", "伏笔点2"],
      "payoffPoints": ["响应点1"],
      "emotionalShift": "情感变化，如：紧张→恐惧",
      "characters": ["角色A", "角色B"]
    }
  ],
  "characters": [
    {
      "name": "角色名",
      "description": "角色描述",
      "personality": "性格特点",
      "appearance": "外貌特征"
    }
  ],
  "locations": ["场景1", "场景2"],
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
    locations: (parsed.locations as string[]) || [],
    styleProfile: (parsed.styleProfile as StyleProfile) || {
      dialogueRatio: 50,
      actionDetailLevel: '中等',
      slangTerms: [],
    },
  };
}

function createDefaultAnalysis(content: ParsedScriptContent): ScriptAnalysisResult {
  const characters = detectCharacterNames(content.scenes);
  const locations = detectLocations(content.scenes);
  
  const chapters: ChapterAnalysis[] = content.scenes.slice(0, 20).map((scene, index) => ({
    chapterNumber: index + 1,
    title: scene.heading,
    summary: scene.content.slice(0, 100),
    setupPoints: [],
    payoffPoints: [],
    emotionalShift: '',
    characters: [],
  }));
  
  return {
    chapters,
    characters: characters.slice(0, 10).map((name) => ({
      name,
      description: '',
      personality: '',
      appearance: '',
    })),
    locations,
    styleProfile: {
      dialogueRatio: 50,
      actionDetailLevel: '中等',
      slangTerms: [],
    },
  };
}

export function createChapterNodesFromAnalysis(
  analysis: ScriptAnalysisResult,
  _projectId: string
): Array<{ id: string; type: string; data: ScriptChapterNodeData; position: { x: number; y: number } }> {
  const baseX = 500;
  const baseY = 100;
  const NODE_HEIGHT = 400;
  const GAP = 40;
  const spacingY = NODE_HEIGHT + GAP;
  
  return analysis.chapters.map((chapter, index) => ({
    id: uuidv4(),
    type: CANVAS_NODE_TYPES.scriptChapter,
    data: {
      displayName: `章节 ${chapter.chapterNumber}`,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      content: '',
      summary: chapter.summary,
      sceneHeadings: [chapter.title],
      characters: chapter.characters,
      locations: [],
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
      y: baseY + index * spacingY,
    },
  }));
}

export async function generateChapterSummary(
  content: string,
  options?: { model?: string }
): Promise<string> {
  const prompt = `请为以下剧本内容生成50-100字的剧情摘要，包含：起因、关键冲突、结果、情感转向。

剧本内容:
${content.slice(0, 2000)}

请直接输出摘要，不要添加任何解释。`;

  const result = await generateText({
    prompt,
    model: options?.model || 'gemini-2.0-flash',
    temperature: 0.5,
    maxTokens: 500,
  });

  return result.text.trim();
}
