import { computed } from 'vue';
import type { StageToolbarVisibility } from '../definitions/stageToolbarVisibility';

export function useStageToolbarVisibility(read: () => StageToolbarVisibility) {
  return computed(() => {
    const state = read();
    // 属性面板与输入/手势不能抢同一对象；AI 输入打开时也让出其位置。
    return (
      state.hasControls &&
      !state.aiPromptOpen &&
      !state.editingText &&
      !state.translating &&
      !state.resizing &&
      !state.resizingText
    );
  });
}
