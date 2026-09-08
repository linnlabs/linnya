import type Database from 'better-sqlite3';

import type { CommandRunnerProcessPort } from '../../../../domains/commands';
import type { CommandExecutionAuditPort } from 'src/domains/audit';
import type { ConversationWorkDirectoryAdmissionPort } from '../../../../app-hosts/linnya/application/conversation-lifecycle';
import type { CommandApprovalHost } from 'src/app-hosts/linnya/adapters/commands/approval-host';
import type { CommandCardControlHost } from 'src/app-hosts/linnya/adapters/commands/command-card-control-host';
import {
  createCommandCardControlHost,
} from 'src/app-hosts/linnya/adapters/commands/command-card-control-host';
import { createElectronCommandRunnerProcessPort } from '../../runner-runtime';
import type { BackendPluginCliRegistration } from '../../../../app-hosts/linnya/plugin-registry/registry';
import {
  createCommandProductionScope,
  LINNYA_COMMAND_PRODUCTION_CONSTRUCTION_POLICY,
  type CommandRuntimeFacts,
  type CommandProductionScope,
} from '../../../../app-hosts/linnya/adapters/commands/production-runtime';

/**
 * Electron App owner 的唯一命令组合根。owner、runner、artifact adapter 和审批 host
 * 都只在这里汇合一次；Shell 工具只能取得最外层用例，不能取得平台进程能力。
 */
export async function createElectronCommandProductionScope(input: {
  readonly db: Database.Database;
  readonly conversationAdmission: ConversationWorkDirectoryAdmissionPort;
  readonly approvalHost: CommandApprovalHost;
  readonly commandExecutionAudit: CommandExecutionAuditPort;
  readonly cardControlHost?: CommandCardControlHost;
  readonly runtimeFacts: CommandRuntimeFacts;
  readonly helperEnvironment: Readonly<Record<string, string>>;
  readonly runnerPath: string;
  readonly artifactStorageRoot: string;
  resolveToolOutputBlobsDirectory(scope: {
    readonly conversationId: string;
    readonly instanceId: string;
  }): string;
  readonly runnerProcess?: CommandRunnerProcessPort;
  readonly resolvePluginCli: (pluginId: string) => BackendPluginCliRegistration | undefined;
}): Promise<CommandProductionScope> {
  const cardControlHost = input.cardControlHost ?? createCommandCardControlHost({});
  const runnerProcess = input.runnerProcess ?? createElectronCommandRunnerProcessPort({
    runnerPath: input.runnerPath,
    helperEnvironment: input.helperEnvironment,
    platformRuntime: input.runtimeFacts.platformRuntime,
  });
  return createCommandProductionScope({
    db: input.db,
    conversationAdmission: input.conversationAdmission,
    approvalHost: input.approvalHost,
    commandExecutionAudit: input.commandExecutionAudit,
    presentationHost: cardControlHost,
    constructionPolicy: LINNYA_COMMAND_PRODUCTION_CONSTRUCTION_POLICY,
    runtimeFacts: input.runtimeFacts,
    runnerProcess,
    artifactStorageRoot: input.artifactStorageRoot,
    resolveToolOutputBlobsDirectory: input.resolveToolOutputBlobsDirectory,
    resolvePluginCli: input.resolvePluginCli,
  });
}
