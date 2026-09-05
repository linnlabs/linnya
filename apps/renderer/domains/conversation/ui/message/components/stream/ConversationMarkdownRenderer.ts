/**
 * @file ConversationMarkdownRenderer.ts
 * @description 会话侧“解析器内嵌 + 自研渲染层”的 Markdown 渲染组件
 *
 * 设计目标：
 * - 只依赖我们内嵌维护的 `stream-markdown-parser`（解析输出 AST）
 * - 渲染层完全由我们掌控：默认用原生 HTML 标签输出，不要求为每个节点写独立 Vue 组件
 * - 只对“必须自定义”的节点使用自研组件（目前：code_block / math_* / reference）
 *
 * 备注：
 * - 这里用 render function，而不是在 template 里直接访问 union 字段，避免类型收敛困难。
 * - 严禁 any 类型断言：通过 ParsedNode 的 discriminated union 做严格分支。
 */

import {
  defineComponent,
  h,
  inject,
  shallowRef,
  watch,
  onBeforeUnmount,
  type PropType,
} from 'vue'
import type { ConversationCitationDependencySnapshot } from '@app/schemas'
import {
  getMarkdown,
  parseMarkdownToStructure,
  type CodeBlockNode,
  type MathBlockNode,
  type MathInlineNode,
  type ParsedNode,
  type ReferenceNode,
  type MarkdownToken,
} from 'stream-markdown-parser'

import ConversationCodeBlockNode from '../markstream/ConversationCodeBlockNode.vue'
import ConversationReferenceNode from '../markstream/ConversationReferenceNode.vue'
import ConversationCitationNode from '../citation/ConversationCitationNode.vue'
// 注意：目录内同时存在同名 .ts/.vue 时，无后缀 import 可能命中旧实现；这里显式指向 .vue
import ConversationMathInlineNode from './ConversationMathInlineNode.vue'
import ConversationMathBlockNode from './ConversationMathBlockNode.vue'
import ConversationMarkdownBlock, {
  type ConversationMarkdownRenderContext,
  type ConversationMarkdownVNodeChild,
} from './ConversationMarkdownBlock'
import { createMarkdownParseDebug } from './markdownParseDebug'
import { createMarkdownParseScheduler } from './createMarkdownParseScheduler'
import { reconcileStreamingMarkdownNodes } from './reconcileStreamingMarkdownNodes'
import ConversationResourceLinkNode from '../../../../features/resource-link/ui/ConversationResourceLinkNode.vue'
import { isMarkdownFileLocatorCandidate } from '../../../../features/resource-link/functions/normalizeMarkdownFileLocatorHref'
import { CONVERSATION_RENDER_SCHEDULING_PORT_KEY } from '../../../../definitions/conversationRenderScheduling'

type RecordLike = Record<string, unknown>

function isRecordLike(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null
}

function isParsedNodeLike(value: unknown): value is ParsedNode {
  if (!isRecordLike(value)) return false
  const type = value.type
  const raw = value.raw
  return typeof type === 'string' && typeof raw === 'string'
}

function getChildren(value: unknown): ParsedNode[] {
  if (!Array.isArray(value)) return []
  return value.filter(isParsedNodeLike)
}

function readPlainText(nodes: ParsedNode[]): string {
  return nodes.map((node) => {
    if (node.type === 'text' && hasStringProp(node, 'content')) {
      return String((node as RecordLike).content)
    }
    if (node.type === 'inline_code' && hasStringProp(node, 'code')) {
      return String((node as RecordLike).code)
    }
    return readPlainText(getChildren((node as RecordLike).children))
  }).join('')
}

function hasStringProp(node: ParsedNode, key: string): boolean {
  if (!isRecordLike(node)) return false
  return typeof (node as RecordLike)[key] === 'string'
}

function hasNumberProp(node: ParsedNode, key: string): boolean {
  if (!isRecordLike(node)) return false
  return typeof (node as RecordLike)[key] === 'number' && Number.isFinite((node as RecordLike)[key] as number)
}

function hasBooleanProp(node: ParsedNode, key: string): boolean {
  if (!isRecordLike(node)) return false
  return typeof (node as RecordLike)[key] === 'boolean'
}

function normalizeSoftbreakTokens(tokens: MarkdownToken[]): MarkdownToken[] {
  const stack: MarkdownToken[] = [...tokens]
  while (stack.length) {
    const token = stack.pop()
    if (!token) continue
    if (token.type === 'softbreak') {
      token.type = 'hardbreak'
    }
    const children = (token as { children?: MarkdownToken[] }).children
    if (Array.isArray(children) && children.length) {
      stack.push(...children)
    }
  }
  return tokens
}

const REF_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const REF_LEN = 6
// 支持两种引用：
// - [#XXXXXX]：编辑器段落引用
// - [@XXXXXX]：知识库稳定短引用
/**
 * 引用解析规则（会话渲染层）
 *
 * 支持：
 * - 编辑器段落引用：[#XXXXXX]
 * - 知识库引用：[@XXXXXX]
 * - ✅ 兼容“聚合引用”（模型偶发输出）：[@AAAAAA; @BBBBBB] / [@AAAAAA, @BBBBBB]
 *
 * 说明：
 * - “聚合引用”仍然是若干个稳定短 ref 的集合；渲染时会拆成多个 ConversationCitationNode。
 * - 分隔符仅支持 `;` / `,`，并允许两侧空格。
 */
const REFERENCE_TEXT_RE = new RegExp(
  /**
   * vNext 扩展（跨文档引用）：
   * - 允许模型输出：[#aZ3kP9@<documentId>] 或 [#aZ3kP9@<documentType>:<documentId>]
   * - 说明：这里只负责“识别并切分出引用 token”，具体解析/跳转由 ConversationReferenceNode 负责。
   *
   * 注意：
   * - documentId 不做格式假设（uuid / 自定义 id 都可），但禁止空白与 `]`；
   * - 仍保持对 legacy `[#aZ3kP9]` 的兼容。
   */
  `\\[#([${REF_CHARSET}]{${REF_LEN}})(?:@([^\\]\\s]+))?\\]|\\[@[${REF_CHARSET}]{${REF_LEN}}(?:\\s*[;,]\\s*@[${REF_CHARSET}]{${REF_LEN}})*\\]`,
  'g'
)
const KB_REF_TOKEN_RE = new RegExp(`@([${REF_CHARSET}]{${REF_LEN}})`, 'g')
const INLINE_CODE_REF_RE = new RegExp(`^\\[#([${REF_CHARSET}]{${REF_LEN}})(?:@([^\\]\\s]+))?\\]$`)

function getOrAssignCitationDisplayIndex(ctx: ConversationMarkdownRenderContext, key: string): number {
  const existing = ctx.citationDisplayState.map.get(key)
  if (typeof existing === 'number') return existing
  const next = ctx.citationDisplayState.next
  ctx.citationDisplayState.map.set(key, next)
  ctx.citationDisplayState.next = next + 1
  return next
}

function normalizeCustomAttrs(attrs: unknown): Record<string, string | boolean> | undefined {
  if (!attrs) return undefined
  const result: Record<string, string | boolean> = Object.create(null) as Record<string, string | boolean>

  const setAttr = (name: unknown, value: unknown) => {
    const key = String(name ?? '').trim()
    if (!key) return
    if (value === '' || value === true) {
      result[key] = true
      return
    }
    if (value == null) return
    result[key] = String(value)
  }

  if (Array.isArray(attrs)) {
    for (const entry of attrs) {
      if (Array.isArray(entry)) {
        setAttr(entry[0], entry[1])
      }
      else if (isRecordLike(entry) && 'name' in entry) {
        const rec = entry as RecordLike
        setAttr(rec.name, rec.value)
      }
    }
  }
  else if (isRecordLike(attrs)) {
    for (const [key, value] of Object.entries(attrs)) {
      setAttr(key, value)
    }
  }

  return Object.keys(result).length ? result : undefined
}

function mergeClassValue(existing: unknown, extra: string): string {
  const base = typeof existing === 'string' ? existing.trim() : ''
  return base ? `${base} ${extra}` : extra
}

function renderNode(
  node: ParsedNode,
  ctx: ConversationMarkdownRenderContext,
): ConversationMarkdownVNodeChild {
  switch (node.type) {
    case 'text': {
      const content = hasStringProp(node, 'content') ? String((node as RecordLike).content) : ''
      if (!content) return ''
      REFERENCE_TEXT_RE.lastIndex = 0
      if (!REFERENCE_TEXT_RE.test(content)) {
        return content
      }
      REFERENCE_TEXT_RE.lastIndex = 0
      const parts: ConversationMarkdownVNodeChild[] = []
      let lastIndex = 0
      let match: RegExpExecArray | null = null
      while ((match = REFERENCE_TEXT_RE.exec(content)) !== null) {
        const start = match.index ?? 0
        if (start > lastIndex) {
          parts.push(content.slice(lastIndex, start))
        }
        const raw = match[0]
        const refFromHash = match[1]  // [#aZ3kP9] / [#aZ3kP9@docId] 格式 -> 工作区引用
        const docHint = match[2]      // 可选：@<documentId> 或 @<documentType>:<documentId>

        if (refFromHash) {
          // 编辑器引用：使用 ConversationReferenceNode
          const id = docHint ? `#${refFromHash}@${docHint}` : `#${refFromHash}`
          const n: ReferenceNode = { type: 'reference', id, raw }
          parts.push(h(ConversationReferenceNode, { node: n, turnId: ctx.turnId }))
        } else {
          /**
           * 知识库引用（推荐）：`[@XXXXXX]`
           * 兼容：`[@AAAAAA; @BBBBBB]` / `[@AAAAAA, @BBBBBB]`
           *
           * 处理策略：
           * - 从 raw 中提取所有 `@ref` token；
           * - 逐个渲染为 ConversationCitationNode（展示序号按“在答案中首次出现顺序”重排为 1..N）。
           */
          KB_REF_TOKEN_RE.lastIndex = 0
          const refs: string[] = []
          let m: RegExpExecArray | null = null
          while ((m = KB_REF_TOKEN_RE.exec(raw)) !== null) {
            const r = m[1]
            if (typeof r === 'string' && r.length === REF_LEN) {
              refs.push(r)
            }
          }

          if (refs.length > 0) {
            for (const ref of refs) {
              const key = `@${ref}`
              const displayIndex = getOrAssignCitationDisplayIndex(ctx, key)
              parts.push(
                h(ConversationCitationNode, {
                  citationRef: ref,
                  displayIndex,
                  turnId: ctx.turnId,
                  citation: ctx.citationDependencies?.citations.find(item => item.ref === ref),
                })
              )
            }
          } else {
            // 理论上不应发生：REFERENCE_TEXT_RE 已保证结构里至少有一个 @ref
            // 这里保持 raw 原样输出，避免内容丢失
            parts.push(raw)
          }
        }
        lastIndex = start + raw.length
      }
      if (lastIndex < content.length) {
        parts.push(content.slice(lastIndex))
      }
      return parts
    }
    case 'paragraph':
      return h('p', { class: 'md-paragraph' }, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'heading': {
      const level = hasNumberProp(node, 'level') ? Number((node as RecordLike).level) : 1
      return h(`h${Math.min(6, Math.max(1, level))}`, { class: 'md-heading' }, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    }
    case 'blockquote':
      return h('blockquote', { class: 'md-blockquote' }, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'list': {
      const ordered = hasBooleanProp(node, 'ordered') ? Boolean((node as RecordLike).ordered) : false
      const tag = ordered ? 'ol' : 'ul'
      const start = (node as RecordLike).start
      const attrs = ordered && typeof start === 'number' && Number.isFinite(start) ? { start } : undefined
      const items = getChildren((node as RecordLike).items)
      return h(tag, attrs, items.map(item => renderNode(item, ctx)))
    }
    case 'list_item': {
      return h('li', {}, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    }
    case 'checkbox':
    case 'checkbox_input': {
      const checked = hasBooleanProp(node, 'checked') ? Boolean((node as RecordLike).checked) : false
      return h('input', {
        type: 'checkbox',
        checked,
        disabled: true,
        class: 'md-task-checkbox',
        'aria-checked': checked ? 'true' : 'false',
      })
    }
    case 'inline_code':
      if (hasStringProp(node, 'code')) {
        const code = String((node as RecordLike).code)
        const trimmed = code.trim()
        const match = INLINE_CODE_REF_RE.exec(trimmed)
        if (match?.[1]) {
          const ref = match[1]
          const docHint = match[2]
          const id = docHint ? `#${ref}@${docHint}` : `#${ref}`
          const n: ReferenceNode = { type: 'reference', id, raw: trimmed }
          return h(ConversationReferenceNode, { node: n, turnId: ctx.turnId })
        }
        return h('code', { class: 'md-inline-code' }, code)
      }
      return h('code', { class: 'md-inline-code' }, '')
    case 'strong':
      return h('strong', {}, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'emphasis':
      return h('em', {}, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'strikethrough':
      return h('s', {}, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'highlight':
      return h('mark', {}, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'insert':
      return h('ins', {}, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'subscript':
      return h('sub', {}, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'superscript':
      return h('sup', {}, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    case 'hardbreak':
      return h('br')
    case 'link': {
      const href = hasStringProp(node, 'href') ? String((node as RecordLike).href) : '#'
      const title = (node as RecordLike).title
      const children = getChildren((node as RecordLike).children)
      if (isMarkdownFileLocatorCandidate(href)) {
        return h(ConversationResourceLinkNode, {
          key: href,
          href,
          authoredTitle: readPlainText(children),
        })
      }
      return h(
        'a',
        {
          href,
          title: typeof title === 'string' ? title : undefined,
          target: '_blank',
          rel: 'noreferrer noopener',
          class: 'md-link',
        },
        children.map(child => renderNode(child, ctx)),
      )
    }
    case 'image':
      return h('img', {
        src: hasStringProp(node, 'src') ? String((node as RecordLike).src) : '',
        alt: hasStringProp(node, 'alt') ? String((node as RecordLike).alt) : '',
        title: hasStringProp(node, 'title') ? String((node as RecordLike).title) : undefined,
        class: 'md-image',
      })
    case 'thematic_break':
      return h('hr', { class: 'md-hr' })
    case 'table': {
      const headerRowRaw = (node as RecordLike).header
      const rowsRaw = (node as RecordLike).rows
      const headerRow = isParsedNodeLike(headerRowRaw) ? renderNode(headerRowRaw, ctx) : null
      const bodyRows = getChildren(rowsRaw).map(r => renderNode(r, ctx))
      return h('table', { class: 'md-table' }, [
        h('thead', {}, [headerRow]),
        h('tbody', {}, bodyRows),
      ])
    }
    case 'table_row': {
      return h('tr', {}, getChildren((node as RecordLike).cells).map(c => renderNode(c, ctx)))
    }
    case 'table_cell': {
      const header = hasBooleanProp(node, 'header') ? Boolean((node as RecordLike).header) : false
      const tag = header ? 'th' : 'td'
      const align = (node as RecordLike).align
      const style = typeof align === 'string' ? { textAlign: align } : undefined
      return h(tag, { style }, getChildren((node as RecordLike).children).map(child => renderNode(child, ctx)))
    }
    case 'code_block': {
      const language = hasStringProp(node, 'language') ? String((node as RecordLike).language) : 'plaintext'
      const code = hasStringProp(node, 'code') ? String((node as RecordLike).code) : ''
      const raw = hasStringProp(node, 'raw') ? String((node as RecordLike).raw) : code
      const loading = typeof (node as RecordLike).loading === 'boolean' ? Boolean((node as RecordLike).loading) : false
      const n: CodeBlockNode = {
        type: 'code_block',
        language,
        code,
        raw,
        loading,
      }
      // 使用我们已有的代码块组件（复制按钮/高亮/流式光标）
      // 关键：只在代码块仍处于 mid-state（未闭合）时显示流式光标，避免“最后永远一个 |”
      return h(ConversationCodeBlockNode, { node: n, stream: false, loading: n.loading })
    }
    case 'math_inline': {
      const content = hasStringProp(node, 'content') ? String((node as RecordLike).content) : ''
      const loading = hasBooleanProp(node, 'loading') ? Boolean((node as RecordLike).loading) : false
      const n: MathInlineNode = {
        type: 'math_inline',
        content,
        loading,
        raw: hasStringProp(node, 'raw') ? String((node as RecordLike).raw) : `$${content}$`,
      }
      return h(ConversationMathInlineNode, { node: n, isStreaming: ctx.isStreaming })
    }
    case 'math_block': {
      const content = hasStringProp(node, 'content') ? String((node as RecordLike).content) : ''
      const loading = hasBooleanProp(node, 'loading') ? Boolean((node as RecordLike).loading) : false
      const n: MathBlockNode = {
        type: 'math_block',
        content,
        loading,
        raw: hasStringProp(node, 'raw') ? String((node as RecordLike).raw) : `$$${content}$$`,
      }
      return h(ConversationMathBlockNode, { node: n, isStreaming: ctx.isStreaming })
    }
    case 'reference': {
      const id = hasStringProp(node, 'id') ? String((node as RecordLike).id) : ''
      const raw = hasStringProp(node, 'raw') ? String((node as RecordLike).raw) : id
      /**
       * 重要：stream-markdown-parser 内置 legacy reference 规则，会把纯数字的 [1] 解析成 reference 节点。
       * 新引用体系不再支持数字引用，因此：
       * - 遇到纯数字 reference：按“普通文本”原样输出，避免误当段落引用（#1）
       * - 其他 reference：仍按编辑器段落引用处理（[#XXXXXX] -> ConversationReferenceNode）
       */
      if (id && /^\d+$/.test(id)) {
        return raw
      }

      const n: ReferenceNode = { type: 'reference', id, raw }
      return h(ConversationReferenceNode, { node: n, turnId: ctx.turnId })
    }
    case 'details': {
      const attrs = normalizeCustomAttrs((node as RecordLike).attrs)
      const content = hasStringProp(node, 'content') ? String((node as RecordLike).content) : ''
      const children = ctx.parseMarkdown ? ctx.parseMarkdown(content) : []
      const mergedAttrs = {
        ...(attrs ?? {}),
        class: mergeClassValue(attrs?.class, 'md-details'),
      }
      return h('details', mergedAttrs, children.map(child => renderNode(child, ctx)))
    }
    case 'summary': {
      const attrs = normalizeCustomAttrs((node as RecordLike).attrs)
      const mergedAttrs = {
        ...(attrs ?? {}),
        class: mergeClassValue(attrs?.class, 'md-summary'),
      }
      const children = getChildren((node as RecordLike).children)
      if (children.length) {
        return h('summary', mergedAttrs, children.map(child => renderNode(child, ctx)))
      }
      const content = hasStringProp(node, 'content') ? String((node as RecordLike).content) : ''
      return h('summary', mergedAttrs, content)
    }
    case 'u': {
      const attrs = normalizeCustomAttrs((node as RecordLike).attrs)
      const mergedAttrs = {
        ...(attrs ?? {}),
        class: mergeClassValue(attrs?.class, 'md-underline'),
      }
      const children = getChildren((node as RecordLike).children)
      if (children.length) {
        return h('u', mergedAttrs, children.map(child => renderNode(child, ctx)))
      }
      const content = hasStringProp(node, 'content') ? String((node as RecordLike).content) : ''
      return h('u', mergedAttrs, content)
    }
    case 'html_inline':
      // 会话里暂时保留：直接输出原始片段（注意：如果未来需要安全控制，应在解析器层做白名单）
      return h('span', { class: 'md-html-inline' }, hasStringProp(node, 'content') ? String((node as RecordLike).content) : '')
    case 'html_block':
      return h('div', { class: 'md-html-block' }, hasStringProp(node, 'content') ? String((node as RecordLike).content) : '')
    default:
      // 未知节点：直接展示 raw，保证内容不丢
      return h('span', { class: 'md-unknown' }, String(node.raw ?? ''))
  }
}

export default defineComponent({
  name: 'ConversationMarkdownRenderer',
  props: {
    content: { type: String, required: true },
    isStreaming: { type: Boolean, default: false },
    /** 对话轮次 ID（供引用 transfer DOM 标注归属） */
    turnId: { type: String, default: undefined },
    citationDependencies: {
      type: Object as PropType<ConversationCitationDependencySnapshot>,
      default: undefined,
    },
  },
  setup(props) {
    const renderScheduling = inject(CONVERSATION_RENDER_SCHEDULING_PORT_KEY, null)
    // 同一个渲染实例复用同一个 md 对象，避免频繁 new
    const md = getMarkdown('conversation-message', {
      // 文件 locator 仍由 Conversation resource-link owner 做结构与权限校验；解析器只负责保留 AST。
      allowedLinkProtocols: ['workspace', 'conversation', 'file'],
    })
    const parseMarkdown = (markdown: string) => parseMarkdownToStructure(markdown, md, {
      customHtmlTags: ['details', 'summary', 'u'],
      preTransformTokens: normalizeSoftbreakTokens,
    })

    const nodes = shallowRef<ParsedNode[]>([])
    const citationDisplayState: ConversationMarkdownRenderContext['citationDisplayState'] = {
      map: new Map<string, number>(),
      next: 1,
    }
    let parsedMarkdown = ''
    const parseDebug = createMarkdownParseDebug(import.meta.env.VITE_CONVERSATION_MARKDOWN_DEBUG)

    /**
     * 中文说明（性能）：
     * - 关键卡顿根因候选之一：流式输出阶段，content 会持续增长且更新频繁；
     * - 若每个 chunk 都做一次“全量 parse”，耗时会随 contentLength 线性增长，表现为“越到后面越卡”；
     * - 这里引入节流：isStreaming=true 时，最多每 50ms 解析一次，把 burst 合并掉。
     */
    const STREAM_PARSE_THROTTLE_MS = 50
    const parseAndSetNodes = (markdown: string, reason: 'immediate' | 'throttled') => {
      void reason
      const nextNodes = parseMarkdown(markdown)
      const isAppendOnly = markdown.startsWith(parsedMarkdown)
      if (!isAppendOnly) {
        citationDisplayState.map.clear()
        citationDisplayState.next = 1
      }
      nodes.value = reconcileStreamingMarkdownNodes({
        previousMarkdown: parsedMarkdown,
        nextMarkdown: markdown,
        previousNodes: nodes.value,
        nextNodes,
      })
      parsedMarkdown = markdown
    }
    const parseScheduler = createMarkdownParseScheduler({
      throttleMs: STREAM_PARSE_THROTTLE_MS,
      parse: parseAndSetNodes,
    })

    watch(
      () => renderScheduling?.isContentWidthChanging() ?? false,
      isChanging => parseScheduler.setSuspended(isChanging),
      { immediate: true, flush: 'sync' },
    )

    onBeforeUnmount(() => {
      parseScheduler.dispose()
    })

    watch(
      () => [props.content, props.isStreaming] as const,
      ([markdown, isStreaming]) => {
        // ✅ 性能策略：流式阶段节流解析；非流式则立即解析，保证最终态准确
        // 例外：开启 markdown debug 且命中高信号内容时，强制立即解析，便于定位公式漂移根因
        if (parseDebug.shouldParseImmediately(markdown)) {
          parseScheduler.update(markdown, 'immediate')
        } else if (isStreaming) {
          parseScheduler.update(markdown, 'throttled')
        } else {
          parseScheduler.update(markdown, 'immediate')
        }

        parseDebug.inspect(markdown, nodes.value, isStreaming)
      },
      { immediate: true },
    )

    return () => {
      return h(
        'div',
        { class: 'conversation-markdown-renderer' },
        nodes.value.map((node, index) => h(ConversationMarkdownBlock, {
          key: `${index}:${node.type}`,
          node,
          isStreaming: props.isStreaming && index === nodes.value.length - 1,
          parseMarkdown,
          renderNode,
          turnId: props.turnId,
          citationDependencies: props.citationDependencies,
          citationDisplayState,
        })),
      )
    }
  },
})
