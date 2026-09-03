import {
  ProcessToolRuntimeResultSchema,
  ShellToolRuntimeResultSchema,
  type CommandAgentRunId,
  type CommandControlToolCallId,
  type CommandConversationId,
  type CommandExecutionOwnerBindingV1,
  type CommandOriginToolCallId,
  type ProcessToolArgumentsV1,
  type ProcessToolRuntimeResult,
  type ShellToolArgumentsV1,
  type ShellToolRuntimeResult,
} from '@app/schemas/commands';
import type { CommandRunPermissionContext } from 'src/domains/commands/features/permission-settings';

export type {
  ProcessToolPublicRejectionCode,
  ProcessToolRuntimeResult,
  ShellToolPublicRejectionCode,
  ShellToolRuntimeResult,
  ShellToolTerminalSummary,
} from '@app/schemas/commands';

export function parseShellToolRuntimeResult(value: unknown): ShellToolRuntimeResult {
  const parsed = ShellToolRuntimeResultSchema.safeParse(value);
  if (!parsed.success) {
    // Zod 细节可能包含误带的内部字段名；工具错误只能暴露稳定边界，不回显这些细节。
    throw new Error('shell 工具宿主返回了无效结果');
  }
  return parsed.data;
}

export function parseProcessToolRuntimeResult(value: unknown): ProcessToolRuntimeResult {
  const parsed = ProcessToolRuntimeResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('process 工具宿主返回了无效结果');
  }
  return parsed.data;
}

interface ShellToolRuntimeContext {
  readonly conversationId: CommandConversationId;
  readonly agentRunId: CommandAgentRunId;
  readonly commandRunPermission: CommandRunPermissionContext;
  readonly abortSignal?: AbortSignal;
}

export interface ExecuteShellToolRequest extends ShellToolRuntimeContext {
  readonly arguments: ShellToolArgumentsV1;
  readonly originToolCallId: CommandOriginToolCallId;
  /** 必须与当前 ToolContext 的 ToolOutput reader 实例一致，不能用短生命周期 run id 代替。 */
  readonly toolOutputInstanceId: string;
}

export interface ExecuteProcessToolRequest extends ShellToolRuntimeContext {
  readonly arguments: ProcessToolArgumentsV1;
  readonly controlToolCallId: CommandControlToolCallId;
}

/**
 * 审计 sink 与命令 owner 互不拥有彼此的终态。这个窄端口只保存“审计不完整”的
 * 用户可见旁路事实，不能借此取消命令或改写自然退出、超时等真实结果。
 */
export interface CommandExecutionAuditFailurePort {
  report(binding: CommandExecutionOwnerBindingV1): void;
  hasFailure(binding: CommandExecutionOwnerBindingV1): boolean;
}

export type CommandExecutionAuditFailureStage =
  | 'proposal_created'
  | 'authorization_settled'
  | 'execution_rejected'
  | 'execution_started'
  | 'process_action'
  | 'execution_terminal';

export interface CommandExecutionAuditDiagnosticPort {
  recordFailure(input: {
    readonly binding: CommandExecutionOwnerBindingV1;
    readonly stage: CommandExecutionAuditFailureStage;
  }): void;
}

/**
 * 两个 Agent 工具共用的 host 用例边界。工具看不到 owner、backend、runner、PID 或
 * generation；runtime 也不接收未校验的宽泛参数对象。
 */
export interface ShellToolRuntimePort {
  executeShell(request: ExecuteShellToolRequest): Promise<ShellToolRuntimeResult>;
  executeProcess(request: ExecuteProcessToolRequest): Promise<ProcessToolRuntimeResult>;
}
