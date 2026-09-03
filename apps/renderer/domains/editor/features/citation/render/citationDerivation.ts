/**
 * @file citation/render/citationDerivation.ts
 * @description Phase 3 引用派生模型（纯函数层）
 *
 * 职责：
 * - 扫描 ProseMirror doc，提取所有 citationNode
 * - 按 sourceId 去重，生成 BibliographyEntry 列表
 * - 根据 styleId 计算每个 citation 的显示 label
 *
 * 设计原则：
 * - 纯函数，无副作用，便于单测
 * - 确定性规则：同一份 doc JSON 在任何时间/机器都产出完全一致的结果
 * - 不修改 CitationNode attrs（渲染是视图层派生）
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { CitationSourceType, BibliographyStyleId } from '../types'
import { readCitationNodeAttrs } from '../functions/citationNodeProjection'

// ============ 类型定义 ============

/**
 * 单个引用实例（扫描结果）
 * 对应文档中一处 CitationNode
 */
export interface CitationInstance {
  /** 引用实例 ID（citationId） */
  citationId: string
  /** 去重键 */
  sourceId: string
  /** 来源类型 */
  sourceType: CitationSourceType
  /** 标题 */
  title: string
  /** 引用片段 */
  snippet: string
  /** 作者列表 */
  authors: string[]
  /** 发布日期 */
  date: string
  /** URL */
  url: string
  /** 容器标题 */
  containerTitle: string
  /** 在文档中首次出现的顺序（0-based） */
  firstSeenOrder: number
}

/**
 * 参考文献条目（去重后）
 * 每个 sourceId 只有一条
 */
export interface BibliographyEntry {
  /** 去重键 */
  sourceId: string
  /** 来源类型 */
  sourceType: CitationSourceType
  /** 标题 */
  title: string
  /** 引用片段 */
  snippet: string
  /** 作者列表 */
  authors: string[]
  /** 发布日期 */
  date: string
  /** URL */
  url: string
  /** 容器标题 */
  containerTitle: string
  /** 在文档中首次出现的顺序（0-based，用于 numeric 排序） */
  firstSeenOrder: number
  /** numeric 编号（1-based） */
  numericIndex: number
}

/**
 * 派生结果
 */
export interface CitationDerivationResult {
  /** 所有引用实例（按文档顺序） */
  instances: CitationInstance[]
  /** 去重后的参考文献条目（已排序） */
  entries: BibliographyEntry[]
  /** sourceId -> BibliographyEntry 映射 */
  bySourceId: Map<string, BibliographyEntry>
  /** citationId -> 显示 label 映射 */
  labelByCitationId: Map<string, string>
  /** sourceId -> 显示 label 映射（便于新增引用时快速查找） */
  labelBySourceId: Map<string, string>
}

// ============ 辅助函数 ============

/**
 * 生成 numeric 风格的 label
 * @param numericIndex 编号（1-based）
 */
function generateNumericLabel(numericIndex: number): string {
  return `[${numericIndex}]`
}

/**
 * 生成 author-date 风格的 label
 * 缺字段降级规则：
 * - 无 author：用 title
 * - 无 date：省略年份
 */
function generateAuthorDateLabel(entry: BibliographyEntry): string {
  // 提取第一作者姓氏（简化处理：取第一个空格前的部分，或整个名字）
  let authorPart = ''
  if (entry.authors && entry.authors.length > 0) {
    const firstAuthor = entry.authors[0]
    // 尝试提取姓氏（假设格式为 "姓 名" 或 "Last, First"）
    const parts = firstAuthor.split(/[,\s]+/)
    authorPart = parts[0] || firstAuthor
  } else {
    // 无作者，用标题（截断到 20 字符）
    authorPart = entry.title.length > 20 ? entry.title.slice(0, 20) + '…' : entry.title
  }

  // 提取年份
  let yearPart = ''
  if (entry.date) {
    // 尝试提取 4 位年份
    const yearMatch = entry.date.match(/\d{4}/)
    if (yearMatch) {
      yearPart = yearMatch[0]
    }
  }

  // 组合 label
  if (yearPart) {
    return `(${authorPart}, ${yearPart})`
  } else {
    return `(${authorPart})`
  }
}

/**
 * author-date 排序比较函数
 * 排序 key：primary = authors[0] || title, secondary = date, tertiary = title
 */
function compareAuthorDate(a: BibliographyEntry, b: BibliographyEntry): number {
  // primary: authors[0] || title
  const aPrimary = (a.authors && a.authors[0]) || a.title
  const bPrimary = (b.authors && b.authors[0]) || b.title
  const primaryCompare = aPrimary.localeCompare(bPrimary, 'zh-CN')
  if (primaryCompare !== 0) return primaryCompare

  // secondary: date
  const aDate = a.date || ''
  const bDate = b.date || ''
  const dateCompare = aDate.localeCompare(bDate)
  if (dateCompare !== 0) return dateCompare

  // tertiary: title
  return a.title.localeCompare(b.title, 'zh-CN')
}

// ============ 核心函数 ============

/**
 * 扫描文档，提取所有 CitationNode 实例。
 * Inline atom 天然是一处一个实例，不再需要合并跨 text node 的 mark range。
 */
export function scanCitationInstances(doc: ProseMirrorNode): CitationInstance[] {
  const instances: CitationInstance[] = []

  doc.descendants(node => {
    if (node.type.name !== 'citationNode') return true
    const attrs = readCitationNodeAttrs(node.attrs)
    if (!attrs) return false
    instances.push({
      citationId: attrs.citationId,
      sourceId: attrs.sourceId,
      sourceType: attrs.sourceType,
      title: attrs.title,
      snippet: attrs.snippet,
      authors: attrs.authors ?? [],
      date: attrs.date ?? '',
      url: attrs.url ?? '',
      containerTitle: attrs.containerTitle ?? '',
      firstSeenOrder: instances.length,
    })
    return true
  })
  return instances
}

/**
 * 从引用实例列表生成去重后的参考文献条目
 *
 * 去重规则：按 sourceId 去重
 * 同源多快照策略：首次出现优先（按 firstSeenOrder）
 */
export function deduplicateToEntries(instances: CitationInstance[]): BibliographyEntry[] {
  const entriesBySourceId = new Map<string, BibliographyEntry>()

  for (const instance of instances) {
    if (!entriesBySourceId.has(instance.sourceId)) {
      // 首次出现，创建 entry（numericIndex 后续排序后再分配）
      entriesBySourceId.set(instance.sourceId, {
        sourceId: instance.sourceId,
        sourceType: instance.sourceType,
        title: instance.title,
        snippet: instance.snippet,
        authors: instance.authors,
        date: instance.date,
        url: instance.url,
        containerTitle: instance.containerTitle,
        firstSeenOrder: instance.firstSeenOrder,
        numericIndex: 0, // 占位，后续分配
      })
    }
    // 同源后续出现：跳过（首次出现优先）
  }

  return Array.from(entriesBySourceId.values())
}

/**
 * 对参考文献条目排序并分配 numericIndex
 *
 * @param entries 去重后的条目列表
 * @param styleId 样式 ID
 * @returns 排序后的条目列表（已分配 numericIndex）
 */
export function sortAndIndexEntries(
  entries: BibliographyEntry[],
  styleId: BibliographyStyleId
): BibliographyEntry[] {
  let sortedEntries: BibliographyEntry[]

  if (styleId === 'author-date') {
    // author-date 按作者/年份/标题排序
    sortedEntries = [...entries].sort(compareAuthorDate)
  } else {
    // numeric 按首次出现顺序排序
    sortedEntries = [...entries].sort((a, b) => a.firstSeenOrder - b.firstSeenOrder)
  }

  // 分配 numericIndex（1-based）
  sortedEntries.forEach((entry, index) => {
    entry.numericIndex = index + 1
  })

  return sortedEntries
}

/**
 * 生成 citation label 映射
 *
 * @param instances 所有引用实例
 * @param entries 排序后的参考文献条目
 * @param styleId 样式 ID
 */
export function generateLabelMaps(
  instances: CitationInstance[],
  entries: BibliographyEntry[],
  styleId: BibliographyStyleId
): {
  labelByCitationId: Map<string, string>
  labelBySourceId: Map<string, string>
} {
  const labelByCitationId = new Map<string, string>()
  const labelBySourceId = new Map<string, string>()

  // 先为每个 entry 生成 label
  const entryBySourceId = new Map<string, BibliographyEntry>()
  for (const entry of entries) {
    entryBySourceId.set(entry.sourceId, entry)

    const label =
      styleId === 'author-date'
        ? generateAuthorDateLabel(entry)
        : generateNumericLabel(entry.numericIndex)

    labelBySourceId.set(entry.sourceId, label)
  }

  // 为每个 instance 分配 label（通过 sourceId 映射）
  for (const instance of instances) {
    const label = labelBySourceId.get(instance.sourceId) || '[?]'
    labelByCitationId.set(instance.citationId, label)
  }

  return { labelByCitationId, labelBySourceId }
}

/**
 * 完整的派生流程（主入口）
 *
 * @param doc ProseMirror 文档节点
 * @param styleId 参考文献样式 ID
 * @returns 派生结果
 */
export function deriveCitations(
  doc: ProseMirrorNode,
  styleId: BibliographyStyleId
): CitationDerivationResult {
  // 1. 扫描所有引用实例
  const instances = scanCitationInstances(doc)

  // 2. 去重生成条目
  const rawEntries = deduplicateToEntries(instances)

  // 3. 排序并分配编号
  const entries = sortAndIndexEntries(rawEntries, styleId)

  // 4. 生成 label 映射
  const { labelByCitationId, labelBySourceId } = generateLabelMaps(instances, entries, styleId)

  // 5. 构建 bySourceId 映射
  const bySourceId = new Map<string, BibliographyEntry>()
  for (const entry of entries) {
    bySourceId.set(entry.sourceId, entry)
  }

  return {
    instances,
    entries,
    bySourceId,
    labelByCitationId,
    labelBySourceId,
  }
}

/**
 * 获取 BibliographyBlock 的 styleId
 * 扫描文档找到 bibliographyBlock 并返回其 styleId
 * 如果没有找到，返回默认值 'numeric'
 */
export function getBibliographyStyleId(doc: ProseMirrorNode): BibliographyStyleId {
  let styleId: BibliographyStyleId = 'numeric'

  doc.descendants(node => {
    if (node.type.name === 'bibliographyBlock') {
      const attrs = node.attrs as Record<string, unknown>
      if (attrs.styleId === 'author-date') {
        styleId = 'author-date'
      }
      return false // 找到后停止遍历
    }
    return true
  })

  return styleId
}
