import type {
  CommandAgentRunId,
  CommandConversationId,
} from '@app/schemas/commands';

/**
 * endAgentRun 已经建立停止屏障并完成进程收口；调用方退出最外层执行栈时必须释放。
 * 凭证只在收口成功后产生，避免失败路径误删仍然承担安全职责的屏障。
 */
export interface CommandAgentRunEndBarrier {
  release(): void;
}

/**
 * Agent 编排只需要声明一个 run 已结束，不能取得底层进程表或控制其他 run。
 * 这个窄口让 root run 与 child run 共用同一套 owner 收口语义。
 */
export interface CommandAgentRunLifecyclePort {
  endAgentRun(input: {
    readonly conversationId: CommandConversationId;
    readonly agentRunId: CommandAgentRunId;
  }): Promise<CommandAgentRunEndBarrier>;
}
