import type {
  CommandExecutionIdentity,
  CommandLaunchSnapshotV1,
} from '@app/schemas/commands';
import type {
  ShellCommandExecutionScope,
} from '../../../adapters/commands/shell-runtime';

export interface PluginCliShellBridgeRuntime {
  prepareExecution(launch: CommandLaunchSnapshotV1): ShellCommandExecutionScope;
  closeAndWait(): Promise<void>;
}

export type PluginCliBridgeUnexpectedFailureStage =
  | 'read_request'
  | 'parse_request'
  | 'resolve_plugin'
  | 'acquire_plugin'
  | 'prepare'
  | 'validate_access'
  | 'execute'
  | 'project_result'
  | 'write_response';

/** App Host 拥有的内部诊断端口；不能把 error 或 stack 投影到 bridge 协议。 */
export interface PluginCliBridgeDiagnosticPort {
  recordUnexpectedFailure(input: {
    readonly correlationId: string;
    readonly stage: PluginCliBridgeUnexpectedFailureStage;
    readonly identity: CommandExecutionIdentity;
    readonly pluginId?: string;
    readonly invocationId?: string;
    readonly error: unknown;
  }): void;
}
