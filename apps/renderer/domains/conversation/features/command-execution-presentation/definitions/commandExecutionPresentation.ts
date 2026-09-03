import type {
  CommandExecutionPresentationFactsV1,
  CommandOutputIncompleteReason,
  CommandProcessHandle,
  CommandToolOutputDisplay,
  ProcessToolPublicRejectionCode,
  ShellToolPublicRejectionCode,
  ShellToolTerminalSummary,
} from '@app/schemas/commands';

export type CommandExecutionDisplayState =
  | 'starting'
  | 'running'
  | 'completed'
  | 'rejected'
  | 'failed';

interface CommandExecutionPresentationBase {
  readonly state: CommandExecutionDisplayState;
  readonly observation: string;
  readonly display?: CommandToolOutputDisplay;
  readonly terminal?: ShellToolTerminalSummary;
  readonly executionFacts?: CommandExecutionPresentationFactsV1;
  readonly incomplete: boolean;
  readonly incompleteReasons: readonly CommandOutputIncompleteReason[];
}

/**
 * 模型已声明一次命令调用，但参数尚未通过 command owner admission。
 * 该状态只承载生命周期事实，不能伪造 command、process handle 或 action。
 */
export interface CommandExecutionLifecyclePresentationData
  extends CommandExecutionPresentationBase {
  readonly kind: 'command_execution_lifecycle';
  readonly source: 'shell' | 'process';
  readonly state: 'starting' | 'failed';
  readonly toolCallId?: string;
}

export interface ShellCommandExecutionPresentationData extends CommandExecutionPresentationBase {
  readonly kind: 'command_execution';
  readonly source: 'shell';
  readonly toolCallId?: string;
  readonly command: string;
  readonly cwd?: string;
  readonly interactive: boolean;
  readonly processHandle?: CommandProcessHandle;
  readonly nextCursor?: number;
  readonly rejectionCode?: ShellToolPublicRejectionCode;
  readonly lastProcessAction?: string;
  readonly lastProcessRejectionCode?: ProcessToolPublicRejectionCode;
}

export interface ProcessCommandExecutionPresentationData extends CommandExecutionPresentationBase {
  readonly kind: 'command_execution';
  readonly source: 'process';
  readonly effect: 'pending' | 'observation' | 'control_accepted' | 'rejected' | 'failed';
  readonly processHandle: CommandProcessHandle;
  readonly action: string;
  readonly nextCursor?: number;
  readonly rejectionCode?: ProcessToolPublicRejectionCode;
  readonly auditStatus?: 'complete' | 'incomplete';
}

export type CommandExecutionPresentationData =
  | CommandExecutionLifecyclePresentationData
  | ShellCommandExecutionPresentationData
  | ProcessCommandExecutionPresentationData;
