/**
 * @file MindMap 证据增量刷新触发器
 *
 * 中文说明：
 * - mindmap_attach_evidence 只写证据卫星表，不产生 MindMap 文档版本；
 * - 因此它不能依赖 workspace.document.updated(version) 刷新；
 * - 本触发器只消费主时间线工具结果中的 attached nodeIds，刷新证据 count/list。
 */

import { computed, watch } from 'vue'
import type { RendererToolRefreshTriggerParams } from '@plugin/renderer/toolRefreshPort'
import { useMindMapStore } from '../../../domain/store/mindmapStore'
import { useMindMapEvidenceStore } from '../../evidence/domain/store/evidenceStore'
import { LOG_PREFIX } from '../domain/types'

const MINDMAP_EVIDENCE_TOOL_NAMES = new Set<string>([
  'mindmap_attach_evidence',
  'workspace_mindmap_attach_evidence',
])

const triggeredToolMessageKeys = new Set<string>()

export type UseMindMapEvidenceRefreshTriggerParams = RendererToolRefreshTriggerParams

export function isMindMapEvidenceToolName(toolName: string): boolean {
  return MINDMAP_EVIDENCE_TOOL_NAMES.has(toolName)
}

export function clearMindMapEvidenceRefreshDedupeCache(): void {
  triggeredToolMessageKeys.clear()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readDocumentIdFromValue(value: unknown): string | null {
  if (!isRecord(value)) return null
  const documentId = value.documentId ?? value.document_id
  return typeof documentId === 'string' && documentId.trim().length > 0
    ? documentId.trim()
    : null
}

function readDocumentId(params: {
  toolArgs: unknown
  toolResult: unknown
}): string | null {
  if (isRecord(params.toolResult)) {
    const fromData = readDocumentIdFromValue(params.toolResult.data)
    if (fromData) return fromData
    const fromTopLevel = readDocumentIdFromValue(params.toolResult)
    if (fromTopLevel) return fromTopLevel
  }
  return readDocumentIdFromValue(params.toolArgs)
}

function extractAttachedEvidenceNodeIds(result: unknown): string[] {
  if (!isRecord(result) || !isRecord(result.data)) return []
  const results = result.data.results
  if (!Array.isArray(results)) return []

  const nodeIds: string[] = []
  for (const item of results) {
    if (!isRecord(item)) continue
    if (item.status !== 'attached') continue
    const nodeId = item.nodeId
    if (typeof nodeId !== 'string') continue
    const trimmed = nodeId.trim()
    if (trimmed.length > 0) {
      nodeIds.push(trimmed)
    }
  }
  return Array.from(new Set(nodeIds))
}

function buildDedupeKey(params: {
  toolName: string
  documentId: string
  messageId?: string
  conversationId?: string
}): string {
  if (params.messageId && params.messageId.trim().length > 0) {
    const conversationId = params.conversationId && params.conversationId.trim().length > 0
      ? params.conversationId.trim()
      : 'unknown-conversation'
    return `conversation:${conversationId}:msg:${params.messageId.trim()}`
  }
  return `hash:${params.toolName}:${params.documentId}`
}

async function refreshEvidenceFromAttachEvidenceTool(docId: string, result: unknown): Promise<void> {
  const nodeIds = extractAttachedEvidenceNodeIds(result)
  if (nodeIds.length === 0) return

  const mindMapStore = useMindMapStore()
  // 中文说明：只处理当前打开文档，避免历史回放或其他文档的工具结果污染当前 UI。
  if (mindMapStore.currentDocumentId !== docId) return

  const evidenceStore = useMindMapEvidenceStore()
  await evidenceStore.loadCounts(nodeIds)

  const expandedNodeIds = nodeIds.filter((id) => evidenceStore.expandedByNodeId[id] === true)
  for (const nodeId of expandedNodeIds) {
    await evidenceStore.loadEvidences(nodeId)
  }

  mindMapStore.mind?.requestReflow('addons:content')
}

export function useMindMapEvidenceRefreshTrigger(
  params: UseMindMapEvidenceRefreshTriggerParams
): void {
  const { toolName, toolArgs, toolResult, status, messageId, conversationId } = params
  const emptyScope = computed<string | undefined>(() => undefined)

  watch(
    [
      toolName,
      toolArgs,
      toolResult,
      status,
      messageId ?? emptyScope,
      conversationId ?? emptyScope,
    ],
    ([name, args, result, statusValue, msgId, convId]) => {
      if (statusValue !== 'success') return
      if (!isMindMapEvidenceToolName(name)) return

      const documentId = readDocumentId({ toolArgs: args, toolResult: result })
      if (!documentId) {
        console.warn(`${LOG_PREFIX} evidence: attach_evidence succeeded but no documentId found`)
        return
      }

      const dedupeKey = buildDedupeKey({
        toolName: name,
        documentId,
        messageId: msgId,
        conversationId: convId,
      })
      if (triggeredToolMessageKeys.has(dedupeKey)) return
      triggeredToolMessageKeys.add(dedupeKey)

      void refreshEvidenceFromAttachEvidenceTool(documentId, result)
    }
  )
}
