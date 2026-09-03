import type { BrowserFontStackResolution } from '../definitions/browserFontStack.js';

const LATIN_FALLBACKS = [
  'Helvetica Neue',
  'Helvetica',
  'Arial',
  'sans-serif',
] as const;

const CJK_FALLBACKS = [
  'PingFang SC',
  'Hiragino Sans GB',
  'Heiti SC',
  'Microsoft YaHei',
  'WenQuanYi Micro Hei',
  'sans-serif',
] as const;

const OFFICE_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  'Calibri Light': ['Calibri Light', 'Calibri', ...LATIN_FALLBACKS],
  Calibri: ['Calibri', ...LATIN_FALLBACKS],
  Arial: ['Arial', 'Helvetica Neue', 'Helvetica', 'sans-serif'],
  'Times New Roman': ['Times New Roman', 'Times', 'Georgia', 'serif'],
};

export function resolveBrowserFontStack(
  requestedFamily?: string,
  sampleText?: string,
): BrowserFontStackResolution {
  const normalizedRequestedFamily = normalizeRequestedFamily(requestedFamily);
  const requestedFamilies = normalizedRequestedFamily
    ? splitFontFamilies(normalizedRequestedFamily)
    : [];
  const requestedPrimaryFamily = requestedFamilies[0];
  const fallbackFamilies = uniqueFamilies([
    ...requestedFamilies,
    ...(requestedPrimaryFamily
      ? OFFICE_FALLBACKS[requestedPrimaryFamily] ?? [requestedPrimaryFamily]
      : []),
    ...(containsCjk(sampleText) ? CJK_FALLBACKS : LATIN_FALLBACKS),
  ]);
  const primaryFamily = fallbackFamilies[0] ?? 'sans-serif';
  return {
    ...(normalizedRequestedFamily ? { requestedFamily: normalizedRequestedFamily } : {}),
    ...(requestedPrimaryFamily ? { requestedPrimaryFamily } : {}),
    primaryFamily,
    resolvedFamily: formatCssFontFamilyStack(fallbackFamilies),
    fallbackFamilies,
  };
}

export function formatCssFontFamilyStack(families: readonly string[]): string {
  return families.map(quoteFamily).join(', ');
}

function normalizeRequestedFamily(requestedFamily?: string): string | undefined {
  const trimmed = requestedFamily?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function splitFontFamilies(fontFamily: string): string[] {
  return fontFamily
    .split(',')
    .map(family => stripQuotes(family.trim()))
    .filter(Boolean);
}

function stripQuotes(fontFamily: string): string {
  return fontFamily.replace(/^['"]|['"]$/gu, '');
}

function uniqueFamilies(families: readonly string[]): string[] {
  const unique = Array.from(new Set(families.filter(Boolean)));
  return [
    ...unique.filter(family => !isGenericFamily(family)),
    ...unique.filter(isGenericFamily),
  ];
}

function quoteFamily(family: string): string {
  return family.includes(' ') ? `"${family}"` : family;
}

function containsCjk(sampleText?: string): boolean {
  return sampleText != null && /[\u3400-\u9FFF\uF900-\uFAFF]/u.test(sampleText);
}

function isGenericFamily(family: string): boolean {
  return family === 'sans-serif' || family === 'serif' || family === 'monospace';
}
