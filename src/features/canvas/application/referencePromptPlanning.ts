import type { AdBrief, AdScriptTableRow } from '@/features/ad/types';
import type {
  ReferenceTransferItem,
  ReferenceTransferPackage,
  ReferenceTransferTargetKind,
  ShootingScriptRow,
} from '@/features/canvas/domain/canvasNodes';

export interface ShootingScriptTransferContext {
  chapterTitle: string;
  sceneTitle: string;
  episodeTitle: string;
}

function normalizePromptText(value: string | null | undefined): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
    : '';
}

function normalizeCompareText(value: string): string {
  return normalizePromptText(value)
    .toLowerCase()
    .replace(/[\s,.;:!?"'`~\-_/\\|()[\]{}<>，。；：！？、]/g, '');
}

function isDuplicateLine(lines: string[], candidate: string): boolean {
  const normalizedCandidate = normalizeCompareText(candidate);
  if (!normalizedCandidate) {
    return true;
  }

  return lines.some((line) => {
    const normalizedLine = normalizeCompareText(line);
    return normalizedLine === normalizedCandidate
      || normalizedLine.includes(normalizedCandidate)
      || normalizedCandidate.includes(normalizedLine);
  });
}

function pushUniqueLine(lines: string[], line: string): void {
  const normalizedLine = normalizePromptText(line);
  if (!normalizedLine || isDuplicateLine(lines, normalizedLine)) {
    return;
  }
  lines.push(normalizedLine);
}

function pushLabeledLine(lines: string[], label: string, value: string | null | undefined): void {
  const normalizedValue = normalizePromptText(value);
  if (!normalizedValue) {
    return;
  }
  pushUniqueLine(lines, `${label}：${normalizedValue}`);
}

function isVisualDirectorIntent(value: string): boolean {
  const normalizedValue = normalizePromptText(value);
  if (!normalizedValue) {
    return false;
  }

  const nonVisualHints = ['cta', '卖点', '转化', '关注', '下单', '购买', '传播', '受众', '平台'];
  return !nonVisualHints.some((hint) => normalizedValue.toLowerCase().includes(hint));
}

function buildTransferItem(
  sourceRowId: string,
  shotNumber: string,
  title: string,
  summary: string | null,
  lines: string[],
): ReferenceTransferItem {
  const normalizedLines: string[] = [];
  lines.forEach((line) => pushUniqueLine(normalizedLines, line));

  return {
    sourceRowId,
    shotNumber: normalizePromptText(shotNumber),
    title: normalizePromptText(title) || '镜头',
    summary: normalizePromptText(summary) || null,
    lines: normalizedLines,
    renderedPrompt: normalizedLines.join('\n'),
  };
}

export function renderTransferPrompt(transferPackage: Omit<ReferenceTransferPackage, 'renderedPrompt'>): string {
  const sections: string[] = [];
  transferPackage.contextLines.forEach((line) => pushUniqueLine(sections, line));

  if (transferPackage.targetKind === 'video') {
    transferPackage.items.forEach((item) => {
      const body = item.lines.join('\n');
      if (!body) {
        return;
      }
      sections.push(`${item.title}：\n${body}`);
    });
  } else {
    transferPackage.items.forEach((item) => {
      item.lines.forEach((line) => pushUniqueLine(sections, line));
    });
  }

  transferPackage.closingLines.forEach((line) => pushUniqueLine(sections, line));
  return sections.join('\n');
}

function createTransferPackage(
  sourceKind: ReferenceTransferPackage['sourceKind'],
  sourceNodeId: string,
  targetKind: ReferenceTransferTargetKind,
  contextLines: string[],
  items: ReferenceTransferItem[],
  closingLines: string[],
): ReferenceTransferPackage {
  const packageWithoutPrompt = {
    sourceKind,
    sourceNodeId,
    targetKind,
    contextLines,
    items,
    closingLines,
  };

  return {
    ...packageWithoutPrompt,
    renderedPrompt: renderTransferPrompt(packageWithoutPrompt),
  };
}

function buildAdContextLines(
  _brief: AdBrief,
  targetKind: ReferenceTransferTargetKind
): string[] {
  if (targetKind === 'storyboard') {
    return [];
  }

  return [];
}

function buildAdClosingLines(_brief: AdBrief, _targetKind: ReferenceTransferTargetKind): string[] {
  return [];
}

function buildAdImageLines(row: AdScriptTableRow): string[] {
  const lines: string[] = [];
  const visual = normalizePromptText(row.visual);
  if (visual) {
    pushUniqueLine(lines, visual);
  }
  return lines;
}

function buildAdStoryboardLines(row: AdScriptTableRow): string[] {
  const lines: string[] = [];
  const visual = normalizePromptText(row.visual);
  if (visual) {
    pushUniqueLine(lines, visual);
  }
  return lines;
}

function buildAdVideoLines(row: AdScriptTableRow): string[] {
  const lines: string[] = [];
  pushUniqueLine(lines, normalizePromptText(row.duration));
  pushLabeledLine(lines, '镜头目标', row.objective);
  pushLabeledLine(lines, '画面内容', row.visual);
  pushLabeledLine(lines, '镜头调度', row.camera);
  pushLabeledLine(lines, '台词/旁白', row.dialogueOrVO);
  pushLabeledLine(lines, '声音设计', row.audio);
  pushLabeledLine(lines, '产品重点', row.productFocus);
  if (isVisualDirectorIntent(row.directorIntent)) {
    pushLabeledLine(lines, '导演意图', row.directorIntent);
  }
  return lines;
}

function buildAdItemLines(row: AdScriptTableRow, targetKind: ReferenceTransferTargetKind): string[] {
  if (targetKind === 'image') {
    return buildAdImageLines(row);
  }

  if (targetKind === 'storyboard') {
    return buildAdStoryboardLines(row);
  }

  return buildAdVideoLines(row);
}

export function buildAdScriptTransferPackage(
  sourceNodeId: string,
  brief: AdBrief,
  rows: AdScriptTableRow[],
  targetKind: ReferenceTransferTargetKind,
): ReferenceTransferPackage {
  const contextLines = buildAdContextLines(brief, targetKind);
  const items = rows.map((row, index) => buildTransferItem(
    row.id,
    row.shotNumber || String(index + 1),
    `镜头${row.shotNumber || index + 1}`,
    normalizePromptText(row.objective) || normalizePromptText(row.visual) || null,
    buildAdItemLines(row, targetKind),
  ));

  return createTransferPackage(
    'adScript',
    sourceNodeId,
    targetKind,
    contextLines,
    items,
    buildAdClosingLines(brief, targetKind),
  );
}

function buildShootingContextLines(
  _context: ShootingScriptTransferContext,
  _targetKind: ReferenceTransferTargetKind
): string[] {
  return [];
}

function buildShootingItemLines(
  row: ShootingScriptRow,
  targetKind: ReferenceTransferTargetKind
): string[] {
  const manualPrompt = normalizePromptText(row.genPrompt);
  const lines: string[] = [];
  if (targetKind === 'image') {
    if (manualPrompt) {
      pushUniqueLine(lines, manualPrompt);
      pushLabeledLine(lines, '灯光美术', row.artLighting);
      return lines;
    }

    pushLabeledLine(lines, '剧情点', row.beat);
    pushLabeledLine(lines, '动作表演', row.action);
    pushLabeledLine(lines, '景别构图', row.composition);
    pushLabeledLine(lines, '灯光美术', row.artLighting);
    pushLabeledLine(lines, '导演意图', row.directorIntent);
    return lines;
  }

  if (targetKind === 'storyboard') {
    pushLabeledLine(lines, '剧情点', row.beat);
    pushLabeledLine(lines, '动作表演', row.action);
    pushLabeledLine(lines, '景别构图', row.composition);
    pushLabeledLine(lines, '机位运镜', row.camera);
    pushLabeledLine(lines, '调度走位', row.blocking);
    return lines;
  }

  if (manualPrompt) {
    pushUniqueLine(lines, manualPrompt);
    pushLabeledLine(lines, '动作表演', row.action);
    pushLabeledLine(lines, '景别', row.composition);
    pushLabeledLine(lines, '对白', row.audio);
    pushLabeledLine(lines, '调度', row.blocking);
    pushLabeledLine(lines, '灯光', row.artLighting);
    pushLabeledLine(lines, '节奏', row.duration);
    return lines;
  }

  pushLabeledLine(lines, '动作表演', row.action);
  pushLabeledLine(lines, '景别', row.composition);
  pushLabeledLine(lines, '对白', row.audio);
  pushLabeledLine(lines, '调度', row.blocking);
  pushLabeledLine(lines, '灯光', row.artLighting);
  pushLabeledLine(lines, '节奏', row.duration);
  return lines;
}

export function buildShootingScriptTransferPackage(
  sourceNodeId: string,
  context: ShootingScriptTransferContext,
  rows: ShootingScriptRow[],
  targetKind: ReferenceTransferTargetKind,
): ReferenceTransferPackage {
  const items = rows.map((row, index) => buildTransferItem(
    row.id,
    row.shotNumber || String(index + 1),
    `镜头${row.shotNumber || index + 1}`,
    normalizePromptText(row.beat) || normalizePromptText(row.action) || null,
    buildShootingItemLines(row, targetKind),
  ));

  return createTransferPackage(
    'shootingScript',
    sourceNodeId,
    targetKind,
    buildShootingContextLines(context, targetKind),
    items,
    [],
  );
}
