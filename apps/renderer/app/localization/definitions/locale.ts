export const SUPPORTED_LINNYA_LOCALES = ['zh-CN', 'en-US'] as const;

export type LinnyaLocale = (typeof SUPPORTED_LINNYA_LOCALES)[number];

export const DEFAULT_LINNYA_LOCALE: LinnyaLocale = 'zh-CN';
export const FALLBACK_LINNYA_LOCALE: LinnyaLocale = 'zh-CN';

export function isLinnyaLocale(value: unknown): value is LinnyaLocale {
  return typeof value === 'string'
    && SUPPORTED_LINNYA_LOCALES.includes(value as LinnyaLocale);
}
