/**
 * @file markdownImporter.ts
 * @description Markdown → Tiptap(ProseMirror) DocJSON 的导入转换器
 *
 * 职责单一：
 * - 接收纯 Markdown 文本 + 编辑器 Schema
 * - 通过 WASM StreamingParser 解析为 BlockEvent[]
 * - 再通过 markdownRuntime materializer 转换为编辑器可用的 ProseMirror doc JSON
 *
 * 这是一个**纯函数模块**，不涉及 UI / 数据库 / IPC / 副作用。
 * 适用场景：文档首开迁移、用户手动导入、虚拟文档加载、粘贴等。
 */

import type { Schema } from 'prosemirror-model'
import {
  parseMarkdownToBlockEvents,
  blockEventsToDocJson,
  type BlockEventLike,
} from '../markdownRuntime'

/**
 * 导入结果（同时携带中间产物 blockEvents，便于调试与高级消费）
 */
export interface MarkdownImportResult {
  /** 转换后的 ProseMirror doc JSON，可直接传给 editor.commands.setContent() */
  docJson: { type: 'doc'; content: unknown[] } | null
  /** WASM 解析出的中间 BlockEvent 列表（仅供调试/高级用途） */
  blockEvents: BlockEventLike[]
}

/**
 * 将 Markdown 文本转换为 ProseMirror doc JSON
 *
 * @param params.markdown - 原始 Markdown 文本
 * @param params.schema  - 当前编辑器的 ProseMirror Schema（决定哪些节点类型可被创建）
 * @returns MarkdownImportResult
 *
 * 内部链路：
 *   markdown ─[WASM StreamingParser]→ BlockEvent[] ─[markdownRuntime materializer]→ doc JSON
 *
 * 注意：
 * - WASM StreamingParser 是功能最全的解析实现（支持 table / latex 等），
 *   不使用 legacy `parseMarkdown(text, 'blocks')`。
 * - 若 schema 中缺少某节点类型，converter 会做文本降级而非崩溃。
 */
export async function importMarkdownToDocJson(params: {
  markdown: string
  schema: Schema
}): Promise<MarkdownImportResult> {
  const { markdown, schema } = params

  if (!markdown || !markdown.trim()) {
    return { docJson: null, blockEvents: [] }
  }

  // 阶段 1：WASM StreamingParser → BlockEvent[]（类型由 markdownService.d.ts 声明）
  const blockEvents = await parseMarkdownToBlockEvents(markdown)

  if (blockEvents.length === 0) {
    console.warn('[markdownImporter] WASM 解析结果为空，无法生成 doc JSON')
    return { docJson: null, blockEvents: [] }
  }

  // 阶段 2：BlockEvent[] → ProseMirror doc JSON
  const docJson = blockEventsToDocJson(blockEvents, schema)

  if (!docJson || !Array.isArray(docJson.content) || docJson.content.length === 0) {
    console.warn('[markdownImporter] BlockEvent → doc JSON 转换后无有效节点')
    return { docJson: null, blockEvents }
  }

  return { docJson, blockEvents }
}
