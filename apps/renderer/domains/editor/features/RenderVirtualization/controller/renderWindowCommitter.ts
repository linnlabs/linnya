/**
 * renderWindowCommitter.ts
 *
 * RootBlock 虚拟化窗口的 ProseMirror 提交层。
 *
 * 中文说明：
 * - Engine 只决定“要提交什么”，本文件负责“如何写入 PM plugin state”；
 * - 所有 render virtualization transaction 都必须标记为 ephemeral，避免污染 undo
 *   或触发 block lifecycle 的业务删除副作用。
 */

import { EditorState, type Transaction } from 'prosemirror-state'
import type { DirectEditorProps } from 'prosemirror-view'
import { markRenderVirtualizationTransaction } from '../../../core/transactions/editorTransactionMeta'
import {
  getRenderVirtualizationState,
  renderVirtualizationPluginKey,
  type RenderVirtualizationMeta,
} from '../state/renderVirtualizationPlugin'
import { syncTiptapVueReactiveState } from '../../../shared/adapters/tiptapVueReactiveState'

export interface RenderWindowCommitterView {
  state: EditorState
  dispatch: (tr: Transaction) => void
  updateState?: (state: EditorState) => void
  props?: DirectEditorProps
  update?: (props: DirectEditorProps) => void
}

export interface RenderWindowCommitterEditor {
  state: EditorState
  view: RenderWindowCommitterView
}

export type RenderVirtualizationCommitMode = 'atomic-update-state'

export interface RenderVirtualizationCommitResult {
  didCommit: boolean
  mode: RenderVirtualizationCommitMode | null
  viewStateUpdated: boolean | null
  reactiveStateSynced: boolean
}

function dispatchRenderVirtualizationTransaction(params: {
  tr: Transaction
  editor: RenderWindowCommitterEditor
}): Omit<RenderVirtualizationCommitResult, 'didCommit'> {
  // 中文说明：Tiptap Vue 的 editor.state 来自内部 reactiveState，不一定等于
  // editor.view.state。渲染虚拟化事务只改 PM plugin state，不改 doc/history；
  // 这里用 view.state 原子 apply + updateState，避免高频滚动时事务落到旧 reactiveState 上。
  const { view } = params.editor
  const nextState = view.state.apply(params.tr)
  if (view.update && view.props) {
    view.update({
      ...view.props,
      state: nextState,
    })
  } else {
    view.updateState?.(nextState)
    if (!view.updateState) {
      // 中文说明：生产路径必须传入拥有 updateState/update 的 editor view。
      // 没有同步能力时继续 dispatch 会重新引入 Vue reactiveState 漂移，所以直接失败。
      throw new Error(
        '[RenderVirtualization] commit requires a view.updateState or view.update contract'
      )
    }
  }

  // 中文说明：这里不做 EditorState instanceof 校验。Tiptap 可能经由
  // @tiptap/pm/state 引入另一个 EditorState 构造函数；nextState 来自当前
  // view.state.apply，来源可信。私有 reactiveState 访问统一收口在 adapter 内。
  const reactiveStateSynced = syncTiptapVueReactiveState(params.editor, nextState)
  return {
    mode: 'atomic-update-state',
    viewStateUpdated: view.state === nextState,
    reactiveStateSynced,
  }
}

/**
 * 测试专用 legacy adapter。
 *
 * 中文说明：
 * - 生产代码必须调用 `commitRenderVirtualizationMeta(editor, meta)`；
 * - 这个函数只给少量没有 Tiptap editor owner 的单元测试使用；
 * - 不从 public / internal 出口导出，避免重新形成 view-only 旁路。
 */
export function commitRenderVirtualizationMetaForTest(
  view: RenderWindowCommitterView,
  meta: RenderVirtualizationMeta
): RenderVirtualizationCommitResult {
  const hasWork =
    meta.reset === true ||
    typeof meta.setEnabled === 'boolean' ||
    (meta.hydrate?.length ?? 0) > 0 ||
    (meta.dehydrate?.length ?? 0) > 0 ||
    (meta.pin?.length ?? 0) > 0 ||
    (meta.unpin?.length ?? 0) > 0

  if (!hasWork) {
    return {
      didCommit: false,
      mode: null,
      viewStateUpdated: null,
      reactiveStateSynced: false,
    }
  }

  const tr = view.state.tr.setMeta(renderVirtualizationPluginKey, meta)
  markRenderVirtualizationTransaction(tr)
  view.dispatch(tr)
  return {
    didCommit: true,
    mode: null,
    viewStateUpdated: null,
    reactiveStateSynced: false,
  }
}

export function commitRenderVirtualizationMeta(
  editor: RenderWindowCommitterEditor,
  meta: RenderVirtualizationMeta
): RenderVirtualizationCommitResult {
  const hasWork =
    meta.reset === true ||
    typeof meta.setEnabled === 'boolean' ||
    (meta.hydrate?.length ?? 0) > 0 ||
    (meta.dehydrate?.length ?? 0) > 0 ||
    (meta.pin?.length ?? 0) > 0 ||
    (meta.unpin?.length ?? 0) > 0

  if (!hasWork) {
    return {
      didCommit: false,
      mode: null,
      viewStateUpdated: null,
      reactiveStateSynced: false,
    }
  }

  const tr = editor.view.state.tr.setMeta(renderVirtualizationPluginKey, meta)
  markRenderVirtualizationTransaction(tr)
  const dispatchResult = dispatchRenderVirtualizationTransaction({
    tr,
    editor,
  })
  return {
    didCommit: true,
    ...dispatchResult,
  }
}

export function ensureRenderVirtualizationPluginEnabled(params: {
  editor: RenderWindowCommitterEditor
  initialHydratedBlockIds: readonly string[]
}): boolean {
  const virtualizationState = getRenderVirtualizationState(params.editor.view.state)
  if (!virtualizationState) return false
  if (virtualizationState.enabled) return true

  commitRenderVirtualizationMeta(params.editor, {
    setEnabled: true,
    hydrate: params.initialHydratedBlockIds,
  })
  return getRenderVirtualizationState(params.editor.view.state)?.enabled === true
}

export function commitRenderWindow(params: {
  editor: RenderWindowCommitterEditor
  hydrate?: readonly string[]
  dehydrate?: readonly string[]
  pin?: readonly string[]
  unpin?: readonly string[]
}): RenderVirtualizationCommitResult {
  if (
    (params.hydrate?.length ?? 0) === 0 &&
    (params.dehydrate?.length ?? 0) === 0 &&
    (params.pin?.length ?? 0) === 0 &&
    (params.unpin?.length ?? 0) === 0
  ) {
    return {
      didCommit: false,
      mode: null,
      viewStateUpdated: null,
      reactiveStateSynced: false,
    }
  }
  return commitRenderVirtualizationMeta(params.editor, {
    hydrate: params.hydrate && params.hydrate.length > 0 ? params.hydrate : undefined,
    dehydrate: params.dehydrate && params.dehydrate.length > 0 ? params.dehydrate : undefined,
    pin: params.pin && params.pin.length > 0 ? params.pin : undefined,
    unpin: params.unpin && params.unpin.length > 0 ? params.unpin : undefined,
  })
}
