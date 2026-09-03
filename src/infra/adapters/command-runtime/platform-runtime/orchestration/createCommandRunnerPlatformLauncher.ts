import {
  CommandRunnerOwnedPipeProcessLaunchError,
  type LaunchCommandRunnerOwnedPipeProcess,
} from '../../runner/definitions/commandRunnerOwnedPipeProcess';
import {
  CommandRunnerOwnedPtyProcessLaunchError,
  type LaunchCommandRunnerOwnedPtyProcess,
} from '../../runner/definitions/commandRunnerOwnedPtyProcess';
import { OwnedPipeProcessStartupCleanupError } from '../../../../../shared/process-runtime';
import { OwnedPtyCommandProcessStartupCleanupError } from '../../runner/definitions/ownedPtyCommandProcess';
import { resolveCommandInvocationArguments } from '../../runner/functions/resolveCommandInvocationArguments';
import {
  createMacOsSandboxedOwnedPipeCommandProcess,
  MacOsOwnedPipeCommandProcessLaunchError,
} from '../../macos/createMacOsSandboxedOwnedPipeCommandProcess';
import {
  createWindowsJobOwnedPipeProcessLauncher,
} from '../../../local-process-runtime/windows';
import { createWindowsJobOwnedPtyCommandProcessLauncher } from '../../windows/createWindowsJobOwnedPtyCommandProcess';
import {
  createWindowsOwnedPipeNativeBindingLoader,
  type WindowsOwnedPipeNativeBindingLoaderOptions,
} from '../../../local-process-runtime/windows/functions/loadWindowsOwnedPipeNativeBinding';
import {
  createWindowsOwnedPtyNativeBindingLoader,
} from '../../windows/functions/loadWindowsOwnedPtyNativeBinding';
import type {
  LocalProcessPlatformRuntime,
} from '../../../local-process-runtime/platform-runtime';
import { classifyCommandPlatformLaunchFailure } from '../functions/classifyCommandPlatformLaunchFailure';
import { LINNYA_CONVERSATION_ROOT_ENV } from '../../../../../domains/commands/definitions/internalCommandMode';

function createPlatformLaunchError(input: {
  readonly failureCode: 'sandbox_unavailable' | 'process_owner_unavailable';
  readonly message: string;
  readonly error: unknown;
}): CommandRunnerOwnedPipeProcessLaunchError {
  return new CommandRunnerOwnedPipeProcessLaunchError(
    classifyCommandPlatformLaunchFailure(input.error) ?? input.failureCode,
    input.message,
    input.error instanceof OwnedPipeProcessStartupCleanupError
      ? {
          status: 'startup_cleanup_observed',
          treeCleanup: input.error.treeCleanup,
          resourceRelease: input.error.resourceRelease,
        }
      : { status: 'guaranteed_not_started' },
    { cause: input.error },
  );
}

function createInvocation(
  launch: Parameters<LaunchCommandRunnerOwnedPipeProcess>[0]
    | Parameters<LaunchCommandRunnerOwnedPtyProcess>[0],
  internalEnvironment: Readonly<Record<string, string>> = {},
) {
  return {
    executablePath: launch.shell.executable_path,
    argv: [
      ...launch.shell.argv_prefix,
      ...resolveCommandInvocationArguments({
        shell: launch.shell,
        approvedCommand: launch.proposal.command,
      }),
    ],
    cwd: launch.proposal.cwd,
    environment: {
      ...launch.environment.entries,
      // conversation_root 是 launch snapshot 的后端事实。注入子进程后，宿主 CLI
      // 可以在任意对话子目录启动，同时不需要把绝对路径暴露给 Agent 或持久事件。
      [LINNYA_CONVERSATION_ROOT_ENV]: launch.conversation_root,
      ...internalEnvironment,
    },
  };
}

function createPtyPlatformLaunchError(input: {
  readonly failureCode: 'sandbox_unavailable' | 'process_owner_unavailable';
  readonly message: string;
  readonly error: unknown;
}): CommandRunnerOwnedPtyProcessLaunchError {
  return new CommandRunnerOwnedPtyProcessLaunchError(
    classifyCommandPlatformLaunchFailure(input.error) ?? input.failureCode,
    input.message,
    input.error instanceof OwnedPtyCommandProcessStartupCleanupError
      ? {
          status: 'startup_cleanup_observed',
          treeCleanup: input.error.treeCleanup,
          resourceRelease: input.error.resourceRelease,
        }
      : { status: 'guaranteed_not_started' },
    { cause: input.error },
  );
}

export interface CommandRunnerPlatformLaunchers {
  readonly launchOwnedPipeProcess: LaunchCommandRunnerOwnedPipeProcess;
  readonly launchOwnedPtyProcess: LaunchCommandRunnerOwnedPtyProcess;
}

/**
 * 这是一次性 utility 内唯一允许出现平台分支的组合根。平台 handle、Job 和 SRT
 * 都留在 child 内；Electron main 只提供已冻结的可信运行时事实。
 */
export function createCommandRunnerPlatformLauncher(
  runtime: LocalProcessPlatformRuntime,
): CommandRunnerPlatformLaunchers {
  if (runtime.platform === 'darwin') {
    if (process.platform !== 'darwin') {
      throw new CommandRunnerOwnedPipeProcessLaunchError(
        'runtime_unavailable',
        'macOS command runtime was configured on another platform',
        { status: 'guaranteed_not_started' },
      );
    }
    const launchOwnedPipeProcess: LaunchCommandRunnerOwnedPipeProcess = async (
      launch,
      options,
    ) => {
      if (launch.shell.platform !== 'macos') {
        throw new CommandRunnerOwnedPipeProcessLaunchError(
          'runtime_unavailable',
          'macOS command runtime received a non-macOS Shell snapshot',
          { status: 'guaranteed_not_started' },
        );
      }
      try {
        return await createMacOsSandboxedOwnedPipeCommandProcess({
          ...createInvocation(launch, options?.internalEnvironment),
          permissionLevel: launch.permission.effective_level,
          conversationRoot: launch.conversation_root,
        }, options);
      } catch (error) {
        throw createPlatformLaunchError({
          failureCode: error instanceof MacOsOwnedPipeCommandProcessLaunchError
            && error.stage === 'sandbox'
            ? 'sandbox_unavailable'
            : 'process_owner_unavailable',
          message: 'macOS command platform owner could not be established',
          error,
        });
      }
    };
    const launchOwnedPtyProcess: LaunchCommandRunnerOwnedPtyProcess = async (
      launch,
      options,
    ) => {
      if (launch.shell.platform !== 'macos') {
        throw new CommandRunnerOwnedPtyProcessLaunchError(
          'runtime_unavailable',
          'macOS command PTY runtime received a non-macOS Shell snapshot',
          { status: 'guaranteed_not_started' },
        );
      }
      // node-pty 只允许显式 PTY run 加载。普通 pipe Utility 不能因为共用组合根，
      // 就提前持有 native PTY/helper，避免重现竞品普通命令被 PTY 依赖拖累的问题。
      let ptyRuntime: typeof import(
        '../../macos/createMacOsSandboxedOwnedPtyCommandProcess'
      );
      try {
        ptyRuntime = await import(
          '../../macos/createMacOsSandboxedOwnedPtyCommandProcess'
        );
      } catch (error) {
        throw new CommandRunnerOwnedPtyProcessLaunchError(
          'runtime_unavailable',
          'macOS command PTY runtime is unavailable',
          { status: 'guaranteed_not_started' },
          { cause: error },
        );
      }
      try {
        return await ptyRuntime.createMacOsSandboxedOwnedPtyCommandProcess({
          ...createInvocation(launch, options?.internalEnvironment),
          permissionLevel: launch.permission.effective_level,
          conversationRoot: launch.conversation_root,
          terminalSize: launch.terminal_size,
        }, options);
      } catch (error) {
        throw createPtyPlatformLaunchError({
          failureCode: error instanceof ptyRuntime.MacOsOwnedPtyCommandProcessLaunchError
            && error.stage === 'sandbox'
            ? 'sandbox_unavailable'
            : 'process_owner_unavailable',
          message: 'macOS command PTY platform owner could not be established',
          error,
        });
      }
    };
    return Object.freeze({ launchOwnedPipeProcess, launchOwnedPtyProcess });
  }

  if (process.platform !== 'win32') {
    throw new CommandRunnerOwnedPipeProcessLaunchError(
      'runtime_unavailable',
      'Windows command runtime was configured on another platform',
      { status: 'guaranteed_not_started' },
    );
  }
  const loaderOptions: WindowsOwnedPipeNativeBindingLoaderOptions = {
    manifestPath: runtime.manifest_path,
    expectedRuntimeVersion: runtime.expected_runtime_version,
    expectedApplicationVersion: runtime.expected_application_version,
    trust: runtime.trust.kind === 'development'
      ? { kind: 'development' }
      : {
          kind: 'release',
          expectedPublisherIdentity: runtime.trust.expected_publisher_identity,
        },
  };
  const pipeLoader = createWindowsOwnedPipeNativeBindingLoader(loaderOptions);
  const ptyLoader = createWindowsOwnedPtyNativeBindingLoader(loaderOptions);
  let pipeNativeBinding: Awaited<ReturnType<typeof pipeLoader.load>> | undefined;
  let ptyNativeBinding: Awaited<ReturnType<typeof ptyLoader.load>> | undefined;
  const launchOwnedPipeProcess: LaunchCommandRunnerOwnedPipeProcess = async (
    launch,
    options,
  ) => {
    if (launch.shell.platform !== 'windows') {
      throw new CommandRunnerOwnedPipeProcessLaunchError(
        'runtime_unavailable',
        'Windows command runtime received a non-Windows Shell snapshot',
        { status: 'guaranteed_not_started' },
      );
    }
    if (!pipeNativeBinding) {
      try {
        pipeNativeBinding = await pipeLoader.load();
      } catch (error) {
        throw new CommandRunnerOwnedPipeProcessLaunchError(
          'runtime_unavailable',
          'Windows command native runtime is unavailable',
          { status: 'guaranteed_not_started' },
          { cause: error },
        );
      }
    }
    try {
      return await createWindowsJobOwnedPipeProcessLauncher(pipeNativeBinding)(
        createInvocation(launch, options?.internalEnvironment),
        options,
      );
    } catch (error) {
      throw createPlatformLaunchError({
        failureCode: 'process_owner_unavailable',
        message: 'Windows command process owner could not be established',
        error,
      });
    }
  };
  const launchOwnedPtyProcess: LaunchCommandRunnerOwnedPtyProcess = async (
    launch,
    options,
  ) => {
    if (launch.shell.platform !== 'windows') {
      throw new CommandRunnerOwnedPtyProcessLaunchError(
        'runtime_unavailable',
        'Windows command PTY runtime received a non-Windows Shell snapshot',
        { status: 'guaranteed_not_started' },
      );
    }
    if (!ptyNativeBinding) {
      try {
        ptyNativeBinding = await ptyLoader.load();
      } catch (error) {
        throw new CommandRunnerOwnedPtyProcessLaunchError(
          'runtime_unavailable',
          'Windows command PTY native runtime is unavailable',
          { status: 'guaranteed_not_started' },
          { cause: error },
        );
      }
    }
    try {
      return await createWindowsJobOwnedPtyCommandProcessLauncher(ptyNativeBinding)(
        {
          ...createInvocation(launch, options?.internalEnvironment),
          terminalSize: launch.terminal_size,
        },
        options,
      );
    } catch (error) {
      throw createPtyPlatformLaunchError({
        failureCode: 'process_owner_unavailable',
        message: 'Windows command PTY process owner could not be established',
        error,
      });
    }
  };
  return Object.freeze({ launchOwnedPipeProcess, launchOwnedPtyProcess });
}
