import { createRequire } from 'node:module';
import path from 'node:path';

import type {
  CommandApprovalChoice,
  CommandApprovalPendingProjectionV1,
} from '@app/schemas/commands';

import type { LinnyaCliRuntimeLauncherPort } from '../definitions/cli';
import { LINNYA_CLI_VERSION, LinnyaCliError } from '../definitions/cli';
import { resolveCliRuntimeModule } from '../functions/resolveCliRuntimeModule';
import { resolveCliSourceCheckout } from '../functions/resolveCliSourceCheckout';
import { createTerminalCommandApprovalPrompt } from './createTerminalCommandApprovalPrompt';

interface CliRuntimeHostModule {
  readonly LINNYA_CLI_RUNTIME_HOST_CONTRACT_VERSION: 1;
  runCliRuntimeHost(input: {
    readonly developmentRoot: string;
    readonly applicationVersion: string;
    readonly workspaceRootOverride?: string;
    readonly apiPort: number;
    readonly qdrantPort: number;
    readonly processEnvironment: NodeJS.ProcessEnv;
    readonly stderrSink: NodeJS.WriteStream;
    readonly commandApprovalPrompt?: {
      requestChoice(
        approval: CommandApprovalPendingProjectionV1,
      ): Promise<CommandApprovalChoice>;
      close(): void;
    };
    readonly onReady: Parameters<LinnyaCliRuntimeLauncherPort['run']>[0]['onReady'];
  }): Promise<void>;
}

export function createBundledCliRuntimeLauncher(
  environment: NodeJS.ProcessEnv = process.env,
): LinnyaCliRuntimeLauncherPort {
  const launcher: LinnyaCliRuntimeLauncherPort = {
    async run(input) {
      const resolved = resolveRuntimeModule(environment);
      const requireModule = createRequire(path.join(
        resolved.developmentRoot,
        '.linnya-cli-runtime-loader.cjs',
      ));
      const loaded: unknown = requireModule(resolved.modulePath);
      assertCliRuntimeHostModule(loaded);
      const commandApprovalPrompt = process.stdin.isTTY && process.stderr.isTTY
          ? createTerminalCommandApprovalPrompt({
            input: process.stdin,
            output: process.stderr,
            onInterrupt() { process.emit('SIGINT'); },
          })
        : undefined;
      try {
        await loaded.runCliRuntimeHost({
          developmentRoot: resolved.developmentRoot,
          applicationVersion: LINNYA_CLI_VERSION,
          workspaceRootOverride: input.workspaceDirectory,
          apiPort: input.apiPort,
          qdrantPort: input.qdrantPort,
          processEnvironment: environment,
          stderrSink: process.stderr,
          ...(commandApprovalPrompt ? { commandApprovalPrompt } : {}),
          onReady: input.onReady,
        });
      } catch (error: unknown) {
        const failure = toError(error);
        if (failure.message.includes('Workspace 已有运行中的 Backend')) {
          throw new LinnyaCliError('conversation_busy', failure.message);
        }
        throw failure;
      }
    },
  };
  return Object.freeze(launcher);
}

function resolveRuntimeModule(environment: NodeJS.ProcessEnv): ReturnType<typeof resolveCliRuntimeModule> {
  try {
    return resolveCliRuntimeModule({
      processEntryPath: process.argv[1],
      workingDirectory: process.cwd(),
      configuredModulePath: environment.LINNYA_CLI_RUNTIME_MODULE,
      configuredDevelopmentRoot: environment.LINNYA_CLI_DEVELOPMENT_ROOT,
    });
  } catch (error: unknown) {
    // 随桌面安装包分发的命令只有控制面，不带无界面 Backend。显式配置了 Runtime 模块或身处源码
    // checkout 时保留原错误（那是构建没做完），其余情况给出产品层面的拒绝。
    if (!environment.LINNYA_CLI_RUNTIME_MODULE?.trim() && resolveCliSourceCheckout() === null) {
      throw new LinnyaCliError(
        'capability_unavailable',
        'This Linnya installation does not include the headless runtime. Open the Linnya desktop app and use the other linnya commands; `runtime start` is only available from a source checkout.',
      );
    }
    throw error;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function assertCliRuntimeHostModule(value: unknown): asserts value is CliRuntimeHostModule {
  if (typeof value !== 'object'
    || value === null
    || !('LINNYA_CLI_RUNTIME_HOST_CONTRACT_VERSION' in value)
    || value.LINNYA_CLI_RUNTIME_HOST_CONTRACT_VERSION !== 1
    || !('runCliRuntimeHost' in value)
    || typeof value.runCliRuntimeHost !== 'function') {
    throw new Error('CLI Runtime bundle 与当前 linnya CLI 的 Host 合同不兼容');
  }
}
