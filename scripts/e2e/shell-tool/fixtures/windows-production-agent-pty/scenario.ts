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
import { SQLiteEventStore } from '../../../../../src/app-hosts/linnya/adapters/persistence/event-store';
import { SqliteCheckpointer } from '../../../../../src/app-hosts/linnya/adapters/persistence/checkpointer/sqlite.implementation';
import { HistoryRepository } from '../../../../../src/features/conversation/history/history.repository';
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
import { createConversationLifecycleApplicationScope } from '../../../../../src/app-hosts/linnya/application/conversation-lifecycle';
import { createLocalConversationDirectoryPort } from '../../../../../src/infra/adapters/conversation-files/local-directory';
import { SqliteConversationDirectoryCleanupJobPort } from '../../../../../src/app-hosts/linnya/adapters/persistence/conversation-files';
import { createEventStoreConversationFactsPort } from '../../../../../src/app-hosts/linnya/adapters/persistence/conversation-facts';
import { createProductionE2eCommandPermissionSettings } from '../../harness/createProductionE2eCommandPermissionSettings';
import { installProductionE2eRuntimePathRoots } from '../../harness/installProductionE2eRuntimePathRoots';
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
import { parseCommandOutputArtifactManifest } from '../../../../../src/domains/commands/definitions/commandOutputArtifact';
import { setPluginRuntimeDatabase } from '../../../../../src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { bootstrapBuiltinPluginLifecycle } from '../../../../../src/app-hosts/linnya/plugin-registry/builtin';
import { projectCommandExecutionWindowForValidation } from '../../../../../apps/renderer/app/fixtures/functions/projectCommandExecutionWindowForValidation';
import { isRecord } from '../../../../../apps/renderer/domains/conversation/utils/typeGuards';
import {
  AGENT_PTY_SHELL_TOOL_CALL_ID,
  createDeterministicAgentPtyInferencePort,
} from './deterministicInferencePort';

const CONVERSATION_ID = 'conversation-agent-pty-e2e';
const TURN_ID = 'turn-agent-pty-e2e';
const MODEL_ID = 'deterministic-agent-pty-model';
const SUBMITTED_VALUE = 'accepted-value';
const EXPECTED_SIZE = 'PTY_SIZE:100x31';

function unavailableKnowledgeBaseOperation<T>(): Promise<T> {
  return Promise.reject(new Error('knowledge-base capability is outside this PTY E2E scenario'));
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

function screenText(value: unknown): string {
  assert(isRecord(value));
  const lines = value['lines'];
  assert(Array.isArray(lines));
  return lines.map((line) => {
    assert(isRecord(line));
    assert.equal(typeof line['text'], 'string');
    return line['text'];
  }).join('\n');
}

export async function runProductionAgentPtyScenario(input: {
  readonly runRoot: string;
  readonly runnerRoot: string;
  readonly command: string;
  readonly runToken: string;
  readonly observationReadyPath: string;
  readonly workDirectoryHandshakePath: string;
  readonly userDataRoot: string;
}): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') {
    throw new Error(`production Agent PTY E2E does not support ${process.platform}`);
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
  const lifecycle = createConversationLifecycleApplicationScope({
    cleanupJobs: new SqliteConversationDirectoryCleanupJobPort(db),
    directories: createLocalConversationDirectoryPort({ storageRoot: appDataRoot }),
    facts: createEventStoreConversationFactsPort(eventStore),
  });
  const workDirectory = await lifecycle.workDirectoryAdmission.withAdmission(
    { conversationId: CONVERSATION_ID },
    async (directory) => {
      const pendingPath = `${input.workDirectoryHandshakePath}.${process.pid}.pending`;
      await fsp.mkdir(path.dirname(input.workDirectoryHandshakePath), { recursive: true });
      await fsp.writeFile(pendingPath, JSON.stringify({
        version: 1,
        conversationId: CONVERSATION_ID,
        absolutePath: directory.absolutePath,
      }), 'utf8');
      await fsp.rename(pendingPath, input.workDirectoryHandshakePath);
      return directory.absolutePath;
    },
  );
  const cliIdentityPath = path.join(workDirectory, 'pty-cli-identity.json');

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
        // 这是真实 packaged Electron，但验证包未签名；沿用 Validation 124 的窄口径，
        // 由外层独立验 RunAsNode fuse、asar 和 native 资源，不伪造发布者身份。
        packaged: false,
        hostEnvironment: {},
      }),
    }),
    helperEnvironment: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? 'C:\\Windows',
    },
    runnerPath: path.join(input.runnerRoot, 'commandRunnerUtilityProcess.cjs'),
    artifactStorageRoot: artifactRoot,
    resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) => (
      path.join(appDataRoot, 'ToolOutputBlobs', conversationId, instanceId)
    ),
  });
  const inferencePort = createDeterministicAgentPtyInferencePort({
    command: input.command,
    submittedValue: SUBMITTED_VALUE,
    expectedSize: EXPECTED_SIZE,
    observationReadyPath: input.observationReadyPath,
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
    // 状态机最多 24 条工具调用：固定八条，四个观察阶段各最多四次 wait。
    // Graph 还包含持久化与路由节点；这个宽预算只允许完整生产节点跑完，
    // 真正场景边界由确定性模型的工具数、分阶段 wait 和 unexpected phase 断言负责。
    maxSteps: 256,
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

  try {
    const result = await orchestrator.next({
      conversation_id: CONVERSATION_ID,
      new_events: [{
        type: 'user_input',
        content: '启动交互命令，提交输入，调整尺寸，发送 Windows EOF，确认状态后取消。',
        timestamp: Date.now(),
        source: 'user',
        turn_id: TURN_ID,
      }],
      options: { promptKey: 'default', model_id: MODEL_ID, turn_id: TURN_ID },
    }, () => undefined);
    inferencePort.assertComplete({
      graphStepCount: result.stepCount ?? -1,
      terminationReason: result.terminationReason ?? 'missing',
      checkpointNodeId: result.checkpointNodeId ?? 'missing',
      eventTypes: result.events.map(event => event.type),
      errorEvents: result.events
        .filter(event => event.type === 'error')
        .map(event => JSON.stringify(event)),
    });
    const expectedToolCallIds = inferencePort.toolCallIds();
    const observationWaitCounts = inferencePort.observationWaitCounts();
    assert(result.events.some(event => (
      event.type === 'final_answer'
      && event.content === '交互命令已提交输入、调整终端尺寸，发送 Windows EOF 后确认仍运行并明确取消。'
    )));

    const window = requireReadyWindow(readTail(db, CONVERSATION_ID, 80));
    const commandMessages = window.messages.filter(message => (
      message.message_type === 'tool_calls'
      && (message.payload?.tool_name === 'shell' || message.payload?.tool_name === 'process')
    ));
    assert.equal(
      commandMessages.length,
      expectedToolCallIds.length,
      'each bounded PTY action and observation must persist one tool row',
    );
    assert(
      commandMessages.length >= 11 && commandMessages.length <= 24,
      `durable PTY row count is outside the bounded contract: ${commandMessages.length}`,
    );
    const payloads = commandMessages.map(message => (
      ConversationToolMessagePayloadSchema.parse(message.payload)
    ));
    assert.deepEqual(payloads.map(payload => payload.tool_call_id), expectedToolCallIds);
    assert.deepEqual(payloads.map(payload => payload.tool_name), [
      'shell',
      ...Array.from({ length: expectedToolCallIds.length - 1 }, () => 'process' as const),
    ]);
    assert(
      payloads.every(payload => payload.status === 'success' && payload.phase === 'complete'),
      `PTY durable rows contain a non-success result: ${JSON.stringify(payloads)}`,
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
    assert.equal(cards.length, 1, 'renderer must aggregate the complete PTY chain into one card');
    const card = cards[0];
    assert(card?.type === 'tool_calls', 'aggregated PTY card must remain a tool-call message');
    const cardData = card.toolPresentation?.data;
    assert(isRecord(cardData), 'aggregated PTY card data must be a record');
    assert.equal(cardData['source'], 'shell');
    assert.equal(cardData['interactive'], true);
    assert.equal(cardData['state'], 'completed');
    assert.equal(cardData['lastProcessAction'], 'poll');
    assert(isRecord(cardData['terminal']), 'aggregated PTY card must expose a terminal summary');
    assert.equal(cardData['terminal']['outcome'], 'terminated');
    assert.equal(cardData['terminal']['reason'], 'cancelled');
    assert(isRecord(cardData['display']), 'aggregated PTY card must expose display data');
    assert.equal(cardData['display']['mode'], 'pty');
    assert(isRecord(cardData['display']['screen']), 'aggregated PTY card must expose a PTY screen');
    const screen = cardData['display']['screen'];
    assert.equal(screen['columns'], 100);
    assert.equal(screen['rows'], 31);
    const projectedScreenText = screenText(screen);
    assert(
      projectedScreenText.includes('SUBMIT_OK:accepted-value'),
      `PTY screen lost the submitted value: ${JSON.stringify(projectedScreenText)}`,
    );
    assert(
      projectedScreenText.includes('PTY_SIZE:100x31'),
      `PTY screen lost the resized dimensions: ${JSON.stringify(projectedScreenText)}`,
    );

    const matchingArtifacts = [];
    for (const filePath of await listFilesRecursively(artifactRoot)) {
      if (path.basename(filePath) !== 'manifest.json') continue;
      const raw: unknown = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      const manifest = parseCommandOutputArtifactManifest(raw);
      if (
        manifest.owner.identity.conversation_id === CONVERSATION_ID
        && manifest.owner.identity.origin_tool_call_id === AGENT_PTY_SHELL_TOOL_CALL_ID
      ) matchingArtifacts.push({ filePath, manifest });
    }
    assert.equal(matchingArtifacts.length, 1);
    const artifact = matchingArtifacts[0];
    assert(artifact?.manifest.mode === 'pty', 'shell must persist one PTY artifact manifest');
    assert.equal(artifact.manifest.terminal.source_completion, 'complete');
    const artifactDirectory = path.dirname(artifact.filePath);
    const rawTerminal = await fsp.readFile(path.join(artifactDirectory, 'terminal.bin'), 'utf8');
    assert(rawTerminal.includes('PTY_READY:true:true'), 'raw PTY artifact lost the TTY marker');
    assert(rawTerminal.includes('SUBMIT_OK:accepted-value'), 'raw PTY artifact lost submitted input');
    assert(rawTerminal.includes('PTY_SIZE:100x31'), 'raw PTY artifact lost resized dimensions');
    assert(rawTerminal.includes('^Z'), 'raw PTY artifact lost the Windows EOF echo');
    assert(
      rawTerminal.includes('PTY_EOF_RECEIVED_STILL_RUNNING'),
      'raw PTY artifact lost the processed Windows EOF marker',
    );
    await assert.rejects(fsp.access(path.join(artifactDirectory, 'stdout.bin')), { code: 'ENOENT' });
    await assert.rejects(fsp.access(path.join(artifactDirectory, 'stderr.bin')), { code: 'ENOENT' });

    const cliIdentity: unknown = JSON.parse(await fsp.readFile(cliIdentityPath, 'utf8'));
    assert(isRecord(cliIdentity), 'PTY CLI identity must remain a record');
    assert.equal(cliIdentity['version'], 1);
    assert.equal(cliIdentity['runToken'], input.runToken);
    assert.equal(typeof cliIdentity['pid'], 'number');

    return {
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      userDataPath: input.userDataRoot,
      graphSteps: result.stepCount,
      conversationId: CONVERSATION_ID,
      agentRunId: artifact.manifest.owner.identity.agent_run_id,
      commandExecutionId: artifact.manifest.owner.identity.command_execution_id,
      durableCommandRows: commandMessages.length,
      observationWaitCounts,
      commandCardState: cardData['state'],
      lastProcessAction: cardData['lastProcessAction'],
      terminalOutcome: cardData['terminal']['outcome'],
      terminalReason: cardData['terminal']['reason'],
      screenColumns: screen['columns'],
      screenRows: screen['rows'],
      rawTerminalBytes: artifact.manifest.terminal.persisted_bytes,
      cliPid: cliIdentity['pid'],
    };
  } finally {
    await commandScope.endOwnerAndWait();
    databaseService.close();
  }
}
