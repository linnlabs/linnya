import type {
  CommandAgentRunId,
  CommandConversationId,
  CommandExecutionIdentity,
  CommandExecutionMode,
  CommandExecutionOwnerBindingV1,
} from '@app/schemas/commands';

import type {
  CommandExecutionOwnerActivitySnapshot,
  PreparedCommandExecutionRuntime,
  CommandExecutionReservationReleaseResult,
  CommandExecutionReservationResult,
  CommandExecutionStartResult,
} from '../features/process-control/definitions/commandExecutionReservation';
export interface CommandExecutionOwnerPort {
  reserve(input: {
    readonly identity: CommandExecutionIdentity;
    readonly mode: CommandExecutionMode;
  }): CommandExecutionReservationResult;

  release(binding: CommandExecutionOwnerBindingV1): CommandExecutionReservationReleaseResult;

  /** Agent run 进入终态时同步建立屏障；随后到达的同 run 启动必须被拒绝。 */
  beginAgentRunStop(input: {
    readonly conversationId: CommandConversationId;
    readonly agentRunId: CommandAgentRunId;
  }): void;

  /** 精准等待当前 Agent run 的 execution 全部形成可信终态。 */
  stopAgentRunAndWait(input: {
    readonly conversationId: CommandConversationId;
    readonly agentRunId: CommandAgentRunId;
  }): Promise<void>;

  /**
   * Agent 最外层执行栈已经退出后，精准释放对应的停止屏障。
   * 只能在 stopAgentRunAndWait 成功且调用方保证不再产生该 run 的 tool call 后调用。
   */
  releaseAgentRunStopBarrier(input: {
    readonly conversationId: CommandConversationId;
    readonly agentRunId: CommandAgentRunId;
  }): void;

  claimAndStart(input: {
    readonly binding: CommandExecutionOwnerBindingV1;
    readonly prepareRuntime: () => PreparedCommandExecutionRuntime;
  }): Promise<CommandExecutionStartResult>;

  /** 持久 cleanup barrier 建立时同步调用；此方法不得等待平台进程。 */
  beginConversationStop(conversationId: CommandConversationId): void;

  /** 等待 reserved/starting/running 全部形成可信终态或明确失败。 */
  stopConversationAndWait(conversationId: CommandConversationId): Promise<void>;

  /** 只用于整个 App command owner 结束，不用于删除单个对话。 */
  endAndWait(): Promise<void>;

  readActivitySnapshot(): CommandExecutionOwnerActivitySnapshot;
}
