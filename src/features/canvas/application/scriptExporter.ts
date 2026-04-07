import { save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  CANVAS_NODE_TYPES,
  normalizeSceneCards,
  type SceneCard,
  type ScriptRootNodeData,
  type ScriptChapterNodeData,
  type ScriptCharacterNodeData,
  type ScriptLocationNodeData,
  type ScriptItemNodeData,
  type ScriptPlotPointNodeData,
} from '../domain/canvasNodes';
import type { Edge } from '@xyflow/react';

type DocxModule = typeof import('docx');

export type ExportFormat = 'txt' | 'docx' | 'json' | 'markdown';

export interface BranchInfo {
  id: string;
  name: string;
  startChapter: number;
  endChapter: number;
  path: string[];
  nodeIds: string[];
  isMainBranch: boolean;
}

export interface ExportOptions {
  format: ExportFormat;
  branchIds?: string[];
}

interface ChapterWithId {
  id: string;
  data: ScriptChapterNodeData;
}

interface ScriptData {
  root: ScriptRootNodeData | null;
  chapters: ChapterWithId[];
  characters: ScriptCharacterNodeData[];
  locations: ScriptLocationNodeData[];
  items: ScriptItemNodeData[];
  plotPoints: ScriptPlotPointNodeData[];
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&lt;': '<',
    '&gt;': '>',
    '&amp;': '&',
    '&nbsp;': ' ',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  };
  
  return text.replace(/&[^;]+;/g, (match) => entities[match] || match);
}

function parseHtmlToDocxParagraphs(html: string, docx: DocxModule): any[] {
  if (!html || !html.trim()) {
    return [];
  }

  const paragraphs: any[] = [];
  
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;

    function processInlineNodes(node: Node, textRuns: any[], isBold: boolean = false, isItalic: boolean = false): void {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text.trim()) {
          textRuns.push(new docx.TextRun({
            text: decodeHtmlEntities(text),
            bold: isBold,
            italics: isItalic,
          }));
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();

        switch (tagName) {
          case 'strong':
          case 'b':
            for (const child of element.childNodes) {
              processInlineNodes(child, textRuns, true, isItalic);
            }
            break;
          case 'em':
          case 'i':
            for (const child of element.childNodes) {
              processInlineNodes(child, textRuns, isBold, true);
            }
            break;
          case 'br':
            textRuns.push(new docx.TextRun({ text: '', break: 1 }));
            break;
          default:
            for (const child of element.childNodes) {
              processInlineNodes(child, textRuns, isBold, isItalic);
            }
        }
      }
    }

    function processBlockNode(node: Node): void {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text.trim()) {
          paragraphs.push(new docx.Paragraph({ text: decodeHtmlEntities(text) }));
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as Element;
        const tagName = element.tagName.toLowerCase();

        switch (tagName) {
          case 'h1':
          case 'h2': {
            const textRuns: any[] = [];
            for (const child of element.childNodes) {
              processInlineNodes(child, textRuns);
            }
            if (textRuns.length > 0) {
              paragraphs.push(new docx.Paragraph({
                children: textRuns,
                heading: docx.HeadingLevel.HEADING_2,
              }));
            }
            break;
          }
          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6': {
            const textRuns: any[] = [];
            for (const child of element.childNodes) {
              processInlineNodes(child, textRuns);
            }
            if (textRuns.length > 0) {
              paragraphs.push(new docx.Paragraph({
                children: textRuns,
                heading: docx.HeadingLevel.HEADING_3,
              }));
            }
            break;
          }
          case 'p': {
            const textRuns: any[] = [];
            for (const child of element.childNodes) {
              processInlineNodes(child, textRuns);
            }
            if (textRuns.length > 0) {
              paragraphs.push(new docx.Paragraph({ children: textRuns }));
            } else {
              paragraphs.push(new docx.Paragraph({ text: '' }));
            }
            break;
          }
          case 'hr': {
            paragraphs.push(new docx.Paragraph({
              text: '',
              border: {
                bottom: {
                  color: 'auto',
                  space: 1,
                  style: docx.BorderStyle.SINGLE,
                  size: 6,
                },
              },
            }));
            break;
          }
          case 'div':
          case 'section':
          case 'article':
            for (const child of element.childNodes) {
              processBlockNode(child);
            }
            break;
          default: {
            const textRuns: any[] = [];
            for (const child of element.childNodes) {
              processInlineNodes(child, textRuns);
            }
            if (textRuns.length > 0) {
              paragraphs.push(new docx.Paragraph({ children: textRuns }));
            }
          }
        }
      }
    }

    for (const child of body.childNodes) {
      processBlockNode(child);
    }

    if (paragraphs.length === 0) {
      paragraphs.push(new docx.Paragraph({ text: decodeHtmlEntities(html) }));
    }
  } catch (error) {
    console.error('Failed to parse HTML for DOCX export:', error);
    paragraphs.push(new docx.Paragraph({ text: decodeHtmlEntities(html) }));
  }

  return paragraphs;
}

function resolveChapterScenes(chapter: ScriptChapterNodeData): SceneCard[] {
  return normalizeSceneCards(chapter.scenes, chapter.content)
    .slice()
    .sort((left, right) => left.order - right.order);
}

function htmlToPlainText(html: string): string {
  if (!html.trim()) {
    return '';
  }

  return decodeHtmlEntities(
    html
      .replace(/<hr\s*\/?>/gi, '\n---\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  ).trim();
}

function resolveChapterExportHtml(chapter: ScriptChapterNodeData): string {
  const sceneDrafts = resolveChapterScenes(chapter)
    .map((scene) => scene.draftHtml.trim())
    .filter((value) => value.length > 0);

  if (sceneDrafts.length > 0) {
    return sceneDrafts.join('<hr />');
  }

  return chapter.content;
}

function resolveChapterExportTextBlocks(chapter: ScriptChapterNodeData): string[] {
  const sceneBlocks = resolveChapterScenes(chapter).flatMap((scene) => {
    const draftText = htmlToPlainText(scene.draftHtml);
    if (!draftText && !scene.summary.trim()) {
      return [];
    }

    const lines: string[] = [];
    lines.push(`场景 ${scene.order + 1}: ${scene.title || '未命名场景'}`);
    if (scene.summary.trim()) {
      lines.push(scene.summary.trim());
    }
    if (draftText) {
      lines.push(draftText);
    }
    return [lines.join('\n')];
  });

  if (sceneBlocks.length > 0) {
    return sceneBlocks;
  }

  const legacyContent = htmlToPlainText(chapter.content);
  return legacyContent ? [legacyContent] : [];
}

export function extractScriptData(
  nodes: any[],
  _edges: unknown
): ScriptData {
  const root = nodes.find((n) => n.type === CANVAS_NODE_TYPES.scriptRoot);
  const chapters = nodes
    .filter((n) => n.type === CANVAS_NODE_TYPES.scriptChapter)
    .sort((a, b) => (a.data.chapterNumber || 0) - (b.data.chapterNumber || 0))
    .map((n) => ({ id: n.id, data: n.data }));
  const characters = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptCharacter).map((n) => n.data);
  const locations = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptLocation).map((n) => n.data);
  const items = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptItem).map((n) => n.data);
  const plotPoints = nodes.filter((n) => n.type === CANVAS_NODE_TYPES.scriptPlotPoint).map((n) => n.data);

  return {
    root: root?.data || null,
    chapters,
    characters,
    locations,
    items,
    plotPoints,
  };
}

function tracePath(
  startId: string,
  adjacency: Map<string, string[]>,
  validNodes: Set<string>
): string[] {
  const path: string[] = [startId];
  let current = startId;

  while (true) {
    const targets = adjacency.get(current) ?? [];
    if (targets.length !== 1) break;

    const next = targets[0];
    if (!validNodes.has(next) || path.includes(next)) break;

    path.push(next);
    current = next;
  }

  return path;
}

export function detectBranches(
  chapters: ChapterWithId[],
  edges: unknown
): BranchInfo[] {
  if (!chapters || chapters.length === 0) {
    return [{
      id: 'main',
      name: '主分支',
      startChapter: 1,
      endChapter: 1,
      path: ['1'],
      nodeIds: [],
      isMainBranch: true,
    }];
  }

  const typedEdges = (edges as Edge[]).filter(
    (e) => e.source && e.target
  );

  const nodeIdSet = new Set(chapters.map((c) => c.id));

  const adjacency = new Map<string, string[]>();
  for (const edge of typedEdges) {
    if (nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target)) {
      const targets = adjacency.get(edge.source) ?? [];
      targets.push(edge.target);
      adjacency.set(edge.source, targets);
    }
  }

  const branchPoints = new Set<string>();
  for (const chapter of chapters) {
    const targets = adjacency.get(chapter.id) ?? [];
    if (targets.length > 1 || chapter.data.branchType === 'branch') {
      branchPoints.add(chapter.id);
    }
  }

  const visitedNodes = new Set<string>();
  const branches: BranchInfo[] = [];

  const chapterNumberById = new Map(chapters.map((c) => [c.id, c.data.chapterNumber]));

  const mainPathNodeIds: string[] = [];
  for (const chapter of chapters) {
    if (!branchPoints.has(chapter.id) && !visitedNodes.has(chapter.id)) {
      mainPathNodeIds.push(chapter.id);
      visitedNodes.add(chapter.id);
    }
    if (branchPoints.has(chapter.id)) {
      mainPathNodeIds.push(chapter.id);
      visitedNodes.add(chapter.id);
      break;
    }
  }

  if (mainPathNodeIds.length > 0) {
    const startChapter = chapterNumberById.get(mainPathNodeIds[0]) ?? 1;
    const endChapter = chapterNumberById.get(mainPathNodeIds[mainPathNodeIds.length - 1]) ?? chapters.length;
    branches.push({
      id: 'main',
      name: '主分支',
      startChapter,
      endChapter,
      path: mainPathNodeIds.map((id) => String(chapterNumberById.get(id) ?? 0)),
      nodeIds: mainPathNodeIds,
      isMainBranch: true,
    });
  }

  for (const branchPointId of branchPoints) {
    const targets = adjacency.get(branchPointId) ?? [];
    const branchPointChapter = chapterNumberById.get(branchPointId) ?? 0;

    for (let i = 0; i < targets.length; i++) {
      const targetId = targets[i];
      if (visitedNodes.has(targetId)) continue;

      const pathNodeIds = tracePath(targetId, adjacency, nodeIdSet);
      pathNodeIds.forEach((id) => visitedNodes.add(id));

      const branchLabel = `分支 ${String.fromCharCode(65 + branches.filter((b) => !b.isMainBranch).length)}`;

      branches.push({
        id: `branch-${branchPointId}-${i}`,
        name: branchLabel,
        startChapter: chapterNumberById.get(targetId) ?? branchPointChapter + 1,
        endChapter: chapterNumberById.get(pathNodeIds[pathNodeIds.length - 1]) ?? chapters.length,
        path: pathNodeIds.map((id) => String(chapterNumberById.get(id) ?? 0)),
        nodeIds: pathNodeIds,
        isMainBranch: false,
      });
    }
  }

  if (branches.length === 0) {
    branches.push({
      id: 'main',
      name: '主分支',
      startChapter: 1,
      endChapter: chapters.length,
      path: chapters.map((c) => String(c.data.chapterNumber)),
      nodeIds: chapters.map((c) => c.id),
      isMainBranch: true,
    });
  }

  return branches;
}

export async function exportScript(
  nodes: any[],
  edges: unknown[],
  options: ExportOptions
): Promise<boolean> {
  const scriptData = extractScriptData(nodes, edges);
  const branches = detectBranches(scriptData.chapters, edges);
  
  const selectedBranches = options.branchIds 
    ? branches.filter((b) => options.branchIds?.includes(b.id))
    : branches.filter((b) => b.isMainBranch);

  const title = scriptData.root?.title || '未命名剧本';
  let defaultPath = title;
  
  switch (options.format) {
    case 'txt':
      defaultPath = `${title}.txt`;
      break;
    case 'docx':
      defaultPath = `${title}.docx`;
      break;
    case 'json':
      defaultPath = `${title}.json`;
      break;
    case 'markdown':
      defaultPath = `${title}.md`;
      break;
  }

  const filePath = await save({
    defaultPath,
    filters: [
      { name: 'Word 文档', extensions: ['docx'] },
      { name: '文本文件', extensions: ['txt'] },
      { name: 'JSON', extensions: ['json'] },
      { name: 'Markdown', extensions: ['md'] },
    ],
  });

  if (!filePath) {
    return false;
  }

  switch (options.format) {
    case 'txt':
      return exportAsTxt(scriptData, selectedBranches, filePath);
    case 'docx':
      return exportAsDocx(scriptData, selectedBranches, filePath);
    case 'json':
      return exportAsJson(scriptData, selectedBranches, filePath);
    case 'markdown':
      return exportAsMarkdown(scriptData, selectedBranches, filePath);
    default:
      return false;
  }
}

async function exportAsTxt(data: ScriptData, branches: BranchInfo[], filePath: string): Promise<boolean> {
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
    const branchChapters = data.chapters.filter((c) => 
      branch.nodeIds.includes(c.id)
    );
    if (!branch.isMainBranch) {
      lines.push(`[${branch.name}]`);
    }
    branchChapters.forEach((chapter) => {
      lines.push(`第${chapter.data.chapterNumber}章: ${chapter.data.title || '未命名'}`);
      if (chapter.data.summary) {
        lines.push(`  摘要: ${chapter.data.summary.slice(0, 100)}`);
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
    const branchChapters = data.chapters.filter((c) => 
      branch.nodeIds.includes(c.id)
    );
    
    if (!branch.isMainBranch) {
      lines.push('');
      lines.push(`======================= ${branch.name} =======================`);
    }

    branchChapters.forEach((chapter) => {
      lines.push('');
      lines.push(`第${chapter.data.chapterNumber}章 ${chapter.data.title || '未命名'}`);
      lines.push('──────────────────────────────────────');
      lines.push('');
      if (chapter.data.sceneHeadings?.length) {
        chapter.data.sceneHeadings.forEach((heading) => {
          lines.push(heading);
          lines.push('');
        });
      }
      resolveChapterExportTextBlocks(chapter.data).forEach((block) => {
        lines.push(block);
        lines.push('');
      });
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

  const content = lines.join('\n');
  
  try {
    await invoke('save_text_file', { path: filePath, content });
    return true;
  } catch (error) {
    console.error('Failed to save TXT file:', error);
    return false;
  }
}

async function exportAsDocx(data: ScriptData, branches: BranchInfo[], filePath: string): Promise<boolean> {
  const docx = await import('docx');
  const title = data.root?.title || '未命名剧本';
  const docChildren: any[] = [];

  docChildren.push(
    new docx.Paragraph({
      text: title,
      heading: docx.HeadingLevel.TITLE,
      alignment: docx.AlignmentType.CENTER,
    })
  );

  if (data.root?.genre) {
    docChildren.push(
      new docx.Paragraph({
        text: `类型: ${data.root.genre}`,
        alignment: docx.AlignmentType.CENTER,
      })
    );
  }

  docChildren.push(new docx.Paragraph({ text: '' }));

  if (data.characters.length > 0) {
    docChildren.push(
      new docx.Paragraph({
        text: '角色档案',
        heading: docx.HeadingLevel.HEADING_1,
      })
    );

    data.characters.forEach((char) => {
      docChildren.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: char.name, bold: true })],
        })
      );
      if (char.description) {
        docChildren.push(new docx.Paragraph({ text: char.description }));
      }
      if (char.personality) {
        docChildren.push(new docx.Paragraph({ text: `性格: ${char.personality}` }));
      }
      if (char.appearance) {
        docChildren.push(new docx.Paragraph({ text: `外貌: ${char.appearance}` }));
      }
      docChildren.push(new docx.Paragraph({ text: '' }));
    });
  }

  if (data.locations.length > 0) {
    docChildren.push(
      new docx.Paragraph({
        text: '场景地点',
        heading: docx.HeadingLevel.HEADING_1,
      })
    );

    data.locations.forEach((loc) => {
      docChildren.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: loc.name, bold: true })],
        })
      );
      if (loc.description) {
        docChildren.push(new docx.Paragraph({ text: loc.description }));
      }
      docChildren.push(new docx.Paragraph({ text: '' }));
    });
  }

  if (data.items.length > 0) {
    docChildren.push(
      new docx.Paragraph({
        text: '关键道具',
        heading: docx.HeadingLevel.HEADING_1,
      })
    );

    data.items.forEach((item) => {
      docChildren.push(
        new docx.Paragraph({
          children: [new docx.TextRun({ text: item.name, bold: true })],
        })
      );
      if (item.description) {
        docChildren.push(new docx.Paragraph({ text: item.description }));
      }
      docChildren.push(new docx.Paragraph({ text: '' }));
    });
  }

  docChildren.push(
    new docx.Paragraph({
      text: '正文',
      heading: docx.HeadingLevel.HEADING_1,
    })
  );

  branches.forEach((branch) => {
    const branchChapters = data.chapters.filter((c) => 
      branch.nodeIds.includes(c.id)
    );

    if (!branch.isMainBranch) {
      docChildren.push(
        new docx.Paragraph({
          text: branch.name,
          heading: docx.HeadingLevel.HEADING_2,
        })
      );
    }

    branchChapters.forEach((chapter) => {
      docChildren.push(
        new docx.Paragraph({
          text: `第${chapter.data.chapterNumber}章 ${chapter.data.title || '未命名'}`,
          heading: docx.HeadingLevel.HEADING_3,
        })
      );

      if (chapter.data.sceneHeadings?.length) {
        chapter.data.sceneHeadings.forEach((heading) => {
          docChildren.push(new docx.Paragraph({ text: heading }));
        });
      }

      const chapterHtmlContent = resolveChapterExportHtml(chapter.data);
      if (chapterHtmlContent) {
        const contentParagraphs = parseHtmlToDocxParagraphs(chapterHtmlContent, docx);
        docChildren.push(...contentParagraphs);
      }

      docChildren.push(new docx.Paragraph({ text: '' }));
    });
  });

  const doc = new docx.Document({
    sections: [{
      properties: {},
      children: docChildren,
    }],
  });

  try {
    const blob = await docx.Packer.toBlob(doc);
    const buffer = await blob.arrayBuffer();
    await invoke('save_binary_file', { path: filePath, content: Array.from(new Uint8Array(buffer)) });
    return true;
  } catch (error) {
    console.error('Failed to save DOCX file:', error);
    return false;
  }
}

async function exportAsJson(data: ScriptData, branches: BranchInfo[], filePath: string): Promise<boolean> {
  const title = data.root?.title || '未命名剧本';
  
  const exportData = {
    title,
    genre: data.root?.genre || '',
    totalChapters: data.chapters.length,
    branches: branches.map((branch) => ({
      name: branch.name,
      isMain: branch.isMainBranch,
      chapters: data.chapters.filter((c) => branch.nodeIds.includes(c.id)).map((c) => ({
        chapterNumber: c.data.chapterNumber,
        title: c.data.title,
        summary: c.data.summary,
        content: resolveChapterExportHtml(c.data),
        scenes: resolveChapterScenes(c.data),
        sceneHeadings: c.data.sceneHeadings,
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

  const content = JSON.stringify(exportData, null, 2);
  
  try {
    await invoke('save_text_file', { path: filePath, content });
    return true;
  } catch (error) {
    console.error('Failed to save JSON file:', error);
    return false;
  }
}

async function exportAsMarkdown(data: ScriptData, branches: BranchInfo[], filePath: string): Promise<boolean> {
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
    const branchChapters = data.chapters.filter((c) => 
      branch.nodeIds.includes(c.id)
    );

    if (!branch.isMainBranch) {
      lines.push(`### ${branch.name}`);
      lines.push('');
    }

    branchChapters.forEach((chapter) => {
      lines.push(`### 第${chapter.data.chapterNumber}章 ${chapter.data.title || '未命名'}`);
      lines.push('');

      if (chapter.data.sceneHeadings?.length) {
        chapter.data.sceneHeadings.forEach((heading) => {
          lines.push(`\`\`\`\n${heading}\n\`\`\``);
          lines.push('');
        });
      }

      resolveChapterExportTextBlocks(chapter.data).forEach((block) => {
        lines.push(block);
        lines.push('');
      });

      if (chapter.data.summary) {
        lines.push(`> 摘要: ${chapter.data.summary}`);
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

  const content = lines.join('\n');
  
  try {
    await invoke('save_text_file', { path: filePath, content });
    return true;
  } catch (error) {
    console.error('Failed to save Markdown file:', error);
    return false;
  }
}
