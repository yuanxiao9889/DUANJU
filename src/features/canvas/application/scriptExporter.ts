import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import {
  CANVAS_NODE_TYPES,
  type ScriptRootNodeData,
  type ScriptChapterNodeData,
  type ScriptCharacterNodeData,
  type ScriptLocationNodeData,
  type ScriptItemNodeData,
  type ScriptPlotPointNodeData,
} from '../domain/canvasNodes';

export type ExportFormat = 'txt' | 'docx' | 'json' | 'markdown';

export interface BranchInfo {
  id: string;
  name: string;
  startChapter: number;
  endChapter: number;
  path: string[];
  isMainBranch: boolean;
}

export interface ExportOptions {
  format: ExportFormat;
  branchIds?: string[];
}

interface ScriptData {
  root: ScriptRootNodeData | null;
  chapters: ScriptChapterNodeData[];
  characters: ScriptCharacterNodeData[];
  locations: ScriptLocationNodeData[];
  items: ScriptItemNodeData[];
  plotPoints: ScriptPlotPointNodeData[];
}

export function extractScriptData(
  nodes: any[],
  _edges: unknown
): ScriptData {
  const root = nodes.find((n) => n.type === CANVAS_NODE_TYPES.scriptRoot);
  const chapters = nodes
    .filter((n) => n.type === CANVAS_NODE_TYPES.scriptChapter)
    .sort((a, b) => (a.data.chapterNumber || 0) - (b.data.chapterNumber || 0));
  const characters = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptCharacter);
  const locations = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptLocation);
  const items = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptItem);
  const plotPoints = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptPlotPoint);

  return {
    root: root?.data || null,
    chapters: chapters.map((c) => c.data),
    characters: characters.map((c) => c.data),
    locations: locations.map((l) => l.data),
    items: items.map((i) => i.data),
    plotPoints: plotPoints.map((p) => p.data),
  };
}

export function detectBranches(
  chapters: ScriptChapterNodeData[],
  _edges: unknown
): BranchInfo[] {
  const branchNodes = chapters.filter((c) => c.isBranchPoint);
  
  if (branchNodes.length === 0) {
    return [{
      id: 'main',
      name: '主分支',
      startChapter: 1,
      endChapter: chapters.length,
      path: chapters.map((_, i) => String(i + 1)),
      isMainBranch: true,
    }];
  }

  const branches: BranchInfo[] = [];
  
  branches.push({
    id: 'main',
    name: '主分支',
    startChapter: 1,
    endChapter: branchNodes[0]?.chapterNumber || chapters.length,
    path: chapters.slice(0, branchNodes[0]?.chapterNumber || chapters.length).map((_, i) => String(i + 1)),
    isMainBranch: true,
  });

  branchNodes.forEach((branch, index) => {
    const nextBranch = branchNodes[index + 1];
    const endChapter = nextBranch ? nextBranch.chapterNumber - 1 : chapters.length;
    
    branches.push({
      id: `branch-${index + 1}`,
      name: `分支 ${String.fromCharCode(65 + index)}`,
      startChapter: branch.chapterNumber,
      endChapter,
      path: chapters.slice(branch.chapterNumber - 1, endChapter).map((_, i) => String(branch.chapterNumber + i)),
      isMainBranch: false,
    });
  });

  return branches;
}

export function exportScript(
  nodes: any[],
  edges: unknown[],
  options: ExportOptions
): void {
  const scriptData = extractScriptData(nodes, edges);
  const branches = detectBranches(scriptData.chapters, edges);
  
  const selectedBranches = options.branchIds 
    ? branches.filter((b) => options.branchIds?.includes(b.id))
    : branches.filter((b) => b.isMainBranch);

  switch (options.format) {
    case 'txt':
      exportAsTxt(scriptData, selectedBranches);
      break;
    case 'docx':
      exportAsDocx(scriptData, selectedBranches);
      break;
    case 'json':
      exportAsJson(scriptData, selectedBranches);
      break;
    case 'markdown':
      exportAsMarkdown(scriptData, selectedBranches);
      break;
  }
}

function exportAsTxt(data: ScriptData, branches: BranchInfo[]): void {
  const lines: string[] = [];
  const title = data.root?.title || '未命名剧本';
  const genre = data.root?.genre || '未指定类型';

  lines.push('================================================================================');
  lines.push(`                              ${title}`);
  lines.push(`                              类型: ${genre}`);
  if (branches.length > 1) {
    lines.push(`                              分支: ${branches.map((b) => b.name).join(', ')}`);
  }
  lines.push('================================================================================');
  lines.push('');

  lines.push('【故事大纲】');
  branches.forEach((branch) => {
    const branchChapters = data.chapters.filter((_, i) => 
      branch.path.includes(String(i + 1))
    );
    if (!branch.isMainBranch) {
      lines.push(`[${branch.name}]`);
    }
    branchChapters.forEach((chapter) => {
      lines.push(`第${chapter.chapterNumber}章: ${chapter.title || '未命名'}`);
      if (chapter.summary) {
        lines.push(`  摘要: ${chapter.summary.slice(0, 100)}`);
      }
    });
  });
  lines.push('');

  lines.push('【角色】');
  data.characters.forEach((char) => {
    lines.push(`${char.name}: ${char.description || '无描述'}`);
    if (char.personality) {
      lines.push(`      性格: ${char.personality}`);
    }
    if (char.appearance) {
      lines.push(`      外貌: ${char.appearance}`);
    }
  });
  lines.push('');

  lines.push('【场景】');
  data.locations.forEach((loc) => {
    lines.push(`${loc.name}: ${loc.description || '无描述'}`);
  });
  lines.push('');

  lines.push('【道具】');
  data.items.forEach((item) => {
    lines.push(`${item.name}: ${item.description || '无描述'}`);
  });
  lines.push('');

  lines.push('================================================================================');
  lines.push('                                正文');
  lines.push('================================================================================');

  branches.forEach((branch) => {
    const branchChapters = data.chapters.filter((_, i) => 
      branch.path.includes(String(i + 1))
    );
    
    if (!branch.isMainBranch) {
      lines.push('');
      lines.push(`======================= ${branch.name} =======================`);
    }

    branchChapters.forEach((chapter) => {
      lines.push('');
      lines.push(`第${chapter.chapterNumber}章 ${chapter.title || '未命名'}`);
      lines.push('──────────────────────────────────────');
      lines.push('');
      if (chapter.sceneHeadings?.length) {
        chapter.sceneHeadings.forEach((heading) => {
          lines.push(heading);
          lines.push('');
        });
      }
      if (chapter.content) {
        lines.push(chapter.content);
      }
      lines.push('');
    });
  });

  if (data.plotPoints.length > 0) {
    lines.push('================================================================================');
    lines.push('                              埋点追踪');
    lines.push('================================================================================');
    lines.push('');
    
    const setups = data.plotPoints.filter((p) => p.pointType === 'setup');
    const payoffs = data.plotPoints.filter((p) => p.pointType === 'payoff');

    if (setups.length > 0) {
      lines.push('【伏笔】');
      setups.forEach((p) => {
        lines.push(`- ${p.description}`);
      });
      lines.push('');
    }

    if (payoffs.length > 0) {
      lines.push('【响应】');
      payoffs.forEach((p) => {
        lines.push(`- ${p.description}`);
      });
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  saveAs(blob, `${title}.txt`);
}

async function exportAsDocx(data: ScriptData, branches: BranchInfo[]): Promise<void> {
  const title = data.root?.title || '未命名剧本';
  const docChildren: any[] = [];

  docChildren.push(
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
    })
  );

  if (data.root?.genre) {
    docChildren.push(
      new Paragraph({
        text: `类型: ${data.root.genre}`,
        alignment: AlignmentType.CENTER,
      })
    );
  }

  docChildren.push(new Paragraph({ text: '' }));

  if (data.characters.length > 0) {
    docChildren.push(
      new Paragraph({
        text: '角色档案',
        heading: HeadingLevel.HEADING_1,
      })
    );

    data.characters.forEach((char) => {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: char.name, bold: true })],
        })
      );
      if (char.description) {
        docChildren.push(new Paragraph({ text: char.description }));
      }
      if (char.personality) {
        docChildren.push(new Paragraph({ text: `性格: ${char.personality}` }));
      }
      if (char.appearance) {
        docChildren.push(new Paragraph({ text: `外貌: ${char.appearance}` }));
      }
      docChildren.push(new Paragraph({ text: '' }));
    });
  }

  if (data.locations.length > 0) {
    docChildren.push(
      new Paragraph({
        text: '场景地点',
        heading: HeadingLevel.HEADING_1,
      })
    );

    data.locations.forEach((loc) => {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: loc.name, bold: true })],
        })
      );
      if (loc.description) {
        docChildren.push(new Paragraph({ text: loc.description }));
      }
      docChildren.push(new Paragraph({ text: '' }));
    });
  }

  if (data.items.length > 0) {
    docChildren.push(
      new Paragraph({
        text: '关键道具',
        heading: HeadingLevel.HEADING_1,
      })
    );

    data.items.forEach((item) => {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: item.name, bold: true })],
        })
      );
      if (item.description) {
        docChildren.push(new Paragraph({ text: item.description }));
      }
      docChildren.push(new Paragraph({ text: '' }));
    });
  }

  docChildren.push(
    new Paragraph({
      text: '正文',
      heading: HeadingLevel.HEADING_1,
    })
  );

  branches.forEach((branch) => {
    const branchChapters = data.chapters.filter((_, i) => 
      branch.path.includes(String(i + 1))
    );

    if (!branch.isMainBranch) {
      docChildren.push(
        new Paragraph({
          text: branch.name,
          heading: HeadingLevel.HEADING_2,
        })
      );
    }

    branchChapters.forEach((chapter) => {
      docChildren.push(
        new Paragraph({
          text: `第${chapter.chapterNumber}章 ${chapter.title || '未命名'}`,
          heading: HeadingLevel.HEADING_3,
        })
      );

      if (chapter.sceneHeadings?.length) {
        chapter.sceneHeadings.forEach((heading) => {
          docChildren.push(new Paragraph({ text: heading }));
        });
      }

      if (chapter.content) {
        docChildren.push(new Paragraph({ text: chapter.content }));
      }

      docChildren.push(new Paragraph({ text: '' }));
    });
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: docChildren,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${title}.docx`);
}

function exportAsJson(data: ScriptData, branches: BranchInfo[]): void {
  const title = data.root?.title || '未命名剧本';
  
  const exportData = {
    title,
    genre: data.root?.genre || '',
    totalChapters: data.chapters.length,
    branches: branches.map((branch) => ({
      name: branch.name,
      isMain: branch.isMainBranch,
      chapters: data.chapters.filter((_, i) => branch.path.includes(String(i + 1))).map((c) => ({
        chapterNumber: c.chapterNumber,
        title: c.title,
        summary: c.summary,
        content: c.content,
        sceneHeadings: c.sceneHeadings,
      })),
    })),
    characters: data.characters.map((c) => ({
      name: c.name,
      description: c.description,
      personality: c.personality,
      appearance: c.appearance,
    })),
    locations: data.locations.map((l) => ({
      name: l.name,
      description: l.description,
      appearances: l.appearances,
    })),
    items: data.items.map((i) => ({
      name: i.name,
      description: i.description,
      appearances: i.appearances,
    })),
    plotPoints: data.plotPoints.map((p) => ({
      type: p.pointType,
      description: p.description,
    })),
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  saveAs(blob, `${title}.json`);
}

function exportAsMarkdown(data: ScriptData, branches: BranchInfo[]): void {
  const lines: string[] = [];
  const title = data.root?.title || '未命名剧本';
  const genre = data.root?.genre || '未指定类型';

  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`**类型**: ${genre}`);
  lines.push('');

  if (data.characters.length > 0) {
    lines.push('## 角色档案');
    lines.push('');
    data.characters.forEach((char) => {
      lines.push(`### ${char.name}`);
      lines.push('');
      if (char.description) {
        lines.push(char.description);
        lines.push('');
      }
      if (char.personality) {
        lines.push(`**性格**: ${char.personality}`);
        lines.push('');
      }
      if (char.appearance) {
        lines.push(`**外貌**: ${char.appearance}`);
        lines.push('');
      }
    });
  }

  if (data.locations.length > 0) {
    lines.push('## 场景地点');
    lines.push('');
    data.locations.forEach((loc) => {
      lines.push(`### ${loc.name}`);
      lines.push('');
      if (loc.description) {
        lines.push(loc.description);
        lines.push('');
      }
    });
  }

  if (data.items.length > 0) {
    lines.push('## 关键道具');
    lines.push('');
    data.items.forEach((item) => {
      lines.push(`### ${item.name}`);
      lines.push('');
      if (item.description) {
        lines.push(item.description);
        lines.push('');
      }
    });
  }

  lines.push('## 正文');
  lines.push('');

  branches.forEach((branch) => {
    const branchChapters = data.chapters.filter((_, i) => 
      branch.path.includes(String(i + 1))
    );

    if (!branch.isMainBranch) {
      lines.push(`### ${branch.name}`);
      lines.push('');
    }

    branchChapters.forEach((chapter) => {
      lines.push(`### 第${chapter.chapterNumber}章 ${chapter.title || '未命名'}`);
      lines.push('');

      if (chapter.sceneHeadings?.length) {
        chapter.sceneHeadings.forEach((heading) => {
          lines.push(`\`\`\`\n${heading}\n\`\`\``);
          lines.push('');
        });
      }

      if (chapter.content) {
        lines.push(chapter.content);
        lines.push('');
      }

      if (chapter.summary) {
        lines.push(`> 摘要: ${chapter.summary}`);
        lines.push('');
      }
    });
  });

  if (data.plotPoints.length > 0) {
    lines.push('## 埋点追踪');
    lines.push('');

    const setups = data.plotPoints.filter((p) => p.pointType === 'setup');
    const payoffs = data.plotPoints.filter((p) => p.pointType === 'payoff');

    if (setups.length > 0) {
      lines.push('### 伏笔');
      lines.push('');
      setups.forEach((p) => {
        lines.push(`- ${p.description}`);
      });
      lines.push('');
    }

    if (payoffs.length > 0) {
      lines.push('### 响应');
      lines.push('');
      payoffs.forEach((p) => {
        lines.push(`- ${p.description}`);
      });
    }
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  saveAs(blob, `${title}.md`);
}
