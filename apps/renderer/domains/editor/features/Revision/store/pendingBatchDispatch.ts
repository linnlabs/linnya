import type { Editor } from '@tiptap/core'
import type { EditorView } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'

/** 扩展 Editor 类型，添加批处理标志 */
type BatchableEditor = Editor & { _isPendingRevisionBatch?: boolean }

/** 扩展 EditorView 类型，暴露 ProseMirror 内部字段 */
type PatchableView = EditorView & {
  _state: EditorState
  _props: { state: EditorState }
}

const pendingBatchQueues = new WeakMap<Editor, Promise<void>>()

function waitForPreviousBatch(editor: Editor): {
  previous: Promise<void>
  current: Promise<void>
  release: () => void
} {
  const previous = pendingBatchQueues.get(editor) ?? Promise.resolve()
  let releaseCurrentBatch = (): void => {}
  const currentGate = new Promise<void>((resolve) => {
    releaseCurrentBatch = resolve
  })
  const current = previous.catch(() => undefined).then(() => currentGate)
  pendingBatchQueues.set(editor, current)

  return {
    previous,
    current,
    release: releaseCurrentBatch,
  }
}

async function runSerializedPendingBatch(
  editor: Editor,
  fn: () => Promise<unknown>,
  options?: { onFlush?: (durationMs: number) => void }
): Promise<void> {
  const batchEditor = editor as BatchableEditor
  const view = editor.view as unknown as PatchableView
  const originalUpdateState = view.updateState.bind(view)
  let latestState: EditorState | null = null

  batchEditor._isPendingRevisionBatch = true

  view.updateState = (state: EditorState) => {
    latestState = state
    view._state = state
    if (view._props) view._props.state = state
  }

  try {
    await fn()
  } finally {
    view.updateState = originalUpdateState
    batchEditor._isPendingRevisionBatch = false
    const finalState = latestState ?? editor.state
    if (!finalState) {
      console.error('[pendingBatchDispatch] flush 跳过：未拿到最终 EditorState')
      return
    }
    const flushStart =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    originalUpdateState(finalState)
    const flushEnd =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    options?.onFlush?.(flushEnd - flushStart)
  }
}

/**
 * 在 pending 投影期间临时拦截 view.updateState，跳过中间态 DOM 协调。
 *
 * 中文说明：
 * applyPendingRevisionsToEditor 内部会按块产生多个 transaction。批量投影时我们需要保留
 * ProseMirror state 链条，但不希望每个中间态都触发 DOM 重排，所以这里只把最新 state
 * 缓存在 view 私有状态里，最后统一 flush 一次。
 *
 * 同一个 editor 上的 pending 投影必须串行执行。否则多个可见块同时触发按需投影时，
 * 不同批次会各自基于旧 doc 创建 transaction；先完成的批次改变 doc 后，后完成的批次
 * 再 dispatch 旧 transaction 就会触发 ProseMirror 的 "Applying a mismatched transaction"。
 */
export async function withBatchedPendingDispatches(
  editor: Editor,
  fn: () => Promise<unknown>,
  options?: { onFlush?: (durationMs: number) => void }
): Promise<void> {
  const queue = waitForPreviousBatch(editor)
  await queue.previous.catch(() => undefined)

  try {
    await runSerializedPendingBatch(editor, fn, options)
  } finally {
    queue.release()
    if (pendingBatchQueues.get(editor) === queue.current) {
      pendingBatchQueues.delete(editor)
    }
  }
}
