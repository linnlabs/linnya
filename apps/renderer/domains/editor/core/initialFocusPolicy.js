import { shouldUseRootBlockShellForOwner } from '../ui/services/editorFeatureFlags'

// 与 direct-state / RootBlockShell 的大文档阈值保持一致。
// 这里单独保留在聚焦策略内，避免 editorFactory 反向依赖文档加载服务。
const LARGE_DOCUMENT_FOCUS_ROOT_BLOCK_THRESHOLD = 1500

export const INITIAL_EDITOR_FOCUS_DELAY_MS = 100

export function countRootBlocksInEditorState(state) {
  if (!state?.doc) return 0

  let rootBlockCount = 0
  state.doc.descendants((node) => {
    if (node.type.name === 'rootBlock') {
      rootBlockCount += 1
    }
  })
  return rootBlockCount
}

export function findFirstBaseBlockTextSelectionPos(state) {
  if (!state?.doc) return null

  let firstBlockPos = null
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'baseBlock' && firstBlockPos === null) {
      firstBlockPos = pos
      return false
    }
    return undefined
  })

  return firstBlockPos === null ? null : firstBlockPos + 1
}

export function shouldSkipInitialEditorFocus(editor) {
  if (!editor || editor.isDestroyed || !editor.state) return true
  if (shouldUseRootBlockShellForOwner(editor)) return true

  const rootBlockCount = countRootBlocksInEditorState(editor.state)
  return rootBlockCount >= LARGE_DOCUMENT_FOCUS_ROOT_BLOCK_THRESHOLD
}

export function focusFirstEditableBlock(editor) {
  if (shouldSkipInitialEditorFocus(editor)) return false

  const selectionPos = findFirstBaseBlockTextSelectionPos(editor.state)
  if (selectionPos === null) return false

  // 使用 chain 合并为一次 dispatch，避免首开阶段连续发两个 selection transaction。
  return editor.chain().focus().setTextSelection(selectionPos).run()
}

export function scheduleInitialEditorFocus({ editor, onComplete }) {
  return setTimeout(() => {
    try {
      focusFirstEditableBlock(editor)
    } finally {
      onComplete?.()
    }
  }, INITIAL_EDITOR_FOCUS_DELAY_MS)
}
