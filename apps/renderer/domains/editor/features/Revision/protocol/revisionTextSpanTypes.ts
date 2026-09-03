import type { CitationSourceType as SchemaCitationSourceType } from '@app/schemas'

type CitationSourceType = Exclude<SchemaCitationSourceType, 'conversation_turn'>

/**
 * @file revisionTextSpanTypes.ts
 * @description Revision 协议层共享的 TextSpan 类型定义。
 *
 * 中文说明：
 * - 这里承载的是 Revision diff / pending / citation hydration 共享的稳定协议；
 * - 它不是通用 markdownRuntime 类型，而是面向 Revision 语义的中间表示；
 * - legacy parser、linearize、richDiff、diffApplier 都应依赖这里，而不是互相从实现文件取类型。
 */

/** 支持的 mark 类型名称 */
export type MarkName = 'bold' | 'italic' | 'code' | 'strike'

/**
 * citation 行内元数据（用于在 diff 插入阶段恢复 CitationNode attrs）
 *
 * 说明：
 * - ref 是 Agent 写作协议中的 canonical 短引用，存在时必须进入编辑器存储；
 * - Knowledge 引用通过 sourceId(docId) + blockId 精确定位，不能只保留文档级身份。
 */
export interface CitationInlineMeta {
  ref: string
  sourceType?: CitationSourceType
  sourceId: string
  title: string
  snippet: string
  kbId?: string
  blockId?: string
  url?: string
  date?: string
  authors?: string[]
  containerTitle?: string
}

export interface InlineLatexAtom {
  type: 'inlineLatex'
  latexSource: string
  textRepresentation: string
  attrs?: Record<string, unknown>
}

export interface CitationAtom {
  type: 'citation'
  citation: CitationInlineMeta
  textRepresentation: string
}

export type InlineAtom = InlineLatexAtom | CitationAtom

/** 带 marks 的文本片段 */
export interface TextSpan {
  /** 文本内容 */
  text: string
  /** 该片段携带的 marks */
  marks: MarkName[]
  /**
   * 可选：citation 行内元数据。
   *
   * 中文说明：
   * - 仅在 pending 引用水合链路下会携带；
   * - 普通 Markdown 解析路径保持 undefined，不影响原有逻辑。
   */
  citation?: CitationInlineMeta
  /**
   * 可选：结构化 inline 原子节点语义。
   *
   * 中文说明：
   * - 当前用于 `inlineLatex` 与 `CitationNode`；
   * - 让 pending / richDiff / diffApplier 在不丢失纯文本表示的前提下，仍能恢复真正的 inline 节点。
   */
  inlineAtom?: InlineAtom
}

/** spans 解析结果 */
export interface ParseResult {
  /** 解析后的 spans 序列 */
  spans: TextSpan[]
  /** 扁平化后的纯文本（用于 diff） */
  plainText: string
}
