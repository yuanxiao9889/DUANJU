function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function applyStyleTemplatePrompt(
  currentPrompt: string,
  _previousTemplatePrompt: string,
  nextTemplatePrompt: string,
): string {
  const normalizedCurrentPrompt = currentPrompt.trim();
  const normalizedNextTemplate = nextTemplatePrompt.trim();

  if (!normalizedNextTemplate) {
    return normalizedCurrentPrompt;
  }

  if (
    normalizedCurrentPrompt &&
    new RegExp(`(?:^|,\\s*)${escapeRegExp(normalizedNextTemplate)}\\s*$`).test(
      normalizedCurrentPrompt,
    )
  ) {
    return normalizedCurrentPrompt;
  }

  return normalizedCurrentPrompt
    ? `${normalizedCurrentPrompt}, ${normalizedNextTemplate}`
    : normalizedNextTemplate;
}
