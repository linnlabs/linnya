import {
  importMarkdownToDocJson,
  type MarkdownBlockParser,
} from './importMarkdownToDocJson';
import type { MarkdownDocJson, WasmBlockEventLike } from './types';
import { flattenMarkdownDocumentBlocks } from '../../shared/markdownBlockProjection';

export interface PlannedMarkdownBlocks {
  readonly blockEvents: WasmBlockEventLike[];
  readonly docJson: MarkdownDocJson | null;
  /** 经过 WASM 解析与块序列化规范化后的块级 Markdown */
  readonly blocks: string[];
}

/**
 * 将整篇标准 Markdown 规划为 canonical block 列表。
 *
 * 这里不返回临时 docJson 里的 blockId/ref，因为那是解析期临时 ID；
 * 写入时真正的 blockId 必须来自 workspace 文档结构或后端新建块实体。
 */
export async function planMarkdownBlocks(
  markdown: string,
  parser?: MarkdownBlockParser,
): Promise<PlannedMarkdownBlocks> {
  if (!markdown.trim()) {
    return {
      blockEvents: [],
      docJson: null,
      blocks: [],
    };
  }

  const { blockEvents, docJson } = await importMarkdownToDocJson(markdown, parser);
  if (!docJson) {
    return {
      blockEvents,
      docJson: null,
      blocks: [],
    };
  }

  const blocks = flattenMarkdownDocumentBlocks(docJson)
    .map((block) => block.text)
    .filter((text) => text.trim().length > 0);

  return {
    blockEvents,
    docJson,
    blocks,
  };
}
