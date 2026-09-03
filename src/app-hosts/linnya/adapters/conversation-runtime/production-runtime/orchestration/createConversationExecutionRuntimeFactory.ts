import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { CommandRunnerProcessPort, CommandPermissionSettingsPort } from 'src/domains/commands';
import {
  prependPluginCliLauncherPath,
  reconcilePluginCliLaunchers,
} from 'src/app-hosts/linnya/adapters/commands/plugin-cli-launcher';
import {
  createCommandProductionScope,
  LINNYA_COMMAND_PRODUCTION_CONSTRUCTION_POLICY,
  resolveCommandRuntimeFacts,
  resolvePluginCliClientPath,
  type CommandApprovalHostPort,
  type CommandExecutionPresentationHostPort,
} from 'src/app-hosts/linnya/adapters/commands/production-runtime';
import {
  createSandboxProductionScope,
  resolveSandboxEvaluatorRuntime,
  type SandboxUtilityProcessForkPort,
} from 'src/app-hosts/linnya/adapters/sandbox/production-runtime';
import type {
  ConversationExecutionRuntimeCreateInput,
  ConversationExecutionRuntimeFactoryPort,
  ConversationExecutionRuntimeScope,
} from 'src/app-hosts/linnya/application/conversation-runtime';
import { ConversationRuntimeInitializationError } from 'src/app-hosts/linnya/application/conversation-runtime';
import type { BackendBootstrapFacts } from 'src/app-hosts/linnya/backend-runtime';
import {
  getRegisteredBackendPluginCli,
  listAllBackendPluginCliIdsForLauncherCleanup,
  listRegisteredBackendPluginClis,
} from 'src/app-hosts/linnya/plugin-registry/builtin';
import { createMacOsShellEnvironmentSnapshot } from 'src/infra/adapters/command-runtime/environment';
import type { HostProcessEnvironment } from 'src/infra/adapters/command-runtime/environment';
import type { LocalProcessPlatformRuntime } from 'src/infra/adapters/local-process-runtime/platform-runtime';
import { getLogger } from 'src/shared/logger';

const logger = getLogger('ConversationExecutionRuntime');

/**
 * Linnya 对话执行的唯一宿主无关组合根。Commands/Sandbox 的业务 owner 只在这里创建；
 * Electron 与 App Server 只能注入各自的物理 fork、审批/展示和权限 authority。
 */
export function createConversationExecutionRuntimeFactory(input: {
  readonly bootstrap: BackendBootstrapFacts;
  readonly commandHostProcessEnvironment: HostProcessEnvironment;
  readonly localProcessPlatformRuntime: LocalProcessPlatformRuntime;
  readonly commandPermissionSettings: CommandPermissionSettingsPort;
  readonly commandApprovalHost: CommandApprovalHostPort;
  readonly commandPresentationHost: CommandExecutionPresentationHostPort;
  readonly commandRunnerProcess: CommandRunnerProcessPort;
  readonly sandboxUtilityProcessFork: SandboxUtilityProcessForkPort;
  readonly internalChildEnvironment: Readonly<Record<string, string>>;
}): ConversationExecutionRuntimeFactoryPort {
  return Object.freeze({
    async create(
      scopeInput: ConversationExecutionRuntimeCreateInput,
    ): Promise<ConversationExecutionRuntimeScope> {
      const commandEnvironmentRevision = randomUUID();
      const macOsEnvironment = input.bootstrap.platform === 'darwin'
        ? await createMacOsShellEnvironmentSnapshot({
            host: input.commandHostProcessEnvironment,
            revision: commandEnvironmentRevision,
          })
        : undefined;
      if (macOsEnvironment) {
        // 环境变量名、值以及 profile 输出都不能进入普通日志。
        logger.info('macOS 命令登录环境已在 App 生命周期内冻结', {
          source: macOsEnvironment.snapshot.source,
          variableCount: Object.keys(macOsEnvironment.snapshot.entries).length,
          probeStatus: macOsEnvironment.probe.status,
          ...(macOsEnvironment.probe.status === 'failed'
            ? { failureReason: macOsEnvironment.probe.reason }
            : {}),
        });
      }

      const pluginCliLauncherDirectory = path.join(
        scopeInput.appDataRoot,
        'CommandRuntimes',
        'v2',
        'bin',
      );
      await reconcilePluginCliLaunchers({
        directory: pluginCliLauncherDirectory,
        clientExecutablePath: resolvePluginCliClientPath({
          packaged: input.bootstrap.packaged,
          resourcesPath: input.bootstrap.resourcesPath,
          mainBundleDirectory: input.bootstrap.mainBundleDirectory,
          platform: input.bootstrap.platform,
          architecture: input.bootstrap.architecture,
        }),
        enabledPluginIds: listRegisteredBackendPluginClis().map(
          registration => registration.pluginId,
        ),
        knownPluginIds: listAllBackendPluginCliIdsForLauncherCleanup(),
        legacyDirectories: [
          path.join(scopeInput.appDataRoot, 'CommandRuntimes', 'v1', 'bin'),
        ],
      });
      const shellEnvironment = prependPluginCliLauncherPath(
        macOsEnvironment?.snapshot.entries ?? input.commandHostProcessEnvironment.entries,
        pluginCliLauncherDirectory,
      );
      const commandRuntimeFacts = resolveCommandRuntimeFacts({
        platform: input.bootstrap.platform,
        environment: shellEnvironment,
        revision: commandEnvironmentRevision,
        platformRuntime: input.localProcessPlatformRuntime,
      });

      let commandScope: ConversationExecutionRuntimeScope['command'] | null = null;
      try {
        commandScope = await createCommandProductionScope({
          db: scopeInput.db,
          conversationAdmission: scopeInput.conversationAdmission,
          approvalHost: input.commandApprovalHost,
          commandExecutionAudit: scopeInput.commandExecutionAudit,
          presentationHost: input.commandPresentationHost,
          constructionPolicy: LINNYA_COMMAND_PRODUCTION_CONSTRUCTION_POLICY,
          runtimeFacts: commandRuntimeFacts,
          runnerProcess: input.commandRunnerProcess,
          artifactStorageRoot: scopeInput.commandArtifactStorageRoot,
          resolveToolOutputBlobsDirectory: scopeInput.resolveToolOutputBlobsDirectory,
          resolvePluginCli: getRegisteredBackendPluginCli,
        });
        const sandboxEvaluatorRuntime = await resolveSandboxEvaluatorRuntime({
          packaged: input.bootstrap.packaged,
          resourcesPath: input.bootstrap.resourcesPath,
          mainBundleDirectory: input.bootstrap.mainBundleDirectory,
          platform: input.bootstrap.platform,
          architecture: input.bootstrap.architecture,
        });
        logger.info('Sandbox evaluator runtime 已冻结', {
          nodeVersion: sandboxEvaluatorRuntime.nodeVersion,
          platform: input.bootstrap.platform,
          architecture: input.bootstrap.architecture,
          packaged: input.bootstrap.packaged,
        });
        const sandboxScope = createSandboxProductionScope({
          storageRoot: path.join(scopeInput.appDataRoot, 'SandboxRuns', 'v1'),
          utilityPath: path.join(
            input.bootstrap.mainBundleDirectory,
            'sandbox',
            'sandboxUtilityProcess.cjs',
          ),
          utilityEnvironment: input.internalChildEnvironment,
          evaluator: sandboxEvaluatorRuntime.launch,
          platformRuntime: commandRuntimeFacts.platformRuntime,
          utilityProcessFork: input.sandboxUtilityProcessFork,
        });
        return Object.freeze({
          command: commandScope,
          sandbox: sandboxScope,
          commandPermissionSettings: input.commandPermissionSettings,
        });
      } catch (initializationFailure: unknown) {
        if (!commandScope) throw initializationFailure;
        const cleanupFailures: unknown[] = [];
        try {
          await commandScope.endOwnerAndWait();
        } catch (cleanupFailure: unknown) {
          cleanupFailures.push(cleanupFailure);
        }
        throw new ConversationRuntimeInitializationError(
          initializationFailure,
          Object.freeze(cleanupFailures),
        );
      }
    },
  });
}
