import type { JSONContent } from '@tiptap/core'
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model'

type SchemaTypeWithAttributes = {
  readonly spec: {
    readonly attrs?: Readonly<Record<string, unknown>>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKnownAttributes(params: {
  value: unknown
  schemaType: SchemaTypeWithAttributes
  path: string
  owner: string
}): void {
  const { value, schemaType, path, owner } = params
  if (value === undefined) return
  if (!isRecord(value)) {
    throw new Error(`[EditorDocumentSchema] ${path}.attrs 必须是对象`)
  }

  const knownAttributes = schemaType.spec.attrs ?? {}
  for (const attributeName of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(knownAttributes, attributeName)) {
      throw new Error(
        `[EditorDocumentSchema] ${path} 的 ${owner} 包含未知属性 "${attributeName}"`
      )
    }
  }
}

function assertMarkJson(value: unknown, schema: Schema, path: string): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`[EditorDocumentSchema] ${path} 必须是带 type 的 mark 对象`)
  }

  const markType = schema.marks[value.type]
  if (!markType) {
    throw new Error(`[EditorDocumentSchema] ${path} 包含未知 mark "${value.type}"`)
  }

  assertKnownAttributes({
    value: value.attrs,
    schemaType: markType,
    path,
    owner: `mark "${value.type}"`,
  })
}

function assertNodeJson(value: unknown, schema: Schema, path: string): void {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new Error(`[EditorDocumentSchema] ${path} 必须是带 type 的 node 对象`)
  }

  const nodeType = schema.nodes[value.type]
  if (!nodeType) {
    throw new Error(`[EditorDocumentSchema] ${path} 包含未知 node "${value.type}"`)
  }

  assertKnownAttributes({
    value: value.attrs,
    schemaType: nodeType,
    path,
    owner: `node "${value.type}"`,
  })

  if (value.marks !== undefined) {
    if (!Array.isArray(value.marks)) {
      throw new Error(`[EditorDocumentSchema] ${path}.marks 必须是数组`)
    }
    value.marks.forEach((mark, index) => {
      assertMarkJson(mark, schema, `${path}.marks[${index}]`)
    })
  }

  if (value.content !== undefined) {
    if (!Array.isArray(value.content)) {
      throw new Error(`[EditorDocumentSchema] ${path}.content 必须是数组`)
    }
    value.content.forEach((child, index) => {
      assertNodeJson(child, schema, `${path}.content[${index}]`)
    })
  }

  if (value.type === 'text') {
    if (typeof value.text !== 'string' || value.text.length === 0) {
      throw new Error(`[EditorDocumentSchema] ${path}.text 必须是非空字符串`)
    }
    if (value.content !== undefined) {
      throw new Error(`[EditorDocumentSchema] 文本节点 ${path} 不允许包含 content`)
    }
  } else if (value.text !== undefined) {
    throw new Error(`[EditorDocumentSchema] 非文本节点 ${path} 不允许包含 text`)
  }
}

/**
 * 使用生产 Editor schema 严格准备完整文档。
 *
 * `nodeFromJSON()` 本身会忽略未知 attrs，且不会验证父子内容表达式；因此必须先检查
 * node/mark/attrs，再调用 `Node.check()`。任一阶段失败都发生在 Editor state 改变之前。
 */
export function parseEditorDocumentJson(
  content: JSONContent,
  schema: Schema
): ProseMirrorNode {
  assertNodeJson(content, schema, 'doc')
  const doc = schema.nodeFromJSON(content)
  doc.check()
  return doc
}
