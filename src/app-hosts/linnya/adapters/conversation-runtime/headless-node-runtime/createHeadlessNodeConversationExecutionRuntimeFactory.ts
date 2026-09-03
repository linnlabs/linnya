import path from 'node:path';

import type { CommandPermissionSettingsPort } from 'src/domains/commands';
import { createNodeCommandRunnerProcessPort } from 'src/infra/adapters/command-runtime/runner/createNodeCommandRunnerProcessPort';
import type { HostProcessEnvironment } from 'src/infra/adapters/command-runtime/environment';
import type { LocalProcessPlatformRuntime } from 'src/infra/adapters/local-process-runtime/platform-runtime';
import { createNodeSandboxUtilityProcessFork } from 'src/infra/adapters/sandbox-runtime/local-process';
import type { BackendBootstrapFacts } from 'src/app-hosts/linnya/backend-runtime';
import type { ConversationExecutionRuntimeFactoryPort } from 'src/app-hosts/linnya/application/conversation-runtime';
import type {
  CommandApprovalHostPort,
  CommandExecutionPresentationHostPort,
} from '../../commands/production-runtime';
import { createConversationExecutionRuntimeFactory } from '../production-runtime';

/** App Server 的纯 Node 物理 composition；不导入 Electron，也不创建第二套业务 owner。 */
export function createHeadlessNodeConversationExecutionRuntimeFactory(input: {
  readonly bootstrap: BackendBootstrapFacts;
  readonly commandHostProcessEnvironment: HostProcessEnvironment;
  readonly localProcessPlatformRuntime: LocalProcessPlatformRuntime;
  readonly headlessNodeExecutablePath: string;
  readonly commandPermissionSettings: CommandPermissionSettingsPort;
  readonly commandApprovalHost: CommandApprovalHostPort;
  readonly commandPresentationHost: CommandExecutionPresentationHostPort;
}): ConversationExecutionRuntimeFactoryPort {
  const internalChildEnvironment = createInternalChildEnvironment(
    input.bootstrap.platform,
  );
  return createConversationExecutionRuntimeFactory({
    bootstrap: input.bootstrap,
    commandHostProcessEnvironment: input.commandHostProcessEnvironment,
    localProcessPlatformRuntime: input.localProcessPlatformRuntime,
    commandPermissionSettings: input.commandPermissionSettings,
    commandApprovalHost: input.commandApprovalHost,
    commandPresentationHost: input.commandPresentationHost,
    commandRunnerProcess: createNodeCommandRunnerProcessPort({
      runnerPath: path.join(
        input.bootstrap.mainBundleDirectory,
        'commands',
        'commandRunnerProcess.cjs',
      ),
      nodeExecutablePath: input.headlessNodeExecutablePath,
      helperEnvironment: internalChildEnvironment,
      platformRuntime: input.localProcessPlatformRuntime,
    }),
    sandboxUtilityProcessFork: createNodeSandboxUtilityProcessFork({
      nodeExecutablePath: input.headlessNodeExecutablePath,
    }),
    internalChildEnvironment,
  });
}

function createInternalChildEnvironment(
  platform: NodeJS.Platform,
): Readonly<Record<string, string>> {
  return platform === 'darwin'
    ? Object.freeze({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' })
    : Object.freeze({});
}
