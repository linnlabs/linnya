/**
 * @file markdownService.d.ts
 * @description `markdownService.js` 的类型声明文件（供 TS 文件 import 使用）。
 *
 * 背景：
 * - 本项目的 `apps/renderer/shared/services/markdownService.js` 是 JS 实现；
 * - `workspacePending.ts` 等 TS 文件需要 import 它；
 * - 若无声明文件，TypeScript 会报 TS7016（隐式 any）。
 *
 * 约束：
 * - 这里仅提供最小且安全的类型声明；
 * - 不使用 any（统一使用 unknown）。
 */

export type MarkdownParseMode = 'blocks' | 'html'

/**
 * 使用 WASM（legacy parser）解析 Markdown。
 * - mode='blocks' 返回 BlockEvent[]（结构与 parser-wasm 输出一致）
 * - mode='html' 返回 HTML 字符串
 */
export function parseMarkdown(
  markdownText: string,
  mode: MarkdownParseMode
): Promise<unknown[] | string>

/**
 * WASM StreamingParser 产出的 BlockEvent 结构（与 parser-wasm 输出一致）。
 * 供 blockEventsToDocJson 等消费方使用，避免调用方做类型断言。
 */
export interface WasmBlockEvent {
  block_type: string
  structured_content?: unknown
  raw_content_fallback?: string | null
  language?: string | null
  level?: number | null
  list_type?: string | null
  list_level?: number | null
  attrs?: unknown
}

/**
 * 使用 WASM StreamingParser 一次性解析完整 Markdown 为 blocks（BlockEvent[]）。
 * 注意：该方法是我们更推荐的解析入口（支持 pipe table 等）。
 */
export function parseMarkdownToBlocksByStreaming(markdownText: string): Promise<WasmBlockEvent[]>

/**
 * 初始化一个新的 StreamingParser（用于流式会话）。
 */
export function initializeNewStreamingParser(): Promise<unknown>

/**
 * 使用当前 active StreamingParser 处理一个 chunk，返回 BlockEvent[]。
 */
export function processChunkWithStreamingParser(textChunk: string): Promise<unknown[]>

/**
 * finalize 当前 active StreamingParser，返回剩余 BlockEvent[]。
 */
export function finalizeStreamingParsing(): Promise<unknown[]>

