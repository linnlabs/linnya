/**
 * @tiptap/vue-3 reactive state 兼容层。
 *
 * 中文说明：
 * - Vue 版 Tiptap 的 `editor.state` 读取内部 `reactiveState.value`；
 * - direct-state 文档切换和 render-only 虚拟化事务都绕过普通 dispatchTransaction，
 *   因此必须在同一个提交边界同步这层 state；
 * - 所有对这个内部字段的访问都集中在这里，避免业务代码散落依赖 Tiptap 私有结构。
 */

export interface TiptapVueReactiveStateRef<TState> {
  value: TState
}

interface TiptapVueReactiveStateReadOptions<TState> {
  isState?: (value: unknown) => value is TState
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTiptapVueReactiveStateRef<TState>(
  value: unknown,
  options: TiptapVueReactiveStateReadOptions<TState>
): value is TiptapVueReactiveStateRef<TState> {
  if (!isObjectRecord(value) || !('value' in value)) return false
  return options.isState ? options.isState(value.value) : true
}

export function readTiptapVueReactiveStateRef<TState = unknown>(
  editor: unknown,
  options: TiptapVueReactiveStateReadOptions<TState> = {}
): TiptapVueReactiveStateRef<TState> | null {
  if (!isObjectRecord(editor)) return null

  const reactiveState = editor.reactiveState
  if (!isTiptapVueReactiveStateRef(reactiveState, options)) return null

  return reactiveState
}

export function syncTiptapVueReactiveState<TState>(
  editor: unknown,
  state: TState,
  options: TiptapVueReactiveStateReadOptions<TState> = {}
): boolean {
  const reactiveState = readTiptapVueReactiveStateRef(editor, options)
  if (!reactiveState) return false

  reactiveState.value = state
  return true
}
