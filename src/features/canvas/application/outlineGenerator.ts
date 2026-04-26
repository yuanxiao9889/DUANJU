import { generateText } from '@/commands/textGen';

export interface OutlineChapter {
  number: number;
  title: string;
  summary: string;
}

export interface StoryOutline {
  title: string;
  genre: string;
  chapters: OutlineChapter[];
  worldview?: {
    name: string;
    description: string;
    era: string;
    technology: string;
    magic: string;
    society: string;
    geography: string;
  };
}

export interface OutlineGenerationOptions {
  chapterCount?: number;
  style?: string;
  worldviewDescription?: string;
}

export async function generateOutline(
  storyDescription: string,
  options?: OutlineGenerationOptions
): Promise<StoryOutline> {
  const chapterCount = options?.chapterCount || 5;
  const style = options?.style || '';
  const worldviewDesc = options?.worldviewDescription || '';

  let prompt = `请根据以下信息生成一个剧本大纲。

故事概要：${storyDescription}
`;

  if (style) {
    prompt += `\n故事风格：${style}`;
  }

  if (worldviewDesc) {
    prompt += `\n世界观设定：${worldviewDesc}`;
  }

  prompt += `

请返回 JSON 格式的大纲，包含：
- title: 剧本标题
- genre: 剧本类型（如：悬疑、爱情、科幻、喜剧等）
- chapters: 章节数组，每个章节包含：
  - number: 章节序号
  - title: 章节标题
  - summary: 50字左右的章节摘要

${worldviewDesc ? `- worldview: 世界观信息，包含：
  - name: 世界观名称
  - description: 世界观概述
  - era: 时代背景
  - technology: 科技水平
  - magic: 魔法/超自然设定
  - society: 社会结构
  - geography: 地理环境` : ''}

请生成 ${chapterCount} 个章节的大纲。请直接返回 JSON，不要其他内容。`;

  try {
    const result = await generateText({
      prompt,
      temperature: 0.7,
      maxTokens: 4096,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const outline = JSON.parse(jsonMatch[0]) as StoryOutline;
      return outline;
    }
    
    throw new Error('Failed to parse AI response');
  } catch (error) {
    console.error('Generate outline failed:', error);
    if (error instanceof Error && error.message.includes('请先在设置中')) {
      throw error;
    }
    return {
      title: '未命名剧本',
      genre: '剧情',
      chapters: [
        { number: 1, title: '第一章', summary: '故事开始...' },
        { number: 2, title: '第二章', summary: '冲突发展...' },
        { number: 3, title: '第三章', summary: '高潮...' },
        { number: 4, title: '第四章', summary: '结局...' },
        { number: 5, title: '第五章', summary: '尾声...' },
      ],
    };
  }
}
