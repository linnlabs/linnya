import type { LinnyaLocale } from '../definitions/locale';
import type { LocalizedText } from '../definitions/localizedText';
import { interpolateMessage } from './interpolateMessage';

export interface ResolveLocalizedTextOptions {
  readonly locale: LinnyaLocale;
  readonly fallbackLocale: LinnyaLocale;
  readonly resolveMessage: (locale: LinnyaLocale, key: string) => string | null;
}

export function resolveLocalizedText(
  text: LocalizedText,
  options: ResolveLocalizedTextOptions,
): string {
  if (typeof text === 'string') {
    return text;
  }

  const localizedTemplate =
    options.resolveMessage(options.locale, text.key)
    ?? (options.locale === options.fallbackLocale
      ? null
      : options.resolveMessage(options.fallbackLocale, text.key))
    ?? text.fallback;

  return interpolateMessage(localizedTemplate, text.params);
}
