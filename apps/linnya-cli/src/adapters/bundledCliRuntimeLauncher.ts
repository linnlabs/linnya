import { createRequire } from 'node:module';
import path from 'node:path';

import type {
  CommandApprovalChoice,
  CommandApprovalPendingProjectionV1,
} from '@app/schemas/commands';

import type { LinnyaCliRuntimeLauncherPort } from '../definitions/cli';
import { LINNYA_CLI_VERSION, LinnyaCliError } from '../definitions/cli';
import { resolveCliRuntimeModule } from '../functions/resolveCliRuntimeModule';
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
      const resolved = resolveCliRuntimeModule({
        processEntryPath: process.argv[1],
        workingDirectory: process.cwd(),
        configuredModulePath: environment.LINNYA_CLI_RUNTIME_MODULE,
        configuredDevelopmentRoot: environment.LINNYA_CLI_DEVELOPMENT_ROOT,
      });
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
