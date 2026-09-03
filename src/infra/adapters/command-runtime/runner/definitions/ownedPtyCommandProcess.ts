import type { Readable } from 'node:stream';

import type { ProcessInteractionActionV1 } from '@app/schemas/commands';

import type {
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
  OwnedProcessRootExit,
  OwnedProcessTreeStopResult,
} from '../../../../../shared/process-runtime';

export class OwnedPtyCommandProcessStartupCleanupError extends Error {
  readonly cause?: unknown;

  constructor(
    message: string,
    readonly treeCleanup: OwnedProcessTreeStopResult,
    readonly resourceRelease: OwnedProcessResourceReleaseResult,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'OwnedPtyCommandProcessStartupCleanupError';
    this.cause = options?.cause;
  }
}

export interface OwnedPtyCommandProcessLaunch {
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly terminalSize: {
    readonly columns: number;
    readonly rows: number;
  };
}

/**
 * 一次性 runner 内部的 PTY 平台事实。terminal 是 backend transcript，不冒充
 * child stdout 原始 byte；输入 Promise 只有在固定 backend 真正接纳动作后才完成，
 * 上层不能把 Utility transport ACK 当作平台接纳。
 */
export interface OwnedPtyCommandProcess {
  readonly terminal: Readable;
  readonly rootExit: Promise<OwnedProcessRootExit>;
  readonly treeEmpty: Promise<OwnedProcessTreeStopResult>;
  readonly backendFailure: Promise<Error>;
  interact(action: ProcessInteractionActionV1): Promise<void>;
  stopAndWaitForTreeEmpty(): Promise<OwnedProcessTreeStopResult>;
  release(): Promise<OwnedProcessResourceReleaseResult>;
}

export type LaunchOwnedPtyCommandProcess = (
  launch: OwnedPtyCommandProcessLaunch,
  options?: OwnedPipeProcessLaunchOptions,
) => Promise<OwnedPtyCommandProcess>;
