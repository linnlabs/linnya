/**
 * Markdown `[@ref]` -> CitationNode 的后端规范化边界。
 * token 识别严格复用 Citation domain 的 canonical parser，避免 Markdown domain 自建正则协议。
 */
import type { CitationSourceType } from '@app/schemas';
import { parseMarkdownCitationTokens } from '../../../citation';
import { validateMarkdownDocJson } from './schemaLite';
import type { MarkdownDocJson, ProseMirrorJsonNode } from './types';

export interface CitationNodeHydrationData {
  docId?: string;
  blockId?: string;
  title: string;
  snippet: string;
  kbId?: string;
  sourceType?: CitationSourceType;
  url?: string;
  date?: string;
  authors?: string[];
  containerTitle?: string;
}

function generateCitationId(): string {
  return crypto.randomUUID();
}

export function buildCitationNodeAttrs(params: {
  readonly data: CitationNodeHydrationData;
  readonly ref: string;
  readonly citationId: string;
}): Readonly<Record<string, unknown>> {
  const { data, ref, citationId } = params;
  const sourceType =
    data.sourceType === 'web' || data.sourceType === 'manual' ? data.sourceType : 'knowledge_base';
  const sourceId =
    sourceType === 'web' && typeof data.url === 'string' && data.url.trim().length > 0
      ? data.url
      : (data.docId ?? '');

  return {
    citationId,
    ref,
    sourceType,
    sourceId,
    kbId: data.kbId ?? null,
    blockId: data.blockId ?? null,
    title: data.title,
    snippet: data.snippet,
    snippets: null,
    authors: Array.isArray(data.authors) && data.authors.length > 0 ? data.authors : null,
    date: data.date ?? null,
    url: data.url ?? null,
    containerTitle: data.containerTitle ?? null,
  };
}

function createTextSegment(source: ProseMirrorJsonNode, text: string): ProseMirrorJsonNode | null {
  return text.length > 0 ? { ...source, text } : null;
}

function createCitationNode(
  source: ProseMirrorJsonNode,
  ref: string,
  data: CitationNodeHydrationData
): ProseMirrorJsonNode {
  return {
    type: 'citationNode',
    attrs: buildCitationNodeAttrs({ data, ref, citationId: generateCitationId() }),
    ...(Array.isArray(source.marks) && source.marks.length > 0 ? { marks: source.marks } : {}),
  };
}

function marksAreEqual(
  left: ProseMirrorJsonNode['marks'],
  right: ProseMirrorJsonNode['marks']
): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

/**
 * Markdown parser 可能把转义后的 `[`、正文和 `]` 拆成多个相邻 text node。
 * Citation 协议属于连续内联文本，必须先在相同 marks 边界内恢复连续文本再解析。
 */
function mergeAdjacentTextNodes(content: ProseMirrorJsonNode[]): ProseMirrorJsonNode[] {
  const merged: ProseMirrorJsonNode[] = [];
  for (const node of content) {
    const previous = merged[merged.length - 1];
    if (
      previous?.type === 'text' &&
      node.type === 'text' &&
      typeof previous.text === 'string' &&
      typeof node.text === 'string' &&
      marksAreEqual(previous.marks, node.marks)
    ) {
      previous.text += node.text;
      continue;
    }
    // 后续合并会改写 previous.text，文本节点必须先复制，不能污染 parser 的原始结果。
    merged.push(node.type === 'text' ? { ...node } : node);
  }
  return merged;
}

function hydrateTextNode(
  node: ProseMirrorJsonNode,
  hydration: Readonly<Record<string, CitationNodeHydrationData>>
): ProseMirrorJsonNode[] {
  const text = typeof node.text === 'string' ? node.text : '';
  if (!text || node.marks?.some(mark => mark.type === 'code')) return [node];

  const tokens = parseMarkdownCitationTokens(text);
  if (tokens.length === 0) return [node];

  const result: ProseMirrorJsonNode[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const prefix = createTextSegment(node, text.slice(cursor, token.start));
    if (prefix) result.push(prefix);

    for (const ref of token.refs) {
      const data = hydration[ref];
      if (data) result.push(createCitationNode(node, ref, data));
      else {
        const unresolved = createTextSegment(node, `[@${ref}]`);
        if (unresolved) result.push(unresolved);
      }
    }
    cursor = token.end;
  }

  const suffix = createTextSegment(node, text.slice(cursor));
  if (suffix) result.push(suffix);
  return result;
}

function hydrateNode(
  node: ProseMirrorJsonNode,
  hydration: Readonly<Record<string, CitationNodeHydrationData>>
): ProseMirrorJsonNode[] {
  if (node.type === 'text') return hydrateTextNode(node, hydration);
  if (node.type === 'codeBlock') return [node];
  if (!Array.isArray(node.content) || node.content.length === 0) return [node];
  const continuousContent = mergeAdjacentTextNodes(node.content);
  return [{ ...node, content: continuousContent.flatMap(child => hydrateNode(child, hydration)) }];
}

export function attachCitationNodesToDocJson(
  docJson: MarkdownDocJson,
  hydration: Readonly<Record<string, CitationNodeHydrationData>>
): MarkdownDocJson {
  if (!Array.isArray(docJson.content) || Object.keys(hydration).length === 0) return docJson;
  return validateMarkdownDocJson({
    ...docJson,
    content: docJson.content.flatMap(node => hydrateNode(node, hydration)),
  });
}
