import { computed, inject, provide, type ComputedRef } from 'vue';
import type { ConversationToolMessageStatus } from '@app/schemas';
import { useInteractiveRunStore } from '../../../features/interactive-run';
import { useAnnotationRunExecutionStore } from '../../../features/annotation-run';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import {
  SUBRUN_EXECUTION_SCOPE_KEY,
  TOOL_EXECUTION_SCOPE_KEY,
  type ExecutionActivity,
  type ToolExecutionScope,
} from '../definitions/executionActivity';
import {
  executionActivity,
  resolveRunExecutionActivity,
  resolveToolExecutionActivity,
} from '../functions/resolveExecutionActivity';

export function useRunExecutionActivity(
  conversationId: () => string,
  runId: () => string | undefined
): ComputedRef<ExecutionActivity> {
  const inherited = inject(SUBRUN_EXECUTION_SCOPE_KEY, undefined);
  const interactive = useInteractiveRunStore();
  const annotation = useAnnotationRunExecutionStore();
  return computed(() => {
    const id = runId();
    if (!id) return executionActivity('inactive');
    if (inherited?.conversationId === conversationId() && inherited.runId() === id) {
      return inherited.activity.value;
    }
    const run = interactive.snapshotFor(conversationId());
    if (run?.runId === id) return resolveRunExecutionActivity(run);
    if (annotation.runId === id && annotation.isStreamingFor(conversationId())) {
      return executionActivity('running');
    }
    // 历史记录或尚未读取到控制快照时，只能显示未完成，不能从 loading 猜测后台正在运行。
    return executionActivity('inactive');
  });
}

function useExecutionRenderScope() {
  const scope = inject(CONVERSATION_RENDER_SCOPE_KEY);
  if (!scope) throw new Error('Execution activity requires a conversation render scope');
  return scope;
}

/** 插件公开卡与完整 child 消息共享同一父调用归属，不引入当前会话回退。 */
export function provideSubrunExecutionActivity(
  runId: () => string | undefined,
  activity: ComputedRef<ExecutionActivity>
): void {
  const scope = useExecutionRenderScope();
  provide(SUBRUN_EXECUTION_SCOPE_KEY, { conversationId: scope.conversationId, runId, activity });
}

export function useMessageExecutionActivity(
  runId: () => string | undefined
): ComputedRef<ExecutionActivity> {
  const scope = useExecutionRenderScope();
  return useRunExecutionActivity(() => scope.conversationId, runId);
}

export function provideToolExecutionActivity(
  status: () => ConversationToolMessageStatus,
  owner: ComputedRef<ExecutionActivity>,
  headerOwnsProgress: () => boolean
): ComputedRef<ExecutionActivity> {
  const activity = computed(() => resolveToolExecutionActivity(status(), owner.value));
  provide(TOOL_EXECUTION_SCOPE_KEY, { activity, headerOwnsProgress: computed(headerOwnsProgress) });
  return activity;
}

export function useToolExecutionActivity(
  status?: () => ConversationToolMessageStatus
): ComputedRef<ExecutionActivity> {
  const { activity } = useToolExecutionScope();
  return status ? computed(() => resolveToolExecutionActivity(status(), activity.value)) : activity;
}

function useToolExecutionScope(): ToolExecutionScope {
  const scope = inject(TOOL_EXECUTION_SCOPE_KEY);
  if (!scope) throw new Error('Tool execution activity must be provided by its message host');
  return scope;
}

/** header 已表达进度时，正文保留业务文案与布局，不重复播放同一工具的等待动画。 */
export function useToolBodyProgress(): ComputedRef<boolean> {
  const scope = useToolExecutionScope();
  return computed(() => scope.activity.value.isExecuting && !scope.headerOwnsProgress.value);
}
