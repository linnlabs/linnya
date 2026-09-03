/**
 * @file markdownBlockProjection.ts
 * @description 将 Markdown 文档内部块结构投影为稳定的块级 Markdown。
 */

import { generateRefMapWithCollisionCheck } from 'src/shared/utils/refIdGenerator';
import {
  serializeRootBlockToMarkdown,
  type MarkdownInlineNodeProjector,
  type MarkdownInlineTextProjector,
} from '../features/normalization/markdownJsonSerializer';
import { DocumentBlockIdSchema } from '@app/schemas';

export interface FlattenedMarkdownBlock {
  readonly index: number;
  readonly blockId: string;
  readonly ref: string;
  readonly text: string;
}

interface ProseMirrorNode {
  readonly type?: unknown;
  readonly attrs?: unknown;
  readonly content?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asNode(value: unknown): ProseMirrorNode | null {
  return isRecord(value) ? value : null;
}

function getAttrs(node: ProseMirrorNode | null): Record<string, unknown> {
  return isRecord(node?.attrs) ? node.attrs : {};
}

function getContent(node: ProseMirrorNode | null): unknown[] {
  return Array.isArray(node?.content) ? node.content : [];
}

function readRawMarkdownSource(root: ProseMirrorNode | null): string | null {
  for (const child of getContent(root)) {
    const node = asNode(child);
    if (!node || node.type !== 'baseBlock') continue;
    const raw = getAttrs(node)['rawMarkdownSource'];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw;
    }
  }
  return null;
}

function extractMarkdownFromRootBlock(
  root: ProseMirrorNode | null,
  projectInlineText?: MarkdownInlineTextProjector,
  projectInlineNode?: MarkdownInlineNodeProjector
): string {
  return (
    readRawMarkdownSource(root) ??
    serializeRootBlockToMarkdown(root, { projectInlineText, projectInlineNode })
  );
}

export function flattenMarkdownDocumentBlocks(
  content: unknown,
  options: {
    readonly projectInlineText?: MarkdownInlineTextProjector;
    readonly projectInlineNode?: MarkdownInlineNodeProjector;
  } = {}
): FlattenedMarkdownBlock[] {
  const doc = asNode(content);
  if (!doc) return [];

  const tempBlocks: Array<{ index: number; blockId: string; text: string }> = [];
  const blockIds: string[] = [];
  const admittedBlockIds = new Set<string>();
  let index = 0;

  for (const rawNode of getContent(doc)) {
    const node = asNode(rawNode);
    if (!node || node.type !== 'rootBlock') continue;

    index += 1;
    const parsedBlockId = DocumentBlockIdSchema.safeParse(getAttrs(node)['id']);
    if (!parsedBlockId.success) {
      throw new Error(`Markdown root block ${index} is missing its admitted block identity`);
    }
    const blockId = parsedBlockId.data;
    if (admittedBlockIds.has(blockId)) {
      throw new Error(`Markdown root block ${index} repeats block identity ${blockId}`);
    }
    admittedBlockIds.add(blockId);
    blockIds.push(blockId);
    tempBlocks.push({
      index,
      blockId,
      text: extractMarkdownFromRootBlock(
        node,
        options.projectInlineText,
        options.projectInlineNode
      ),
    });
  }

  const refMap = generateRefMapWithCollisionCheck(blockIds);
  return tempBlocks.map(block => {
    const ref = refMap.get(block.blockId);
    if (!ref) {
      throw new Error(`Markdown root block is missing its generated reference: ${block.blockId}`);
    }
    return { ...block, ref };
  });
}

export function serializeMarkdownBlocks(blocks: readonly FlattenedMarkdownBlock[]): string {
  return blocks
    .map(block => block.text.trimEnd())
    .filter(text => text.length > 0)
    .join('\n\n')
    .trimEnd();
}
