import { computed, ref, shallowRef, watch, type ComputedRef } from 'vue';
import { useRepeatingTimer } from '@linnya/renderer-ui';
import type { ToolUiActivity } from '@linnya/plugin-host-contract/renderer/toolUi';
import {
  isInteractiveRunUnfinished,
  useInteractiveRunStore,
  type InteractiveRunStatus,
} from '../../../features/interactive-run';
import { useAnnotationRunExecutionStore } from '../../../features/annotation-run';
import { useCommandApprovalProjectionStore } from '../../../features/command-approval';
import { readConversationMessageRunId } from '../../../functions/readConversationMessageRunId';
import { formatConversationDuration } from '../../../functions/formatConversationDuration';
import { useConversationLocalization } from '../../../ui/useConversationLocalization';
import type { BaseMessage, ToolCallMessage } from '../../../types';
import { RUN_STATUS_TICK_MS, type RunStatusRowView } from '../definitions/runStatus';
import {
  advanceDisplayedRunStatus,
  createRunWorkClock,
  readRunWorkClock,
  resolveRunStartedAt,
  resolveRunStatusSignal,
  resolveRunStatusText,
  setRunWorkClockTicking,
  type DisplayedRunStatus,
  type RunWorkClock,
} from '../functions/resolveRunStatus';

interface ActiveRun {
  /** 换运行时重置计时与停留：还没拿到运行身份的“发起中”也算一段，拿到后按真实身份重算开始时间。 */
  readonly key: string;
  readonly runId: string | null;
  readonly status: InteractiveRunStatus;
  readonly executionId: string | undefined;
}

/**
 * 主时间线底部常驻状态行：整轮运行（含等回答、等批准、已暂停）一直显示“在做什么 · 已用时长”。
 * 规则都在 resolveRunStatus 的纯函数里；这里只接线运行快照、审批投影、消息和每秒一次的时钟。
 */
export function useRunStatusRow(input: {
  readonly conversationId: () => string;
  readonly messages: () => readonly BaseMessage[];
  readonly resolveToolActivity: (message: ToolCallMessage) => ToolUiActivity | undefined;
}): ComputedRef<RunStatusRowView | null> {
  const interactive = useInteractiveRunStore();
  const annotation = useAnnotationRunExecutionStore();
  const approvals = useCommandApprovalProjectionStore();
  const { conversationMessage } = useConversationLocalization();

  const activeRun = computed<ActiveRun | null>(() => {
    const conversationId = input.conversationId();
    const snapshot = interactive.snapshotFor(conversationId);
    if (snapshot && isInteractiveRunUnfinished(snapshot)) {
      return {
        key: snapshot.runId ?? 'pending',
        runId: snapshot.runId ?? null,
        status: snapshot.status,
        executionId: snapshot.executionId,
      };
    }
    // 批注运行没有暂停与交互，只有“在跑”这一种控制态。
    if (annotation.isStreamingFor(conversationId) && annotation.runId) {
      return { key: annotation.runId, runId: annotation.runId, status: 'running', executionId: undefined };
    }
    return null;
  });

  const now = ref(Date.now());
  const ticker = useRepeatingTimer();

  const clock = shallowRef<RunWorkClock | null>(null);
  const displayed = shallowRef<DisplayedRunStatus | null>(null);

  const isRunMessage = (message: BaseMessage): boolean => {
    const runId = activeRun.value?.runId;
    return runId !== null && runId !== undefined && readConversationMessageRunId(message) === runId;
  };
  const runMessages = computed(() => (activeRun.value?.runId ? input.messages().filter(isRunMessage) : []));
  const awaitingApproval = computed(() => {
    const conversationId = input.conversationId();
    return approvals.snapshot?.pending.some(pending => (
      pending.conversation_id === conversationId && pending.status === 'awaiting_reply'
    )) ?? false;
  });

  const statusText = computed(() => {
    const run = activeRun.value;
    if (!run) return null;
    return resolveRunStatusText(resolveRunStatusSignal({
      runStatus: run.status,
      executionId: run.executionId,
      awaitingApproval: awaitingApproval.value,
      runMessages: runMessages.value,
      now: now.value,
      resolveToolActivity: input.resolveToolActivity,
    }));
  });

  // 新运行：重新开始计时与文字停留；时钟每秒前进。
  watch(
    () => activeRun.value?.key ?? null,
    key => {
      ticker.stop();
      displayed.value = null;
      clock.value = null;
      if (key === null) return;
      now.value = Date.now();
      ticker.start(() => { now.value = Date.now(); }, RUN_STATUS_TICK_MS);
    },
    { immediate: true },
  );

  // 计时：开始时间以本轮用户消息为准；暂停期间停表，继续后接着走。
  watch(
    () => [activeRun.value, now.value] as const,
    ([run, currentNow]) => {
      if (!run) return;
      const ticking = run.status !== 'paused' && run.status !== 'pausing' && run.status !== 'cancelling';
      if (!clock.value) {
        const startedAt = resolveRunStartedAt(input.messages(), isRunMessage) ?? currentNow;
        clock.value = createRunWorkClock({ startedAt, now: currentNow, ticking });
        return;
      }
      clock.value = setRunWorkClockTicking(clock.value, ticking, currentNow);
    },
    { immediate: true },
  );

  // 时钟也是来源：被停留规则挡下的新文字要在下一秒重新判断，否则信号不再变化时会一直停在旧文字。
  watch(
    () => [statusText.value, now.value] as const,
    ([text, currentNow]) => {
      displayed.value = text ? advanceDisplayedRunStatus(displayed.value, text, currentNow) : null;
    },
    { immediate: true },
  );

  return computed(() => {
    const shown = displayed.value;
    const currentClock = clock.value;
    if (!activeRun.value || !shown || !currentClock) return null;
    return {
      text: conversationMessage(shown.text.labelKey),
      elapsedText: formatConversationDuration(readRunWorkClock(currentClock, now.value), conversationMessage),
      motion: shown.text.motion,
    };
  });
}
