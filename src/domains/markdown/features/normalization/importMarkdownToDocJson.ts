/**
 * @file importMarkdownToDocJson.ts
 * @description 后端 Markdown -> doc JSON 导入入口。
 */

import { convertBlockEventsToDocJson } from './blockEventToDocJson';
import { normalizeParsedBlockEvents } from './normalizeBlockEvents';
import { parseMarkdownToBlocksInNode } from './parserAdapterNode';
import { validateMarkdownDocJson } from './schemaLite';
import type { MarkdownDocJson, WasmBlockEventLike } from './types';

export interface MarkdownImportResult {
  docJson: MarkdownDocJson | null;
  blockEvents: WasmBlockEventLike[];
}

export type MarkdownBlockParser = (markdown: string) => Promise<WasmBlockEventLike[]>;

/**
 * 统一的后端 Markdown 导入入口。
 *
 * 中文说明：
 * - 默认走 Node 侧的 parser-wasm 适配器；
 * - 测试中可注入假的 parser，避免依赖真实 WASM 构建产物。
 */
export async function importMarkdownToDocJson(
  markdown: string,
  parser: MarkdownBlockParser = parseMarkdownToBlocksInNode
): Promise<MarkdownImportResult> {
  if (!markdown.trim()) {
    return { docJson: null, blockEvents: [] };
  }

  const blockEvents = normalizeParsedBlockEvents(await parser(markdown));
  if (blockEvents.length === 0) {
    return { docJson: null, blockEvents: [] };
  }

  const rawDocJson = convertBlockEventsToDocJson(blockEvents);
  if (!rawDocJson) {
    return { docJson: null, blockEvents };
  }

  return {
    docJson: validateMarkdownDocJson(rawDocJson),
    blockEvents
  };
}
