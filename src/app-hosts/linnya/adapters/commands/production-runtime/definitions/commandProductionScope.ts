import type { ShellToolRuntimePort } from '../../shell-runtime';
import type { CommandAgentRunLifecyclePort } from '../../process-owner';
import type {
  CommandExecutionOwnerPort,
  CommandProcessObservationPort,
  ConversationCommandApprovalDeletionPort,
} from 'src/domains/commands';

/** App 生命周期只取得运行事实和结束能力，不能取得 Shell、handle、PID 或 Agent run 内部能力。 */
export interface CommandAppOwnerLifecyclePort {
  hasExecutingCommands(): boolean;
  endOwnerAndWait(): Promise<void>;
}

/**
 * Commands 的 App Host 生产 scope。它不属于 Electron；桌面壳和 headless App Server
 * 都只能通过窄 port 注入自己的展示与 runner adapter。
 */
export interface CommandProductionScope extends CommandAppOwnerLifecyclePort {
  readonly shellToolRuntime: ShellToolRuntimePort;
  readonly agentRunLifecycle: CommandAgentRunLifecyclePort;
  /** 只供 App 级对话删除工作流使用，不向 History 或 renderer 暴露进程 owner。 */
  readonly conversationCleanupCommands: Pick<
    CommandExecutionOwnerPort & CommandProcessObservationPort,
    'beginConversationStop' | 'stopConversationAndWait' | 'forgetDeletedConversation'
  >;
  /** 删除工作流只能清除已有批准，不能借此读取或创建批准。 */
  readonly conversationApprovalDeletion: ConversationCommandApprovalDeletionPort;
  /** 对话删除固定步骤显式清理 UI-only command settlement，不能只依赖外键。 */
  readonly conversationCardSettlementDeletion: {
    drainConversation(conversationId: string): Promise<void>;
    deleteForConversation(conversationId: string): Promise<void>;
  };
}
