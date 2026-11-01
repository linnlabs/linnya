import {
  SandboxManager,
} from '@anthropic-ai/sandbox-runtime';
import type { CommandPermissionLevel } from '@app/schemas/commands';

import { OwnedPipeProcessStartupCleanupError } from '../../../../shared/process-runtime';
import type {
  OwnedPipeProcess,
  OwnedPipeProcessLaunch,
  OwnedPipeProcessLaunchOptions,
  OwnedProcessResourceReleaseResult,
} from '../../../../shared/process-runtime';
import { createMacOsProcessGroupOwnedPipeProcess } from '../../local-process-runtime/macos';
import { createMacOsCommandFilesystemPolicy } from './functions/createMacOsCommandFilesystemPolicy';
import { serializePosixCommandArgv } from './functions/serializePosixCommandArgv';

export interface MacOsSandboxedOwnedPipeCommandProcessLaunch
  extends OwnedPipeProcessLaunch {
  readonly permissionLevel: CommandPermissionLevel;
  readonly conversationRoot: string;
}

export type MacOsOwnedPipeCommandProcessLaunchFailureStage =
  | 'sandbox'
  | 'process_owner';

export class MacOsOwnedPipeCommandProcessLaunchError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly stage: MacOsOwnedPipeCommandProcessLaunchFailureStage,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'MacOsOwnedPipeCommandProcessLaunchError';
    this.cause = options?.cause;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function resetSandboxAfterFailure(
  originalError: unknown,
  stage: MacOsOwnedPipeCommandProcessLaunchFailureStage,
): Promise<never> {
  try {
    await SandboxManager.reset();
  } catch (resetError) {
    if (originalError instanceof OwnedPipeProcessStartupCleanupError) {
      throw new OwnedPipeProcessStartupCleanupError(
        'macOS process owner startup and sandbox reset both failed',
        originalError.treeCleanup,
        {
          status: 'failed',
          error: new Error(
            `macOS sandbox reset failed: ${describeError(resetError)}`,
          ),
        },
        { cause: originalError },
      );
    }
    throw new MacOsOwnedPipeCommandProcessLaunchError(
      'sandbox',
      'macOS sandbox preparation and reset both failed',
      {
        cause: new Error(
          `preparation=${describeError(originalError)}; reset=${describeError(resetError)}`,
        ),
      },
    );
  }
  if (originalError instanceof OwnedPipeProcessStartupCleanupError) {
    throw originalError;
  }
  throw new MacOsOwnedPipeCommandProcessLaunchError(
    stage,
    `macOS ${stage === 'sandbox' ? 'sandbox' : 'process owner'} launch failed`,
    { cause: originalError },
  );
}

function ownSandboxLifetime(
  process: OwnedPipeProcess,
): OwnedPipeProcess {
  let releasePromise: Promise<OwnedProcessResourceReleaseResult> | undefined;

  return Object.freeze({
    stdout: process.stdout,
    stderr: process.stderr,
    rootExit: process.rootExit,
    rootClose: process.rootClose,
    treeEmpty: process.treeEmpty,
    stopAndWaitForTreeEmpty: () => process.stopAndWaitForTreeEmpty(),
    release() {
      if (releasePromise) return releasePromise;
      releasePromise = (async () => {
        const processRelease = await process.release();
        if (processRelease.status === 'failed') return processRelease;
        try {
          // SRT 是模块级 singleton。一次性 utility 只运行一条命令，必须在其终态
          // 显式 reset，防止上一次 policy 或监听资源进入下一次测试/复用环境。
          await SandboxManager.reset();
        } catch (error) {
          return {
            status: 'failed',
            error: new Error(
              `macOS sandbox reset failed: ${describeError(error)}`,
            ),
          };
        }
        return processRelease;
      })();
      return releasePromise;
    },
  });
}

/**
 * 组合 macOS 文件边界与进程树 owner。两个职责保持独立：SRT 失败时绝不裸跑，
 * 进程树 owner 失败时也不会把 sandbox-exec 的根退出冒充整树已清空。
 */
export async function createMacOsSandboxedOwnedPipeCommandProcess(
  launch: MacOsSandboxedOwnedPipeCommandProcessLaunch,
  options: OwnedPipeProcessLaunchOptions = {},
): Promise<OwnedPipeProcess> {
  if (launch.permissionLevel === 'full_access') {
    try {
      return await createMacOsProcessGroupOwnedPipeProcess(launch, options);
    } catch (error) {
      if (error instanceof OwnedPipeProcessStartupCleanupError) throw error;
      throw new MacOsOwnedPipeCommandProcessLaunchError(
        'process_owner',
        'macOS process owner launch failed',
        { cause: error },
      );
    }
  }

  let descriptor: Awaited<ReturnType<typeof SandboxManager.wrapWithSandboxArgv>>;
  try {
    const dependencies = await SandboxManager.checkDependenciesAsync();
    if (dependencies.errors.length > 0) {
      throw new Error(
        `macOS sandbox dependencies are unavailable: ${dependencies.errors.join(', ')}`,
      );
    }
    descriptor = await SandboxManager.wrapWithSandboxArgv(
      serializePosixCommandArgv(launch.executablePath, launch.argv),
      '/bin/zsh',
      { filesystem: createMacOsCommandFilesystemPolicy(launch) },
      options.abortSignal,
      launch.cwd,
    );
  } catch (error) {
    return resetSandboxAfterFailure(error, 'sandbox');
  }

  const [executablePath, ...argv] = descriptor.argv;
  if (!executablePath) {
    return resetSandboxAfterFailure(
      new Error('macOS sandbox returned an empty launch argv'),
      'sandbox',
    );
  }

  try {
    const process = await createMacOsProcessGroupOwnedPipeProcess({
      executablePath,
      argv,
      cwd: launch.cwd,
      // SRT 在 macOS 返回宿主 process.env。命令必须继续使用 Linnya 在 fork 前冻结的
      // 用户 Shell 环境，否则权限 adapter 会悄悄改变 PATH、代理和用户自定义变量。
      environment: launch.environment,
    }, options);
    return ownSandboxLifetime(process);
  } catch (error) {
    return resetSandboxAfterFailure(error, 'process_owner');
  }
}
