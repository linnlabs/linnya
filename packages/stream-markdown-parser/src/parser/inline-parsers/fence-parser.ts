import type { CodeBlockNode, MarkdownToken } from '../../types'

// Strip a final line that looks like a fence marker (``` etc.)
const TRAILING_FENCE_LINE_RE = /\r?\n[ \t]*`+\s*$/
// Unified diff metadata/header line prefixes to skip when splitting a diff
const DIFF_HEADER_PREFIXES = ['diff ', 'index ', '--- ', '+++ ', '@@ ']
// Newline splitter reused in this module
const NEWLINE_RE = /\r?\n/

function splitUnifiedDiff(content: string) {
  const orig: string[] = []
  const updated: string[] = []
  for (const rawLine of content.split(NEWLINE_RE)) {
    const line = rawLine
    // skip diff metadata lines
    if (DIFF_HEADER_PREFIXES.some(p => line.startsWith(p)))
      continue

    if (line.length >= 2 && line[0] === '-' && line[1] === ' ') {
      orig.push(` ${line.slice(1)}`)
    }
    else if (line.length >= 2 && line[0] === '+' && line[1] === ' ') {
      updated.push(` ${line.slice(1)}`)
    }
    else {
      // fallback: treat as context (no prefix)
      orig.push(line)
      updated.push(line)
    }
  }
  return {
    original: orig.join('\n'),
    updated: updated.join('\n'),
  }
}

export function parseFenceToken(token: MarkdownToken): CodeBlockNode {
  const hasMap = Array.isArray(token.map) && token.map.length === 2
  const tokenMeta = (token.meta ?? {}) as unknown as { closed?: boolean }
  const closed = typeof tokenMeta.closed === 'boolean' ? tokenMeta.closed : undefined
  const info = String(token.info ?? '')
  const diff = info.startsWith('diff')
  const language = diff
    ? (() => {
        const s = info
        const sp = s.indexOf(' ')
        return sp === -1
          ? ''
          : String(s.slice(sp + 1) ?? '')
      })()
    : info

  // Defensive sanitization: sometimes a closing fence line (e.g. ``` or ``)
  // can accidentally end up inside `token.content` (for example when
  // the parser/mapping is confused). Remove a trailing line that only
  // contains backticks and optional whitespace so we don't render stray
  // ` or `` characters at the end of the code output. This is a
  // conservative cleanup and only strips a final line that looks like a
  // fence marker (starts with optional spaces then one or more ` and
  // only whitespace until end-of-string).
  let content = String(token.content ?? '')
  if (TRAILING_FENCE_LINE_RE.test(content))
    content = content.replace(TRAILING_FENCE_LINE_RE, '')

  if (diff) {
    const { original, updated } = splitUnifiedDiff(content)
    // 返回时保留原来的 code 字段为 updated（编辑后代码），并额外附加原始与更新的文本
    return {
      type: 'code_block',
      language,
      code: String(updated ?? ''),
      raw: String(content ?? ''),
      diff,
      loading: closed === true ? false : closed === false ? true : !hasMap,
      originalCode: original,
      updatedCode: updated,
    }
  }

  return {
    type: 'code_block',
    language,
    code: String(content ?? ''),
    raw: String(content ?? ''),
    diff,
    loading: closed === true ? false : closed === false ? true : !hasMap,
  }
}
