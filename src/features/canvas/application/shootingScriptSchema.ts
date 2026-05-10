import type { ShootingScriptColumnKey } from '@/features/canvas/domain/canvasNodes';

export interface ShootingScriptColumnDefinition {
  key: ShootingScriptColumnKey;
  labelKey: string;
  multiline?: boolean;
  widthPx?: number;
}

export const SHOOTING_SCRIPT_PRIMARY_COLUMNS: ShootingScriptColumnDefinition[] = [
  { key: 'shotNumber', labelKey: 'script.shootingScript.table.shotNumber', widthPx: 92 },
  { key: 'beat', labelKey: 'script.shootingScript.table.beat', multiline: true, widthPx: 160 },
  { key: 'action', labelKey: 'script.shootingScript.table.action', multiline: true, widthPx: 300 },
  { key: 'composition', labelKey: 'script.shootingScript.table.composition', multiline: true, widthPx: 160 },
  { key: 'camera', labelKey: 'script.shootingScript.table.camera', multiline: true, widthPx: 160 },
  { key: 'duration', labelKey: 'script.shootingScript.table.duration', widthPx: 112 },
  { key: 'audio', labelKey: 'script.shootingScript.table.audio', multiline: true, widthPx: 190 },
  { key: 'genTarget', labelKey: 'script.shootingScript.table.genTarget', widthPx: 104 },
  { key: 'genPrompt', labelKey: 'script.shootingScript.table.genPrompt', multiline: true, widthPx: 250 },
];

export const SHOOTING_SCRIPT_DETAIL_COLUMNS: ShootingScriptColumnDefinition[] = [
  { key: 'blocking', labelKey: 'script.shootingScript.detail.blocking', multiline: true },
  { key: 'artLighting', labelKey: 'script.shootingScript.detail.artLighting', multiline: true },
  { key: 'continuityNote', labelKey: 'script.shootingScript.detail.continuityNote', multiline: true },
  { key: 'directorIntent', labelKey: 'script.shootingScript.detail.directorIntent', multiline: true },
  { key: 'status', labelKey: 'script.shootingScript.detail.status' },
];
