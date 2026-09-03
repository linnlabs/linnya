/**
 * ClipboardCopyExtension.ts
 *
 * 目标（中文）：
 * - 修复“从 Linnya 复制到 Notion/其他富文本应用变成纯文本”的根因。
 * - 根因：我们的节点 HTML 结构以自定义 div/data-* 为主，外部应用（如 Notion）往往不会按富文本解析；
 *   即便剪贴板里有 text/html，它也可能选择 text/plain 分支，从而丢失格式。
 *
 * 方案（根因级）：
 * - 当复制/剪切的 Slice 顶层包含 rootBlock 时，说明用户在复制“块结构内容”；
 * - 此时用 prosemirror-markdown 的 markdownSerializer 生成 Markdown；
 * - 再用 markdown-it 将 Markdown 渲染成“语义化 HTML”（p/h1/ul/ol/li/blockquote/pre...），写入剪贴板的 text/html；
 * - 同时写入 text/markdown（若外部应用支持）与 text/plain（保持现有行为：块复制时 plain 即 Markdown）。
 * - 额外包一层 data-linnya-copy-scope 标记，供我们内部的粘贴清洗逻辑识别“内部富复制来源”。
 *
 * 注意：
 * - 只在“复制块结构”时接管，避免影响普通的“行内选择复制”（例如仅选中一句话）。
 */
import MarkdownIt from 'markdown-it'
import type { PluginSimple, PluginWithOptions } from 'markdown-it'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Slice } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

import { createMarkdownSerializer } from '../../../../shared/utils/markdownSerializer'
import { resolveCurrentEditorMessage } from '../../functions/resolveCurrentEditorMessage'
import { buildEditorMarkdownSerializerLabels } from '../../functions/markdownSerializerLabels'
import { deriveCitations, getBibliographyStyleId } from '../../features/citation/render/citationDerivation'

// markdown-it 插件（项目已依赖）
import markdownItFootnote from 'markdown-it-footnote'
import markdownItIns from 'markdown-it-ins'
import markdownItMark from 'markdown-it-mark'
import markdownItSub from 'markdown-it-sub'
import markdownItSup from 'markdown-it-sup'
import markdownItTaskCheckbox from 'markdown-it-task-checkbox'

/**
 * markdown-it 插件类型适配（根因修复）
 *
 * 根因：
 * - `markdown-it` / `@types/markdown-it` / 部分插件包内置的类型定义，可能出现“同名 MarkdownIt 类型不一致”的情况，
 *   导致 `.use(plugin)` 在 TS 层报 “No overload matches this call”。
 *
 * 处理策略：
 * - 插件在运行时本质是函数（markdown-it 的插件约定）。
 * - 我们先把插件当作 unknown，再在运行时确认其为函数后，
 *   用 `unknown` -> `PluginSimple/PluginWithOptions` 的安全收敛喂给 `.use`。
 *
 * 注意：
 * - 这里严格禁止 `as any`（项目规范），只使用 `unknown` 做类型收敛。
 */
function useMarkdownItPlugin(md: MarkdownIt, plugin: unknown): MarkdownIt {
  if (typeof plugin !== 'function') return md
  return md.use(plugin as unknown as PluginSimple)
}

function useMarkdownItPluginWithOptions(md: MarkdownIt, plugin: unknown, options: unknown): MarkdownIt {
  if (typeof plugin !== 'function') return md
  return md.use(plugin as unknown as PluginWithOptions<unknown>, options)
}

const baseMd = new MarkdownIt({
  html: false, // 剪贴板输出只允许来自 Markdown 的语义化 HTML，禁止注入原始 HTML
  breaks: false,
  linkify: true,
  typographer: true,
})

const md = useMarkdownItPluginWithOptions(
  useMarkdownItPlugin(
    useMarkdownItPlugin(
      useMarkdownItPlugin(
        useMarkdownItPlugin(
          useMarkdownItPlugin(baseMd, markdownItFootnote),
          markdownItIns,
        ),
        markdownItMark,
      ),
      markdownItSub,
    ),
    markdownItSup,
  ),
  // 任务列表：渲染为 <input type="checkbox" ...>，Notion/Word 通常能理解
  markdownItTaskCheckbox,
  { disabled: true, divWrap: false, divClass: 'md-task', idPrefix: 'md-task-' },
)

/**
 * 判断这次“复制/剪切”的内容是否是“块级内容”
 *
 * 根因：
 * - ProseMirror 的 selection.content() 返回的是 Slice；
 * - 当用户只是拖选某个块内部的一段文字时，slice 顶层通常只有 inline 内容（text/marks），不应接管；
 * - 但当用户跨块拖选（比如列表多行、标题+段落），slice 顶层会出现 block 节点，
 *   此时如果不接管，就会回落到我们自定义 DOM（Notion 往往无法识别为列表/标题等）。
 */
function sliceLooksLikeBlockContent(slice: Slice): boolean {
  let isBlocky = false
  slice.content.forEach(node => {
    if (node.isBlock) isBlocky = true
  })
  return isBlocky
}

function sliceContainsNodeType(slice: Slice, nodeTypeName: string): boolean {
  let found = false
  slice.content.descendants(node => {
    if (node.type.name === nodeTypeName) {
      found = true
      return false
    }
    return true
  })
  return found
}

function trySerializeMarkdownFromSlice(view: EditorView, slice: Slice): string | null {
  try {
    // 将 slice.content 装进一个临时 doc，交给 markdownSerializer
    const doc = view.state.schema.topNodeType.create(null, slice.content)
    // 剪贴板场景：禁止转义特殊字符（避免外部看到 \\[ \\]）
    const serializer = createMarkdownSerializer({
      escapeSpecialChars: false,
      labels: buildEditorMarkdownSerializerLabels(resolveCurrentEditorMessage),
    })
    return serializer.serialize(doc)
  } catch (e) {
    // 这里不做“防御性修复”，只是明确地回退到默认 copy 行为
    console.warn('[ClipboardCopyExtension] Markdown 序列化失败，回退到默认复制行为', e)
    return null
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatBibliographyEntryText(entry: ReturnType<typeof deriveCitations>['entries'][number]): string {
  /**
   * 中文说明（根因）：
   * - 之前这里用 `parts.join(' ')` 简单拼接字段，导致对外复制的参考文献缺少
   *   “. / ,” 等分隔标点，看起来像“信息糊成一团”。
   * - 这里改为对齐编辑器内的 Bibliography 视觉规则（见 CitationBibliographyView.vue）：
   *   - 作者后加 “.”；
   *   - 容器标题前加 “. ”；
   *   - 年份/日期前加 “, ”（无论是否有容器标题）；
   */
  const parts: string[] = []

  // 作者：与 UI 保持一致（1人/2人/多作者）
  if (Array.isArray(entry.authors) && entry.authors.length > 0) {
    if (entry.authors.length === 1) parts.push(`${entry.authors[0]}.`)
    else if (entry.authors.length === 2) parts.push(`${entry.authors[0]} & ${entry.authors[1]}.`)
    else parts.push(`${entry.authors[0]} 等.`)
  }

  // 标题（必选展示）
  if (entry.title) {
    parts.push(entry.title)
  }

  // 容器标题：前置 ". "
  if (entry.containerTitle) {
    parts.push(`. ${entry.containerTitle}`)
  }

  // 年份/日期：只提取年份（与 UI 保持一致），前置 ", "
  if (entry.date) {
    const yearMatch = entry.date.match(/\d{4}/)
    const yearOrDate = yearMatch ? yearMatch[0] : entry.date
    parts.push(`, ${yearOrDate}`)
  }

  // 用空格拼接段落，但标点由上面显式生成
  return parts.join(' ').trim()
}

function buildBibliographyHtml(view: EditorView): string {
  const styleId = getBibliographyStyleId(view.state.doc)
  const derivation = deriveCitations(view.state.doc, styleId)
  const entries = derivation.entries

  /**
   * 参考文献 HTML（用于复制到外部应用）
   *
   * 根因说明（中文）：
   * - 外部应用（Notion/Word 等）会把 `<ol><li>` 自动渲染成“1. 2. 3.”；
   * - numeric 风格本身又需要展示 `[1] [2] ...`，因此若用 `<ol>` 会出现 “1. [1] …” 的重复编号，不合理。
   *
   * 解决策略（根因级）：
   * - 不使用 `<ol>` / `<ul>`，改为一条条 `<p>`，让外部应用不会额外加序号；
   * - 参考文献标题由 Markdown 序列化的 `bibliographyBlock` 产出，这里不重复输出标题，只输出条目内容。
  */
  if (!Array.isArray(entries) || entries.length === 0) {
    const emptyText = resolveCurrentEditorMessage('editor.citation.bibliography.empty')
    return `<div data-linnya-bibliography="1"><p>${escapeHtml(emptyText)}</p></div>`
  }

  const paragraphsHtml = entries
    .map(entry => {
      const prefix = styleId === 'numeric' ? `[${entry.numericIndex}] ` : ''
      const mainText = `${prefix}${formatBibliographyEntryText(entry)}`.trim()
      const urlHtml =
        entry.url && typeof entry.url === 'string'
          ? `. <a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.url)}</a>`
          : ''
      return `<p>${escapeHtml(mainText)}${urlHtml}</p>`
    })
    .join('')

  return `<div data-linnya-bibliography="1">${paragraphsHtml}</div>`
}

function handleCopyLikeEvent(view: EditorView, event: Event, isCut: boolean): boolean {
  // 只处理真正的 ClipboardEvent
  if (!(event instanceof ClipboardEvent)) return false
  const clipboardData = event.clipboardData
  if (!clipboardData) return false

  const selection = view.state.selection
  if (selection.empty) return false

  const slice = selection.content()
  if (!sliceLooksLikeBlockContent(slice)) {
    // 非块级复制：交给 ProseMirror 默认逻辑（保留其对行内 mark 的 HTML 序列化）
    return false
  }

  const markdown = trySerializeMarkdownFromSlice(view, slice)
  if (!markdown) return false

  // 语义化 HTML：更容易被 Notion/外部应用识别为富文本
  const semanticHtml = md.render(markdown)

  // bibliograhyBlock 是 atom NodeView，内容来自 plugin state，不在 doc 内；
  // 因此这里需要在 copy 时主动生成一份“可粘贴到外部”的参考文献 HTML。
  const shouldIncludeBibliography = sliceContainsNodeType(slice, 'bibliographyBlock')
  const bibliographyHtml = shouldIncludeBibliography ? buildBibliographyHtml(view) : ''

  // 内部富复制标记：供我们的表格粘贴清洗器识别内部来源，避免误删表格外正文
  const wrappedHtml = `<div data-linnya-copy-scope="1">${semanticHtml}${bibliographyHtml}</div>`

  clipboardData.setData('text/html', wrappedHtml)
  clipboardData.setData('text/plain', markdown)
  // 非标准，但不少应用会读取
  clipboardData.setData('text/markdown', markdown)

  event.preventDefault()

  if (isCut) {
    // cut 需要删除选区内容
    view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
  }

  return true
}

export const ClipboardCopyExtension = Extension.create({
  name: 'clipboardCopyExtension',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('clipboardCopyExtension'),
        props: {
          handleDOMEvents: {
            copy: (view, event) => handleCopyLikeEvent(view, event, false),
            cut: (view, event) => handleCopyLikeEvent(view, event, true),
          },
        },
      }),
    ]
  },
})

export default ClipboardCopyExtension
