import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zh from './locales/zh.json';
import zhJimeng from './locales/zh-jimeng.json';
import en from './locales/en.json';

type TranslationValue = string | number | boolean | null | TranslationMap | TranslationValue[];
type TranslationMap = {
  [key: string]: TranslationValue;
};

function isTranslationMap(value: TranslationValue | undefined): value is TranslationMap {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object';
}

function mergeTranslations(base: TranslationMap, overrides: TranslationMap): TranslationMap {
  const merged: TranslationMap = {
    ...base,
  };

  Object.entries(overrides).forEach(([key, value]) => {
    const currentValue = merged[key];
    if (isTranslationMap(currentValue) && isTranslationMap(value)) {
      merged[key] = mergeTranslations(currentValue, value);
      return;
    }

    merged[key] = value;
  });

  return merged;
}

const resources = {
  zh: { translation: mergeTranslations(zh as TranslationMap, zhJimeng as TranslationMap) },
  en: { translation: en },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

export default i18n;
