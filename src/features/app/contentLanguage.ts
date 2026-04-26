export type UserContentLanguage = 'zh-Hans' | 'en';

const HAN_CHAR_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD_PATTERN = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;

function collectStrings(value: unknown, target: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      target.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, target));
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, target));
  }
}

export function detectUserContentLanguage(
  values: unknown[],
  fallback: UserContentLanguage = 'zh-Hans'
): UserContentLanguage {
  const texts: string[] = [];
  values.forEach((value) => collectStrings(value, texts));

  let hanScore = 0;
  let latinWordScore = 0;

  texts.forEach((text) => {
    hanScore += text.match(HAN_CHAR_PATTERN)?.length ?? 0;
    latinWordScore += text.match(LATIN_WORD_PATTERN)?.length ?? 0;
  });

  if (hanScore === 0 && latinWordScore === 0) {
    return fallback;
  }

  if (hanScore > 0 && latinWordScore === 0) {
    return 'zh-Hans';
  }

  if (latinWordScore > 0 && hanScore === 0) {
    return 'en';
  }

  if (hanScore > 0 && hanScore >= latinWordScore * 0.5) {
    return 'zh-Hans';
  }

  if (latinWordScore > hanScore * 2) {
    return 'en';
  }

  return fallback;
}

export function buildUserFacingLanguageInstruction(
  language: UserContentLanguage,
  mode: 'general' | 'markdown' | 'json-values' = 'general'
): string {
  if (mode === 'json-values') {
    return language === 'zh-Hans'
      ? 'All user-facing JSON values must be written in Simplified Chinese. Keep JSON keys, enum tokens, code ids, and any explicitly required schema literals unchanged.'
      : 'All user-facing JSON values must be written in English. Keep JSON keys, enum tokens, code ids, and any explicitly required schema literals unchanged.';
  }

  if (mode === 'markdown') {
    return language === 'zh-Hans'
      ? 'Write all user-facing prose in Simplified Chinese unless a proper noun or brand name must stay in its original form.'
      : 'Write all user-facing prose in English unless a proper noun or brand name must stay in its original form.';
  }

  return language === 'zh-Hans'
    ? 'Write all user-facing content in Simplified Chinese unless a proper noun or brand name must stay in its original form.'
    : 'Write all user-facing content in English unless a proper noun or brand name must stay in its original form.';
}
