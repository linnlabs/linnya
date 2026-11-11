import { useHistoryLoadingState } from './store/historyLoaderStore';
import { createHistoryLoaderRuntime } from './orchestration/createHistoryLoaderRuntime';
const runtimes = new WeakMap<
  ReturnType<typeof useHistoryLoadingState>,
  ReturnType<typeof createHistoryLoaderRuntime>
>();
export function useHistoryLoader() {
  const state = useHistoryLoadingState();
  let runtime = runtimes.get(state);
  if (!runtime) {
    runtime = createHistoryLoaderRuntime(state);
    runtimes.set(state, runtime);
  }
  return runtime;
}
