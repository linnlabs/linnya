// apps/renderer/shared/utils/markdownSerializer.ts
import { MarkdownSerializer, MarkdownSerializerState } from 'prosemirror-markdown'
import { Mark as ProseMirrorMark, Node as ProsemirrorNode } from 'prosemirror-model'
import {
  MarkdownAnnotationsSchema,
  encodeMarkdownAnnotationComment,
} from '@app/schemas'

// 类型定义
type NodeSerializer = (state: MarkdownSerializerState, node: ProsemirrorNode) => void
type MarkSerializer = {
  open: string | ((state: MarkdownSerializerState, mark: ProseMirrorMark) => string)
  close: string | ((state: MarkdownSerializerState, mark: ProseMirrorMark) => string)
  mixable?: boolean
  expelEnclosingWhitespace?: boolean
}

/**
 * ==================== 类型安全辅助（禁止 any 类型断言） ====================
 *
 * prosemirror-markdown 的 MarkdownSerializerState 在类型定义上没有暴露：
 * - state.options
 * - state.nodes
 *
 * 但运行时确实存在，因此我们用 `unknown` + 结构化类型做安全收敛，避免 `as any`。
 */
type LineBreakStyle = 'newline'

type MarkdownSerializerOptionsLike = {
  lineBreakStyle?: LineBreakStyle
  labels?: MarkdownSerializerLabels
}

type MarkdownSerializerStateLike = MarkdownSerializerState & {
  options?: MarkdownSerializerOptionsLike
  nodes?: Record<string, unknown>
}

function getLineBreakStyle(state: MarkdownSerializerState): LineBreakStyle | undefined {
  const s = state as unknown as MarkdownSerializerStateLike
  return s.options?.lineBreakStyle
}

function getNodesBag(state: MarkdownSerializerState): Record<string, unknown> {
  const s = state as unknown as MarkdownSerializerStateLike
  return s.nodes ?? {}
}

export interface MarkdownSerializerLabels {
  bibliographyTitle: string
  imageAlt: string
  imageDescription: (params: {
    alt: string
    width?: number | string
    height?: number | string
  }) => string
}

const DEFAULT_MARKDOWN_SERIALIZER_LABELS: MarkdownSerializerLabels = {
  bibliographyTitle: 'References',
  imageAlt: 'Image',
  imageDescription: ({ alt, width, height }) => {
    let description = `[Image: ${alt}`
    if (width || height) {
      if (width) description += `, width ${width}px`
      if (height) description += `, height ${height}px`
    }
    return `${description}]`
  },
}

function getMarkdownSerializerLabels(state: MarkdownSerializerState): MarkdownSerializerLabels {
  const s = state as unknown as MarkdownSerializerStateLike
  return s.options?.labels ?? DEFAULT_MARKDOWN_SERIALIZER_LABELS
}

function normalizeSerializeOptions(options: unknown): Record<string, unknown> {
  if (!options || typeof options !== 'object') return {}
  // options 可能来自第三方调用方，这里只做结构化收敛，避免 any
  return options as Record<string, unknown>
}

// 定义节点序列化规则
const nodes: { [key: string]: NodeSerializer } = {
  doc(state, node) {
    state.renderContent(node)
  },
  text(state, node) {
    state.text(node.text || '')
  },
  rootBlock(state, node) {
    state.renderContent(node)
    const annotations = MarkdownAnnotationsSchema.parse(node.attrs.annotations ?? [])
    for (const annotation of annotations) {
      state.ensureNewLine()
      state.write(encodeMarkdownAnnotationComment(annotation))
      state.closeBlock(node)
    }
  },
  baseBlock(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    if (lineBreakStyle === 'newline') {
      // "newline" 模式：将所有内容都放在同一行，用字面量 \n 分隔
      if (node.content.size === 0) {
        // 空块：写入字面量 \n
        state.write('\\n')
      } else {
        // 有内容的块：渲染内容，然后添加字面量 \\n\\n 作为分隔符
        state.renderInline(node)
        state.write('\\n\\n')
      }
      return
    }

    // 默认行为：类似于段落
    state.renderInline(node)
    state.closeBlock(node)
  },
  headingBlock(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    // 根据 level 属性生成对应数量的 '#'
    state.write(state.repeat('#', node.attrs.level) + ' ')
    state.renderInline(node)

    if (lineBreakStyle === 'newline') {
      // "newline" 模式：使用字面量分隔符
      state.write('\\n\\n')
    } else {
      // 标准模式：使用正常的块分隔
      state.closeBlock(node)
    }
  },
  quoteBlock(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    state.write('> ')
    state.renderInline(node)

    if (lineBreakStyle === 'newline') {
      state.write('\\n\\n')
    } else {
      state.closeBlock(node)
    }
  },
  codeBlock(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    if (lineBreakStyle === 'newline') {
      // "newline" 模式：所有内容都在一行，包括代码块
      state.write('```' + (node.attrs.language || '') + '\\n')
      state.write(node.textContent.replace(/\n/g, '\\n')) // 将代码中的换行也转为字面量
      state.write('\\n```\\n\\n')
    } else {
      // 标准模式
      state.write('```' + (node.attrs.language || '') + '\n')
      state.text(node.textContent, false)
      state.ensureNewLine()
      state.write('```')
      state.closeBlock(node)
    }
  },
  listItemBlock(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    // 根据 level 进行缩进，每个 level 两个空格
    state.write(state.repeat('  ', node.attrs.level))

    // 列表 marker：
    // - bullet：使用 "* "（与现有解析兼容）
    // - ordered：默认 "1. "（Markdown 允许所有行都用 1.，解析器仍能识别为有序列表）；
    //   若节点上有显式的 start（例如用户输入了 "5. "），则首项输出 "${start}. "，
    //   后续项继续 "1. "。这样导出再粘贴回别处，能保留用户的起始数字意图。
    if (node.attrs.listType === 'ordered') {
      const startRaw = node.attrs.start
      const start =
        typeof startRaw === 'number' && Number.isFinite(startRaw) && startRaw > 0
          ? Math.floor(startRaw)
          : 1
      state.write(`${start}. `)
    } else {
      state.write('* ')
    }

    state.renderInline(node)

    if (lineBreakStyle === 'newline') {
      state.write('\\n')
    } else {
      state.closeBlock(node)
    }
  },
  table(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    // The `table` node itself doesn't render anything, it just contains rows.
    // We delegate the rendering to the `tableRow` children.
    state.renderContent(node)

    if (lineBreakStyle === 'newline') {
      state.write('\\n\\n')
    } else {
      state.closeBlock(node)
    }
  },
  tableRow(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    // Render the row with pipes.
    state.write('| ')
    node.forEach((cell, _, i) => {
      if (i > 0) state.write(' | ')
      state.renderContent(cell) // This will call tableCell/tableHeader serializers.
    })
    state.write(' |')

    if (lineBreakStyle === 'newline') {
      state.write('\\n')
    } else {
      state.ensureNewLine()
    }

    // After rendering the row, check if it was a header row.
    // If so, render the separator line underneath.
    const firstCell = node.firstChild
    if (firstCell && firstCell.type.name === 'tableHeader') {
      state.write('|')
      node.forEach(_cell => {
        // A simple separator is used. Calculating precise width is complex
        // and not essential for valid Markdown.
        state.write('---|')
      })
      if (lineBreakStyle === 'newline') {
        state.write('\\n')
      } else {
        state.ensureNewLine()
      }
    }
  },
  tableHeader(state, node) {
    // Delegate rendering to the content block inside the header cell.
    state.renderContent(node)
  },
  tableCell(state, node) {
    // Delegate rendering to the content block inside the cell.
    state.renderContent(node)
  },
  tableCellContentBlock(state, node) {
    // 这里需要临时替换 text 和 hardBreak 的序列化，避免表格单元格中出现换行。
    // 注意：state.nodes 在运行时存在，但类型未暴露，因此通过 getNodesBag 安全访问。
    const nodesBag = getNodesBag(state)
    const originalTextSerializer = nodesBag['text']
    const originalHardBreakSerializer = nodesBag['hardBreak']

    nodesBag['text'] = (currentState: MarkdownSerializerState, textNode: ProsemirrorNode) => {
      if (textNode.text) {
        // Replace any newline characters with a space.
        currentState.text(textNode.text.replace(/\r\n?|\n/g, ' '))
      }
    }

    nodesBag['hardBreak'] = (currentState: MarkdownSerializerState, _node: ProsemirrorNode) => {
      // 在表格中，将 hardBreak 序列化为 <br> 标签
      currentState.write('<br>')
    }

    state.renderInline(node)

    // Restore the original serializers to not affect other parts of the document.
    nodesBag['text'] = originalTextSerializer
    nodesBag['hardBreak'] = originalHardBreakSerializer
  },
  bibliographyBlock(state, node) {
    /**
     * 参考文献块（系统块）序列化（根因修复）
     *
     * 根因：
     * - BibliographyBlock 是 atom NodeView，真实条目来自 citation 派生状态；
     * - 但在 Markdown 序列化阶段我们拿不到派生状态，因此只能输出一个“可读占位”；
     * - 关键目标是：不要因为不支持该 token 而导致整个 Markdown 序列化失败（复制/导出回退）。
     */
    const lineBreakStyle = getLineBreakStyle(state)

    // 使用二级标题，外部应用（Notion/Markdown 渲染器）兼容性最好
    state.write(`## ${getMarkdownSerializerLabels(state).bibliographyTitle}`)

    if (lineBreakStyle === 'newline') {
      state.write('\\n\\n')
    } else {
      state.closeBlock(node)
    }
  },
  horizontalRuleBlock(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    state.write('---')

    if (lineBreakStyle === 'newline') {
      state.write('\\n\\n')
    } else {
      state.closeBlock(node)
    }
  },
  imageBlock(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    const labels = getMarkdownSerializerLabels(state)
    const alt = node.attrs.alt || labels.imageAlt
    const width = node.attrs.width
    const height = node.attrs.height

    state.write(labels.imageDescription({ alt, width, height }))

    if (lineBreakStyle === 'newline') {
      state.write('\\n\\n')
    } else {
      state.closeBlock(node)
    }
  },
  latexBlock(state, node) {
    const lineBreakStyle = getLineBreakStyle(state)

    if (lineBreakStyle === 'newline') {
      // "newline" 模式：所有内容都在一行，包括代码块
      state.write('```latex\\n')
      state.write((node.attrs.latexSource || '').replace(/\n/g, '\\n')) // 将代码中的换行也转为字面量
      state.write('\\n```\\n\\n')
    } else {
      // 标准模式
      state.write('```latex\n')
      state.text(node.attrs.latexSource || '', false)
      state.ensureNewLine()
      state.write('```')
      state.closeBlock(node)
    }
  },
  // 新增：内联 LaTeX 节点，序列化为 $...$
  inlineLatex(state, node) {
    // 优先从 attrs 读取源字符串，否则回退到 textContent
    const source =
      node.attrs && typeof node.attrs.latexSource === 'string'
        ? (node.attrs.latexSource as string)
        : node.textContent || ''
    // 避免内容中的 $ 破坏包裹符
    const escaped = source.replace(/\$/g, '\\$')
    state.write(`$${escaped}$`)
  },
  citationNode(state, node) {
    // 编号是编辑器视图派生值；Markdown 必须投影稳定的 canonical ref。
    const ref = typeof node.attrs.ref === 'string' ? node.attrs.ref.trim() : ''
    if (ref) {
      state.write(`[@${ref}]`)
      return
    }
    state.write(node.attrs.sourceType === 'manual' ? '【manual citation】' : '【invalid citation】')
  },
}

// 定义标记序列化规则 (如果需要)
const marks: { [key: string]: MarkSerializer } = {
  // 加粗（对应 tiptap 的 mark 名称：bold）
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  // 斜体（对应 tiptap 的 mark 名称：italic）
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  // 行内代码
  code: { open: '`', close: '`', mixable: true, expelEnclosingWhitespace: true },
  // 删除线
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  link: {
    open: '[',
    close: (_state, mark) => {
      const href = String(mark.attrs.href ?? '').replace(/[()]/g, '\\$&')
      const title =
        typeof mark.attrs.title === 'string' && mark.attrs.title.length > 0
          ? ` "${mark.attrs.title.replace(/"/g, '\\"')}"`
          : ''
      return `](${href}${title})`
    },
    mixable: false,
  },
  /**
   * ==================== 自定义 Mark：Markdown 无法完整表达时的“透传”策略 ====================
   *
   * 根因说明（中文）：
   * - prosemirror-markdown 遇到未声明的 mark，会直接抛错：
   *   `Mark type xxx not supported by Markdown renderer`
   * - 我们编辑器里有多种自定义 mark（revisionMark / textColor / textHighlight 等），
   *   若不在这里声明，就会导致“复制/导出 Markdown 失败并回退”，进而影响剪贴板的语义化 HTML 输出。
   *
   * 策略：
   * - 这些 mark 的“语义/样式”在 Markdown 里难以一一对应；
   * - 但其包裹的**可见文本**必须保留；
   * - 因此采用 open/close 为空字符串的方式“只保留文本，不保留 mark 语义”，避免抛错。
   */
  revisionMark: { open: '', close: '', mixable: true },
  textColor: { open: '', close: '', mixable: true },
  textHighlight: { open: '', close: '', mixable: true },
}

// 导出设置类型
export interface MarkdownExportSettings {
  escapeSpecialChars?: boolean
  lineBreakStyle?: 'standard' | 'newline'
  labels?: MarkdownSerializerLabels
}

// 创建具有设置的序列化器工厂函数
export function createMarkdownSerializer(settings: MarkdownExportSettings = {}) {
  const { escapeSpecialChars = true, lineBreakStyle = 'standard' } = settings

  // 创建带有特殊字符转义功能的文本处理函数
  const escapeText = (text: string) => {
    if (!escapeSpecialChars) return text

    return text
      .replace(/\\/g, '\\\\') // 反斜杠
      .replace(/\*/g, '\\*') // 星号
      .replace(/_/g, '\\_') // 下划线
      .replace(/#/g, '\\#') // 井号
      .replace(/\[/g, '\\[') // 左方括号
      .replace(/\]/g, '\\]') // 右方括号
      .replace(/\(/g, '\\(') // 左圆括号
      .replace(/\)/g, '\\)') // 右圆括号
      .replace(/`/g, '\\`') // 反引号
      .replace(/~/g, '\\~') // 波浪号
      .replace(/>/g, '\\>') // 大于号
      .replace(/\|/g, '\\|') // 竖线
  }

  // 修改节点序列化规则以支持设置
  const customNodes = { ...nodes }

  // 添加 hardBreak 节点的自定义序列化逻辑
  customNodes.hardBreak = (state: MarkdownSerializerState, _node: ProsemirrorNode) => {
    if (lineBreakStyle === 'newline') {
      // "newline" 风格：写入字面量 `\n`
      state.write('\\n')
    } else {
      // "standard" 风格：写入 Markdown 标准的硬换行（两个空格 + 换行符）
      state.write('  \n')
    }
  }

  // 重写文本节点以支持转义
  customNodes.text = (state: MarkdownSerializerState, node: ProsemirrorNode) => {
    if (node.text) {
      state.text(escapeText(node.text))
    }
  }

  const serializer = new MarkdownSerializer(customNodes, marks)

  // 包装 serialize 方法以应用最终处理
  const originalSerialize = serializer.serialize.bind(serializer)
  serializer.serialize = function (content: ProsemirrorNode, options?: unknown) {
    // 将 markdown-it 风格的 options 传递给 state
    // 这使得我们可以在节点序列化函数中访问 lineBreakStyle
    const stateOptions = { ...normalizeSerializeOptions(options), ...settings }

    // @ts-ignore - ProseMirror-markdown 的类型定义可能不完整
    const result = originalSerialize(content, stateOptions)

    return result
  }

  return serializer
}

// 保持向后兼容的默认导出
export const markdownSerializer = createMarkdownSerializer()

/**
 * 剪贴板专用序列化器（不转义特殊字符）
 *
 * 根因说明（中文）：
 * - 默认 markdownSerializer 为了“导出到 Markdown 文件更安全”，会转义 `[` `]` 等字符；
 * - 但当外部应用（如 Notion）选择读取剪贴板的 `text/plain` 时，这些转义会直接显示成反斜杠：
 *   例如 `[8][5]` 变成 `\\[8\\]\\[5\\]`，影响阅读。
 *
 * 因此在剪贴板场景下，我们禁用 escapeSpecialChars，只保留用户看到的原始文本。
 */
export const clipboardMarkdownSerializer = createMarkdownSerializer({ escapeSpecialChars: false })
