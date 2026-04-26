import type { ProjectRecord } from '@/commands/projectState';
import type { AdScriptTableRow } from '@/features/ad/types';
import {
  CANVAS_NODE_TYPES,
  normalizeAdProjectRootNodeData,
  type AdProjectRootNodeData,
  type AdScriptReferenceRowSnapshot,
  type AdScriptReferenceSnapshot,
  type CanvasNode,
} from '@/features/canvas/domain/canvasNodes';

interface PersistedNodesPayload {
  nodes?: CanvasNode[];
}

export interface LinkedAdProjectReference {
  projectName: string;
  templateId: AdScriptReferenceSnapshot['templateId'];
  brief: AdScriptReferenceSnapshot['brief'];
  rows: AdScriptTableRow[];
  lastGeneratedAt: number | null;
}

function parsePersistedNodesPayload(value: string): CanvasNode[] {
  try {
    const parsed = JSON.parse(value) as CanvasNode[] | PersistedNodesPayload;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  } catch {
    return [];
  }
}

function toRowSnapshot(row: AdScriptTableRow): AdScriptReferenceRowSnapshot {
  return {
    id: row.id,
    shotNumber: row.shotNumber,
    duration: row.duration,
    objective: row.objective,
    visual: row.visual,
    dialogueOrVO: row.dialogueOrVO,
    camera: row.camera,
    audio: row.audio,
    productFocus: row.productFocus,
    sellingPoint: row.sellingPoint,
    cta: row.cta,
    assetHint: row.assetHint,
    directorIntent: row.directorIntent,
    status: row.status,
  };
}

export function extractLinkedAdProjectReference(
  record: ProjectRecord
): LinkedAdProjectReference | null {
  const nodes = parsePersistedNodesPayload(record.nodesJson);
  const rootNode = nodes.find((node) => node.type === CANVAS_NODE_TYPES.adProjectRoot);
  if (!rootNode) {
    return null;
  }

  const data = normalizeAdProjectRootNodeData(rootNode.data as AdProjectRootNodeData);
  return {
    projectName: record.name,
    templateId: data.selectedAdTemplateId,
    brief: data.brief,
    rows: data.rows,
    lastGeneratedAt: data.lastGeneratedAt,
  };
}

export function buildAdScriptReferenceSnapshot(
  reference: Pick<LinkedAdProjectReference, 'templateId' | 'brief' | 'rows' | 'lastGeneratedAt'>
): AdScriptReferenceSnapshot {
  return {
    templateId: reference.templateId,
    brief: reference.brief,
    lastGeneratedAt: reference.lastGeneratedAt,
    rows: reference.rows.map(toRowSnapshot),
  };
}
