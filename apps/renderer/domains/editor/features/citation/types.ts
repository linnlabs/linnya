/**
 * @file citation/types.ts
 * @description Phase 1 引用系统的类型定义
 *
 * 本文件定义了 CitationNode 和 BibliographyBlock 的属性类型。
 * 遵循 packages/schemas 的风格，后续可迁移到该 package 以便前后端共享。
 */

import type { CitationSourceType as SchemaCitationSourceType } from '@app/schemas'

// ============ CitationNode 属性类型 ============

/**
 * 引用来源类型
 * - knowledge_base: 来自知识库的引用
 * - web: 来自网页的引用
 * - manual: 手动输入的引用
 */
export type CitationSourceType = Exclude<SchemaCitationSourceType, 'conversation_turn'>

/**
 * CitationNode 的属性定义（最小集合）
 *
 * 可选字段表示来源本身不具备该信息，不用于兼容旧数据。
 */
export interface CitationNodeAttrs {
  /**
   * 引用实例 ID（UUID）
   * 每个 citationNode 实例的唯一标识
   */
  citationId: string

  /**
   * Agent 写作协议中的 canonical 短引用（例如 `ab1234`）。
   *
   * 该身份与 citationId、界面派生编号 `[1]` 不同。只有来源本来已经通过
   * Citation admission 获得 ref 时才持久化；手工引用不伪造该字段。
   */
  ref?: string

  /**
   * 来源类型
   */
  sourceType: CitationSourceType

  /**
   * 去重与同步更新的 key
   * - knowledge_base: 使用 kb 的 docId
   * - web: 使用 URL
   * - manual: UUID
   */
  sourceId: string

  /**
   * 来源知识库 ID（仅 knowledge_base 来源有意义）
   *
   * 中文说明：
   * - 仅靠 sourceId（docId）在“多知识库”场景无法反向定位 doc 属于哪个 KB；
   * - 该字段用于“查看来源/跳转到知识库文档”这类能力的精确定位；
   * - 部分导入来源不携带 kbId，因此它是可选定位信息；docId/blockId 才是事实锚点。
   */
  kbId?: string

  /**
   * Knowledge 来源的精确块锚点。
   *
   * Web 与 manual 引用没有该字段；新建 Knowledge 引用必须提供。
   */
  blockId?: string

  /**
   * 标题
   * - web/manual: 必填
   * - knowledge_base: 从 docTitle 抽取
   */
  title: string

  /**
   * 引用片段
   * Phase 1 只存储；渲染/hover 在后续 Phase
   */
  snippet: string

  /**
   * 多段引用片段（可选）
   *
   * 中文说明：
   * - 用于支持“同一篇文章在同一处连续引用多个段落”的场景；
   * - 多段摘录由导入或编辑流程显式写入；
   * - CitationNode 不会在渲染阶段偷偷合并相邻节点。
   */
  snippets?: string[]

  // ============ 预留字段（Phase 1 optional）============

  /**
   * 作者列表
   */
  authors?: string[]

  /**
   * 发布日期（ISO 格式字符串，如 "2024-01-15"）
   */
  date?: string

  /**
   * URL（web 引用时必填）
   */
  url?: string

  /**
   * 容器标题（如期刊名、书名等）
   */
  containerTitle?: string
}

// ============ BibliographyBlock 属性类型 ============

/**
 * 参考文献样式 ID
 * - numeric: 数字编号（如 [1], [2]）
 * - author-date: 作者-年份（如 (Smith, 2024)）
 */
export type BibliographyStyleId = 'numeric' | 'author-date'

/**
 * BibliographyBlock 的属性定义
 */
export interface BibliographyBlockAttrs {
  /**
   * 块 ID（与其他 contentBlock 一致）
   */
  id: string

  /**
   * 块类型标识
   */
  blockType: 'bibliography'

  /**
   * 参考文献样式
   */
  styleId: BibliographyStyleId
}

// ============ 扫描结果类型（用于 bibliographyAutoMaintain）============

/**
 * 文档扫描结果
 * 用于 appendTransaction 中判断是否需要修正
 */
export interface DocCitationScanResult {
  /**
   * 文档中 citationNode 的数量
   */
  citationCount: number

  /**
   * 所有 bibliographyBlock 所在 rootBlock 的位置列表
   * （正常情况下应该只有 0 或 1 个）
   */
  bibliographyRootBlockPosList: number[]

  /**
   * bibliography 容器块是否位于文末
   * （仅当 bibliographyRootBlockPosList.length === 1 时有意义）
   */
  isBibliographyAtEnd: boolean

  /**
   * 文档最后一个 rootBlock 的结束位置
   * 用于在文末插入新的 bibliography
   */
  docEndPos: number
}

/**
 * 修正动作类型
 */
export type BibliographyFixAction =
  | { type: 'none' } // 无需修正
  | { type: 'create'; insertPos: number } // 需要创建 bibliography
  | { type: 'remove'; positions: number[] } // 需要移除 bibliography
  | { type: 'cleanup_duplicates'; keepPos: number; removePositions: number[] } // 需要清理多余
  | { type: 'move_to_end'; fromPos: number; toPos: number } // 需要移动到文末

/**
 * 计算修正动作的结果
 */
export interface BibliographyFixResult {
  /**
   * 需要执行的动作列表
   * 按顺序执行：先清理多余 → 再创建/移除 → 最后移动
   */
  actions: BibliographyFixAction[]

  /**
   * 是否需要修正
   */
  needsFix: boolean
}
