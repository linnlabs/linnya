import type { MarkdownDocJson, ProseMirrorJsonNode } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isProseMirrorMark(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  return value.attrs === undefined || isRecord(value.attrs);
}

function isProseMirrorJsonNode(value: unknown): value is ProseMirrorJsonNode {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  if (value.attrs !== undefined && !isRecord(value.attrs)) return false;
  if (value.text !== undefined && typeof value.text !== 'string') return false;
  if (
    value.marks !== undefined
    && (!Array.isArray(value.marks) || !value.marks.every(isProseMirrorMark))
  ) {
    return false;
  }
  return value.content === undefined || (
    Array.isArray(value.content)
    && value.content.every(isProseMirrorJsonNode)
  );
}

/** 将不可信存储值解析为 Workspace Markdown 的正式文档结构。 */
export function parseMarkdownDocJson(value: unknown): MarkdownDocJson {
  if (
    !isProseMirrorJsonNode(value)
    || value.type !== 'doc'
    || !Array.isArray(value.content)
  ) {
    throw new Error('Markdown document must be a ProseMirror doc with a content array');
  }
  return {
    ...value,
    type: 'doc',
    content: value.content,
  };
}
