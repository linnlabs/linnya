import type { ComputedRef, InjectionKey } from 'vue';
import type { InteractiveRunStatus } from '../../../features/interactive-run';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';

/** 只属于展示层；未完成消息不等于运行仍在执行，不回写 Runtime 或消息 metadata。 */
export type ExecutionActivityState = 'inactive' | InteractiveRunStatus;

export interface ExecutionActivity {
  readonly state: ExecutionActivityState;
  readonly isExecuting: boolean;
  readonly labelKey: ConversationMessageKey;
}

/** child 只能继承显式绑定的父调用活动态，不能把当前会话的任意 run 当作自己的 owner。 */
export interface SubrunExecutionScope {
  readonly conversationId: string;
  readonly runId: () => string | undefined;
  readonly activity: ComputedRef<ExecutionActivity>;
}

export const SUBRUN_EXECUTION_SCOPE_KEY: InjectionKey<SubrunExecutionScope> = Symbol(
  'conversation:subrun-execution-scope'
);
/** 布局归属只决定哪里播放动画，不改写运行活动态。 */
export interface ToolExecutionScope {
  readonly activity: ComputedRef<ExecutionActivity>;
  readonly headerOwnsProgress: ComputedRef<boolean>;
}

export const TOOL_EXECUTION_SCOPE_KEY: InjectionKey<ToolExecutionScope> = Symbol(
  'conversation:tool-execution-scope'
);
