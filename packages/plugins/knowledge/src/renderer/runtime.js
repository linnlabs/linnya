import { useKnowledgeBaseStore } from './stores/knowledgeBase/index.js'
import { createKnowledgeBaseRuntime } from './orchestration/createKnowledgeBaseRuntime.js'

const runtimes = new WeakMap()

/** 知识库公开运行能力：应用级生命周期、只读事实与命令，不是第二个 store。 */
export function useKnowledgeBase() {
  const store = useKnowledgeBaseStore()
  let runtime = runtimes.get(store)
  if (!runtime) {
    runtime = createKnowledgeBaseRuntime(store)
    runtimes.set(store, runtime)
  }
  return runtime
}

/** 停用销毁运行资源，但保留用户配置；重新启用不能复用已经停止的 effect scope。 */
export function disposeKnowledgeBaseRuntime() {
  const store = useKnowledgeBaseStore()
  runtimes.get(store)?.cleanupIpcListener()
  runtimes.delete(store)
}
