/**
 * 鼠标交互 Composable
 * 封装 MouseListener 的初始化与清理逻辑
 */
import { onMounted, onBeforeUnmount, type Ref } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import MouseListener from '../extensions/interaction/MouseListener'

export interface MouseInteractionsOptions {
  editor: Ref<Editor | null>
  editorContainerRef: Ref<HTMLElement | null>
}

/**
 * 初始化并管理鼠标交互
 */
export function useMouseInteractions(options: MouseInteractionsOptions) {
  const { editor, editorContainerRef } = options
  let mouseListener: MouseListener | null = null

  onMounted(() => {
    if (editor.value) {
      mouseListener = new MouseListener(editor.value)
      const editorContainer = editorContainerRef.value
      if (editorContainer) {
        mouseListener.initDragEvents(editorContainer)
      }
    }
  })

  onBeforeUnmount(() => {
    if (mouseListener) {
      mouseListener.destroy()
      mouseListener = null
    }
  })

  return {
    mouseListener,
  }
}

