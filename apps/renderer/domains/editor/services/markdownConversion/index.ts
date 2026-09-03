/**
 * @file markdownConversion/index.ts
 * @description Markdown ⇄ Tiptap 双向转换统一门面
 *
 * 所有需要 "Markdown ↔ Tiptap doc JSON" 转换的消费方，都应从此模块导入，
 * 避免直接散落地引用底层实现（markdownRuntime / markdownSerializer）。
 *
 * ┌────────────────────────────────────────────────────┐
 * │                  调用方                            │
 * │  (editorService / SharedMemoryEditor / 粘贴 / …)  │
 * └────────────────────┬───────────────────────────────┘
 *                      │
 *         ┌────────────▼────────────┐
 *         │  markdownConversion     │  ← 你在这里
 *         │  (稳定门面)              │
 *         └──┬──────────────────┬───┘
 *            │                  │
 *   ┌────────▼────────┐ ┌──────▼──────────────────────┐
 *   │ markdownImporter │ │ markdownSerializer (shared) │
 *   │ WASM → DocJSON   │ │ DocJSON → Markdown          │
 *   └────────┬─────────┘ └──────────────────────────────┘
 *            │
 *   ┌────────▼──────────────────────┐
 *   │        markdownRuntime        │
 *   │    BlockEvent[] → DocJSON     │
 *   └──────────────────────────────-┘
 */

// ============================
// 导入方向：Markdown → Tiptap
// ============================
export {
  importMarkdownToDocJson,
  type MarkdownImportResult,
} from './markdownImporter'

// ============================
// 导出方向：Tiptap → Markdown
// ============================
export {
  createMarkdownSerializer,
  markdownSerializer,
  clipboardMarkdownSerializer,
  type MarkdownExportSettings,
  type MarkdownSerializerLabels,
} from '../../../../shared/utils/markdownSerializer'

// ============================
// 低层原语（高级用例：流式解析后手动转换等）
// ============================
export {
  blockEventsToDocJson,
  type BlockEventLike,
  type ContentFragmentLike,
  type MarkLike,
} from '../markdownRuntime'
