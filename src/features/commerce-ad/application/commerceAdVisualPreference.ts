import { normalizeCommerceAdVisualPreferenceState, type CommerceAdVisualPreferenceState } from '@/features/commerce-ad/types';

export const VISUAL_PREFERENCE_OPTION_KEYS = {
  designStyle: [
    'auto',
    'minimalist',
    'premium_luxury',
    'luxury_minimal',
    'natural_organic',
    'warm_cozy',
    'soft_editorial_lifestyle',
    'tech_modern',
    'dynamic_vitality',
    'professional_clean',
    'clean_beauty_commercial',
    'editorial_magazine',
    'bold_graphic_poster',
    'fashion_campaign',
    'cute_playful',
    'retro_trendy',
    'industrial_precision',
  ],
  colorPalette: [
    'auto_extract',
    'light_bright',
    'dark_moody',
    'warm_tones',
    'cool_tones',
    'high_contrast',
    'soft_muted',
    'cream_beige',
    'black_gold',
    'silver_gray',
  ],
  platformVisual: [
    'general',
    'taobao',
    'jd',
    'amazon',
    'xiaohongshu',
    'tiktok',
    'pinduoduo',
    'shopify',
  ],
  language: ['zhCN', 'zhTW', 'enUS', 'jaJP', 'koKR', 'deDE', 'frFR', 'ruRU', 'esES', 'arSA'],
} as const;

export const BRAND_ACCENT_PRESETS = [
  { key: 'red', color: '#EF4444' },
  { key: 'orange', color: '#F97316' },
  { key: 'gold', color: '#F59E0B' },
  { key: 'blue', color: '#3B82F6' },
  { key: 'green', color: '#10B981' },
  { key: 'purple', color: '#8B5CF6' },
  { key: 'pink', color: '#EC4899' },
  { key: 'black', color: '#111827' },
] as const;

export function normalizeBrandAccentInput(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.toLowerCase() === 'auto') {
    return 'auto';
  }

  const preset = BRAND_ACCENT_PRESETS.find((item) => item.color.toLowerCase() === normalized.toLowerCase());
  if (preset) {
    return preset.color;
  }

  return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : normalized;
}

export function composeVisualPreferenceSummary(preference: CommerceAdVisualPreferenceState): string {
  const accent = preference.brandAccentColor.toLowerCase() === 'auto'
    ? '品牌强调色自动提取'
    : `品牌强调色 ${preference.brandAccentColor}`;
  return [
    preference.designStyle,
    preference.colorPalette,
    preference.platformVisual,
    preference.language,
    accent,
  ].filter(Boolean).join(' / ');
}

export function composeVisualPreferencePromptFragment(preference: CommerceAdVisualPreferenceState): string {
  const accent = preference.brandAccentColor.toLowerCase() === 'auto'
    ? '品牌强调色自动从商品主色或品牌识别中提取'
    : `品牌强调色使用 ${preference.brandAccentColor}`;
  return `视觉与排版偏好：设计风格为${preference.designStyle}，整体配色为${preference.colorPalette}，平台视觉偏好为${preference.platformVisual}，画面语言为${preference.language}，${accent}。`;
}

export function buildVisualPreferencePatch(
  preference: CommerceAdVisualPreferenceState
): CommerceAdVisualPreferenceState {
  const normalized = normalizeCommerceAdVisualPreferenceState({
    ...preference,
    brandAccentColor: normalizeBrandAccentInput(preference.brandAccentColor),
    updatedAt: Date.now(),
  });
  return {
    ...normalized,
    summary: composeVisualPreferenceSummary(normalized),
    promptFragment: composeVisualPreferencePromptFragment(normalized),
    updatedAt: Date.now(),
  };
}
