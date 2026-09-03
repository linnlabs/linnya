import type { Readable } from 'node:stream';

export interface OwnedPipeProcessLaunch {
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}

export interface OwnedPipeProcessLaunchOptions {
  readonly abortSignal?: AbortSignal;
}

export interface OwnedProcessRootExit {
  readonly exitCode: number | null;
  readonly signal: string | null;
}

export type OwnedProcessTreeStopResult =
  | { readonly status: 'succeeded' }
  | {
      readonly status: 'failed';
      readonly error: Error;
    };

export type OwnedProcessResourceReleaseResult =
  | { readonly status: 'succeeded' }
  | {
      readonly status: 'failed';
      readonly error: Error;
    };

/**
 * 平台在 owner 交付前已经创建过进程或句柄且回滚不完整时，必须把两个清理事实
 * 交给调用方。此时调用方不能再声称 process not_started 或 cleanup not_required。
 */
export class OwnedPipeProcessStartupCleanupError extends Error {
  readonly cause?: unknown;

  constructor(
    message: string,
    readonly treeCleanup: OwnedProcessTreeStopResult,
    readonly resourceRelease: OwnedProcessResourceReleaseResult,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'OwnedPipeProcessStartupCleanupError';
    this.cause = options?.cause;
  }
}

/**
 * 本地一次性 pipe 进程的最小平台事实。这里不携带 Commands identity、Agent handle、
 * 审批、输出存储或 Sandbox 协议，两个业务只能在各自边界上组合这些事实。
 */
export interface OwnedPipeProcess {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly rootExit: Promise<OwnedProcessRootExit>;
  readonly rootClose: Promise<void>;
  readonly treeEmpty: Promise<OwnedProcessTreeStopResult>;
  stopAndWaitForTreeEmpty(): Promise<OwnedProcessTreeStopResult>;
  release(): Promise<OwnedProcessResourceReleaseResult>;
}
