<!--
  @file ConversationReferenceNode.vue
  @description markstream-vue 的 reference 节点 → “第N段”可点击跳转（复用我们现有导航逻辑）
  
  目标：
  - 在 markstream 渲染路径下保留 [#ref] 的“定位到文档第N段”交互
  - 避免依赖 v-html/DOMParser 的二次处理（更稳定、更安全）
-->
<template>
  <a
    class="ai-ref-link"
    href="#"
    role="button"
    :data-ref="normalizedRef"
    :title="titleText"
    @click.prevent="handleClick"
  >
    {{ labelText }}
  </a>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { ReferenceNode } from 'stream-markdown-parser'
import { useUIStore } from '../../../../../../shared/stores/ui'
import { useNotificationStore } from '@/app/notification'
import { useFileStore } from '../../../../../../shared/stores/file'
import { useBlockIndexSnapshotStore } from '../../../../../../shared/stores/blockIndexSnapshotStore'
import { buildRootBlockIndexMap, flashHighlightRootBlockOuter, navigateToRootBlockById } from '../../../../../editor/shared/utils/blockNavigation'
import { getDocumentReferenceRuntimeHandler } from '@plugin/renderer/documentReferenceRuntimePort'
import { useAssistantStore } from '../../../../store/assistantStore'
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort'
import { readToolNameFromConversationMessage } from '../../../../functions/toolMessageLookup'
import { isRecord } from '../../../../utils/typeGuards'
import {
  findCurrentPluginReferenceDocument,
  getPluginReferenceLabel,
  parseWorkspaceRefId,
  readWorkspaceDocumentCandidate,
  resolveReferenceMatches,
  uniqCandidates,
  type DocType,
  type DocumentCandidate,
} from '../../../shared/workspaceReferenceResolver'
import { useConversationLocalization } from '../../../useConversationLocalization'

const props = defineProps<{
  node: ReferenceNode
  messageId?: string
  threadId?: string
  /**
   * 对话轮次 ID：
   * - 由 AnswerMessage/ThoughtMessage 从 message.metadata.turn_id 透传；
   * - 用于跨文档引用时，从同一 turn 的结构化 read_file 结果中推导候选文档集合。
   */
  turnId?: string
}>()

const uiStore = useUIStore()
const fileStore = useFileStore()
const notificationStore = useNotificationStore()
const snapshotStore = useBlockIndexSnapshotStore()
const assistantStore = useAssistantStore()
const navigation = getWorkspaceNavigationPort()
const { conversationMessage } = useConversationLocalization()

const parsed = computed(() => parseWorkspaceRefId(props.node.id))
const normalizedRef = computed(() => parsed.value?.ref ?? '')
const asyncResolvedLabel = ref<string | null>(null)
let labelResolveSeq = 0

const currentPluginReferenceDocument = computed(() => findCurrentPluginReferenceDocument(fileStore.currentFilePath))

function isCurrentPluginReferenceContext(): boolean {
  const current = currentPluginReferenceDocument.value
  return !!current && current.documentId === fileStore.currentFilePath
}

function getCurrentPluginReferenceLabel(): string {
  const current = currentPluginReferenceDocument.value
  return current
    ? getPluginReferenceLabel(current.docType, conversationMessage)
    : conversationMessage('conversation.tool.workspace.reference.documentLabel')
}

const quickLabelText = computed(() => {
  const ref = normalizedRef.value
  if (!ref) return conversationMessage('conversation.tool.workspace.reference.documentLabel')

  const docTypeHint = parsed.value?.docTypeHint
  if (docTypeHint && docTypeHint !== 'markdown') return getPluginReferenceLabel(docTypeHint, conversationMessage)
  if (isCurrentPluginReferenceContext()) return getCurrentPluginReferenceLabel()

  // 仅当当前就处于 Editor 且能解析到 blockId 时，才显示“第N段”；否则保持通用文案
  const editor = uiStore.getEditor()
  const documentId = fileStore.currentFilePath
  if (!editor || typeof documentId !== 'string') return conversationMessage('conversation.tool.workspace.reference.label')

  const blockId = snapshotStore.resolveBlockId(documentId, ref)
  if (!blockId) return conversationMessage('conversation.tool.workspace.reference.label')

  const indexMap = buildRootBlockIndexMap(editor)
  const idx = indexMap.get(blockId)
  return typeof idx === 'number'
    ? conversationMessage('conversation.tool.workspace.reference.paragraphLabel', { index: idx })
    : conversationMessage('conversation.tool.workspace.reference.label')
})

const labelText = computed(() => {
  const ref = normalizedRef.value
  if (!ref) return conversationMessage('conversation.tool.workspace.reference.documentLabel')

  const docTypeHint = parsed.value?.docTypeHint
  if (docTypeHint && docTypeHint !== 'markdown') return getPluginReferenceLabel(docTypeHint, conversationMessage)
  if (isCurrentPluginReferenceContext()) return getCurrentPluginReferenceLabel()

  if (asyncResolvedLabel.value) return asyncResolvedLabel.value
  return quickLabelText.value
})

const titleText = computed(() => {
  const ref = normalizedRef.value
  return ref
    ? conversationMessage('conversation.tool.workspace.reference.locateTitle', { ref })
    : conversationMessage('conversation.tool.workspace.reference.label')
})

function readReferenceRuntimeLabel(docType: string): string {
  return getPluginReferenceLabel(docType, conversationMessage)
}

function getCandidatesFromCurrentView(): DocumentCandidate[] {
  const candidates: DocumentCandidate[] = []
  const currentFilePath = fileStore.currentFilePath
  if (typeof currentFilePath !== 'string' || currentFilePath.length === 0) {
    return candidates
  }
  const currentPluginDocument = currentPluginReferenceDocument.value
  if (currentPluginDocument?.documentId === currentFilePath) {
    candidates.push(currentPluginDocument)
  } else {
    candidates.push({ documentId: currentFilePath, docType: 'markdown' })
  }
  return candidates
}

function getCandidatesFromTurn(turnId: string | undefined): DocumentCandidate[] {
  if (!turnId) return []

  const candidates: DocumentCandidate[] = []
  for (const msg of assistantStore.activeMessages) {
    if (msg.type !== 'tool_calls') continue
    if (!isRecord(msg.metadata)) continue
    const meta = msg.metadata
    if (meta.turn_id !== turnId) continue

    const toolName = readToolNameFromConversationMessage(msg) ?? ''
    const status = meta.status
    if (status !== 'success') continue

    const candidate = readWorkspaceDocumentCandidate(toolName, meta.result)
    if (candidate) candidates.push(candidate)
  }

  return candidates
}

watch(
  [
    normalizedRef,
    () => parsed.value?.documentId ?? '',
    () => parsed.value?.docTypeHint ?? '',
    () => props.turnId ?? '',
    () => fileStore.currentFilePath ?? '',
    () => currentPluginReferenceDocument.value?.docType ?? '',
    () => currentPluginReferenceDocument.value?.documentId ?? '',
    () => assistantStore.activeConversationId ?? '',
  ],
  async () => {
    const seq = ++labelResolveSeq
    asyncResolvedLabel.value = null

    const ref = normalizedRef.value
    if (!ref) return

    const hint = parsed.value?.docTypeHint
    if ((hint && hint !== 'markdown') || isCurrentPluginReferenceContext()) return
    if (quickLabelText.value !== conversationMessage('conversation.tool.workspace.reference.label')) return

    const candidates: DocumentCandidate[] = []
    if (parsed.value?.documentId) {
      candidates.push({ documentId: parsed.value.documentId, docType: parsed.value.docTypeHint ?? 'markdown' })
    }
    candidates.push(...getCandidatesFromCurrentView())
    candidates.push(...getCandidatesFromTurn(props.turnId))

    const matches = await resolveReferenceMatches(ref, candidates)
    if (seq !== labelResolveSeq) return
    if (matches.length !== 1) return

    const match = matches[0]
    if (match.docType === 'markdown') {
      asyncResolvedLabel.value = conversationMessage('conversation.tool.workspace.reference.paragraphLabel', {
        index: match.index,
      })
      return
    }
    asyncResolvedLabel.value = readReferenceRuntimeLabel(match.docType)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  labelResolveSeq += 1
})

async function openMarkdownDocument(documentId: string) {
  // 中文说明：conversation domain 只表达“我要打开这个引用所在文档”；
  // 文档挂载位置、是否需要重开 active session、布局切换都由 app-level navigation 统一编排。
  await navigation.openDocument({
    documentId,
    displayName: documentId,
    projectId: null,
    type: 'editor',
  })
}

async function openPluginDocument(documentId: string, documentType: string) {
  await navigation.openDocument({
    documentId,
    displayName: documentId,
    projectId: null,
    type: documentType,
  })
}

async function handleClick() {
  const p = parsed.value
  const ref = normalizedRef.value
  if (!p || !ref) return

  // 1) 先构建候选文档集合
  const candidates: DocumentCandidate[] = []
  if (p.documentId) {
    candidates.push({ documentId: p.documentId, docType: p.docTypeHint ?? 'markdown' })
  }
  candidates.push(...getCandidatesFromCurrentView())
  candidates.push(...getCandidatesFromTurn(props.turnId))
  const uniq = uniqCandidates(candidates)

  if (uniq.length === 0) {
    notificationStore.show(conversationMessage('conversation.tool.workspace.reference.noContextDocument'), 'info', 2000)
    return
  }

  // 2) 在候选文档中解析 ref（可能跨文档）
  const matches: Array<{ documentId: string; docType: DocType; resolvedId: string }> = []
  const resolvedMatches = await resolveReferenceMatches(ref, uniq)
  matches.push(...resolvedMatches.map((match) => ({
    documentId: match.documentId,
    docType: match.docType,
    resolvedId: match.resolvedId,
  })))

  if (matches.length === 0) {
    notificationStore.show(conversationMessage('conversation.tool.workspace.reference.pluginNotFound'), 'warning', 3000)
    return
  }

  if (matches.length > 1) {
    notificationStore.show(conversationMessage('conversation.tool.workspace.reference.ambiguous'), 'warning', 3500)
    return
  }

  const target = matches[0]

  // 3) 打开并定位
  try {
    if (target.docType === 'markdown') {
      await openMarkdownDocument(target.documentId)
      const editor: Editor | null = uiStore.getEditor()
      if (!editor) {
        notificationStore.show(conversationMessage('conversation.tool.workspace.reference.editorNotReady'), 'info', 2000)
        return
      }
      const ok = await navigateToRootBlockById(editor, target.resolvedId, { scrollBehavior: 'auto', scrollBlock: 'start' })
      if (!ok) {
        notificationStore.show(conversationMessage('conversation.tool.workspace.reference.paragraphNotFound'), 'warning', 3000)
        return
      }
      flashHighlightRootBlockOuter(target.resolvedId, { durationMs: 650 })
      return
    }

    const referenceRuntime = getDocumentReferenceRuntimeHandler(target.docType)
    if (!referenceRuntime) {
      notificationStore.show(conversationMessage('conversation.tool.workspace.reference.pluginDisabled'), 'info', 2500)
      return
    }

    await openPluginDocument(target.documentId, target.docType)
    const ready = await referenceRuntime.waitForDocumentReady(target.documentId, 8000)
    if (!ready) {
      notificationStore.show(conversationMessage('conversation.tool.workspace.reference.documentNotReady'), 'info', 2000)
      return
    }

    const focusResult = await referenceRuntime.focusReference({
      documentId: target.documentId,
      referenceId: target.resolvedId,
    })
    if (focusResult.status === 'document-not-ready') {
      notificationStore.show(conversationMessage('conversation.tool.workspace.reference.documentNotReady'), 'info', 2000)
      return
    }
    if (focusResult.status === 'reference-not-found') {
      notificationStore.show(conversationMessage('conversation.tool.workspace.reference.targetNotFound'), 'warning', 3000)
    }
  } catch {
    notificationStore.show(conversationMessage('conversation.tool.workspace.reference.locateFailedGeneric'), 'error', 3000)
  }
}

</script>
