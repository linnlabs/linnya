/**
 * @file registerMindmapRendererPorts.ts
 * @description 注册 MindMap 渲染端对 host 暴露的窄能力。
 *
 * 中文说明：
 * - 这里是插件包与 host 的边界层：只注册 page_context 与工具刷新能力；
 * - conversation 通过 SDK registry 调用这些能力，不需要 import MindMap store 或实现文件；
 * - 注册函数必须幂等，避免 HMR / 测试重复加载时重复注册。
 */

import {
  registerRendererPageContextProvider,
  unregisterRendererPageContextProvider,
  type RendererPageContextDocument,
  type RendererPageContextSelection,
} from '@plugin/renderer/pageContextProvider'
import {
  registerRendererToolRefreshHandler,
  unregisterRendererToolRefreshHandler,
} from '@plugin/renderer/toolRefreshPort'
import {
  registerDocumentReferenceRuntimeHandler,
  unregisterDocumentReferenceRuntimeHandler,
  type DocumentReferenceFocusResult,
} from '@plugin/renderer/documentReferenceRuntimePort'
import {
  registerRendererDocumentMutationHandler,
  unregisterRendererDocumentMutationHandler,
} from '@plugin/renderer/documentMutationPort'
import {
  registerPluginDocumentCreationHandler,
  unregisterPluginDocumentCreationHandler,
} from '@plugin/renderer/pluginDocumentCreationPort'
import { MINDMAP_DOCUMENT_TYPE } from '@plugin/mindmap/shared'
import { useMindMapStore } from '../domain/store/mindmapStore'
import { mindMapGateway } from '../ipc/mindMapGateway'
import {
  buildMindMapChatDocumentFragmentFromStore,
  DEFAULT_MINDMAP_CHAT_CONTEXT_OPTIONS,
} from '../utils/mindmapAiContext'
import {
  clearMindMapEvidenceRefreshDedupeCache,
  isMindMapEvidenceToolName,
  requestRefresh,
  useMindMapEvidenceRefreshTrigger,
} from '../features/autoRefresh'
import type { Topic } from '../domain/types/dom'
import { registerMessageCatalogs } from '@app/localization'
import { MINDMAP_TOOL_CARD_MESSAGE_CATALOG } from '../tool-cards/definitions/mindmapToolCardMessageCatalog'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractMindMapReferenceNodeIds(content: unknown): string[] {
  if (!isRecord(content)) return []
  const root = content.nodeData
  if (!isRecord(root)) return []
  const ids: string[] = []

  const walk = (node: unknown): void => {
    if (!isRecord(node)) return
    const id = typeof node.id === 'string' ? node.id : ''
    if (id) ids.push(id)
    const children = node.children
    if (Array.isArray(children)) {
      for (const child of children) {
        walk(child)
      }
    }
  }

  walk(root)
  return ids
}

function waitNextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function computeCenterDelta(containerRect: DOMRect, targetRect: DOMRect): { dx: number; dy: number } {
  const containerCenterX = containerRect.left + containerRect.width / 2
  const containerCenterY = containerRect.top + containerRect.height / 2
  const targetCenterX = targetRect.left + targetRect.width / 2
  const targetCenterY = targetRect.top + targetRect.height / 2
  return {
    dx: targetCenterX - containerCenterX,
    dy: targetCenterY - containerCenterY,
  }
}

async function centerTopicInViewport(topic: Topic): Promise<void> {
  const mindmapStore = useMindMapStore()
  const mind = mindmapStore.mind
  if (!mind) return

  const visualBox = topic.closest('mm-node')
  const target = visualBox instanceof HTMLElement ? visualBox : topic

  for (let i = 0; i < 2; i += 1) {
    const containerRect = mind.container.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const { dx, dy } = computeCenterDelta(containerRect, targetRect)
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return

    // 中文说明：MindMap 的 move() 语义是“平移视口”，因此使用目标中心到容器中心的反向差值。
    mind.move(-dx, -dy, false)
    await waitNextAnimationFrame()
  }
}

function buildMindMapDocumentInfo(): RendererPageContextDocument | undefined {
  const mindmapStore = useMindMapStore()
  const documentId = mindmapStore.currentDocumentId
  if (!documentId) return undefined

  const title =
    typeof mindmapStore.currentDocumentName === 'string' &&
    mindmapStore.currentDocumentName.length > 0
      ? mindmapStore.currentDocumentName
      : undefined

  return {
    id: documentId,
    type: MINDMAP_DOCUMENT_TYPE,
    title,
  }
}

function buildMindMapSelection(): RendererPageContextSelection | undefined {
  const mindmapStore = useMindMapStore()
  const currentNodes = mindmapStore.currentNodes

  if (!currentNodes || currentNodes.length === 0) {
    return undefined
  }

  const selectedNodeIds: string[] = []
  for (const node of currentNodes) {
    // 中文说明：Topic 元素的 nodeObj.id 是业务 nodeId，不是 DOM id。
    const nodeId = node.nodeObj?.id
    if (nodeId) {
      selectedNodeIds.push(nodeId)
    }
  }

  if (selectedNodeIds.length === 0) {
    return undefined
  }

  return { selectedNodeIds }
}

export function registerMindmapRendererPorts(): void {
  registerMessageCatalogs(MINDMAP_TOOL_CARD_MESSAGE_CATALOG)
  registerPluginDocumentCreationHandler({
    id: 'mindmap.document-create',
    createDocument: ({ projectId, parentId, name }) =>
      mindMapGateway.create({
        projectId,
        parentId,
        name,
      }),
  })

  registerDocumentReferenceRuntimeHandler({
    documentType: MINDMAP_DOCUMENT_TYPE,
    referenceLabel: '节点引用',
    getCurrentDocumentId() {
      return useMindMapStore().currentDocumentId
    },
    async listReferenceIds(documentId: string) {
      const result = await mindMapGateway.read({ documentId })
      if (!result.success) return []
      return extractMindMapReferenceNodeIds(result.data?.content)
    },
    async waitForDocumentReady(documentId: string, timeoutMs: number) {
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        const store = useMindMapStore()
        if (store.currentDocumentId === documentId && store.mind?.documentId === documentId) {
          return true
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return false
    },
    async focusReference({ documentId, referenceId }): Promise<DocumentReferenceFocusResult> {
      const store = useMindMapStore()
      const mind = store.mind
      if (!mind || store.currentDocumentId !== documentId || mind.documentId !== documentId) {
        return { status: 'document-not-ready' }
      }

      let topic: Topic
      try {
        topic = mind.findEle(referenceId)
      } catch {
        return { status: 'reference-not-found' }
      }

      await centerTopicInViewport(topic)
      mind.selectNode(topic)
      return { status: 'focused' }
    },
  })

  registerRendererPageContextProvider({
    id: 'mindmap.page-context',
    kind: MINDMAP_DOCUMENT_TYPE,
    documentType: MINDMAP_DOCUMENT_TYPE,
    buildDocument: buildMindMapDocumentInfo,
    buildSelection: buildMindMapSelection,
    buildDocumentFragment: ({ pageContext }) =>
      buildMindMapChatDocumentFragmentFromStore(
        pageContext,
        DEFAULT_MINDMAP_CHAT_CONTEXT_OPTIONS
      ),
  })

  registerRendererToolRefreshHandler({
    id: 'mindmap.evidence-refresh',
    shouldHandle: isMindMapEvidenceToolName,
    useTrigger: useMindMapEvidenceRefreshTrigger,
  })

  registerRendererDocumentMutationHandler({
    id: 'mindmap.document-mutation',
    nodeType: MINDMAP_DOCUMENT_TYPE,
    activeDocumentType: MINDMAP_DOCUMENT_TYPE,
    handleMutation(event) {
      if (event.mutationKind !== 'version') return
      void requestRefresh({
        documentId: event.documentId,
        reason: 'push:document_updated',
        sourceTool: 'workspace-mutation',
        ...(event.versionNumber !== undefined ? { versionNumber: event.versionNumber } : {}),
        requestedAt: Date.now(),
      })
    },
  })
}

export function unregisterMindmapRendererPorts(): void {
  unregisterPluginDocumentCreationHandler('mindmap.document-create')
  unregisterDocumentReferenceRuntimeHandler(MINDMAP_DOCUMENT_TYPE)
  unregisterRendererPageContextProvider('mindmap.page-context')
  unregisterRendererToolRefreshHandler('mindmap.evidence-refresh')
  unregisterRendererDocumentMutationHandler('mindmap.document-mutation')
  clearMindMapEvidenceRefreshDedupeCache()
}
