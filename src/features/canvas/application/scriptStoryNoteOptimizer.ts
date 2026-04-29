import { generateText } from '@/commands/textGen';

import { clampScriptStoryNoteContent } from './scriptStoryNotes';

function buildStoryNoteOptimizationPrompt(content: string): string {
  return [
    'You are a story development editor preparing reusable reference notes for future drafting.',
    'Refine the note so it becomes clearer, tighter, and easier to reuse across later story generation.',
    'Keep the original language.',
    'Do not invent new irreversible plot facts, backstory, relationships, or world rules.',
    'You may reorganize, deduplicate, compress, and clarify the existing material.',
    'Prefer durable setting, character, tone, conflict, and continuity cues over rhetorical flourish.',
    'Return plain text only. Do not return JSON, Markdown fences, headings, or explanation.',
    '',
    'Current story reference note:',
    content,
  ].join('\n');
}

export async function optimizeScriptStoryNoteContent(content: string): Promise<string> {
  const normalizedContent = clampScriptStoryNoteContent(content);
  if (!normalizedContent) {
    return '';
  }

  const result = await generateText({
    prompt: buildStoryNoteOptimizationPrompt(normalizedContent),
    temperature: 0.35,
    maxTokens: 1800,
  });

  return clampScriptStoryNoteContent(result.text) || normalizedContent;
}
