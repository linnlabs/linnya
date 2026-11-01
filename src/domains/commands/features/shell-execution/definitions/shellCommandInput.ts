import type { ShellToolArgumentsV1 } from '@app/schemas/commands';

export type ShellCommandInputRejectionCode =
  | 'invalid_arguments'
  | 'invalid_command'
  | 'invalid_cwd'
  | 'invalid_initial_wait'
  | 'invalid_hard_timeout';

export interface ValidatedShellCommandInput {
  readonly command: ShellToolArgumentsV1['command'];
  readonly requestedCwd?: ShellToolArgumentsV1['cwd'];
  readonly interactive: boolean;
  readonly requiresWriteAccess: boolean;
  readonly initialWaitMs: number;
  readonly requestedHardTimeoutMs?: number;
}

export type ShellCommandInputValidation =
  | {
      readonly status: 'accepted';
      readonly input: ValidatedShellCommandInput;
    }
  | {
      readonly status: 'rejected';
      readonly code: ShellCommandInputRejectionCode;
    };
