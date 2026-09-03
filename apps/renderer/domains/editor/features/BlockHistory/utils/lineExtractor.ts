/**
 * @file lineExtractor.ts
 * @description 从 ProseMirror 节点 JSON 中提取逻辑行
 *
 * 用于时光机多版本对比视图，将 RootBlock 的 JSON 内容
 * 转换为可用于对比的逻辑行列表
 */

// ==================== 类型定义 ====================

/** 版本行数据 */
export interface VersionLine {
  /** 该逻辑行的纯文本 */
  text: string
  /** 在 JSON 树中的路径（可选，用于联动高亮） */
  nodePath?: number[]
  /** 行类型（paragraph, heading, listItem 等） */
  nodeType?: string
}

/** 行差异结果 */
export interface LineDiffResult {
  /** 在新版本中新增的行索引 */
  addedLines: Set<number>
  /** 在旧版本中被删除的行索引 */
  removedLines: Set<number>
  /** 修改的行对 [旧索引, 新索引] */
  changedPairs: Array<[number, number]>
}

// ==================== ProseMirror 节点类型定义 ====================

interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMarkData[]
}

interface PMMarkData {
  type: string
  attrs?: Record<string, unknown>
}

// ==================== 主要函数 ====================

/**
 * 从 RootBlock JSON 中抽取逻辑行集合
 *
 * 遍历块子树，将 paragraph / hardBreak / heading 等 flatten 成一组行
 *
 * @param contentJson - RootBlock 的 JSON 内容（可能是嵌套对象或字符串）
 * @returns 逻辑行数组
 */
export function extractLinesFromContentJson(contentJson: unknown): VersionLine[] {
  if (!contentJson) {
    return []
  }

  const lines: VersionLine[] = []

  try {
    const node = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson
    extractLinesRecursive(node as PMNode, lines, [])
  } catch (error) {
    console.error('[lineExtractor] 解析 JSON 失败:', error)
    return []
  }

  return lines
}

/**
 * 递归提取行
 */
function extractLinesRecursive(node: PMNode, lines: VersionLine[], path: number[]): void {
  if (!node) return

  const nodeType = node.type

  // 文本节点：直接拼接
  if (nodeType === 'text' && node.text) {
    // 文本内容追加到最后一行
    const lastLine = lines[lines.length - 1]
    if (lastLine) {
      lastLine.text += node.text
    } else {
      lines.push({ text: node.text, nodePath: [...path], nodeType: 'text' })
    }
    return
  }

  // 硬换行：开始新行
  if (nodeType === 'hardBreak') {
    const lastLine = lines[lines.length - 1]
    if (lastLine) {
      // 当前行结束，开始新行
      lines.push({ text: '', nodePath: [...path], nodeType: 'hardBreak' })
    }
    return
  }

  // 块级节点：开始新行
  const blockTypes = ['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock', 'baseBlock', 'headingBlock', 'quoteBlock', 'listItemBlock']
  if (blockTypes.includes(nodeType)) {
    // 每个块级节点开始一个新行
    lines.push({ text: '', nodePath: [...path], nodeType })
  }

  // 递归处理子节点
  if (node.content && Array.isArray(node.content)) {
    node.content.forEach((child, idx) => {
      extractLinesRecursive(child, lines, [...path, idx])
    })
  }
}

/**
 * 计算两个版本之间的行差异
 *
 * 使用简单的 LCS（最长公共子序列）算法来识别添加和删除的行
 *
 * @param oldLines - 旧版本的行
 * @param newLines - 新版本的行
 * @returns 差异结果
 */
export function computeLineDiff(oldLines: VersionLine[], newLines: VersionLine[]): LineDiffResult {
  const oldTexts = oldLines.map(l => l.text)
  const newTexts = newLines.map(l => l.text)

  // 使用 LCS 找出公共行
  const lcs = computeLCS(oldTexts, newTexts)

  // 找出被删除的行（在旧版本中存在但不在 LCS 中）
  const removedLines = new Set<number>()
  const addedLines = new Set<number>()
  const changedPairs: Array<[number, number]> = []

  // 标记删除的行
  let lcsIdx = 0
  for (let i = 0; i < oldTexts.length; i++) {
    if (lcsIdx < lcs.length && oldTexts[i] === lcs[lcsIdx]) {
      lcsIdx++
    } else {
      removedLines.add(i)
    }
  }

  // 标记新增的行
  lcsIdx = 0
  for (let i = 0; i < newTexts.length; i++) {
    if (lcsIdx < lcs.length && newTexts[i] === lcs[lcsIdx]) {
      lcsIdx++
    } else {
      addedLines.add(i)
    }
  }

  return { addedLines, removedLines, changedPairs }
}

/**
 * 计算最长公共子序列 (LCS)
 */
function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length

  // 创建 DP 表
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  // 填充 DP 表
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // 回溯构建 LCS
  const lcs: string[] = []
  let i = m
  let j = n

  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return lcs
}

/**
 * 从文本内容提取行（简化版，用于纯文本场景）
 *
 * @param text - 纯文本内容
 * @returns 逻辑行数组
 */
export function extractLinesFromText(text: string): VersionLine[] {
  if (!text) return []

  return text.split('\n').map((line, idx) => ({
    text: line,
    nodePath: [idx],
    nodeType: 'text'
  }))
}

/**
 * 获取节点的纯文本内容
 */
export function getNodePlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''

  const pmNode = node as PMNode

  if (pmNode.type === 'text' && pmNode.text) {
    return pmNode.text
  }

  if (pmNode.content && Array.isArray(pmNode.content)) {
    return pmNode.content.map(child => getNodePlainText(child)).join('')
  }

  return ''
}


