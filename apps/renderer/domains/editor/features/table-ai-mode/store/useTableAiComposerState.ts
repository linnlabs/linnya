import { computed } from 'vue';
import { useTableAiModeStore } from './tableAiModeStore';

/** 对外只暴露 Input Extension 所需的模式与执行外观，不泄漏 table context。 */
export function useTableAiComposerState() {
  const store = useTableAiModeStore();

  return {
    isActive: computed(() => store.isActive),
    isLoading: computed(() => store.activeExecution?.isLoading === true),
    isStreaming: computed(() => store.activeExecution?.isStreaming === true),
  };
}
