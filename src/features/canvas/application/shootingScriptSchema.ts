import type { ShootingScriptColumnKey } from '@/features/canvas/domain/canvasNodes';

export interface ShootingScriptColumnDefinition {
  key: ShootingScriptColumnKey;
  labelKey: string;
  multiline?: boolean;
  widthClassName?: string;
}

export const SHOOTING_SCRIPT_PRIMARY_COLUMNS: ShootingScriptColumnDefinition[] = [
  { key: 'shotNumber', labelKey: 'script.shootingScript.table.shotNumber', widthClassName: 'w-[126px]' },
  { key: 'beat', labelKey: 'script.shootingScript.table.beat', multiline: true, widthClassName: 'w-[220px]' },
  { key: 'action', labelKey: 'script.shootingScript.table.action', multiline: true, widthClassName: 'w-[430px]' },
  { key: 'composition', labelKey: 'script.shootingScript.table.composition', multiline: true, widthClassName: 'w-[220px]' },
  { key: 'camera', labelKey: 'script.shootingScript.table.camera', multiline: true, widthClassName: 'w-[220px]' },
  { key: 'duration', labelKey: 'script.shootingScript.table.duration', widthClassName: 'w-[148px]' },
  { key: 'audio', labelKey: 'script.shootingScript.table.audio', multiline: true, widthClassName: 'w-[230px]' },
  { key: 'genTarget', labelKey: 'script.shootingScript.table.genTarget', widthClassName: 'w-[138px]' },
  { key: 'genPrompt', labelKey: 'script.shootingScript.table.genPrompt', multiline: true, widthClassName: 'w-[420px]' },
];

export const SHOOTING_SCRIPT_DETAIL_COLUMNS: ShootingScriptColumnDefinition[] = [
  { key: 'blocking', labelKey: 'script.shootingScript.detail.blocking', multiline: true },
  { key: 'artLighting', labelKey: 'script.shootingScript.detail.artLighting', multiline: true },
  { key: 'continuityNote', labelKey: 'script.shootingScript.detail.continuityNote', multiline: true },
  { key: 'directorIntent', labelKey: 'script.shootingScript.detail.directorIntent', multiline: true },
  { key: 'status', labelKey: 'script.shootingScript.detail.status' },
];
