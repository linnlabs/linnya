import { useBlockHistoryState } from './store/useBlockHistoryStore';
import { createBlockHistoryActions } from './orchestration/createBlockHistoryActions';
import type { BlockHistoryStore } from './definitions/blockHistory';
let runtime: BlockHistoryStore | null = null;
/** 公共运行入口保留原有单例语义；store 不反向装配异步流程。 */
export function useBlockHistory(): BlockHistoryStore {
  if (!runtime) {
    const state = useBlockHistoryState();
    runtime = { ...state, ...createBlockHistoryActions(state) };
  }
  return runtime;
}
