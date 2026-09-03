import type {
  CommandConversationId,
  CommandExecutionOwnerBindingV1,
  ProcessControlRequestV1,
} from '@app/schemas/commands';

import type {
  CommandProcessHandleDiscardResult,
  CommandProcessHandlePublishResult,
  CommandProcessOutputQueryResult,
} from '../features/process-control/definitions/commandProcessObservation';

/**
 * Agent 可见 handle 的查询口。它与 execution 生命周期 owner 由同一个实例实现，
 * 但删除 workflow 只依赖生命周期 port，不会被输出游标和终态重放细节反向耦合。
 */
export interface CommandProcessObservationPort {
  /** 仅在 shell 确实要把 running handle 返回给 Agent 时调用。 */
  publishHandle(binding: CommandExecutionOwnerBindingV1): CommandProcessHandlePublishResult;

  /** 初始等待得到终态、不会返回 handle 时调用，释放尚未公开的最小终态记录。 */
  discardUnpublishedHandle(
    binding: CommandExecutionOwnerBindingV1,
  ): CommandProcessHandleDiscardResult;

  queryOutput(request: ProcessControlRequestV1): Promise<CommandProcessOutputQueryResult>;

  /**
   * 只向同一 App-host 内的审计编排暴露已经发布且作用域匹配的稳定身份。
   * 不能在 Shell runtime 另建 handle 索引，否则对话删除和终态重放会产生两份真源。
   */
  readPublishedBinding(
    request: ProcessControlRequestV1,
  ): CommandExecutionOwnerBindingV1 | undefined;

  /** 对话事实真正删除后调用；删除尝试失败不能提前使 handle 消失。 */
  forgetDeletedConversation(conversationId: CommandConversationId): void;
}
