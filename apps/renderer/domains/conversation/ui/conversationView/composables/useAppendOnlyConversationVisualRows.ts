import { shallowRef, triggerRef, watch, type Ref } from 'vue';
import type { BaseMessage } from '../../../types';
import { createAppendOnlyConversationVisualRowsBuilder } from '../logic/appendOnlyConversationVisualRowsBuilder';
import type { ConversationVisualRow } from '../../messageCanvas';
import type { EstimationRegistry } from '../utils/estimationRegistry';

interface UseAppendOnlyConversationVisualRowsInput {
  readonly messages: Readonly<Ref<readonly BaseMessage[]>>;
  readonly resetKey: Readonly<Ref<string>>;
  readonly widthPx: Readonly<Ref<number | undefined>>;
  readonly estimationRegistry: EstimationRegistry;
}

/** 将消息窗口接到增量 visual-row 投影；builder 会原地维护稳定 rows 数组。 */
export function useAppendOnlyConversationVisualRows(
  input: UseAppendOnlyConversationVisualRowsInput,
) {
  const builder = createAppendOnlyConversationVisualRowsBuilder();
  const visualRows = shallowRef<ConversationVisualRow[]>([]);
  let appliedResetKey = input.resetKey.value;

  const applyProjection = (): void => {
    visualRows.value = builder.apply(input.messages.value, {
      estimationRegistry: input.estimationRegistry,
      widthPx: input.widthPx.value,
    });
    // append-only builder 保持数组引用稳定；通知依赖方读取本次原地更新。
    triggerRef(visualRows);
  };

  watch(
    () => [input.messages.value, input.widthPx.value, input.resetKey.value] as const,
    () => {
      if (input.resetKey.value !== appliedResetKey) {
        appliedResetKey = input.resetKey.value;
        builder.reset();
      }
      applyProjection();
    },
    { immediate: true, deep: false },
  );

  return { visualRows };
}
