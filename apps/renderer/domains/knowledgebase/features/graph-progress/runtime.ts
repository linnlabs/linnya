import { useKnowledgeGraphProgressStore } from '../../stores/knowledgeGraphProgressStore';
import { createKnowledgeGraphProgressRuntime } from './orchestration/createKnowledgeGraphProgressRuntime';

const runtimes = new WeakMap<ReturnType<typeof useKnowledgeGraphProgressStore>, ReturnType<typeof createKnowledgeGraphProgressRuntime>>();

/** 同一应用的列表和详情共用进度事实与订阅，不把请求放回 store。 */
export function useKnowledgeGraphProgress() {
  const store = useKnowledgeGraphProgressStore();
  let runtime = runtimes.get(store);
  if (!runtime) {
    runtime = createKnowledgeGraphProgressRuntime(store);
    runtimes.set(store, runtime);
  }
  return runtime;
}
