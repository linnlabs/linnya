import type {
  CommandRunnerInternalEnvironmentV1,
  CommandRuntimeFailureCode,
  PtyCommandLaunchSnapshotV1,
} from '@app/schemas/commands';

import type {
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
  OwnedProcessTreeStopResult,
} from '../../../../../shared/process-runtime';
import type { OwnedPtyCommandProcess } from './ownedPtyCommandProcess';

export type CommandRunnerOwnedPtyProcessLaunchSettlement =
  | { readonly status: 'guaranteed_not_started' }
  | {
      readonly status: 'startup_cleanup_observed';
      readonly treeCleanup: OwnedProcessTreeStopResult;
      readonly resourceRelease: OwnedProcessResourceReleaseResult;
    };

export class CommandRunnerOwnedPtyProcessLaunchError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly failureCode: CommandRuntimeFailureCode,
    message: string,
    readonly settlement: CommandRunnerOwnedPtyProcessLaunchSettlement,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'CommandRunnerOwnedPtyProcessLaunchError';
    this.cause = options?.cause;
  }
}

export type LaunchCommandRunnerOwnedPtyProcess = (
  launch: PtyCommandLaunchSnapshotV1,
  options?: OwnedPipeProcessLaunchOptions & {
    readonly internalEnvironment?: CommandRunnerInternalEnvironmentV1;
  },
) => Promise<OwnedPtyCommandProcess>;
