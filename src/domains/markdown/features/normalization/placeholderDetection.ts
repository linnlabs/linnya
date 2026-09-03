/**
 * @file placeholderDetection.ts
 * @description 统一识别/提取 rawMarkdownSource 占位文档。
 */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getArrayField(value: unknown, key: string): unknown[] {
  if (!isRecord(value)) return [];
  const field = value[key];
  return Array.isArray(field) ? field : [];
}

function getStringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === 'string' ? field : null;
}

/**
 * 提取占位文档中存放的原始 Markdown。
 */
export function extractRawMarkdownSource(content: unknown): string | null {
  const rootBlocks = getArrayField(content, 'content');
  for (const rootBlock of rootBlocks) {
    const blockChildren = getArrayField(rootBlock, 'content');
    for (const child of blockChildren) {
      const type = getStringField(child, 'type');
      if (type !== 'baseBlock') continue;
      const attrs = isRecord(child) ? child['attrs'] : undefined;
      const rawMarkdown = getStringField(attrs, 'rawMarkdownSource');
      if (typeof rawMarkdown === 'string' && rawMarkdown.trim().length > 0) {
        return rawMarkdown;
      }
    }
  }
  return null;
}

/**
 * 判断 content_json 是否仍处于 rawMarkdownSource 占位态。
 */
export function isRawMarkdownPlaceholder(content: unknown): boolean {
  return extractRawMarkdownSource(content) !== null;
}
