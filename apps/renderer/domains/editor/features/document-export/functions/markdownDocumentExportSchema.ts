import { getSchema } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'
import { ref } from 'vue'
import { parseEditorDocumentJson } from '../../../functions/parseEditorDocumentJson'

let cachedSchema: Promise<Schema> | null = null

/**
 * 平台 Markdown 文档的生产 schema，与编辑器使用同一份 extension registry。
 *
 * 导出不依赖活动编辑器：没有打开任何文档时也能解析存储的正文。只构造 extension 配置，
 * 不创建 Editor、NodeView 或会话；registry 在第一次导出时才加载，窄入口的其他调用方
 * 不会因此带入完整 Editor 扩展。
 */
function getMarkdownDocumentExportSchema(): Promise<Schema> {
  cachedSchema ??= import('../../../core/extensionRegistry').then(({ getAllExtensions }) =>
    getSchema(getAllExtensions({
      layoutManagerInstance: ref(null),
      findReplaceStore: null,
    })))
  cachedSchema.catch(() => { cachedSchema = null })
  return cachedSchema
}

/** 用打开文档时的同一严格解析读取正文：未知属性或结构不合法都会抛出，不静默丢弃。 */
export async function parseMarkdownDocumentForExport(content: unknown): Promise<ProseMirrorNode> {
  return parseEditorDocumentJson(content, await getMarkdownDocumentExportSchema())
}
