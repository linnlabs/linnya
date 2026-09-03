import { describe, expect, it } from 'vitest';
import { resolveLocalizedText } from './resolveLocalizedText';
import type { LinnyaLocale } from '../definitions/locale';

const messages: Readonly<Record<LinnyaLocale, Readonly<Record<string, string>>>> = {
  'zh-CN': {
    greeting: '你好，{name}',
  },
  'en-US': {
    greeting: 'Hello, {name}',
  },
};

function resolveMessage(locale: LinnyaLocale, key: string): string | null {
  return messages[locale][key] ?? null;
}

describe('resolveLocalizedText', () => {
  it('returns plain string text directly', () => {
    expect(resolveLocalizedText('保存', {
      locale: 'en-US',
      fallbackLocale: 'zh-CN',
      resolveMessage,
    })).toBe('保存');
  });

  it('resolves localized message with params', () => {
    expect(resolveLocalizedText({
      key: 'greeting',
      fallback: 'Hi, {name}',
      params: { name: 'Linnya' },
    }, {
      locale: 'en-US',
      fallbackLocale: 'zh-CN',
      resolveMessage,
    })).toBe('Hello, Linnya');
  });

  it('falls back to fallback locale before text fallback', () => {
    expect(resolveLocalizedText({
      key: 'greeting',
      fallback: 'Hi, {name}',
      params: { name: '林芽' },
    }, {
      locale: 'en-US',
      fallbackLocale: 'zh-CN',
      resolveMessage: (locale, key) => (locale === 'zh-CN' ? resolveMessage(locale, key) : null),
    })).toBe('你好，林芽');
  });
});
