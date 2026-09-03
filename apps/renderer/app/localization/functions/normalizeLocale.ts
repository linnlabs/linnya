import {
  DEFAULT_LINNYA_LOCALE,
  isLinnyaLocale,
  type LinnyaLocale,
} from '../definitions/locale';

const NORMALIZED_LOCALE_MAP: Readonly<Record<string, LinnyaLocale>> = {
  zh: 'zh-CN',
  zhcn: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-hans': 'zh-CN',
  en: 'en-US',
  enus: 'en-US',
  'en-us': 'en-US',
};

export function normalizeLinnyaLocale(value: unknown): LinnyaLocale | null {
  if (isLinnyaLocale(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/_/g, '-').toLowerCase();
  return NORMALIZED_LOCALE_MAP[normalized] ?? null;
}

export function normalizeLinnyaLocaleOrDefault(value: unknown): LinnyaLocale {
  return normalizeLinnyaLocale(value) ?? DEFAULT_LINNYA_LOCALE;
}
