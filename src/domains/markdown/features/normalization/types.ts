/**
 * @file types.ts
 * @description 后端 Markdown 规范化链路的共享类型。
 */

/**
 * WASM Markdown 解析器产出的 mark 结构。
 */
export interface WasmMarkLike {
  type: string;
  attrs?: Record<string, unknown> | null;
}

/**
 * WASM Markdown 解析器产出的内联片段结构。
 */
export interface WasmContentFragmentLike {
  type: string;
  text?: string | null;
  marks?: WasmMarkLike[] | null;
  attrs?: Record<string, unknown> | null;
}

/**
 * WASM Markdown 解析器产出的块事件结构。
 */
export interface WasmBlockEventLike {
  block_type: string;
  structured_content?: WasmContentFragmentLike[] | null;
  raw_content_fallback?: string | null;
  language?: string | null;
  level?: number | null;
  list_type?: string | null;
  list_level?: number | null;
  attrs?: unknown;
}

/**
 * 后端持久化使用的 ProseMirror/Tiptap JSON 节点。
 */
export interface ProseMirrorJsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorJsonNode[];
  text?: string;
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
}

/**
 * 导入后的完整文档 JSON。
 */
export interface MarkdownDocJson extends ProseMirrorJsonNode {
  type: 'doc';
  content: ProseMirrorJsonNode[];
}
