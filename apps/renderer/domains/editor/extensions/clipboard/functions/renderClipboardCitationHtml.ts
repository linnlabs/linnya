import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { MarkdownSerializer } from 'prosemirror-markdown'

/**
 * 块复制仍输出外部应用能识别的语义 HTML，但 Citation 不能经过纯 Markdown 丢掉来源快照。
 * 占位串只由本次实际 CitationNode 产生；不把正文里碰巧出现的 [@ref] 猜成引用。
 */
export function renderClipboardCitationHtml(
  doc: ProseMirrorNode,
  serializer: MarkdownSerializer,
  renderMarkdown: (markdown: string) => string,
  ownerDocument: Document,
): string {
  const domSerializer = DOMSerializer.fromSchema(doc.type.schema)
  const citations = new Map<string, string>()
  serializer.nodes.citationNode = (state, node) => {
    const token = `LINNYACITATION${crypto.randomUUID().replace(/-/g, '')}`
    const container = ownerDocument.createElement('div')
    // Markdown 已负责原节点的 marks；这里只序列化 atom，避免嵌套重复的强调标记。
    container.appendChild(domSerializer.serializeNode(node.mark([]), { document: ownerDocument }))
    citations.set(token, container.innerHTML)
    state.write(token)
  }
  let html = renderMarkdown(serializer.serialize(doc))
  for (const [token, citationHtml] of citations) html = html.replace(token, () => citationHtml)
  return html
}
