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
