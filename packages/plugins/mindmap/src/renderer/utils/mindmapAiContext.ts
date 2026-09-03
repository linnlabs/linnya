/**
 * @file MindMap → AI 上下文构建工具
 *
 * 中文说明：
 * - 目标：在没有 Editor 的场景下（例如当前 activeView=MINDMAP），仍然能给 Agent 注入可用的上下文
 * - 约束：跨层不泄漏 DOM，只输出业务 nodeId / 业务字段
 * - 产物：用于 `document_fragment` 的"MindMap NodeRef View（缩进大纲 + refs 映射）"
 *
 * 注意：
 * - 这不是工具调用（不读 DB），只使用前端已加载的 `mind.nodeData`（当前打开 MindMap 的内存快照）
 * - 未来新增更多 MindMap AI 功能时，应复用本模块的"视图文本构建"与"限制策略"
 * - nodeRef 使用与后端工具一致的 SHA-256 + Base62 算法（前端 refIdGenerator），
 *   保证侧边栏上下文里的 ref 可以直接被 mindmap_tag_node / mindmap_create_node 使用
 */
import { useMindMapStore } from '../domain/store/mindmapStore'
import type { NodeObj } from '../domain/types'
import { generateRefMap } from '@plugin/renderer/refId'

export interface MindMapChatContextOptions {
  /** 最大树深度（从根节点深度=0 开始） */
  maxDepth: number
  /** 最大节点数（包含根节点） */
  maxNodes: number
  /** 最大字符数（超过时截断） */
  maxChars: number
  /** 是否在行内输出 tagging 信息（status/confidence/kind） */
  includeTagging: boolean
}

/**
 * MindMap 侧边栏聊天的默认上下文预算。
 *
 * 中文说明：
 * - 该配置属于 MindMap document_fragment 的构建规则，归属插件包自身；
 * - conversation 只通过 page_context provider 请求片段，不再持有 MindMap 专属参数。
 */
export const DEFAULT_MINDMAP_CHAT_CONTEXT_OPTIONS: MindMapChatContextOptions = {
  maxDepth: 6,
  maxNodes: 120,
  maxChars: 4500,
  includeTagging: true,
}

export interface PageContextLike {
  kind?: string
  document?: {
    id: string
    type?: string
    title?: string
  }
  selection?: {
    selectedNodeIds?: string[]
  }
}

/**
 * 递归收集所有节点 ID
 */
function collectAllNodeIds(root: NodeObj): string[] {
  const ids: string[] = []
  const walk = (node: NodeObj) => {
    if (node.id) ids.push(node.id)
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child)
      }
    }
  }
  walk(root)
  return ids
}

function safeString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined
}

/**
 * 从 nodeData 构建缩进大纲（NodeRef View）
 *
 * 中文说明：
 * - 使用预计算的 refMap（与后端工具协议一致的 SHA-256 + Base62 ref）
 * - 输出形态示例：
 *   [#aZ3kP9] Root topic ⟦kind=hypothesis status=open⟧
 *     [#mT8qX2] Child topic
 * - 格式与 Workspace document-read feature 的 MindMap NodeRef View 保持一致
 */
function buildNodeRefOutlineText(params: {
  root: NodeObj
  selectedNodeIds: Set<string>
  refMap: Map<string, string>
  options: MindMapChatContextOptions
}): string {
  const { root, selectedNodeIds, refMap, options } = params

  const lines: string[] = []
  let nodeCount = 0
  let charCount = 0

  const pushLine = (line: string): boolean => {
    if (nodeCount >= options.maxNodes) return false
    if (charCount + line.length + 1 > options.maxChars) return false
    lines.push(line)
    charCount += line.length + 1
    return true
  }

  /**
   * 构建 tagging 后缀（与 Workspace document-read feature 的 NodeRef 格式对齐）
   *
   * 中文说明：
   * - 使用 ⟦⟧ 包裹，与后端工具输出格式一致
   * - 输出 status/confidence/kind，仅在存在时输出
   */
  const buildTaggingSuffix = (node: NodeObj): string => {
    if (!options.includeTagging) return ''
    const parts: string[] = []

    const status = safeString(node.tagging?.status)
    if (status) parts.push(`status=${status}`)

    const confidenceRaw = node.tagging?.confidence
    if (typeof confidenceRaw === 'string' && confidenceRaw.trim().length > 0) {
      parts.push(`conf=${confidenceRaw}`)
    } else if (typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)) {
      parts.push(`conf=${confidenceRaw}`)
    }

    const kind = safeString(
      node.tagging?.labels && typeof node.tagging.labels === 'object'
        ? (node.tagging.labels as Record<string, unknown>).kind as string | undefined
        : undefined
    )
    if (kind) parts.push(`kind=${kind}`)

    if (parts.length === 0) return ''
    return ` ⟦${parts.join(' ')}⟧`
  }

  const visit = (node: NodeObj, depth: number, isRoot: boolean): boolean => {
    if (nodeCount >= options.maxNodes) return false
    if (depth > options.maxDepth) return true

    const nodeId = node.id
    const ref = refMap.get(nodeId) ?? '#unknown'
    const isSelected = selectedNodeIds.has(nodeId)
    const selectedMark = isSelected ? '* ' : ''

    const indent = '  '.repeat(depth)
    const topic = safeString(node.topic) ?? '(empty)'
    const rootSuffix = isRoot ? ' (Root)' : ''
    const taggingSuffix = buildTaggingSuffix(node)

    const line = `${indent}${selectedMark}[${ref}] ${topic}${rootSuffix}${taggingSuffix}`

    nodeCount += 1
    if (!pushLine(line)) return false
    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) {
      if (!visit(child, depth + 1, false)) return false
    }
    return true
  }

  visit(root, 0, true)

  const truncatedByNodes = nodeCount >= options.maxNodes
  const truncatedByChars = charCount >= options.maxChars

  if (truncatedByNodes || truncatedByChars) {
    lines.push('')
    lines.push(
      `...（已截断：maxDepth=${options.maxDepth}, maxNodes=${options.maxNodes}, maxChars=${options.maxChars}）`
    )
  }

  return lines.join('\n')
}

/**
 * 构建 MindMap 场景的 document_fragment（侧边栏聊天用）
 *
 * 中文说明：
 * - 用于替代 Editor 的 DocumentView（因为 MindMap 页面没有 editor）
 * - 只使用前端内存中的 nodeData，不做 DB 读取（避免隐式副作用）
 * - 异步：因为 nodeRef 生成需要 Web Crypto API（SHA-256）
 * - nodeRef 与后端 read_file(view="document") 输出的 ref 完全一致，
 *   Agent 可以直接将上下文中的 ref 传给 mindmap_tag_node / mindmap_create_node
 */
export async function buildMindMapChatDocumentFragmentFromStore(
  pageContext: PageContextLike,
  options: MindMapChatContextOptions
): Promise<string | null> {
  if (pageContext.kind !== 'mindmap') return null

  const mindmapStore = useMindMapStore()
  const resolvedDocumentId = pageContext.document?.id ?? mindmapStore.currentDocumentId
  if (!resolvedDocumentId) return null

  const mind = mindmapStore.mind ?? null
  const root = mind?.nodeData
  if (!root) return null

  // 收集所有 nodeId，批量生成与后端一致的 ref
  const allNodeIds = collectAllNodeIds(root as NodeObj)
  const refMap = await generateRefMap(allNodeIds)

  const selectedNodeIds = new Set<string>(pageContext.selection?.selectedNodeIds ?? [])

  const documentTitle =
    safeString(pageContext.document?.title) ??
    safeString(mindmapStore.currentDocumentName)

  const headerLines: string[] = [
    '[PageContext]',
    `kind=mindmap`,
    `document_id=${resolvedDocumentId}`,
  ]
  if (documentTitle) {
    headerLines.push(`document_title=${documentTitle}`)
  }
  headerLines.push(
    `selected_node_ids=${JSON.stringify(Array.from(selectedNodeIds))}`
  )

  const outline = buildNodeRefOutlineText({
    root: root as NodeObj,
    selectedNodeIds,
    refMap,
    options,
  })

  return [
    headerLines.join('\n'),
    '',
    'MindMap NodeRef View（缩进大纲）：',
    outline,
  ].join('\n')
}
