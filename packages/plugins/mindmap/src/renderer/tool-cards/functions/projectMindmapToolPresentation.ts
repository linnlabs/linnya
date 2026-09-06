import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
  ToolTitleDescriptor,
} from '@linnya/plugin-host-contract/renderer/toolUi'
import {
  MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS,
  type MindmapToolCardMessageKey,
} from '../definitions/mindmapToolCardMessageCatalog'
import type {
  MindmapCreateNodePresentationData,
  MindmapCreatedNodePresentation,
  MindmapMutationPresentationData,
} from '../definitions/mindmapToolPresentation'

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, path: string): RecordValue {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`)
  return value
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${path} 必须是非空字符串`)
  return value.trim()
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : requireString(value, path)
}

function optionalStringArray(value: unknown, path: string): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${path} 必须是字符串数组`)
  return value.map((item, index) => requireString(item, `${path}[${index}]`))
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} 必须是有限数字`)
  }
  return value
}

function requireResultData(value: unknown): RecordValue {
  return requireRecord(requireRecord(value, 'MindMap tool result').data, 'MindMap tool result.data')
}

function readDocumentId(input: ToolPresentationProjectorInput): string {
  const args = requireRecord(input.args, 'MindMap tool args')
  return requireString(args.document_id, 'document_id')
}

function localizedText(key: MindmapToolCardMessageKey, params?: Readonly<Record<string, string>>) {
  return {
    key,
    fallback: MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS[key],
    ...(params ? { params } : {}),
  }
}

function title(document: string, tag: MindmapToolCardMessageKey): ToolTitleDescriptor {
  return {
    text: localizedText('mindmap.tool.title.document', { document }),
    tag: { text: localizedText(tag), variant: 'warning' },
  }
}

function lifecycle(input: ToolPresentationProjectorInput): ToolPresentationProjection<MindmapMutationPresentationData> {
  const documentId = readDocumentId(input)
  return { data: { kind: 'lifecycle', documentId }, title: title(documentId, 'mindmap.tool.tag.createNode') }
}

function readCreatedItems(value: unknown): readonly MindmapCreatedNodePresentation[] {
  if (!Array.isArray(value)) throw new Error('MindMap create result.results 必须是数组')
  return value.map((item, index) => {
    const row = requireRecord(item, `results[${index}]`)
    return {
      parentNodeId: requireString(row.parentNodeId, `results[${index}].parentNodeId`),
      ...(optionalString(row.parentNodeRef, `results[${index}].parentNodeRef`) ? { parentNodeRef: requireString(row.parentNodeRef, `results[${index}].parentNodeRef`) } : {}),
      nodeId: requireString(row.nodeId, `results[${index}].nodeId`),
      ...(optionalString(row.nodeRef, `results[${index}].nodeRef`) ? { nodeRef: requireString(row.nodeRef, `results[${index}].nodeRef`) } : {}),
      topic: requireString(row.topic, `results[${index}].topic`),
    }
  })
}

export function projectMindmapCreateNodePresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<MindmapMutationPresentationData> {
  if (input.status !== 'success') return lifecycle(input)
  const data = requireResultData(input.result)
  const documentId = requireString(data.documentId, 'result.data.documentId')
  const documentName = requireString(data.documentName, 'result.data.documentName')
  const projection: MindmapCreateNodePresentationData = {
    kind: 'create-node',
    documentId,
    createdCount: requireFiniteNumber(data.createdCount, 'result.data.createdCount'),
    items: readCreatedItems(data.results),
    warnings: optionalStringArray(data.warnings, 'result.data.warnings'),
  }
  return { data: projection, title: title(documentName, 'mindmap.tool.tag.createNode') }
}
