import type { CommandRunPermissionSnapshotV1 } from '@app/schemas/commands';

import type { PluginCliBridgeFailureCode } from '../../plugin-cli-shell-bridge';

export interface PluginCliToolInvocationRequest {
  readonly conversationId: string;
  readonly agentRunId: string;
  readonly toolCallId: string;
  readonly pluginId: string;
  readonly argv: readonly string[];
  /** 当前根 run 启动时冻结的权限；工具入口没有审批，生效档位就是它。 */
  readonly permission: CommandRunPermissionSnapshotV1;
  readonly signal?: AbortSignal;
}

export type PluginCliToolInvocationResult =
  | {
      readonly status: 'completed';
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly status: 'rejected';
      readonly code: PluginCliBridgeFailureCode;
      readonly exitCode: number;
      readonly message: string;
    };

/** plugin_cli 工具只拿到这个窄端口，不接触插件注册表、数据库或会话目录准入。 */
export interface PluginCliToolRuntimePort {
  invoke(request: PluginCliToolInvocationRequest): Promise<PluginCliToolInvocationResult>;
}

/** 未知异常只在宿主日志里留身份与阶段，命令结果只给关联号。 */
export interface PluginCliToolDiagnosticPort {
  recordUnexpectedFailure(input: {
    readonly correlationId: string;
    readonly stage: string;
    readonly conversationId: string;
    readonly agentRunId: string;
    readonly toolCallId: string;
    readonly pluginId: string;
    readonly invocationId?: string;
    readonly error: unknown;
  }): void;
}
