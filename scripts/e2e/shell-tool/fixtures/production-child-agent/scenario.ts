import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {
  CommandAgentRunIdSchema,
  CommandControlToolCallIdSchema,
  CommandConversationIdSchema,
  CommandRunPermissionSnapshotV1Schema,
} from '@app/schemas/commands';
import { ConversationToolMessagePayloadSchema } from '@app/schemas';
import { app } from 'electron';
import { resolveElectronLocalProcessPlatformRuntime } from '../../../../../src/electron-main/local-process-runtime/production-runtime';
import express from 'express';
import { telemetry } from '@linnlabs/linnkit/runtime-kernel';
import {
  createDefaultGraphExecutor,
  LlmCaller,
} from '@linnlabs/linnkit/runtime-kernel';

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
import { createConversationRouteLifecycle } from '../../../../../src/electron-main/routes/orchestration/createConversationRouteLifecycle';
import { createCommandApprovalHost } from '../../../../../src/app-hosts/linnya/adapters/commands/approval-host';
import { createCollectingCommandExecutionAuditPort } from '../../functions/createCollectingCommandExecutionAuditPort';
import {
  createElectronCommandProductionScope,
  projectCommandAgentRuntimes,
  resolveCommandRuntimeFacts,
} from '../../../../../src/electron-main/commands/production-runtime';
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
import { parseCommandOutputArtifactManifest } from '../../../../../src/domains/commands/definitions/commandOutputArtifact';
import { setPluginRuntimeDatabase } from '../../../../../src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { bootstrapBuiltinPluginLifecycle } from '../../../../../src/app-hosts/linnya/plugin-registry/builtin';
import { projectCommandExecutionWindowForValidation } from '../../../../../apps/renderer/app/fixtures/functions/projectCommandExecutionWindowForValidation';
import { isRecord } from '../../../../../apps/renderer/domains/conversation/utils/typeGuards';
import {
  CHILD_AGENT_TOOL_CALL_IDS,
  createDeterministicChildInferencePort,
} from './deterministicInferencePort';

const CONVERSATION_ID = 'conversation-production-child-agent-e2e';
const TURN_ID = 'turn-production-child-agent-e2e';
const MODEL_ID = 'deterministic-production-child-agent-model';
const ROOT_EXPECTED_START = 'production-agent-parent-start';
const ROOT_EXPECTED_TICK = 'production-agent-parent-tick-';
const CHILD_EXPECTED_START = 'production-child-agent-child-start';
const CHILD_EXPECTED_TICK = 'production-agent-parent-tick-';

function unavailableKnowledgeBaseOperation<T>(): Promise<T> {
  return Promise.reject(new Error('knowledge-base capability is outside child Agent E2E'));
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

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('child Agent deletion server did not publish a TCP address'));
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function listFilesRecursively(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else files.push(filePath);
    }
  }
  try {
    await visit(root);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  return files;
}

async function readConversationManifests(
  artifactRoot: string,
  conversationId: string,
) {
  const manifests = [];
  for (const filePath of await listFilesRecursively(artifactRoot)) {
    if (path.basename(filePath) !== 'manifest.json') continue;
    const manifest = parseCommandOutputArtifactManifest(
      JSON.parse(await fsp.readFile(filePath, 'utf8')),
    );
    if (manifest.owner.identity.conversation_id === conversationId) manifests.push(manifest);
  }
  return manifests;
}

function requireReadyWindow(value: ReturnType<typeof readTail>) {
  if (value.status !== 'ready') throw new Error(`SQLite UI projection is not ready: ${value.status}`);
  return value;
}

export async function runProductionChildAgentScenario(input: {
  readonly runRoot: string;
  readonly rootCommand: string;
  readonly childCommand: string;
  readonly handshakePath: string;
  readonly overlapObservedPath: string;
  readonly rootReadyPath: string;
  readonly deleteReadyPath: string;
  readonly controllerDonePath: string;
  readonly runnerRoot: string;
}): Promise<Record<string, unknown>> {
  if (process.platform !== 'darwin') {
    throw new Error(`production child Agent E2E currently requires macOS, received ${process.platform}`);
  }

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
  const lifecycle = createConversationRouteLifecycle({ db, eventStore, storageRoot: appDataRoot });
  const commandScope = await createElectronCommandProductionScope({
    db,
    conversationAdmission: lifecycle.workDirectoryAdmission,
    approvalHost: createCommandApprovalHost(),
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
  const inferencePort = createDeterministicChildInferencePort({
    rootCommand: input.rootCommand,
    childCommand: input.childCommand,
    rootExpectedStart: ROOT_EXPECTED_START,
    rootExpectedTick: ROOT_EXPECTED_TICK,
    childExpectedStart: CHILD_EXPECTED_START,
    childExpectedTick: CHILD_EXPECTED_TICK,
    overlapObservedPath: input.overlapObservedPath,
    rootReadyPath: input.rootReadyPath,
  });
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
    maxSteps: 20,
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
    commandCardSettlements: commandScope.conversationCardSettlementDeletion,
    stopFlowAndWait: conversationId => orchestrator.stopConversationActivityAndWait(conversationId),
  });
  const historyService = new HistoryService(historyRepository, deletion);
  const httpApp = express();
  httpApp.use('/api/v1/conversation', createHistoryRouter(historyService));
  const server = http.createServer(httpApp);
  let execution: Promise<unknown> | undefined;

  try {
    const port = await listen(server);
    const workDirectory = await lifecycle.workDirectoryAdmission.withAdmission(
      { conversationId: CONVERSATION_ID },
      directory => directory,
    );
    execution = orchestrator.next({
      conversation_id: CONVERSATION_ID,
      new_events: [{
        type: 'user_input',
        content: '启动根命令，让子 Agent 运行另一个命令，然后等待删除对话。',
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
    await publishJson(input.handshakePath, {
      version: 1,
      conversationId: CONVERSATION_ID,
      absolutePath: workDirectory.absolutePath,
      baseUrl: `http://127.0.0.1:${port}`,
    });

    const rootProcessHandle = await inferencePort.waitForRootReady();
    const activeRuns = await agentRuntime.supervisor.findActiveByConversation(CONVERSATION_ID);
    assert.equal(activeRuns.length, 1, 'completed child must leave only the active root run');
    const rootRunId = CommandAgentRunIdSchema.parse(activeRuns[0]?.runId);

    const window = requireReadyWindow(readTail(db, CONVERSATION_ID, 100));
    const rootToolMessages = window.messages.filter(message => message.message_type === 'tool_calls');
    const rootPayloads = rootToolMessages.map(message => (
      ConversationToolMessagePayloadSchema.parse(message.payload)
    ));
    assert.deepEqual(rootPayloads.map(payload => payload.tool_call_id), [
      CHILD_AGENT_TOOL_CALL_IDS.rootShell,
      CHILD_AGENT_TOOL_CALL_IDS.subagent,
      CHILD_AGENT_TOOL_CALL_IDS.rootWait,
    ]);
    assert(rootPayloads.every(payload => payload.status === 'success'));
    assert(rootToolMessages.every(message => message.run_id === rootRunId));

    const subagentPayload = rootPayloads.find(
      payload => payload.tool_call_id === CHILD_AGENT_TOOL_CALL_IDS.subagent,
    );
    assert(subagentPayload?.subrun_summary, 'subagent durable row must carry its child summary');
    assert.equal(subagentPayload.subrun_summary.subrun_ids.length, 1);
    const childRunId = CommandAgentRunIdSchema.parse(
      subagentPayload.subrun_summary.subrun_ids[0],
    );
    assert.notEqual(childRunId, rootRunId);

    const trace = readSubrunTrace(
      db,
      CONVERSATION_ID,
      CHILD_AGENT_TOOL_CALL_IDS.subagent,
      childRunId,
      { limit: 100 },
    );
    assert.equal(trace.status, 'ready');
    if (trace.status !== 'ready') throw new Error('child trace must be ready');
    assert(trace.events.length > 0);
    assert(trace.events.every(event => event.subrun_id === childRunId));
    const childDecisionIds = trace.events
      .filter(event => event.kind === 'tool_call_decision')
      .flatMap(event => event.tool_calls.map(call => call.tool_call_id));
    assert.deepEqual(childDecisionIds, [
      CHILD_AGENT_TOOL_CALL_IDS.childShell,
      CHILD_AGENT_TOOL_CALL_IDS.childWait,
      CHILD_AGENT_TOOL_CALL_IDS.childCancel,
    ]);
    assert(trace.events.some(event => (
      event.kind === 'final_answer' && event.content === '子命令已取消并完成收口。'
    )));

    const runRows = db.prepare<[string, string, string], {
      id: string;
      conversation_id: string;
      parent_run_id: string | null;
      status: string;
    }>(`
      SELECT id, conversation_id, parent_run_id, status
      FROM runs
      WHERE id IN (?, ?)
      ORDER BY CASE id WHEN ? THEN 0 ELSE 1 END
    `).all(rootRunId, childRunId, rootRunId);
    assert.equal(runRows.length, 2);
    const rootRun = runRows.find(row => row.id === rootRunId);
    const childRun = runRows.find(row => row.id === childRunId);
    assert.equal(rootRun?.conversation_id, CONVERSATION_ID);
    assert.equal(rootRun?.parent_run_id, null);
    assert.equal(childRun?.conversation_id, CONVERSATION_ID);
    assert.equal(childRun?.parent_run_id, rootRunId);
    assert.equal(childRun?.status, 'completed');

    const sealedBeforeDeletion = await readConversationManifests(artifactRoot, CONVERSATION_ID);
    assert.equal(
      sealedBeforeDeletion.length,
      1,
      'only the cancelled child command may have a sealed artifact before root deletion',
    );
    const childManifest = sealedBeforeDeletion.find(manifest => (
      manifest.owner.identity.origin_tool_call_id === CHILD_AGENT_TOOL_CALL_IDS.childShell
    ));
    assert.equal(childManifest?.owner.identity.agent_run_id, childRunId);

    const rendererProjection = projectCommandExecutionWindowForValidation({
      success: true,
      conversation_id: window.conversation_id,
      messages: window.messages,
      citation_dependencies: window.citation_dependencies,
      has_more_before: window.has_more_before,
      has_more_after: window.has_more_after,
      ...(window.prev_cursor !== undefined ? { prev_cursor: window.prev_cursor } : {}),
      ...(window.next_cursor !== undefined ? { next_cursor: window.next_cursor } : {}),
      revision: window.revision,
    });
    const commandCards = rendererProjection.aggregatedMessages.filter(message => (
      message.type === 'tool_calls'
      && isRecord(message.toolPresentation?.data)
      && message.toolPresentation.data['kind'] === 'command_execution'
    ));
    assert.equal(commandCards.length, 1, 'root shell/wait must aggregate without absorbing child trace');
    const rootCardData = commandCards[0]?.toolPresentation?.data;
    assert(isRecord(rootCardData));
    assert.equal(rootCardData['source'], 'shell');
    assert.equal(rootCardData['state'], 'running');
    assert.equal(typeof rootCardData['observation'], 'string');
    assert(rootCardData['observation'].includes(ROOT_EXPECTED_TICK));
    assert(!rootCardData['observation'].includes(CHILD_EXPECTED_START));
    assert.equal(
      await fsp.readFile(path.join(workDirectory.absolutePath, 'child-agent-created.txt'), 'utf8'),
      'created-by-child\n',
    );

    await publishJson(input.deleteReadyPath, {
      version: 1,
      rootRunId,
      childRunId,
      rootProcessHandle,
      rootCommandRows: 2,
      childCommandRows: 3,
      childTraceEvents: trace.events.length,
    });
    const controllerResult = await waitForJson(input.controllerDonePath);
    await execution;
    inferencePort.assertAborted();
    assert.deepEqual(controllerResult, {
      version: 1,
      deleteStatus: 200,
    });
    assert.equal(await pathExists(workDirectory.absolutePath), false);
    assert.equal(await eventStore.getConversationMetadata(CONVERSATION_ID), null);
    assert.equal(
      (await agentRuntime.supervisor.findActiveByConversation(CONVERSATION_ID)).length,
      0,
    );

    const oldHandle = await commandScope.shellToolRuntime.executeProcess({
      arguments: {
        process_handle: rootProcessHandle,
        action: { type: 'poll', cursor: 0 },
      },
      conversationId: CommandConversationIdSchema.parse(CONVERSATION_ID),
      agentRunId: rootRunId,
      controlToolCallId: CommandControlToolCallIdSchema.parse(
        'call-child-agent-deleted-root-handle',
      ),
      commandRunPermission: {
        status: 'available',
        snapshot: CommandRunPermissionSnapshotV1Schema.parse({
          protocol_version: 1,
          kind: 'command_run_permission_snapshot',
          root_agent_run_id: rootRunId,
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
    if (oldHandle.status !== 'rejected') throw new Error('deleted root handle must be rejected');
    assert.equal(oldHandle.code, 'unknown_handle');

    const sealedAfterDeletion = await readConversationManifests(artifactRoot, CONVERSATION_ID);
    assert.equal(
      sealedAfterDeletion.length,
      2,
      'conversation deletion must seal the still-running root artifact without discarding child bytes',
    );
    const rootManifest = sealedAfterDeletion.find(manifest => (
      manifest.owner.identity.origin_tool_call_id === CHILD_AGENT_TOOL_CALL_IDS.rootShell
    ));
    const retainedChildManifest = sealedAfterDeletion.find(manifest => (
      manifest.owner.identity.origin_tool_call_id === CHILD_AGENT_TOOL_CALL_IDS.childShell
    ));
    assert.equal(rootManifest?.owner.identity.agent_run_id, rootRunId);
    assert.equal(retainedChildManifest?.owner.identity.agent_run_id, childRunId);

    return {
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      rootRunId,
      childRunId,
      sameConversation: true,
      childParentIdentityVerified: true,
      childTraceEvents: trace.events.length,
      durableRootToolRows: rootPayloads.length,
      rawByteArtifacts: sealedAfterDeletion.length,
      rendererRootCommandCards: commandCards.length,
      childFileCreated: true,
      conversationDeleted: true,
      oldRootHandleCode: oldHandle.code,
    };
  } finally {
    // 删除前的合同断言若失败，root 模型仍在等待删除信号。测试收尾仍走完整的
    // conversation deletion 用例，不能直接杀 fixture 从而掩盖命令 owner 泄漏。
    if (execution) {
      await deletion.requestDeletion(CONVERSATION_ID);
      await Promise.allSettled([execution]);
    }
    await closeServer(server);
    await commandScope.endOwnerAndWait();
    databaseService.close();
  }
}
