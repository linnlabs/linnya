/**
 * @file useCitationClickPopover.ts
 * @description Citation click 交互控制器
 *
 * 职责：
 * - 监听 CitationInteractionExtension 抛出的 `citation-click` 自定义事件
 * - 根据 citationId 从当前文档中还原引用数据
 * - 调用 Citation store 打开固定显示的 Popover
 *
 * 设计原则：
 * - 保持 EditorContent 只做 UI 装配
 * - 将 citation 特有交互收敛在 citation feature 内部
 */

import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import { useCitationPanelStore } from '../store/useCitationPanelStore'
import { getCitationByCitationId } from '../services/citationUpdateService'

export interface CitationClickEventDetail {
  citationId: string
  sourceId: string
  position: { top: number; left: number }
  element: HTMLElement
}

export interface UseCitationClickPopoverOptions {
  editor: Ref<Editor | null>
  editorContainerRef: Ref<HTMLElement | null>
}

export function useCitationClickPopover(options: UseCitationClickPopoverOptions): void {
  const { editor, editorContainerRef } = options
  const citationStore = useCitationPanelStore()

  function handleCitationClick(event: Event) {
    if (!(event instanceof CustomEvent)) return

    const { citationId, position } = event.detail as CitationClickEventDetail
    const currentEditor = editor.value
    if (!currentEditor) return

    const citation = getCitationByCitationId(currentEditor.state.doc, citationId)
    if (!citation) return

    // 中文说明：点击引用后 Popover 需要固定显示，直到用户发生主动关闭或外部交互。
    citationStore.openPopover(citation, position, { pinned: true })
  }

  onMounted(() => {
    const editorContainer = editorContainerRef.value
    if (!editorContainer) return

    editorContainer.addEventListener('citation-click', handleCitationClick as EventListener)
  })

  onBeforeUnmount(() => {
    const editorContainer = editorContainerRef.value
    if (!editorContainer) return

    editorContainer.removeEventListener('citation-click', handleCitationClick as EventListener)
  })
}
