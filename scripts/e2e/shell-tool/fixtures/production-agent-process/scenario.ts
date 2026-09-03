import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';
import { resolveElectronLocalProcessPlatformRuntime } from '../../../../../src/electron-main/local-process-runtime/production-runtime';
import { ConversationToolMessagePayloadSchema } from '@app/schemas';
import { telemetry } from 'linnkit/runtime-kernel';
import {
  createDefaultGraphExecutor,
  LlmCaller,
} from 'linnkit/runtime-kernel';

import type { KnowledgeBaseService } from '../../../../../src/features/knowledge-base/application/knowledgeBaseService';
import { DatabaseService } from '../../../../../src/electron-main/services/database';
import { bootstrapAgentRuntimeSingletons } from '../../../../../src/electron-main/services/agentRuntimeSingletons';
import { createEventStoreCommandExecutionAuditPort } from '../../../../../src/app-hosts/linnya/adapters/persistence/command-execution-audit';
import { SQLiteEventStore } from '../../../../../src/app-hosts/linnya/adapters/persistence/event-store';
import { SqliteCheckpointer } from '../../../../../src/app-hosts/linnya/adapters/persistence/checkpointer/sqlite.implementation';
import { HistoryRepository } from '../../../../../src/features/conversation/history/history.repository';
import { HistoryHandlerService, createFlowHistoryAccessPort } from '../../../../../src/app-hosts/linnya/adapters/flow/flow.history-handler.service';
import {
  createConversationPersistencePort,
  createFlowConversationAdmissionPort,
  EventPersistenceCoordinator,
} from '../../../../../src/app-hosts/linnya/adapters/flow/flow.persistence';
import { FlowIncomingEventPreparer } from '../../../../../src/app-hosts/linnya/adapters/flow/incoming-events/orchestration/prepareFlowIncomingEventBatch';
import { FlowOrchestrator } from '../../../../../src/app-hosts/linnya/adapters/flow/flow.orchestrator';
import { AgentRunnerService } from '../../../../../src/app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import { createConversationLifecycleApplicationScope } from '../../../../../src/app-hosts/linnya/application/conversation-lifecycle';
import { createLocalConversationDirectoryPort } from '../../../../../src/infra/adapters/conversation-files/local-directory';
import { SqliteConversationDirectoryCleanupJobPort } from '../../../../../src/app-hosts/linnya/adapters/persistence/conversation-files';
import { createEventStoreConversationFactsPort } from '../../../../../src/app-hosts/linnya/adapters/persistence/conversation-facts';
import { createProductionE2eCommandPermissionSettings } from '../../harness/createProductionE2eCommandPermissionSettings';
import { installProductionE2eRuntimePathRoots } from '../../harness/installProductionE2eRuntimePathRoots';
import { createCommandApprovalHost } from '../../../../../src/app-hosts/linnya/adapters/commands/approval-host';
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
import { parseCommandOutputArtifactManifest } from '../../../../../src/domains/commands/definitions/commandOutputArtifact';
import { setPluginRuntimeDatabase } from '../../../../../src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { bootstrapBuiltinPluginLifecycle } from '../../../../../src/app-hosts/linnya/plugin-registry/builtin';
import { projectCommandExecutionWindowForValidation } from '../../../../../apps/renderer/app/fixtures/functions/projectCommandExecutionWindowForValidation';
import { isRecord } from '../../../../../apps/renderer/domains/conversation/utils/typeGuards';
import {
  AGENT_PROCESS_TOOL_CALL_IDS,
  createDeterministicAgentProcessInferencePort,
} from './deterministicInferencePort';

const CONVERSATION_ID = 'conversation-agent-process-e2e';
const TURN_ID = 'turn-agent-process-e2e';
const MODEL_ID = 'deterministic-agent-process-model';

function unavailableKnowledgeBaseOperation<T>(): Promise<T> {
  return Promise.reject(new Error('knowledge-base capability is outside this process E2E scenario'));
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

function requireReadyWindow(value: ReturnType<typeof readTail>) {
  if (value.status !== 'ready') throw new Error(`SQLite UI projection is not ready: ${value.status}`);
  return value;
}

export async function runProductionAgentProcessScenario(input: {
  readonly runRoot: string;
  readonly command: string;
  readonly expectedStart: string;
  readonly expectedTick: string;
  readonly expectedInteractionPrompt: string;
  readonly expectedInteractionStdin: string;
  readonly observationReadyPath: string;
  readonly workDirectoryHandshakePath: string;
  readonly replayTerminalHandle: boolean;
  readonly userDataRoot: string;
  readonly runnerRoot: string;
}): Promise<Record<string, unknown>> {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new Error(`production Agent process E2E does not support ${process.platform}`);
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
  const { runtime: agentRuntime } = await bootstrapAgentRuntimeSingletons({ db, eventStore });
  const lifecycle = createConversationLifecycleApplicationScope({
    cleanupJobs: new SqliteConversationDirectoryCleanupJobPort(db),
    directories: createLocalConversationDirectoryPort({ storageRoot: appDataRoot }),
    facts: createEventStoreConversationFactsPort(eventStore),
  });
  const workDirectory = await lifecycle.workDirectoryAdmission.withAdmission(
    { conversationId: CONVERSATION_ID },
    directory => directory,
  );
  const pendingHandshakePath = `${input.workDirectoryHandshakePath}.${process.pid}.pending`;
  await fsp.mkdir(path.dirname(input.workDirectoryHandshakePath), { recursive: true });
  await fsp.writeFile(pendingHandshakePath, JSON.stringify({
    version: 1,
    conversationId: CONVERSATION_ID,
    absolutePath: workDirectory.absolutePath,
  }), 'utf8');
  await fsp.rename(pendingHandshakePath, input.workDirectoryHandshakePath);
  const commandScope = await createElectronCommandProductionScope({
    db,
    conversationAdmission: lifecycle.workDirectoryAdmission,
    approvalHost: createCommandApprovalHost(),
    commandExecutionAudit: createEventStoreCommandExecutionAuditPort({
      auditPort: agentRuntime.auditPort,
    }),
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
    helperEnvironment: process.platform === 'darwin'
      ? { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
      : {},
    runnerPath: path.join(input.runnerRoot, 'commandRunnerUtilityProcess.cjs'),
    artifactStorageRoot: artifactRoot,
    resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) => (
      path.join(appDataRoot, 'ToolOutputBlobs', conversationId, instanceId)
    ),
  });
  const inferencePort = createDeterministicAgentProcessInferencePort(input);
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
    maxSteps: 12,
    modelInputCapabilityValidator: createToolModelInputCapabilityValidator(),
  });
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

  try {
    const result = await orchestrator.next({
      conversation_id: CONVERSATION_ID,
      new_events: [{
        type: 'user_input',
        content: '启动、观察并取消一个持续运行的本地命令。',
        timestamp: Date.now(),
        source: 'user',
        turn_id: TURN_ID,
      }],
      options: { promptKey: 'default', model_id: MODEL_ID, turn_id: TURN_ID },
    }, () => undefined);
    inferencePort.assertComplete();
    const expectedFinalAnswer = input.replayTerminalHandle
      ? '长命令已由用户取消，终态句柄重放结果保持一致。'
      : '长命令已由用户取消并完整收口。';
    const executionErrors = result.events
      .filter(event => event.type === 'error')
      .map(event => event.error);
    assert(
      result.events.some(event => (
        event.type === 'final_answer' && event.content === expectedFinalAnswer
      )),
      `expected final answer was missing; execution errors=${JSON.stringify(executionErrors)}`,
    );

    const window = requireReadyWindow(readTail(db, CONVERSATION_ID, 50));
    const commandMessages = window.messages.filter(message => (
      message.message_type === 'tool_calls'
      && (message.payload?.tool_name === 'shell' || message.payload?.tool_name === 'process')
    ));
    assert.equal(
      commandMessages.length,
      input.replayTerminalHandle ? 5 : 4,
      'shell/two waits/cancel and optional terminal replay must each persist one durable row',
    );
    const payloads = commandMessages.map(message => (
      ConversationToolMessagePayloadSchema.parse(message.payload)
    ));
    const expectedToolCallIds = [
      AGENT_PROCESS_TOOL_CALL_IDS.shell,
      AGENT_PROCESS_TOOL_CALL_IDS.wait,
      AGENT_PROCESS_TOOL_CALL_IDS.quietWait,
      AGENT_PROCESS_TOOL_CALL_IDS.cancel,
      ...(input.replayTerminalHandle ? [AGENT_PROCESS_TOOL_CALL_IDS.terminalReplay] : []),
    ];
    assert.deepEqual(payloads.map(payload => payload.tool_call_id), expectedToolCallIds);
    assert.deepEqual(payloads.map(payload => payload.tool_name), [
      'shell',
      'process',
      'process',
      'process',
      ...(input.replayTerminalHandle ? ['process'] : []),
    ]);
    assert(payloads.every(payload => payload.status === 'success' && payload.phase === 'complete'));
    const inputActionTypes = new Set(['write', 'submit', 'eof', 'resize']);
    const automaticInputActions = payloads.filter(payload => {
      if (payload.tool_name !== 'process' || !isRecord(payload.args)) return false;
      const action = payload.args['action'];
      return isRecord(action)
        && typeof action['type'] === 'string'
        && inputActionTypes.has(action['type']);
    }).length;
    assert.equal(
      automaticInputActions,
      0,
      'prompt-like output must not synthesize a process input action',
    );

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
    const cards = rendererProjection.aggregatedMessages.filter(message => (
      message.type === 'tool_calls'
      && isRecord(message.toolPresentation?.data)
      && message.toolPresentation.data['kind'] === 'command_execution'
    ));
    assert.equal(cards.length, 1, 'renderer must aggregate shell/wait/cancel into one card');
    const card = cards[0];
    assert(card?.type === 'tool_calls');
    const cardData = card.toolPresentation?.data;
    assert(isRecord(cardData));
    assert.equal(cardData['source'], 'shell');
    assert.equal(cardData['interactive'], false);
    assert.equal(cardData['state'], 'completed');
    assert.equal(cardData['lastProcessAction'], input.replayTerminalHandle ? 'poll' : 'cancel');
    assert(isRecord(cardData['terminal']));
    assert.equal(cardData['terminal']['outcome'], 'terminated');
    assert.equal(cardData['terminal']['reason'], 'cancelled');
    assert.equal(typeof cardData['observation'], 'string');
    assert(
      !cardData['observation'].includes('command_control:'),
      'renderer command card must not expose the Agent-only control protocol',
    );
    if (input.replayTerminalHandle) {
      assert(
        !cardData['observation'].includes(input.expectedStart),
        'terminal poll card must remain a cursor-based incremental observation',
      );
    } else {
      assert(cardData['observation'].includes(input.expectedStart));
      assert(cardData['observation'].includes(input.expectedTick));
    }

    const matchingArtifacts = [];
    for (const filePath of await listFilesRecursively(artifactRoot)) {
      if (path.basename(filePath) !== 'manifest.json') continue;
      const raw: unknown = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      const manifest = parseCommandOutputArtifactManifest(raw);
      if (
        manifest.owner.identity.conversation_id === CONVERSATION_ID
        && manifest.owner.identity.origin_tool_call_id === AGENT_PROCESS_TOOL_CALL_IDS.shell
      ) matchingArtifacts.push({ filePath, manifest });
    }
    assert.equal(matchingArtifacts.length, 1);
    const artifact = matchingArtifacts[0];
    assert(artifact?.manifest.mode === 'pipe');
    const rawStdout = await fsp.readFile(path.join(path.dirname(artifact.filePath), 'stdout.bin'), 'utf8');
    assert(rawStdout.includes(input.expectedStart));
    assert(rawStdout.includes(input.expectedTick));
    assert(rawStdout.includes(input.expectedInteractionPrompt));
    assert(rawStdout.includes(input.expectedInteractionStdin));
    assert(!rawStdout.includes('interaction-stdin:received'));

    const rawEventPage = await eventStore.readEvents(CONVERSATION_ID, {
      direction: 'forward',
      limit: 1_000,
    });
    assert.equal(rawEventPage.hasMore, false, 'audit validation must read the complete fixture stream');
    const commandAuditEvents = rawEventPage.events.filter(event => (
      event.type === 'audit_envelope'
      && event.envelope.actor.kind === 'host'
      && event.envelope.actor.name === 'linnya-command-runtime'
    ));
    const commandAuditActions = commandAuditEvents.map(event => (
      event.type === 'audit_envelope' ? event.envelope.action : ''
    ));
    assert(commandAuditActions.includes('command.process.action'));
    assert.equal(
      commandAuditActions.filter(action => action === 'command.execution.terminal').length,
      1,
      'one command execution must publish one terminal audit fact',
    );
    for (const event of commandAuditEvents) {
      assert.equal(event.lane, 'auxiliary');
      assert.equal(event.visibility, 'none');
      if (event.type !== 'audit_envelope') continue;
      assert.equal(event.envelope.scope.conversationId, CONVERSATION_ID);
      assert.equal(
        event.envelope.scope.metadata?.['command_execution_id'],
        artifact.manifest.owner.identity.command_execution_id,
      );
    }
    const serializedCommandAudit = JSON.stringify(commandAuditEvents);
    assert(!serializedCommandAudit.includes('argv_prefix'));
    assert(!serializedCommandAudit.includes('entries'));
    assert(!serializedCommandAudit.includes('pid'));

    return {
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      graphSteps: result.stepCount,
      conversationId: CONVERSATION_ID,
      agentRunId: artifact.manifest.owner.identity.agent_run_id,
      commandExecutionId: artifact.manifest.owner.identity.command_execution_id,
      durableCommandRows: commandMessages.length,
      commandCardState: cardData['state'],
      terminalOutcome: cardData['terminal']['outcome'],
      terminalReason: cardData['terminal']['reason'],
      lastProcessAction: cardData['lastProcessAction'],
      terminalHandleReplayed: input.replayTerminalHandle,
      promptLikeOutputObserved: true,
      childStdinEofObserved: true,
      silentWaitReturnedRunning: true,
      automaticInputActions,
      userDataPath: input.userDataRoot,
      rawStdoutBytes: artifact.manifest.stdout.persisted_bytes,
      commandAuditActions,
    };
  } finally {
    await commandScope.endOwnerAndWait();
    databaseService.close();
  }
}
