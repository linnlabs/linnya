import type { JSONContent } from '@tiptap/core'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonMark(value: unknown): boolean {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  return value.attrs === undefined || isRecord(value.attrs)
}

function isJsonContent(value: unknown): value is JSONContent {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.attrs !== undefined && !isRecord(value.attrs)) return false
  if (value.text !== undefined && typeof value.text !== 'string') return false
  if (
    value.marks !== undefined
    && (!Array.isArray(value.marks) || !value.marks.every(isJsonMark))
  ) {
    return false
  }
  return value.content === undefined || (
    Array.isArray(value.content)
    && value.content.every(isJsonContent)
  )
}

/** 将块历史表中的 rootBlock 快照包装成历史 Editor 可加载的完整 doc。 */
export function buildHistoryVersionDocument(contentJson: string): JSONContent {
  let parsed: unknown
  try {
    parsed = JSON.parse(contentJson)
  } catch {
    throw new Error('历史版本 content_json 不是有效 JSON')
  }

  if (!isJsonContent(parsed)) {
    throw new Error('历史版本 content_json 必须是带 type 的 ProseMirror JSON 节点')
  }

  if (parsed.type === 'doc') {
    if (!Array.isArray(parsed.content)) {
      throw new Error('历史版本 doc 必须包含 content 数组')
    }
    return parsed
  }

  return {
    type: 'doc',
    content: [parsed],
  }
}
