import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { app } from 'electron';
import { resolveElectronLocalProcessPlatformRuntime } from '../../../../../src/electron-main/local-process-runtime/production-runtime';
import express from 'express';
import {
  CommandAgentRunIdSchema,
  CommandApprovalRequestIdSchema,
  CommandControlToolCallIdSchema,
  CommandConversationApprovalCandidateSchema,
  CommandConversationIdSchema,
  CommandRunPermissionSnapshotV1Schema,
} from '@app/schemas/commands';
import { telemetry } from 'linnkit/runtime-kernel';
import {
  createDefaultGraphExecutor,
  LlmCaller,
} from 'linnkit/runtime-kernel';
import type { RuntimeEvent } from 'linnkit/contracts';

import type { KnowledgeBaseService } from '../../../../../src/features/knowledge-base/application/knowledgeBaseService';
import { HistoryRepository } from '../../../../../src/features/conversation/history/history.repository';
import { HistoryService } from '../../../../../src/features/conversation/history/history.service';
import { createHistoryRouter } from '../../../../../src/features/conversation/history/history.router';
import { DatabaseService } from '../../../../../src/electron-main/services/database';
import { bootstrapAgentRuntimeSingletons } from '../../../../../src/electron-main/services/agentRuntimeSingletons';
import { SQLiteEventStore } from '../../../../../src/app-hosts/linnya/adapters/persistence/event-store';
import { SqliteCheckpointer } from '../../../../../src/app-hosts/linnya/adapters/persistence/checkpointer/sqlite.implementation';
import {
  HistoryHandlerService,
  createFlowHistoryAccessPort,
} from '../../../../../src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import {
  createConversationPersistencePort,
  createFlowConversationAdmissionPort,
  EventPersistenceCoordinator,
} from '../../../../../src/app-hosts/linnya/adapters/flow/flow.persistence';
import { FlowIncomingEventPreparer } from '../../../../../src/app-hosts/linnya/adapters/flow/incoming-events/orchestration/prepareFlowIncomingEventBatch';
import { FlowOrchestrator } from '../../../../../src/app-hosts/linnya/adapters/flow/flow.orchestrator';
import { AgentRunnerService } from '../../../../../src/app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import { SqliteConversationCommandApprovalPort } from '../../../../../src/app-hosts/linnya/adapters/persistence/command-approvals';
import { createConversationRouteLifecycle } from '../../../../../src/electron-main/routes/orchestration/createConversationRouteLifecycle';
import {
  createElectronCommandProductionScope,
  projectCommandAgentRuntimes,
  resolveCommandRuntimeFacts,
} from '../../../../../src/electron-main/commands/production-runtime';
import { createCommandApprovalHost } from '../../../../../src/app-hosts/linnya/adapters/commands/approval-host';
import { createCollectingCommandExecutionAuditPort } from '../../functions/createCollectingCommandExecutionAuditPort';
import { createDefaultLlmNode } from '../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { createScriptedChatModelCatalog } from '../../../../../src/app-hosts/linnya/testkit/agent-harness/modelCatalogHarness';
import {
  defaultObservationPreviewPort,
  defaultToolRuntimePort,
} from '../../../../../src/app-hosts/linnya/adapters/tools/defaultPorts';
import { createToolModelInputCapabilityValidator } from '../../../../../src/app-hosts/linnya/adapters/tools/modelInputCapabilityValidator';
import { createLinnyaChildRunInvoker } from '../../../../../src/app-hosts/linnya/adapters/child-runs/childRunInvokerFactory';
import { createRegisteredChildRunInvoker } from '../../../../../src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import {
  readAfter,
  readAround,
  readBefore,
  readSubrunTrace,
  readTail,
  readTurnIndex,
} from '../../../../../src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import { createProductionE2eCommandPermissionSettings } from '../../harness/createProductionE2eCommandPermissionSettings';
import { installProductionE2eRuntimePathRoots } from '../../harness/installProductionE2eRuntimePathRoots';
import { setPluginRuntimeDatabase } from '../../../../../src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { bootstrapBuiltinPluginLifecycle } from '../../../../../src/app-hosts/linnya/plugin-registry/builtin';
import {
  CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX,
  CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_NAMESPACE,
  CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
  deriveConversationWorkDirectoryIdentity,
} from '../../../../../src/domains/conversation-files';
import { createDeterministicDeletionInferencePort } from './deterministicInferencePort';

const TARGET_CONVERSATION_ID = 'conversation-active-deletion-e2e';
const OTHER_CONVERSATION_ID = 'conversation-active-deletion-other-e2e';
const TURN_ID = 'turn-active-deletion-e2e';
const MODEL_ID = 'deterministic-active-deletion-model';

function unavailableKnowledgeBaseOperation<T>(): Promise<T> {
  return Promise.reject(new Error('knowledge-base capability is outside deletion E2E'));
}

const unavailableKnowledgeBase: KnowledgeBaseService = {
  createKnowledgeBase: () => unavailableKnowledgeBaseOperation(),
  getAllKnowledgeBases: () => unavailableKnowledgeBaseOperation(),
  getOrCreateDefaultKnowledgeBase: () => unavailableKnowledgeBaseOperation(),
  addDocument: () => unavailableKnowledgeBaseOperation(),
  getDocumentsInKnowledgeBase: () => unavailableKnowledgeBaseOperation(),
  getDocumentById: () => unavailableKnowledgeBaseOperation(),
  getTasksStatus: () => unavailableKnowledgeBaseOperation(),
  cancelTask: () => unavailableKnowledgeBaseOperation(),
  pauseTask: () => unavailableKnowledgeBaseOperation(),
  resumeTask: () => unavailableKnowledgeBaseOperation(),
  deleteDocument: () => unavailableKnowledgeBaseOperation(),
  continueFailedPdfPages: () => unavailableKnowledgeBaseOperation(),
  deleteKnowledgeBase: () => unavailableKnowledgeBaseOperation(),
  updateKnowledgeBaseSettings: () => unavailableKnowledgeBaseOperation(),
  search: () => unavailableKnowledgeBaseOperation(),
  searchKnowledgeBase: () => unavailableKnowledgeBaseOperation(),
  searchInDocument: () => unavailableKnowledgeBaseOperation(),
  searchRawResults: () => unavailableKnowledgeBaseOperation(),
  searchForAgent: () => unavailableKnowledgeBaseOperation(),
  searchForAgentAcrossKnowledgeBases: () => unavailableKnowledgeBaseOperation(),
  getGraphAugmentationsForEvidenceBlocks: () => unavailableKnowledgeBaseOperation(),
  getRawSoTDocument: () => unavailableKnowledgeBaseOperation(),
  getSoTDocumentForAgent: () => unavailableKnowledgeBaseOperation(),
  getSoTTableForAgent: () => unavailableKnowledgeBaseOperation(),
  getDocumentContent: () => unavailableKnowledgeBaseOperation(),
};

function userInput(conversationId: string, turnId: string): RuntimeEvent {
  return {
    id: `message-${conversationId}`,
    type: 'user_input',
    timestamp: Date.now(),
    conversation_id: conversationId,
    turn_id: turnId,
    version: 1,
    content: `seed ${conversationId}`,
    source: 'user',
  };
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('deletion HTTP server did not publish a TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()));
  });
}

async function publishJson(filePath: string, value: unknown): Promise<void> {
  const pendingPath = `${filePath}.${process.pid}.pending`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(pendingPath, JSON.stringify(value), 'utf8');
  await fsp.rename(pendingPath, filePath);
}

async function waitForJson(filePath: string, timeoutMs = 60_000): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fsp.readFile(filePath, 'utf8'));
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${path.basename(filePath)}`);
}

function metadataPaths(storageRoot: string, conversationId: string): readonly string[] {
  const identity = deriveConversationWorkDirectoryIdentity(conversationId);
  const metadataRoot = path.join(
    storageRoot,
    CONVERSATION_WORK_DIRECTORY_NAMESPACE,
    'v1',
    CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  );
  return [
    path.join(metadataRoot, `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX}`),
    path.join(
      metadataRoot,
      `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX}`,
    ),
  ];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.lstat(filePath);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function runProductionActiveConversationDeletionScenario(input: {
  readonly runRoot: string;
  readonly command: string;
  readonly runnerRoot: string;
  readonly handshakePath: string;
  readonly controllerDonePath: string;
}): Promise<Record<string, unknown>> {
  const databasePath = path.join(input.runRoot, 'workspace.sqlite');
  const appDataRoot = path.join(input.runRoot, 'app-data');
  const artifactRoot = path.join(appDataRoot, 'ConversationArtifacts', 'v1');
  installProductionE2eRuntimePathRoots({ runRoot: input.runRoot, appDataRoot });
  await fsp.mkdir(appDataRoot, { recursive: true });
  const databaseService = new DatabaseService(databasePath);
  databaseService.initialize({ lifecycleBootstrap: bootstrapBuiltinPluginLifecycle });
  const db = databaseService.getDb();
  setPluginRuntimeDatabase(db);
  const eventStore = new SQLiteEventStore(db);
  const lifecycle = createConversationRouteLifecycle({
    db,
    eventStore,
    storageRoot: appDataRoot,
  });
  const approvalHost = createCommandApprovalHost();
  const commandScope = await createElectronCommandProductionScope({
    db,
    conversationAdmission: lifecycle.workDirectoryAdmission,
    approvalHost,
    commandExecutionAudit: createCollectingCommandExecutionAuditPort(),
    runtimeFacts: resolveCommandRuntimeFacts({
      platform: process.platform,
      environment: process.env,
      revision: randomUUID(),
      platformRuntime: resolveElectronLocalProcessPlatformRuntime({
        platform: process.platform,
        architecture: process.arch,
        applicationVersion: app.getVersion(),
        applicationExecutablePath: process.execPath,
        resourcesPath: process.resourcesPath,
        packaged: false,
        hostEnvironment: {},
      }),
    }),
    helperEnvironment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    runnerPath: path.join(input.runnerRoot, 'commandRunnerUtilityProcess.cjs'),
    artifactStorageRoot: artifactRoot,
    resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) => (
      path.join(appDataRoot, 'ToolOutputBlobs', conversationId, instanceId)
    ),
  });
  const inferencePort = createDeterministicDeletionInferencePort({ command: input.command });
  const modelCatalog = createScriptedChatModelCatalog(MODEL_ID);
  const llmCaller = new LlmCaller({
    inferencePort,
    modelCatalog,
  });
  const executor = createDefaultGraphExecutor({
    llmNode: createDefaultLlmNode({ llmCaller, modelCatalog }),
    toolRuntime: defaultToolRuntimePort,
    observationPreview: defaultObservationPreviewPort,
    checkpointer: new SqliteCheckpointer(db),
    maxSteps: 8,
    modelInputCapabilityValidator: createToolModelInputCapabilityValidator(),
  });
  const { runtime: agentRuntime } = await bootstrapAgentRuntimeSingletons({ db, eventStore });
  const commandRuntimes = projectCommandAgentRuntimes(commandScope);
  const childRunInvoker = createLinnyaChildRunInvoker({
    telemetryPort: telemetry.noopTelemetry,
    auditPort: agentRuntime.auditPort,
    llmCaller,
    toolRuntime: defaultToolRuntimePort,
  });
  const registeredChildRunInvoker = createRegisteredChildRunInvoker({
    runtime: agentRuntime,
    telemetryPort: telemetry.noopTelemetry,
    childRunInvoker,
    commandRuntime: commandRuntimes.child,
  });
  const historyRepository = new HistoryRepository(eventStore, {
    readTail: (conversationId, limit) => readTail(db, conversationId, limit),
    readBefore: (conversationId, cursor, limit) => readBefore(db, conversationId, cursor, limit),
    readAfter: (conversationId, cursor, limit) => readAfter(db, conversationId, cursor, limit),
    readAround: (conversationId, anchorMessageId, before, after) => (
      readAround(db, conversationId, anchorMessageId, before, after)
    ),
    readTurnIndex: (conversationId, options) => readTurnIndex(db, conversationId, options),
    readSubrunTrace: (conversationId, parentToolCallId, subrunId, options) => (
      readSubrunTrace(db, conversationId, parentToolCallId, subrunId, options)
    ),
  });
  const runner = new AgentRunnerService(executor, unavailableKnowledgeBase, databaseService, {
    costCollector: agentRuntime.costCollector,
    registeredChildRunInvoker,
    commandPermissionSettings: createProductionE2eCommandPermissionSettings(
      path.join(appDataRoot, 'command-permission-settings.json'),
    ),
    commandRuntime: commandRuntimes.root,
  });
  const orchestrator = new FlowOrchestrator(
    new HistoryHandlerService(createFlowHistoryAccessPort(historyRepository)),
    runner,
    new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(historyRepository),
      conversationAdmission: createFlowConversationAdmissionPort(lifecycle.persistenceAdmission),
    }),
    new FlowIncomingEventPreparer({ kind: 'disabled' }),
    agentRuntime,
  );
  const deletion = lifecycle.bindCleanup({
    commands: commandScope.conversationCleanupCommands,
    approvals: commandScope.conversationApprovalDeletion,
    // 生产路由会先等待卡片终态写入排空，再删除对话级结算事实；fixture 必须使用
    // 同一窄端口，否则测试会绕开新增的删除屏障并在运行时误报数据库删除失败。
    commandCardSettlements: commandScope.conversationCardSettlementDeletion,
    stopFlowAndWait: conversationId => orchestrator.stopConversationActivityAndWait(conversationId),
  });
  assert.deepEqual(await deletion.recoverPending(), {
    listedCount: 0,
    completedCount: 0,
    supersededCount: 0,
    failures: [],
  });
  const historyService = new HistoryService(historyRepository, deletion);
  const httpApp = express();
  httpApp.use('/api/v1/conversation', createHistoryRouter(historyService));
  const server = http.createServer(httpApp);
  let execution: Promise<unknown> | undefined;

  try {
    const port = await listen(server);
    await Promise.all([
      eventStore.ensureConversation(
        TARGET_CONVERSATION_ID,
        [userInput(TARGET_CONVERSATION_ID, TURN_ID)],
      ),
      eventStore.ensureConversation(
        OTHER_CONVERSATION_ID,
        [userInput(OTHER_CONVERSATION_ID, 'turn-active-deletion-other-e2e')],
      ),
    ]);
    const [targetDirectory, otherDirectory] = await Promise.all([
      lifecycle.workDirectoryAdmission.withAdmission(
        { conversationId: TARGET_CONVERSATION_ID },
        directory => directory,
      ),
      lifecycle.workDirectoryAdmission.withAdmission(
        { conversationId: OTHER_CONVERSATION_ID },
        directory => directory,
      ),
    ]);
    await Promise.all([
      fsp.writeFile(path.join(targetDirectory.absolutePath, 'target.txt'), 'target', 'utf8'),
      fsp.writeFile(path.join(otherDirectory.absolutePath, 'other.txt'), 'other', 'utf8'),
    ]);
    const approvalStore = new SqliteConversationCommandApprovalPort(db);
    for (const [sequence, conversationId] of [
      [1, TARGET_CONVERSATION_ID],
      [2, OTHER_CONVERSATION_ID],
    ] as const) {
      await approvalStore.remember({
        approvalRequestId: CommandApprovalRequestIdSchema.parse(
          `command_approval_00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`,
        ),
        conversationId: CommandConversationIdSchema.parse(conversationId),
        candidate: CommandConversationApprovalCandidateSchema.parse({
          token_prefix: ['git', 'status'],
          matching_context: {
            platform: 'macos',
            shell_semantics_id: 'zsh',
            matcher_revision: 'simple-command-v1',
          },
        }),
        approvedCwd: conversationId === TARGET_CONVERSATION_ID
          ? targetDirectory.absolutePath
          : otherDirectory.absolutePath,
        approvedAtMs: Date.now() + sequence,
      });
    }

    execution = orchestrator.next({
      conversation_id: TARGET_CONVERSATION_ID,
      new_events: [{
        type: 'user_input',
        content: '启动持续命令，等待删除当前对话。',
        timestamp: Date.now(),
        source: 'user',
        turn_id: TURN_ID,
      }],
      options: { promptKey: 'default', model_id: MODEL_ID, turn_id: TURN_ID },
    }, () => undefined).then(
      result => result,
      error => {
        if (error instanceof Error && error.name === 'AbortError') return error;
        throw error;
      },
    );
    const processHandle = await inferencePort.waitForProcessHandle();
    const activeRuns = await agentRuntime.supervisor.findActiveByConversation(TARGET_CONVERSATION_ID);
    assert.equal(activeRuns.length, 1, 'target conversation must have one active Flow root');
    const activeRunId = CommandAgentRunIdSchema.parse(activeRuns[0]?.runId);
    await publishJson(input.handshakePath, {
      version: 1,
      conversationId: TARGET_CONVERSATION_ID,
      otherConversationId: OTHER_CONVERSATION_ID,
      absolutePath: targetDirectory.absolutePath,
      otherAbsolutePath: otherDirectory.absolutePath,
      baseUrl: `http://127.0.0.1:${port}`,
    });

    const controllerResult = await waitForJson(input.controllerDonePath);
    await execution;
    inferencePort.assertAborted();
    const remainingTargetRuns = await agentRuntime.supervisor.findActiveByConversation(
      TARGET_CONVERSATION_ID,
    );
    assert.equal(
      remainingTargetRuns.length,
      0,
      'deleted conversation must not retain an active Flow supervisor owner',
    );
    assert.deepEqual(controllerResult, {
      version: 1,
      firstDeleteStatus: 200,
      secondDeleteStatus: 404,
    });

    assert.equal(await pathExists(targetDirectory.absolutePath), false);
    assert.equal(await pathExists(otherDirectory.absolutePath), true);
    assert.equal(await fsp.readFile(path.join(otherDirectory.absolutePath, 'other.txt'), 'utf8'), 'other');
    assert.equal(await eventStore.getConversationMetadata(TARGET_CONVERSATION_ID), null);
    assert.notEqual(await eventStore.getConversationMetadata(OTHER_CONVERSATION_ID), null);
    const cleanupJobCount = db.prepare<[string], { count: number }>(`
      SELECT COUNT(*) AS count
      FROM conversation_directory_cleanup_jobs
      WHERE conversation_id = ?
    `).get(TARGET_CONVERSATION_ID)?.count;
    assert.equal(cleanupJobCount, 0);
    for (const markerPath of metadataPaths(appDataRoot, TARGET_CONVERSATION_ID)) {
      assert.equal(await pathExists(markerPath), false);
    }
    for (const markerPath of metadataPaths(appDataRoot, OTHER_CONVERSATION_ID)) {
      assert.equal(await pathExists(markerPath), true);
    }
    assert.deepEqual(await approvalStore.listForConversation(
      CommandConversationIdSchema.parse(TARGET_CONVERSATION_ID),
    ), []);
    assert.equal((await approvalStore.listForConversation(
      CommandConversationIdSchema.parse(OTHER_CONVERSATION_ID),
    )).length, 1);

    const oldHandle = await commandScope.shellToolRuntime.executeProcess({
      arguments: {
        process_handle: processHandle,
        action: { type: 'poll', cursor: 0 },
      },
      conversationId: CommandConversationIdSchema.parse(TARGET_CONVERSATION_ID),
      agentRunId: activeRunId,
      controlToolCallId: CommandControlToolCallIdSchema.parse('call-active-deletion-old-handle'),
      commandRunPermission: {
        status: 'available',
        snapshot: CommandRunPermissionSnapshotV1Schema.parse({
          protocol_version: 1,
          kind: 'command_run_permission_snapshot',
          root_agent_run_id: activeRunId,
          settings_revision: 1,
          captured_at_ms: Date.now(),
          permission_level: 'standard',
          internal_data_access: 'allowed',
          gui_control: 'denied',
          local_ipc_control: 'denied',
          process_lifecycle: 'terminate_with_run',
        }),
      },
    });
    assert.equal(oldHandle.status, 'rejected');
    if (oldHandle.status !== 'rejected') throw new Error('deleted handle must be rejected');
    assert.equal(oldHandle.code, 'unknown_handle');

    return {
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      firstDeleteStatus: 200,
      secondDeleteStatus: 404,
      targetFactsDeleted: true,
      targetApprovalCount: 0,
      targetCleanupJobDeleted: true,
      targetIdentityDeleted: true,
      targetActiveFlowRuns: remainingTargetRuns.length,
      oldHandleStatus: oldHandle.status,
      oldHandleCode: oldHandle.code,
      otherConversationPreserved: true,
    };
  } finally {
    if (execution) await Promise.allSettled([execution]);
    await closeServer(server);
    await commandScope.endOwnerAndWait();
    databaseService.close();
  }
}
