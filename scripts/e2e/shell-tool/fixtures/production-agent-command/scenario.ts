import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';
import { resolveElectronLocalProcessPlatformRuntime } from '../../../../../src/electron-main/local-process-runtime/production-runtime';
import { telemetry } from 'linnkit/runtime-kernel';
import {
  createDefaultGraphExecutor,
  LlmCaller,
} from 'linnkit/runtime-kernel';
import { ConversationToolMessagePayloadSchema } from '@app/schemas';
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
import {
  createDefaultLlmNode,
} from '../../../../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { createScriptedChatModelCatalog } from '../../../../../src/app-hosts/linnya/testkit/agent-harness/modelCatalogHarness';
import {
  defaultObservationPreviewPort,
  defaultToolRuntimePort,
} from '../../../../../src/app-hosts/linnya/adapters/tools/defaultPorts';
import { createToolModelInputCapabilityValidator } from '../../../../../src/app-hosts/linnya/adapters/tools/modelInputCapabilityValidator';
import {
  createLinnyaChildRunInvoker,
} from '../../../../../src/app-hosts/linnya/adapters/child-runs/childRunInvokerFactory';
import {
  createRegisteredChildRunInvoker,
} from '../../../../../src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import {
  readAfter,
  readAround,
  readBefore,
  readSubrunTrace,
  readTail,
  readTurnIndex,
} from '../../../../../src/app-hosts/linnya/adapters/persistence/event-store/ui-projection';
import {
  parseCommandOutputArtifactManifest,
} from '../../../../../src/domains/commands/definitions/commandOutputArtifact';
import {
  ToolOutputBlobManifestSchema,
} from '../../../../../src/tools/tool_output/definitions/toolOutputBlob';
import { readToolOutputTextWindow } from '../../../../../src/tools/tool_output/orchestration/readToolOutputTextWindow';
import { createDeterministicInferencePort } from './deterministicInferencePort';
import { setPluginRuntimeDatabase } from '../../../../../src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import { bootstrapBuiltinPluginLifecycle } from '../../../../../src/app-hosts/linnya/plugin-registry/builtin';
import { projectCommandExecutionWindowForValidation } from '../../../../../apps/renderer/app/fixtures/functions/projectCommandExecutionWindowForValidation';
import { isRecord } from '../../../../../apps/renderer/domains/conversation/utils/typeGuards';

const CONVERSATION_ID = 'conversation-agent-command-e2e';
const TURN_ID = 'turn-agent-command-e2e';
const TOOL_CALL_ID = 'call-agent-command-e2e';
const MISSING_GIT_TOOL_CALL_ID = 'call-agent-command-missing-git';
const MISSING_AGENTS_TOOL_CALL_ID = 'call-agent-command-missing-agents';
const MODEL_ID = 'scripted-test-model';
const EXPECTED_STDOUT = [
  'PIPE_STDOUT_BEGIN:VISIBLE_中:RED:\\x00�',
  'PROGRESS_FINAL',
  '',
].join('\n');
const EXPECTED_STDERR = 'PIPE_STDERR_BEGIN:ERR_VISIBLE:\\x00�\n';
const EXPECTED_FILE = 'agent-e2e-file';
const COMMAND = 'zsh output-safety.zsh';
const FORBIDDEN_PROJECTED_OUTPUT = Object.freeze([
  'PC53_CLIPBOARD_SECRET',
  'PC53_TITLE_SECRET',
  'PC53_DCS_SECRET',
]);

const EXPECTED_RAW_STDOUT = Buffer.concat([
  Buffer.from('PIPE_STDOUT_BEGIN:'),
  Buffer.from('\u001b]52;c;PC53_CLIPBOARD_SECRET\u0007'),
  Buffer.from('VISIBLE_中:'),
  Buffer.from('\u001b[31mRED\u001b[0m:'),
  Buffer.from([0x00, 0xff]),
  Buffer.from('\nPROGRESS_OLD\rPROGRESS_FINAL\n'),
]);
const EXPECTED_RAW_STDERR = Buffer.concat([
  Buffer.from('PIPE_STDERR_BEGIN:'),
  Buffer.from('\u001b]2;PC53_TITLE_SECRET\u0007'),
  Buffer.from('ERR_VISIBLE:'),
  Buffer.from('\u001bPPC53_DCS_SECRET\u001b\\'),
  Buffer.from([0x00, 0x80]),
  Buffer.from('\n'),
]);

// 每次 printf 之间主动让出调度，验证真实 pipe/Utility 分块；原始 byte 仍由下方常量逐字节对账。
const OUTPUT_SAFETY_SCRIPT = [
  '#!/bin/zsh -f',
  `builtin printf '${EXPECTED_FILE}' > agent-e2e-result.txt`,
  "builtin printf 'PIPE_STDOUT_BEGIN:'",
  'sleep 0.02',
  "builtin printf '\\e]52;c;PC53_CLIPBOARD_SECRET'",
  'sleep 0.02',
  "builtin printf '\\aVISIBLE_中:'",
  "builtin printf '\\e[31mRED\\e[0m:'",
  "builtin printf '\\x00\\xFF'",
  "builtin printf '\\nPROGRESS_OLD\\r'",
  'sleep 0.02',
  "builtin printf 'PROGRESS_FINAL\\n'",
  "builtin printf 'PIPE_STDERR_BEGIN:' >&2",
  'sleep 0.02',
  "builtin printf '\\e]2;PC53_TITLE_SECRET' >&2",
  'sleep 0.02',
  "builtin printf '\\aERR_VISIBLE:' >&2",
  "builtin printf '\\ePPC53_DCS_SECRET\\e\\\\' >&2",
  "builtin printf '\\x00\\x80\\n' >&2",
  '',
].join('\n');

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fsp.lstat(candidate);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function quoteForPosixShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function collectObjectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    keys.add(key);
    collectObjectKeys(nested, keys);
  }
}

function unavailableKnowledgeBaseOperation<T>(): Promise<T> {
  return Promise.reject(new Error('knowledge-base capability is outside this Shell E2E scenario'));
}

// AgentRunner 的历史合同仍接收完整知识库门面。本场景不会调用它，但显式提供全部接口，
// 避免用类型断言掩盖宿主依赖变化。
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

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fsp.readFile(filePath, 'utf8')) as unknown;
}

async function findRawOutputArtifacts(input: {
  readonly artifactRoot: string;
  readonly conversationId: string;
  readonly agentRunId: string;
  readonly originToolCallId: string;
}) {
  const manifests = [];
  for (const filePath of await listFilesRecursively(input.artifactRoot)) {
    if (path.basename(filePath) !== 'manifest.json') continue;
    const manifest = parseCommandOutputArtifactManifest(await readJson(filePath));
    if (
      manifest.owner.identity.conversation_id === input.conversationId
      && manifest.owner.identity.agent_run_id === input.agentRunId
      && manifest.owner.identity.origin_tool_call_id === input.originToolCallId
    ) {
      manifests.push({ filePath, manifest });
    }
  }
  return manifests;
}

async function findRawOutputArtifact(input: {
  readonly artifactRoot: string;
  readonly conversationId: string;
  readonly agentRunId: string;
  readonly originToolCallId: string;
}) {
  const manifests = await findRawOutputArtifacts(input);
  assert.equal(manifests.length, 1, 'exactly one raw artifact must match the shell identity');
  const matched = manifests[0];
  assert(matched);
  assert.equal(matched.manifest.mode, 'pipe');
  if (matched.manifest.mode !== 'pipe') throw new Error('expected pipe raw artifact');
  return matched;
}

async function readMatchingToolOutputTexts(input: {
  readonly toolOutputRoot: string;
  readonly conversationId: string;
  readonly originToolCallId: string;
}): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const filePath of await listFilesRecursively(input.toolOutputRoot)) {
    if (path.basename(filePath) !== 'manifest.json') continue;
    const manifest = ToolOutputBlobManifestSchema.parse(await readJson(filePath));
    if (
      manifest.conversation_id !== input.conversationId
      || manifest.tool_call_id !== input.originToolCallId
    ) continue;
    assert(!texts.has(manifest.tool_name), `duplicate ToolOutput source: ${manifest.tool_name}`);
    const blobDirectory = path.dirname(filePath);
    const window = await readToolOutputTextWindow({
      blobDirectory,
      blobId: path.basename(blobDirectory),
      conversationId: input.conversationId,
      instanceId: manifest.instance_id,
      args: { offset: 0, limit: manifest.body.char_count },
    });
    texts.set(
      manifest.tool_name,
      window.windowText,
    );
  }
  return texts;
}

function requireReadyWindow(value: ReturnType<typeof readTail>) {
  if (value.status !== 'ready') {
    throw new Error(`SQLite UI projection is not ready: ${value.status}`);
  }
  return value;
}

export async function runProductionAgentCommandScenario(input: {
  readonly runRoot: string;
}): Promise<Record<string, unknown>> {
  if (process.platform !== 'darwin') {
    throw new Error('initial production Agent command E2E currently targets macOS development Electron');
  }

  const databasePath = path.join(input.runRoot, 'workspace.sqlite');
  const appDataRoot = path.join(input.runRoot, 'app-data');
  const artifactRoot = path.join(appDataRoot, 'ConversationArtifacts', 'v1');
  const toolOutputRoot = path.join(appDataRoot, 'ToolOutputBlobs');
  installProductionE2eRuntimePathRoots({ runRoot: input.runRoot, appDataRoot });
  await fsp.mkdir(appDataRoot, { recursive: true });
  const databaseService = new DatabaseService(databasePath);
  databaseService.initialize({ lifecycleBootstrap: bootstrapBuiltinPluginLifecycle });
  const db = databaseService.getDb();
  setPluginRuntimeDatabase(db);
  const eventStore = new SQLiteEventStore(db);
  const { runtime: agentRuntime } = await bootstrapAgentRuntimeSingletons({
    db,
    eventStore,
  });
  const lifecycle = createConversationLifecycleApplicationScope({
    cleanupJobs: new SqliteConversationDirectoryCleanupJobPort(db),
    directories: createLocalConversationDirectoryPort({ storageRoot: appDataRoot }),
    facts: createEventStoreConversationFactsPort(eventStore),
  });
  let conversationRoot = '';
  await lifecycle.workDirectoryAdmission.withAdmission(
    { conversationId: CONVERSATION_ID },
    (directory) => { conversationRoot = directory.absolutePath; },
  );
  await fsp.writeFile(
    path.join(conversationRoot, 'output-safety.zsh'),
    OUTPUT_SAFETY_SCRIPT,
    { encoding: 'utf8', mode: 0o700 },
  );
  const missingGitDirectory = path.join(conversationRoot, '.git');
  const missingAgentsDirectory = path.join(conversationRoot, '.agents');
  const rejectedGitMarker = path.join(input.runRoot, 'unexpected-git-command.txt');
  const rejectedAgentsMarker = path.join(input.runRoot, 'unexpected-agents-command.txt');
  const forbiddenPaths = [
    missingGitDirectory,
    missingAgentsDirectory,
    rejectedGitMarker,
    rejectedAgentsMarker,
  ] as const;
  for (const candidate of forbiddenPaths) {
    assert.equal(await pathExists(candidate), false, `PC22 precondition must be absent: ${candidate}`);
  }
  const approvalHost = createCommandApprovalHost();
  const commandScope = await createElectronCommandProductionScope({
    db,
    conversationAdmission: lifecycle.workDirectoryAdmission,
    approvalHost,
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
    helperEnvironment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    runnerPath: path.join(
      process.env.LINNYA_AGENT_COMMAND_RUNNER_ROOT ?? '',
      'commandRunnerUtilityProcess.cjs',
    ),
    artifactStorageRoot: artifactRoot,
    resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) => (
      path.join(toolOutputRoot, conversationId, instanceId)
    ),
  });

  const inferencePort = createDeterministicInferencePort({
    toolCallId: TOOL_CALL_ID,
    command: COMMAND,
    expectedStdout: EXPECTED_STDOUT,
    expectedStderr: EXPECTED_STDERR,
    rejectedToolCalls: [
      {
        toolCallId: MISSING_GIT_TOOL_CALL_ID,
        command: `printf 'unexpected' > ${quoteForPosixShell(rejectedGitMarker)}`,
        cwd: '.git',
      },
      {
        toolCallId: MISSING_AGENTS_TOOL_CALL_ID,
        command: `printf 'unexpected' > ${quoteForPosixShell(rejectedAgentsMarker)}`,
        cwd: '.agents',
      },
    ],
    afterRejectedCalls: async () => {
      for (const candidate of forbiddenPaths) {
        assert.equal(
          await pathExists(candidate),
          false,
          `missing cwd rejection must not create or execute through: ${candidate}`,
        );
      }
    },
  });
  const modelCatalog = createScriptedChatModelCatalog(MODEL_ID);
  const llmCaller = new LlmCaller({
    inferencePort,
    modelCatalog,
  });
  const checkpointer = new SqliteCheckpointer(db);
  const executor = createDefaultGraphExecutor({
    llmNode: createDefaultLlmNode({ llmCaller, modelCatalog }),
    toolRuntime: defaultToolRuntimePort,
    observationPreview: defaultObservationPreviewPort,
    checkpointer,
    maxSteps: 8,
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
  const permissionSettings = createProductionE2eCommandPermissionSettings(
      path.join(appDataRoot, 'command-permission-settings.json'),
    );
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
  const runner = new AgentRunnerService(
    executor,
    unavailableKnowledgeBase,
    databaseService,
    {
      costCollector: agentRuntime.costCollector,
      registeredChildRunInvoker,
      commandPermissionSettings: permissionSettings,
      commandRuntime: commandRuntimes.root,
    },
  );
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
        content: '执行本地短命令。',
        timestamp: Date.now(),
        source: 'user',
        turn_id: TURN_ID,
      }],
      options: {
        promptKey: 'default',
        model_id: MODEL_ID,
        turn_id: TURN_ID,
      },
    }, () => undefined);
    assert(result.events.some(event => (
      event.type === 'final_answer' && event.content === '命令执行已验证。'
    )), 'flow result must contain the deterministic final answer');
    inferencePort.assertComplete();

    for (const candidate of forbiddenPaths) {
      assert.equal(await pathExists(candidate), false, `PC22 path must remain absent: ${candidate}`);
    }
    assert.equal(
      await fsp.readFile(path.join(conversationRoot, 'agent-e2e-result.txt'), 'utf8'),
      EXPECTED_FILE,
    );

    const window = requireReadyWindow(readTail(db, CONVERSATION_ID, 50));
    const shellMessage = window.messages.find((message) => (
      message.message_type === 'tool_calls'
      && message.payload?.['tool_name'] === 'shell'
      && message.payload['tool_call_id'] === TOOL_CALL_ID
    ));
    assert(shellMessage, 'SQLite UI projection must contain the shell message');
    const payload = ConversationToolMessagePayloadSchema.parse(shellMessage.payload);
    assert.equal(payload.tool_call_id, TOOL_CALL_ID);
    assert.equal(payload.tool_name, 'shell');
    assert.equal(payload.status, 'success');
    assert.equal(payload.phase, 'complete');
    const rejectedShellMessages = window.messages.filter((message) => (
      message.message_type === 'tool_calls'
      && message.payload?.['tool_name'] === 'shell'
      && (
        message.payload['tool_call_id'] === MISSING_GIT_TOOL_CALL_ID
        || message.payload['tool_call_id'] === MISSING_AGENTS_TOOL_CALL_ID
      )
    ));
    assert.equal(rejectedShellMessages.length, 2, 'both missing cwd calls must remain visible as tool facts');
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
    const commandMessages = rendererProjection.aggregatedMessages.filter(message => (
      message.type === 'tool_calls'
      && isRecord(message.toolPresentation?.data)
      && message.toolPresentation.data['kind'] === 'command_execution'
    ));
    assert.equal(commandMessages.length, 3, 'renderer must retain two rejections and one completed command');
    const rejectedCommandPresentations = commandMessages.map(message => (
      message.type === 'tool_calls' ? message.toolPresentation?.data : undefined
    )).filter((data): data is Record<string, unknown> => (
      isRecord(data) && data['state'] === 'rejected'
    ));
    assert.equal(rejectedCommandPresentations.length, 2);
    assert.deepEqual(
      rejectedCommandPresentations.map(data => data['cwd']).sort(),
      ['.agents', '.git'],
    );
    for (const rejectedPresentation of rejectedCommandPresentations) {
      assert.equal(rejectedPresentation['rejectionCode'], 'working_directory_unavailable');
    }
    const commandMessage = commandMessages.find(message => (
      message.type === 'tool_calls'
      && isRecord(message.toolPresentation?.data)
      && message.toolPresentation.data['command'] === COMMAND
    ));
    assert(commandMessage?.type === 'tool_calls');
    const commandPresentation = commandMessage.toolPresentation?.data;
    assert(isRecord(commandPresentation));
    assert.equal(commandPresentation['state'], 'completed');
    assert.equal(commandPresentation['source'], 'shell');
    assert.equal(typeof commandPresentation['observation'], 'string');
    assert(commandPresentation['observation'].includes(EXPECTED_STDOUT));
    for (const forbidden of FORBIDDEN_PROJECTED_OUTPUT) {
      assert(
        !commandPresentation['observation'].includes(forbidden),
        `renderer projection leaked terminal payload: ${forbidden}`,
      );
    }
    assert(isRecord(commandPresentation['terminal']));
    assert.equal(commandPresentation['terminal']['outcome'], 'exited');
    assert.equal(commandPresentation['terminal']['exitCode'], 0);

    const artifactFiles = await listFilesRecursively(artifactRoot);
    const toolOutputFiles = await listFilesRecursively(toolOutputRoot);
    for (const rejectedMessage of rejectedShellMessages) {
      const rejectedToolCallId = rejectedMessage.payload?.['tool_call_id'];
      assert.equal(typeof rejectedToolCallId, 'string');
      const rejectedArtifacts = await findRawOutputArtifacts({
        artifactRoot,
        conversationId: CONVERSATION_ID,
        agentRunId: rejectedMessage.run_id,
        originToolCallId: rejectedToolCallId,
      });
      assert.equal(
        rejectedArtifacts.length,
        0,
        `rejected cwd must not create a raw artifact: ${rejectedToolCallId}`,
      );
      const rejectedToolOutputTexts = await readMatchingToolOutputTexts({
        toolOutputRoot,
        conversationId: CONVERSATION_ID,
        originToolCallId: rejectedToolCallId,
      });
      assert.equal(
        rejectedToolOutputTexts.size,
        0,
        `rejected cwd must not create ToolOutput: ${rejectedToolCallId}`,
      );
    }
    const rawArtifact = await findRawOutputArtifact({
      artifactRoot,
      conversationId: CONVERSATION_ID,
      agentRunId: shellMessage.run_id,
      originToolCallId: TOOL_CALL_ID,
    });
    const [rawStdout, rawStderr] = await Promise.all([
      fsp.readFile(path.join(path.dirname(rawArtifact.filePath), 'stdout.bin')),
      fsp.readFile(path.join(path.dirname(rawArtifact.filePath), 'stderr.bin')),
    ]);
    assert.deepEqual(rawStdout, EXPECTED_RAW_STDOUT);
    assert.deepEqual(rawStderr, EXPECTED_RAW_STDERR);
    assert.equal(rawArtifact.manifest.stdout.persisted_bytes, rawStdout.byteLength);
    assert.equal(rawArtifact.manifest.stderr.persisted_bytes, rawStderr.byteLength);

    const toolOutputTexts = await readMatchingToolOutputTexts({
      toolOutputRoot,
      conversationId: CONVERSATION_ID,
      originToolCallId: TOOL_CALL_ID,
    });
    assert.equal(toolOutputTexts.size, 2, 'stdout/stderr ToolOutput blobs must match the shell identity');
    assert.equal(toolOutputTexts.get('shell_stdout'), EXPECTED_STDOUT);
    assert.equal(toolOutputTexts.get('shell_stderr'), EXPECTED_STDERR);
    for (const text of toolOutputTexts.values()) {
      for (const forbidden of FORBIDDEN_PROJECTED_OUTPUT) {
        assert(!text.includes(forbidden), `ToolOutput leaked terminal payload: ${forbidden}`);
      }
      assert(!text.includes('\u001b'), 'ToolOutput must not contain escape controls');
    }

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
    assert.deepEqual(commandAuditEvents.map(event => (
      event.type === 'audit_envelope' ? event.envelope.action : ''
    )), [
      'command.proposal.created',
      'command.authorization.settled',
      'command.execution.started',
      'command.execution.terminal',
    ]);
    for (const event of commandAuditEvents) {
      assert.equal(event.lane, 'auxiliary');
      assert.equal(event.visibility, 'none');
      if (event.type !== 'audit_envelope') continue;
      assert.equal(event.envelope.scope.conversationId, CONVERSATION_ID);
      assert.equal(event.envelope.scope.runId, shellMessage.run_id);
      assert.equal(event.envelope.scope.toolCallId, TOOL_CALL_ID);
      assert.equal(
        event.envelope.scope.metadata?.['command_execution_id'],
        rawArtifact.manifest.owner.identity.command_execution_id,
      );
    }
    const serializedCommandAudit = JSON.stringify(commandAuditEvents);
    assert(!serializedCommandAudit.includes(EXPECTED_STDOUT), 'audit must not copy stdout');
    assert(!serializedCommandAudit.includes(EXPECTED_STDERR), 'audit must not copy stderr');
    const commandAuditKeys = new Set<string>();
    collectObjectKeys(commandAuditEvents, commandAuditKeys);
    assert(!commandAuditKeys.has('argv_prefix'), 'audit must not copy launch argv');
    assert(!commandAuditKeys.has('entries'), 'audit must not copy environment entries');
    assert(!commandAuditKeys.has('pid'), 'audit must not store OS process ids');

    return {
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      graphSteps: result.stepCount,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      toolCallId: TOOL_CALL_ID,
      rejectedToolCallIds: [MISSING_GIT_TOOL_CALL_ID, MISSING_AGENTS_TOOL_CALL_ID],
      missingWorkingDirectoriesCreated: false,
      rejectedCommandsExecuted: false,
      conversationRoot,
      uiMessageCount: window.messages.length,
      agentRunId: rawArtifact.manifest.owner.identity.agent_run_id,
      commandExecutionId: rawArtifact.manifest.owner.identity.command_execution_id,
      commandCardState: commandPresentation['state'],
      commandAuditActions: commandAuditEvents.map(event => (
        event.type === 'audit_envelope' ? event.envelope.action : ''
      )),
      artifactFiles: artifactFiles.map(file => path.relative(artifactRoot, file)),
      toolOutputFiles: toolOutputFiles.map(file => path.relative(toolOutputRoot, file)),
    };
  } finally {
    await commandScope.endOwnerAndWait();
    databaseService.close();
  }
}
