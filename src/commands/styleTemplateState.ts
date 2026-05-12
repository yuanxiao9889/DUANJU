import { invoke, isTauri } from '@tauri-apps/api/core';

export interface StyleTemplateStateRecord {
  categoriesJson: string;
  templatesJson: string;
  updatedAt: number;
}

export interface SaveStyleTemplateStatePayload {
  categoriesJson: string;
  templatesJson: string;
}

export async function getStyleTemplateState(): Promise<StyleTemplateStateRecord | null> {
  if (!isTauri()) {
    return null;
  }

  return await invoke<StyleTemplateStateRecord>('get_style_template_state');
}

export async function saveStyleTemplateState(
  payload: SaveStyleTemplateStatePayload
): Promise<StyleTemplateStateRecord | null> {
  if (!isTauri()) {
    return null;
  }

  return await invoke<StyleTemplateStateRecord>('save_style_template_state', {
    payload,
  });
}
