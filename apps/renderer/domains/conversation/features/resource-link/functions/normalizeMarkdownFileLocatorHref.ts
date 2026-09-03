import { parseFileLocator, type ParsedFileLocator } from '@app/schemas';

export type MarkdownFileLocatorNormalization =
  | { readonly ok: true; readonly parsed: ParsedFileLocator }
  | { readonly ok: false; readonly reason: string };

function unwrapDestination(value: string): string {
  return value.startsWith('<') && value.endsWith('>')
    ? value.slice(1, -1)
    : value;
}

function decodePathSegment(segment: string): string {
  const decoded = decodeURIComponent(segment);
  if (
    decoded.length === 0
    || decoded === '.'
    || decoded === '..'
    || decoded.includes('/')
    || decoded.includes('\\')
    || decoded.includes('\0')
  ) {
    throw new Error('Markdown file locator 包含歧义路径段。');
  }
  return decoded;
}

function normalizeLogicalLocator(value: string, scheme: 'workspace:' | 'conversation:'): string {
  const pathValue = value.slice(scheme.length);
  if (!pathValue.startsWith('/')) {
    return value;
  }
  if (pathValue === '/') {
    return value;
  }
  const decodedPath = pathValue
    .slice(1)
    .split('/')
    .map(decodePathSegment)
    .join('/');
  return `${scheme}/${decodedPath}`;
}

/**
 * Markdown parser 会把逻辑路径中的中文和空格编码为 percent escape，而 `file:`
 * 在部分含空格场景会保留 destination 的尖括号。这里只在 parser 边界规范化一次，
 * 随后仍由共享 FileLocator 合同做最终准入，禁止失败后猜路径。
 */
export function normalizeMarkdownFileLocatorHref(
  href: string,
): MarkdownFileLocatorNormalization {
  try {
    const unwrapped = unwrapDestination(href);
    const normalized = (() => {
      if (unwrapped.startsWith('workspace:')) {
        return normalizeLogicalLocator(unwrapped, 'workspace:');
      }
      if (unwrapped.startsWith('conversation:')) {
        return normalizeLogicalLocator(unwrapped, 'conversation:');
      }
      if (unwrapped.startsWith('file:')) {
        if (/^file:\/\/localhost(?:\/|$)/u.test(unwrapped)) {
          throw new Error('本地文件请使用 file:///，不能使用 localhost 别名。');
        }
        const parsedUrl = new URL(unwrapped);
        // URL 会把 file://localhost 静默折叠成 file:///，不能在规范化时洗掉共享合同明确拒绝的别名。
        if (parsedUrl.hostname === 'localhost') {
          throw new Error('本地文件请使用 file:///，不能使用 localhost 别名。');
        }
        return parsedUrl.href;
      }
      return unwrapped;
    })();
    return { ok: true, parsed: parseFileLocator(normalized) };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : '文件链接格式无效。',
    };
  }
}

export function isMarkdownFileLocatorCandidate(href: string): boolean {
  const value = unwrapDestination(href);
  return value.startsWith('workspace:')
    || value.startsWith('conversation:')
    || value.startsWith('file:');
}
