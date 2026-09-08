import type Database from 'better-sqlite3';

import { ToolOutputBlobSourceSchema } from 'src/tools/tool_output';
import { createToolOutputTextBlobWriter } from 'src/tools/tool_output/orchestration/createToolOutputTextBlobWriter';
import { createFileCommandOutputArtifactPort } from 'src/infra/adapters/command-runtime/output';
import { createNodeShellWorkingDirectoryFileSystemPort } from 'src/infra/adapters/command-runtime/working-directory';
import type { CommandRunnerProcessPort } from 'src/domains/commands';
import type { CommandExecutionAuditPort } from 'src/domains/audit';
import type {
  ConversationWorkDirectoryAdmissionPort,
} from 'src/app-hosts/linnya/application/conversation-lifecycle';
import {
  SqliteConversationCommandApprovalPort,
} from 'src/app-hosts/linnya/adapters/persistence/command-approvals';
import {
  SqliteCommandCardSettlementPort,
} from 'src/app-hosts/linnya/adapters/persistence/command-card-settlements';
import {
  createDrainableCommandExecutionAuditPort,
} from 'src/app-hosts/linnya/adapters/persistence/command-execution-audit';
import {
  createCommandAgentRunLifecycle,
  createLocalCommandExecutionOwner,
} from '../../process-owner';
import {
  createShellCommandRuntimeBackend,
  createShellToolRuntime,
} from '../../shell-runtime';
import type { CommandConstructionPolicy } from '../definitions/commandConstructionPolicy';
import type {
  CommandApprovalHostPort,
  CommandExecutionPresentationHostPort,
} from '../definitions/commandProductionHostPorts';
import type { CommandProductionScope } from '../definitions/commandProductionScope';
import type { CommandRuntimeFacts } from '../definitions/commandRuntimeFacts';
import { validateCommandConstructionPolicy } from '../functions/validateCommandConstructionPolicy';
import { getLogger } from 'src/shared/logger';
import type {
  BackendPluginCliRegistration,
} from 'src/app-hosts/linnya/plugin-registry/registry';
import {
  startPluginCliShellBridgeRuntime,
} from 'src/app-hosts/linnya/application/plugin-cli-shell-bridge';

const COMMAND_TEXT_PROJECTION_LIMITS = Object.freeze({
  // stdout + stderr + Shell 控制/续读说明必须留在 Linnkit 默认 20k/1200 行治理阈值内，
  // 否则同一份完整输出会被 Shell 与通用 ToolNode 各落一次 blob。
  maxCharactersPerStream: 8_000,
  maxLinesPerStream: 500,
});
const logger = getLogger('CommandProductionScope');

/**
 * App Host 的唯一命令组合根。这里汇合业务 owner、runner、artifact、审批和展示 port；
 * Electron Main 或 App Server 只能在外层选择物理 adapter，不能复制这套 owner。
 */
export async function createCommandProductionScope(input: {
  readonly db: Database.Database;
  readonly conversationAdmission: ConversationWorkDirectoryAdmissionPort;
  readonly approvalHost: CommandApprovalHostPort;
  readonly commandExecutionAudit: CommandExecutionAuditPort;
  readonly presentationHost: CommandExecutionPresentationHostPort;
  readonly constructionPolicy: CommandConstructionPolicy;
  readonly runtimeFacts: CommandRuntimeFacts;
  readonly runnerProcess: CommandRunnerProcessPort;
  readonly artifactStorageRoot: string;
  resolveToolOutputBlobsDirectory(scope: {
    readonly conversationId: string;
    readonly instanceId: string;
  }): string;
  readonly resolvePluginCli: (pluginId: string) => BackendPluginCliRegistration | undefined;
}): Promise<CommandProductionScope> {
  const constructionPolicy = validateCommandConstructionPolicy(input.constructionPolicy);
  const owner = createLocalCommandExecutionOwner({
    maximumActiveExecutions: constructionPolicy.maximumActiveExecutions,
  });
  const cardSettlements = new SqliteCommandCardSettlementPort(input.db);
  const commandExecutionAudit = createDrainableCommandExecutionAuditPort(
    input.commandExecutionAudit,
  );
  const artifactPort = createFileCommandOutputArtifactPort({
    storageRoot: input.artifactStorageRoot,
  });
  const pluginCliBridge = await startPluginCliShellBridgeRuntime({
    resolveCli: input.resolvePluginCli,
    internalDataContext: Object.freeze({
      databaseService: Object.freeze({
        getDb: () => input.db,
      }),
    }),
    diagnostics: {
      recordUnexpectedFailure({
        correlationId,
        stage,
        identity,
        pluginId,
        invocationId,
        error,
      }) {
        logger.error('Plugin CLI bridge 发生未知异常', {
          correlationId,
          stage,
          conversationId: identity.conversation_id,
          agentRunId: identity.agent_run_id,
          originToolCallId: identity.origin_tool_call_id,
          commandExecutionId: identity.command_execution_id,
          ownerGenerationId: identity.owner_generation_id,
          pluginId,
          invocationId,
          errorName: error instanceof Error ? error.name : typeof error,
          errorMessage: error instanceof Error ? error.message : 'Non-Error failure',
          errorStack: error instanceof Error ? error.stack : undefined,
        });
      },
    },
  });
  const backend = createShellCommandRuntimeBackend({
    owner,
    executionScopes: pluginCliBridge,
    runnerProcess: input.runnerProcess,
    artifactPort,
    launchRuntimeContext: {
      shell: input.runtimeFacts.shell,
      environment: input.runtimeFacts.environment,
      defaultHardTimeoutMs: constructionPolicy.defaultHardTimeoutMs,
      maximumHardTimeoutMs: constructionPolicy.maximumHardTimeoutMs,
    },
    initialPtySize: { columns: 80, rows: 24 },
    pipeText: {
      currentLogicalLineLimits: { maxCharactersPerCurrentLine: 20_000 },
      agentTextProjectionLimits: COMMAND_TEXT_PROJECTION_LIMITS,
    },
    ptyText: {
      scrollbackLines: 1_024,
      agentTextProjectionLimits: COMMAND_TEXT_PROJECTION_LIMITS,
      observationLimits: {
        maxSnapshots: 256,
        maxCharactersPerSnapshot: 20_000,
        maxLinesPerSnapshot: 1_024,
      },
    },
    openTextWriter: async ({ launch, source, toolOutputInstanceId }) => createToolOutputTextBlobWriter({
      blobsDirectory: input.resolveToolOutputBlobsDirectory({
        conversationId: launch.proposal.identity.conversation_id,
        instanceId: toolOutputInstanceId,
      }),
      source: ToolOutputBlobSourceSchema.parse({
        kind: 'tool_output_text',
        conversation_id: launch.proposal.identity.conversation_id,
        instance_id: toolOutputInstanceId,
        tool_name: source,
        tool_call_id: launch.proposal.identity.origin_tool_call_id,
      }),
    }),
  });
  const agentRunLifecycle = createCommandAgentRunLifecycle(owner);
  const approvals = new SqliteConversationCommandApprovalPort(input.db);
  const shellToolRuntime = createShellToolRuntime({
    backend,
    conversationAdmission: input.conversationAdmission,
    workingDirectoryFileSystem: createNodeShellWorkingDirectoryFileSystemPort(),
    approvals,
    approval: input.approvalHost,
    audit: commandExecutionAudit,
    auditFailures: {
      report: binding => input.presentationHost.reportAuditFailure({ binding }),
      hasFailure: binding => input.presentationHost.hasAuditFailure(binding),
    },
    auditDiagnostics: {
      recordFailure({ binding, stage }) {
        // 审计诊断只保留稳定身份和阶段；命令、输出、环境与异常正文属于其他边界。
        logger.error('命令执行审计写入失败', {
          stage,
          conversationId: binding.identity.conversation_id,
          agentRunId: binding.identity.agent_run_id,
          originToolCallId: binding.identity.origin_tool_call_id,
          commandExecutionId: binding.identity.command_execution_id,
          ownerGenerationId: binding.identity.owner_generation_id,
          processHandle: binding.process_handle,
        });
      },
    },
  });
  let endingPromise: Promise<void> | undefined;

  // 全部可失败依赖完成后才提交 presentation host 绑定；构造中途失败不能污染下一次启动重试。
  try {
    input.presentationHost.bindRuntime({
      control: owner,
      lifecycle: owner,
      settlements: cardSettlements,
      audit: commandExecutionAudit,
    });
  } catch (error: unknown) {
    await pluginCliBridge.closeAndWait();
    await owner.endAndWait();
    throw error;
  }

  return Object.freeze({
    shellToolRuntime,
    agentRunLifecycle,
    conversationCleanupCommands: owner,
    conversationApprovalDeletion: approvals,
    conversationCardSettlementDeletion: {
      drainConversation: (conversationId: string) => (
        input.presentationHost.drainConversation(conversationId)
      ),
      deleteForConversation: (conversationId: string) => (
        input.presentationHost.deleteConversationSettlements(conversationId)
      ),
    },
    hasExecutingCommands() {
      const snapshot = owner.readActivitySnapshot();
      // reserved 包含尚待用户审批的 proposal，terminal replay 已不持有系统资源；只有以下三态
      // 会让“关闭窗口”真实终止命令，因此不能用总记录数决定是否打扰用户。
      return snapshot.startingCount + snapshot.runningCount + snapshot.stoppingCount > 0;
    },
    endOwnerAndWait() {
      if (endingPromise) return endingPromise;
      input.approvalHost.endOwner();
      endingPromise = owner.endAndWait()
        .then(() => pluginCliBridge.closeAndWait())
        .then(() => input.presentationHost.drainProtectedInputs())
        .then(() => commandExecutionAudit.drain())
        .then(() => input.presentationHost.endAndDrain());
      return endingPromise;
    },
  });
}
