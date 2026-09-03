export interface RegisteredCommandDescriptor {
  readonly id: string;
  readonly executablePath: string;
  readonly argvPrefix?: readonly string[];
  readonly allowedCwdRoots: readonly string[];
  readonly inheritedEnvironmentKeys: readonly string[];
  readonly allowedEnvironmentOverrides: readonly string[];
  readonly fixedEnvironment?: Readonly<Record<string, string>>;
  readonly defaultTimeoutMs: number;
  readonly maxTimeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface RegisteredCommandExecutionRequest {
  readonly commandId: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface CommandLaunchSpec {
  readonly commandId: string;
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface CommandProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export type CommandExecutionErrorCode =
  | 'command.execution.invalid_request'
  | 'command.execution.command_unavailable'
  | 'command.execution.executable_unavailable'
  | 'command.execution.cwd_out_of_scope'
  | 'command.execution.environment_not_allowed'
  | 'command.execution.launch_failed'
  | 'command.execution.timed_out'
  | 'command.execution.cancelled'
  | 'command.execution.output_limit_exceeded'
  | 'command.execution.termination_failed';

export class CommandExecutionError extends Error {
  readonly name = 'CommandExecutionError';

  constructor(
    readonly code: CommandExecutionErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
  }
}
