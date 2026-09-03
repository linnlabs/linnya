<!--
  @file WorkspaceRefLink.vue
  @description 将文本中的 #ref 渲染为可点击跳转链接（复用对话侧现有的导航链路）

  中文说明：
  - 目标：插件/Workspace 工具卡里也能点击 #ref 跳转到对应文档位置；
  - 约束：禁止 any 类型断言；严格按 refIdGenerator 的规则解析/校验；
  - 策略：优先使用引用里带的 @documentId / @documentType:documentId 指明目标文档，避免歧义。
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
import { useUIStore } from '../../../../../shared/stores/ui'
import { useNotificationStore } from '@/app/notification'
import { useFileStore } from '../../../../../shared/stores/file'
import { useBlockIndexSnapshotStore } from '../../../../../shared/stores/blockIndexSnapshotStore'
import { buildRootBlockIndexMap, flashHighlightRootBlockOuter, navigateToRootBlockById } from '../../../../editor/shared/utils/blockNavigation'
import { getDocumentReferenceRuntimeHandler } from '@plugin/renderer/documentReferenceRuntimePort'
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort'
import { useConversationLocalization } from '../../useConversationLocalization'
import {
  findCurrentPluginReferenceDocument,
  getPluginReferenceLabel,
  parseWorkspaceRefId,
  resolvePluginReferenceInDocument,
  resolveMarkdownReferenceInDocument,
  type DocType,
} from '../../shared/workspaceReferenceResolver'

const props = defineProps<{
  /**
   * 原始引用文本：
   * - 支持：#aZ3kP9
   * - 支持跨文档：#aZ3kP9@<documentId>
   * - 支持显式类型：#aZ3kP9@<documentType>:<documentId>
   */
  rawRef: string
  /**
   * 展示文案策略：
   * - auto（默认）：沿用对话侧的“节点引用/第N段/引用”语义文案；
   * - ref：直接展示 `#xxxxxx`（更贴近“表格内容里看到的 #”）
   */
  display?: 'auto' | 'ref'
  /**
   * 可选：对话轮次 ID。当前工具卡会优先把 documentId 写进 rawRef，通常不需要该字段。
   */
  turnId?: string
}>()

const uiStore = useUIStore()
const fileStore = useFileStore()
const notificationStore = useNotificationStore()
const snapshotStore = useBlockIndexSnapshotStore()
const navigation = getWorkspaceNavigationPort()
const { conversationMessage } = useConversationLocalization()

const parsed = computed(() => parseWorkspaceRefId(props.rawRef))
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
  if (!ref) return conversationMessage('conversation.tool.workspace.reference.label')

  // 显式要求展示 #ref 本体
  if (props.display === 'ref') return ref

  const hint = parsed.value?.docTypeHint
  if (hint && hint !== 'markdown') return getPluginReferenceLabel(hint, conversationMessage)
  if (isCurrentPluginReferenceContext()) return getCurrentPluginReferenceLabel()

  // 仅当当前处于 Editor 且能解析到 blockId 时，才显示“第N段”
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
  if (!ref) return conversationMessage('conversation.tool.workspace.reference.label')

  if (props.display === 'ref') return ref

  const hint = parsed.value?.docTypeHint
  if (hint && hint !== 'markdown') return getPluginReferenceLabel(hint, conversationMessage)
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

async function openMarkdownDocument(documentId: string) {
  // 中文说明：工具卡不直接控制视图或 file-manager；引用跳转统一走导航端口，
  // 避免 conversation domain 依赖 workspace 内部生命周期。
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

watch(
  [
    normalizedRef,
    () => parsed.value?.documentId ?? '',
    () => parsed.value?.docTypeHint ?? '',
    () => props.display ?? 'auto',
    () => fileStore.currentFilePath ?? '',
    () => currentPluginReferenceDocument.value?.docType ?? '',
    () => currentPluginReferenceDocument.value?.documentId ?? '',
  ],
  async () => {
    const seq = ++labelResolveSeq
    asyncResolvedLabel.value = null

    const ref = normalizedRef.value
    if (!ref) return
    if (props.display === 'ref') return

    const parsedValue = parsed.value
    const hint = parsedValue?.docTypeHint
    if ((hint && hint !== 'markdown') || isCurrentPluginReferenceContext()) return
    if (quickLabelText.value !== conversationMessage('conversation.tool.workspace.reference.label')) return
    if (!parsedValue?.documentId) return

    const resolved = await resolveMarkdownReferenceInDocument(parsedValue.documentId, ref)
    if (seq !== labelResolveSeq) return
    if (!resolved) return
    asyncResolvedLabel.value = conversationMessage('conversation.tool.workspace.reference.paragraphLabel', {
      index: resolved.index,
    })
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  labelResolveSeq += 1
})

async function handleClick() {
  const p = parsed.value
  const ref = normalizedRef.value
  if (!p || !ref) return

  // 工具卡场景：必须明确目标文档，否则不做推断（避免误跳）
  if (!p.documentId) {
    notificationStore.show(conversationMessage('conversation.tool.workspace.reference.missingTarget'), 'info', 2500)
    return
  }

  const docType: DocType = p.docTypeHint ?? 'markdown'
  try {
    if (docType === 'markdown') {
      const resolved = await resolveMarkdownReferenceInDocument(p.documentId, ref)
      if (!resolved) {
        notificationStore.show(conversationMessage('conversation.tool.workspace.reference.markdownNotFound'), 'warning', 3000)
        return
      }
      await openMarkdownDocument(p.documentId)
      const editor: Editor | null = uiStore.getEditor()
      if (!editor) {
        notificationStore.show(conversationMessage('conversation.tool.workspace.reference.editorNotReady'), 'info', 2000)
        return
      }
      const ok = await navigateToRootBlockById(editor, resolved.resolvedId, { scrollBehavior: 'auto', scrollBlock: 'start' })
      if (!ok) {
        notificationStore.show(conversationMessage('conversation.tool.workspace.reference.paragraphNotFound'), 'warning', 3000)
        return
      }
      flashHighlightRootBlockOuter(resolved.resolvedId, { durationMs: 650 })
      return
    }

    const resolved = await resolvePluginReferenceInDocument(docType, p.documentId, ref)
    if (!resolved) {
      notificationStore.show(conversationMessage('conversation.tool.workspace.reference.pluginNotFound'), 'warning', 3000)
      return
    }

    const referenceRuntime = getDocumentReferenceRuntimeHandler(docType)
    if (!referenceRuntime) {
      notificationStore.show(conversationMessage('conversation.tool.workspace.reference.pluginDisabled'), 'info', 2500)
      return
    }

    await openPluginDocument(p.documentId, docType)
    const ready = await referenceRuntime.waitForDocumentReady(p.documentId, 8000)
    if (!ready) {
      notificationStore.show(conversationMessage('conversation.tool.workspace.reference.documentNotReady'), 'info', 2000)
      return
    }

    const focusResult = await referenceRuntime.focusReference({
      documentId: p.documentId,
      referenceId: resolved.resolvedId,
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
