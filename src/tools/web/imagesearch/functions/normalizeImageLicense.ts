import type { ImageLicense, ImageLicenseCode } from '@app/schemas';

const CC_CODES: Readonly<Record<string, ImageLicenseCode>> = {
  'by': 'by', 'by-sa': 'by-sa', 'by-nd': 'by-nd', 'by-nc': 'by-nc', 'by-nc-sa': 'by-nc-sa', 'by-nc-nd': 'by-nc-nd',
  'cc0': 'cc0', 'pdm': 'pdm',
};

function codeFromUrl(url: string | undefined): ImageLicenseCode | undefined {
  if (!url) return undefined;
  const match = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)/i.exec(url);
  if (!match) return undefined;
  if (match[1]!.toLowerCase() === 'publicdomain') {
    return match[2]!.toLowerCase() === 'zero' ? 'cc0' : match[2]!.toLowerCase() === 'mark' ? 'pdm' : undefined;
  }
  return CC_CODES[match[2]!.toLowerCase()];
}

/** 从 "CC BY-SA 3.0"、"CC0"、"Public domain" 这类名称读出许可代码；读不出的算 other。 */
function codeFromName(name: string): ImageLicenseCode | undefined {
  const lower = name.toLowerCase();
  if (/\bcc0\b|cc-zero|public\s+domain\s+dedication/.test(lower)) return 'cc0';
  const cc = /\bcc[\s-]*by((?:[\s-]*(?:nc|sa|nd))*)\b/.exec(lower);
  if (cc) {
    const parts: readonly string[] = cc[1]!.match(/nc|sa|nd/g) ?? [];
    return CC_CODES[['by', ...['nc', 'sa', 'nd'].filter(part => parts.includes(part))].join('-')] ?? 'other';
  }
  if (/\bpublic\s+domain\b|^pd(?:-|\b)|\bno\s+known\s+copyright\b/.test(lower)) return 'pdm';
  return undefined;
}

const NAMES: Readonly<Record<ImageLicenseCode, string>> = {
  'cc0': 'CC0', 'pdm': 'Public domain', 'by': 'CC BY', 'by-sa': 'CC BY-SA', 'by-nd': 'CC BY-ND',
  'by-nc': 'CC BY-NC', 'by-nc-sa': 'CC BY-NC-SA', 'by-nc-nd': 'CC BY-NC-ND', 'other': 'Other terms',
};

/**
 * 把来源给出的许可归一成代码与三项事实（能否商用、能否改动、是否须署名）。
 * 只按 CC 目录推导；不属于 CC 族的条款（GFDL、FAL、馆方自定条款）记为 other，保守地按“不可商用、不可改动”处理，名称原样保留供查看。
 */
export function normalizeImageLicense(input: {
  readonly code?: string;
  readonly version?: string;
  readonly name?: string;
  readonly url?: string;
}): ImageLicense {
  const declared = input.code ? CC_CODES[input.code.trim().toLowerCase()] : undefined;
  const code = declared ?? codeFromUrl(input.url) ?? (input.name ? codeFromName(input.name) : undefined) ?? 'other';
  const name = input.name?.trim()
    || (code === 'cc0' || code === 'pdm' || code === 'other' ? NAMES[code] : `${NAMES[code]}${input.version ? ` ${input.version}` : ''}`);
  const known = code !== 'other';
  return {
    code,
    name: name.slice(0, 200),
    ...(input.url && /^https?:\/\//i.test(input.url) ? { url: input.url.replace(/^http:/i, 'https:') } : {}),
    commercial_use: known && !code.includes('nc'),
    modifications: known && !code.includes('nd'),
    attribution_required: code !== 'cc0' && code !== 'pdm',
  };
}

/** 署名文字：Openverse 已给出时直接用；否则按 TASL（标题、作者、来源、许可）拼。 */
export function buildImageAttribution(input: {
  readonly title: string;
  readonly creator?: string;
  readonly pageUrl: string;
  readonly license: ImageLicense;
  readonly via?: string;
}): string {
  const titled = `"${input.title}"`;
  const by = input.creator ? ` by ${input.creator}` : '';
  const via = input.via ? `, via ${input.via}` : '';
  const terms = input.license.code === 'pdm'
    ? ' is in the public domain'
    : input.license.code === 'cc0'
      ? ' is dedicated to the public domain (CC0)'
      : ` is licensed under ${input.license.name}`;
  return `${titled}${by}${via}${terms}. Source: ${input.pageUrl}`.slice(0, 600);
}
