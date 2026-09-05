import type { MarkdownIt } from 'markdown-it-ts'
import type { MarkdownToken, ParsedNode, ParseOptions } from '../types'
import { parseInlineTokens } from './inline-parsers'
import { parseCommonBlockToken } from './node-parsers/block-token-parser'
import { parseBlockquote } from './node-parsers/blockquote-parser'
import { containerTokenHandlers } from './node-parsers/container-token-handlers'
import { parseHardBreak } from './node-parsers/hardbreak-parser'
import { parseList } from './node-parsers/list-parser'
import { parseParagraph } from './node-parsers/paragraph-parser'

function stripDanglingHtmlLikeTail(markdown: string) {
  // In streaming mode it's common to have an incomplete HTML-ish fragment at
  // the very end of the current buffer (e.g. '<fo' or '</think'). Letting it
  // reach markdown-it can produce visible mid-state text nodes. We only strip
  // the *tail* when there is no closing '>' anywhere after the last '<'.
  const s = String(markdown ?? '')
  const lastLt = s.lastIndexOf('<')
  if (lastLt === -1)
    return s
  const tail = s.slice(lastLt)
  if (tail.includes('>'))
    return s
  // Only strip when the tail looks like a tag start/prefix, not a random '<'.
  if (!/^<\s*(?:\/\s*)?[A-Z!][\s\S]*$/i.test(tail))
    return s
  return s.slice(0, lastLt)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeParsedLinkNodes(
  value: unknown,
  validateLink: (href: string) => boolean,
): void {
  if (Array.isArray(value)) {
    value.forEach(child => sanitizeParsedLinkNodes(child, validateLink))
    return
  }
  if (!isRecord(value)) return

  if (value.type === 'link' && typeof value.href === 'string' && !validateLink(value.href)) {
    const raw = typeof value.raw === 'string' ? value.raw : String(value.text ?? '')
    Object.keys(value).forEach(key => delete value[key])
    Object.assign(value, { type: 'text', content: raw, raw })
    return
  }

  Object.values(value).forEach(child => sanitizeParsedLinkNodes(child, validateLink))
}

/**
 * 规范化块级数学公式的段落边界（面向流式/AI 输出）
 *
 * 根因：
 * - `markdown-it` 的段落规则会“吞掉”紧随其后的下一行；
 * - 当用户/模型输出形如：
 *   `块级公式：\n$$\n...`
 *   且 `$$` 前没有空行时，`$$` 会被上一段落吞进同一个 paragraph，
 *   导致 block ruler 的 `math_block` 规则**根本拿不到 startLine=$$**，
 *   最终表现为：`$$` 被 inline 规则当成 `math_inline`，块级公式解析失败/闪烁。
 *
 * 解决：
 * - 在“独立一行的 $$”前面，如果上一行是非空文本，则插入一个空行，强制断段。
 * - 这是解析器层面的结构化修复（不是 UI 打补丁），用于保证 math_block 能稳定命中。
 */
function normalizeStandaloneMathBlockDelimiters(markdown: string): string {
  const s = String(markdown ?? '')
  if (!s.includes('$$')) return s

  const lines = s.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    if (trimmed === '$$') {
      const prev = out.length ? out[out.length - 1] ?? '' : ''
      // 上一行是非空文本：插入空行断段，避免 paragraph 吞掉 "$$" 这一行
      if (prev.trim() !== '' && prev.trim() !== '$$') {
        out.push('')
      }
    }
    out.push(line)
  }
  return out.join('\n')
}

export function parseMarkdownToStructure(
  markdown: string,
  md: MarkdownIt,
  options: ParseOptions = {},
): ParsedNode[] {
  // Ensure markdown is a string — guard against null/undefined inputs from callers
  // todo: 下面的特殊 math 其实应该更精确匹配到() 或者 $$ $$ 或者 \[ \] 内部的内容
  let safeMarkdown = (markdown ?? '').toString().replace(/([^\\])\r(ight|ho)/g, '$1\\r$2').replace(/([^\\])\n(abla|eq|ot|exists)/g, '$1\\n$2')
  if (safeMarkdown.endsWith('- *')) {
    // 放置markdown 解析 - * 会被处理成多个 ul >li 嵌套列表
    safeMarkdown = safeMarkdown.replace(/- \*$/, '- \\*')
  }
  if (/(?:^|\n)\s*-\s*$/.test(safeMarkdown)) {
    // streaming 中间态：单独的 "-" 行（或以换行结尾的 "-\n"）会被渲染成文本/列表前缀，
    // 也会导致输入 "---" 时第一个 "-" 先闪出来再跳成 hr。
    safeMarkdown = safeMarkdown.replace(/(?:^|\n)\s*-\s*$/, (m) => {
      return m.startsWith('\n') ? '\n' : ''
    })
  }
  else if (/(?:^|\n)\s*--\s*$/.test(safeMarkdown)) {
    // streaming 中间态：输入 "---" 时的 "--" 前缀也不应该作为文本渲染，避免跳动。
    safeMarkdown = safeMarkdown.replace(/(?:^|\n)\s*--\s*$/, (m) => {
      return m.startsWith('\n') ? '\n' : ''
    })
  }
  else if (/(?:^|\n)\s*>\s*$/.test(safeMarkdown)) {
    // streaming 中间态：单独的 ">" 行会先被识别成 blockquote，导致 UI 闪烁/跳动。
    // 只裁剪末尾这一个 marker，等后续内容到齐再正常解析。
    safeMarkdown = safeMarkdown.replace(/(?:^|\n)\s*>\s*$/, (m) => {
      return m.startsWith('\n') ? '\n' : ''
    })
  }
  else if (/\n\s*[*+]\s*$/.test(safeMarkdown)) {
    // streaming 中间态：单独的 "*"/"+" 行会被识别成空的 list item，导致 UI 闪出一个圆点
    safeMarkdown = safeMarkdown.replace(/\n\s*[*+]\s*$/, '\n')
  }
  else if (/\n[[(]\n*$/.test(safeMarkdown)) {
    // 此时 markdown 解析会出错要跳过
    safeMarkdown = safeMarkdown.replace(/(\n\[|\n\()+\n*$/g, '\n')
  }

  // For custom HTML-like blocks (e.g. <thinking>...</thinking>), markdown-it may
  // keep parsing subsequent lines as part of the HTML block unless there's a
  // blank line boundary. To ensure content immediately following a closing tag
  // (like a list/table/blockquote/fence) is parsed as Markdown blocks, insert
  // a single empty line after the closing tag when the next line begins with a
  // block-level marker.
  if (options.customHtmlTags?.length) {
    const tags = options.customHtmlTags
      .map(t => String(t ?? '').trim())
      .filter(Boolean)
      .map((t) => {
        const m = t.match(/^[<\s/]*([A-Z][\w-]*)/i)
        return (m?.[1] ?? '').toLowerCase()
      })
      .filter(Boolean)

    if (tags.length) {
      // Fast path: no closing tag marker at all.
      if (!safeMarkdown.includes('</')) {
        // no-op
      }
      else {
        for (const tag of tags) {
          const re = new RegExp(
          // After a closing tag at end-of-line, if the next line is not blank
          // (ignoring whitespace) and we're not at end-of-string, insert a
          // blank line to force markdown-it to resume normal block parsing.
          // Restrict to lines that contain ONLY the closing tag (plus whitespace)
          // to avoid affecting inline occurrences like "x</thinking>y".
            String.raw`(^[\t ]*<\s*\/\s*${tag}\s*>[\t ]*)(\r?\n)(?![\t ]*\r?\n|$)`,
            'gim',
          )
          safeMarkdown = safeMarkdown.replace(re, '$1$2$2')
        }
      }
    }
  }

  // 마지막에 남아있는 미완성 '<...'(예: '<fo', '</think') 꼬리 조각은
  // streaming 중간 상태에서 화면에 그대로 찍힐 수 있으므로, markdown-it
  // 파싱 전에 제거한다.
  safeMarkdown = stripDanglingHtmlLikeTail(safeMarkdown)

  // 块级公式：保证 "$$" 这一行能作为独立 block 被 math_block 规则命中
  safeMarkdown = normalizeStandaloneMathBlockDelimiters(safeMarkdown)

  // Get tokens from markdown-it
  const tokens = md.parse(safeMarkdown, {})
  // Defensive: ensure tokens is an array
  if (!tokens || !Array.isArray(tokens))
    return []

  // Allow consumers to transform tokens before processing
  const pre = options.preTransformTokens
  const post = options.postTransformTokens
  let transformedTokens = tokens as unknown as MarkdownToken[]
  if (pre && typeof pre === 'function') {
    transformedTokens = pre(transformedTokens) || transformedTokens
  }

  // Process the tokens into our structured format.
  // Note: markdown-it's `html_block` token.content can be normalized in ways
  // that drop some original lines. Keep the original source around so block
  // parsers can reconstruct raw slices using token.map when needed.
  const internalOptions = {
    ...options,
    __sourceMarkdown: safeMarkdown,
    __customHtmlBlockCursor: 0,
  } as any
  let result = processTokens(transformedTokens, internalOptions)

  // Backwards compatible token-level post hook: if provided and returns
  // a modified token array, re-process tokens and override node-level result.
  if (post && typeof post === 'function') {
    const postResult = post(transformedTokens)
    if (Array.isArray(postResult)) {
      // Backwards compatibility: if the hook returns an array of tokens
      // (they have a `type` string property), re-process them into nodes.
      const first = (postResult as unknown[])[0] as unknown
      const firstType = (first as Record<string, unknown>)?.type
      if (first && typeof firstType === 'string') {
        result = processTokens(postResult as unknown as MarkdownToken[])
      }
      else {
        // Otherwise assume it returned ParsedNode[] and use it as-is
        result = postResult as unknown as ParsedNode[]
      }
    }
  }
  // fixLinkTokens 会为流式中间态重建 link 节点；最终 AST 必须再次服从 markdown-it 的统一安全校验。
  sanitizeParsedLinkNodes(result, md.validateLink.bind(md))
  if (options.debug) {
    console.log('Parsed Markdown Tree Structure:', result)
  }
  return result
}

// Process markdown-it tokens into our structured format
export function processTokens(tokens: MarkdownToken[], options?: ParseOptions): ParsedNode[] {
  // Defensive: ensure tokens is an array
  if (!tokens || !Array.isArray(tokens))
    return []

  const result: ParsedNode[] = []
  let i = 0
  // Note: table token normalization is applied during markdown-it parsing
  // via the `applyFixTableTokens` plugin (core.ruler.after('block')).
  // Link/strong/list-item fixes are applied during the inline stage by
  // their respective plugins. That keeps parsing-time fixes centralized
  // and avoids ad-hoc post-processing here.
  while (i < tokens.length) {
    const handled = parseCommonBlockToken(tokens, i, options, containerTokenHandlers)
    if (handled) {
      result.push(handled[0])
      i = handled[1]
      continue
    }

    const token = tokens[i]
    switch (token.type) {
      case 'paragraph_open':
        result.push(parseParagraph(tokens, i, options))
        i += 3 // Skip paragraph_open, inline, paragraph_close
        break

      case 'bullet_list_open':
      case 'ordered_list_open': {
        const [listNode, newIndex] = parseList(tokens, i, options)
        result.push(listNode)
        i = newIndex
        break
      }

      case 'blockquote_open': {
        const [blockquoteNode, newIndex] = parseBlockquote(tokens, i, options)
        result.push(blockquoteNode)
        i = newIndex
        break
      }

      case 'footnote_anchor':{
        const meta = (token.meta ?? {}) as Record<string, unknown>
        const id = String(meta.label ?? token.content ?? '')
        result.push({
          type: 'footnote_anchor',
          id,
          raw: String(token.content ?? ''),
        } as ParsedNode)

        i++
        break
      }

      case 'hardbreak':
        result.push(parseHardBreak())
        i++
        break

      case 'text': {
        const content = String(token.content ?? '')
        // In stream mode, markdown-it can occasionally emit a root-level `text`
        // token (e.g. immediately after an HTML/custom block closes). Treat it
        // as a normal paragraph so the content isn't dropped.
        result.push({
          type: 'paragraph',
          raw: content,
          children: content
            ? [{ type: 'text', content, raw: content } as ParsedNode]
            : [],
        } as ParsedNode)
        i++
        break
      }

      case 'inline':
        result.push(...parseInlineTokens(token.children || [], String(token.content ?? ''), undefined, {
          requireClosingStrong: options?.requireClosingStrong,
          customHtmlTags: options?.customHtmlTags,
        }))
        i += 1
        break
      default:
        // Handle other token types or skip them
        i += 1
        break
    }
  }

  return result
}

export { parseInlineTokens }
