/**
 * Pipe Table Markdown 解析工具
 * 用于在前端将 markdown 格式的 pipe table 解析成表格块结构
 */

/**
 * 解析后的表格数据结构
 */
export interface ParsedPipeTable {
  headerCells: string[]
  alignments: Array<'left' | 'center' | 'right' | null>
  bodyRows: string[][]
}

/**
 * 解析单行 pipe table 行
 * @param line - 表格行字符串（如 "| col1 | col2 |"）
 * @returns 单元格数组
 */
function parseTableRow(line: string): string[] {
  const trimmed = line.trim()
  
  // 移除首尾的 |
  let content = trimmed
  if (content.startsWith('|')) {
    content = content.slice(1)
  }
  if (content.endsWith('|')) {
    content = content.slice(0, -1)
  }
  
  // 分割并清理单元格
  return content.split('|').map((cell) => cell.trim())
}

/**
 * 解析对齐行，返回对齐方式数组
 * @param line - 对齐行字符串（如 "|:---:|---:|"）
 * @returns 对齐方式数组
 */
function parseAlignmentRow(line: string): Array<'left' | 'center' | 'right' | null> {
  const cells = parseTableRow(line)
  return cells.map((cell) => {
    const startsWithColon = cell.startsWith(':')
    const endsWithColon = cell.endsWith(':')
    
    if (startsWithColon && endsWithColon) {
      return 'center'
    } else if (endsWithColon) {
      return 'right'
    } else if (startsWithColon) {
      return 'left'
    }
    return null
  })
}

/**
 * 检查一行是否为有效的对齐行
 * @param line - 待检查的行
 * @returns 是否为有效对齐行
 */
function isAlignmentRow(line: string): boolean {
  const cells = parseTableRow(line)
  if (cells.length === 0) return false
  
  // 每个单元格必须只包含 '-' 和 ':'，且至少有一个 '-'
  return cells.every((cell) => {
    const cleaned = cell.replace(/[-:]/g, '')
    return cleaned === '' && cell.includes('-')
  })
}

/**
 * 解析 pipe table markdown
 * @param markdown - markdown 字符串
 * @returns 解析后的表格数据，如果不是有效表格则返回 null
 */
export function parsePipeTableMarkdown(markdown: string): ParsedPipeTable | null {
  // 先按行拆分并去掉首尾空白，但保留空行，用于更鲁棒地识别「表格片段」
  const rawLines = markdown.split('\n').map((l) => l.trim())

  // 仅在非空行上做表格头/对齐行匹配，允许前面有说明文字或空行
  const nonEmptyLines = rawLines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.length > 0)

  if (nonEmptyLines.length < 2) {
    return null
  }

  // 在所有非空行中，寻找第一个「header 行 + 对齐行」组合：
  // - header 行必须包含 '|'
  // - 紧随其后的非空行必须是合法对齐行（只包含 '-' 和 ':'，且至少有一个 '-'）
  let headerLine: string | null = null
  let alignmentLine: string | null = null
  let startIndex = -1

  for (let i = 0; i < nonEmptyLines.length - 1; i++) {
    const candidateHeader = nonEmptyLines[i].line
    const candidateAlignment = nonEmptyLines[i + 1].line

    if (!candidateHeader.includes('|')) continue
    if (!isAlignmentRow(candidateAlignment)) continue

    headerLine = candidateHeader
    alignmentLine = candidateAlignment
    startIndex = i
    break
  }

  if (!headerLine || !alignmentLine || startIndex === -1) {
    return null
  }

  // 解析 header
  const headerCells = parseTableRow(headerLine)
  if (headerCells.length === 0) {
    return null
  }

  // 解析对齐
  const alignments = parseAlignmentRow(alignmentLine)

  // 解析数据行：从对齐行之后开始，连续的、包含 '|' 的非空行都视为数据行
  const bodyRows: string[][] = []
  for (let i = startIndex + 2; i < nonEmptyLines.length; i++) {
    const line = nonEmptyLines[i].line
    if (!line.includes('|')) {
      // 一旦遇到不包含 '|' 的行，认为表格结束，后续内容忽略
      break
    }
    bodyRows.push(parseTableRow(line))
  }

  return {
    headerCells,
    alignments,
    bodyRows,
  }
}

/**
 * 判断 markdown 是否为 pipe table
 * @param markdown - markdown 字符串
 * @returns 是否为有效的 pipe table
 */
export function isPipeTable(markdown: string): boolean {
  return parsePipeTableMarkdown(markdown) !== null
}

