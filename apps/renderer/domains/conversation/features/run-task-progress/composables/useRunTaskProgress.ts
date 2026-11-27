import { computed, type ComputedRef } from 'vue';
import type { TaskState } from '@app/schemas';
import { isInteractiveRunUnfinished, useInteractiveRunStore } from '../../interactive-run';
import type { BaseMessage } from '../../../types';
import { findLatestRunTaskWrite, readTaskWriteState } from '../functions/selectRunTaskProgress';

/**
 * 输入框上方任务进度托盘的数据：当前对话正在进行（含等回答、已暂停）的运行里最新一次 task_write。
 * 运行结束就收起；不改 TaskState 合同，也不读更早轮次的计划。
 */
export function useRunTaskProgress(input: {
  readonly conversationId: () => string | null;
  readonly messages: () => readonly BaseMessage[];
}): ComputedRef<TaskState | null> {
  const interactive = useInteractiveRunStore();
  const runId = computed(() => {
    const conversationId = input.conversationId();
    const snapshot = conversationId ? interactive.snapshotFor(conversationId) : undefined;
    if (!snapshot?.runId) return null;
    return isInteractiveRunUnfinished(snapshot) ? snapshot.runId : null;
  });
  // 先只找消息：流式输出时这条 computed 每次重算，但找到的仍是同一条消息，下面的解析不会重跑。
  const latestWrite = computed(() => (
    runId.value ? findLatestRunTaskWrite(input.messages(), runId.value) : null
  ));
  return computed(() => (latestWrite.value ? readTaskWriteState(latestWrite.value) : null));
}
