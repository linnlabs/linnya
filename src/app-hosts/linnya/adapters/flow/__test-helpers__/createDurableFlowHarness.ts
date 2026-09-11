import { vi } from 'vitest';
import { releaseTerminalRunRecovery } from '../../../application/run-resumption';
import { graph, telemetry } from '@linnlabs/linnkit/runtime-kernel';
import { createScriptedInferenceHarness, type ScriptedLlmTurn } from '@linnlabs/linnkit/testkit';
import { DatabaseService } from 'src/electron-main/services/database';
import { bootstrapAgentRuntimeSingletons } from 'src/electron-main/services/agentRuntimeSingletons';
import { modelCatalog, type ModelConfig } from 'src/domains/model-catalog';
import type { KnowledgeBaseService } from 'src/features/knowledge-base/application/knowledgeBaseService';
import { SQLiteEventStore } from '../../persistence/event-store';
import { SqliteCheckpointer } from '../../persistence/checkpointer';
import { createDefaultLlmNode } from '../../runtime-assembly/graphRuntimeFactory';
import { defaultObservationPreviewPort } from '../../tools/defaultPorts';
import { createToolRuntimeHarness } from '../../../testkit/agent-harness/toolRegistryHarness';
import { createAgentRunnerRuntimeHarness } from '../../../testkit/agent-harness/agentRunnerRuntimeHarness';
import { HistoryRepository } from 'src/features/conversation/history/history.repository';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from '../flow.history-handler.service';
import {
  createConversationPersistencePort,
  EventPersistenceCoordinator,
} from '../flow.persistence';
import { createDirectFlowConversationAdmissionPort } from './createDirectFlowConversationAdmissionPort';
import { FlowIncomingEventPreparer } from '../incoming-events/orchestration/prepareFlowIncomingEventBatch';
import { AgentRunnerService } from '../flow.agent-runner.service';
import { FlowOrchestrator } from '../flow.orchestrator';
import type { BaseTool } from 'src/tools/types';
import { createRegisteredChildRunInvoker } from '../../child-runs/registeredSubagentInvoker';
import { createLinnyaChildRunInvoker } from '../../child-runs/childRunInvokerFactory';

// 本夹具没有 Knowledge 服务；任何意外调用都直接使业务回归失败，不能伪造成功结果。
const unavailable = async (): Promise<never> => {
  throw new Error('Knowledge is outside this recovery fixture');
};
const knowledge: KnowledgeBaseService = {
  createKnowledgeBase: unavailable,
  getAllKnowledgeBases: unavailable,
  getOrCreateDefaultKnowledgeBase: unavailable,
  addDocument: unavailable,
  getDocumentsInKnowledgeBase: unavailable,
  getDocumentById: unavailable,
  getTasksStatus: unavailable,
  cancelTask: unavailable,
  pauseTask: unavailable,
  resumeTask: unavailable,
  deleteDocument: unavailable,
  continueFailedPdfPages: unavailable,
  deleteKnowledgeBase: unavailable,
  updateKnowledgeBaseSettings: unavailable,
  search: unavailable,
  searchKnowledgeBase: unavailable,
  searchInDocument: unavailable,
  searchRawResults: unavailable,
  searchForAgent: unavailable,
  searchForAgentAcrossKnowledgeBases: unavailable,
  getGraphAugmentationsForEvidenceBlocks: unavailable,
  getRawSoTDocument: unavailable,
  getSoTDocumentForAgent: unavailable,
  getSoTTableForAgent: unavailable,
  getDocumentContent: unavailable,
};

export function installRecoveryModelFixture(): void {
  const model: ModelConfig = {
    id: 'scripted-test-model',
    model_name: 'scripted-test-model',
    catalog_source: 'user',
    capabilities: ['chat'],
    ui_visibility: ['user'],
    display_name: 'Recovery fixture',
    description: 'Scripted inference',
    inference_route: {
      api_surface: 'openai_chat_completions',
      capability_id: 'ai-sdk:openai-chat',
      endpoint_id: 'fixture',
      endpoint_model_id: 'scripted-test-model',
      base_url: 'https://models.example.com/v1',
      auth_profile: 'bearer',
      context_window_tokens: 128_000,
      max_output_tokens: 4096,
      input_support: { user_image: false, tool_result_image: false },
      usage: { response_usage: 'provider_reported_optional' },
      continuation: { tool_replay: 'optional' },
    },
  };
  vi.spyOn(modelCatalog, 'getModel').mockImplementation(id =>
    id === model.id ? model : undefined
  );
  vi.spyOn(modelCatalog, 'getModelsByCapability').mockReturnValue([model]);
  vi.spyOn(modelCatalog, 'getModelsByUIVisibility').mockReturnValue([model]);
  vi.spyOn(modelCatalog, 'getInferenceEndpoints').mockReturnValue([]);
}

/** 真 SQLite、生产启动恢复、Graph 和 Flow；只替换上游模型及本测试工具。 */
export async function createDurableFlowHarness(
  path: string,
  turns: ScriptedLlmTurn[],
  tools: BaseTool[] = []
) {
  const database = new DatabaseService(path);
  database.initialize();
  const db = database.getDb();
  const eventStore = new SQLiteEventStore(db);
  const { runtime } = await bootstrapAgentRuntimeSingletons({ db, eventStore, packaged: true });
  if (!runtime.executionCheckpoints || !runtime.runDescriptors)
    throw new Error('Recovery composition missing');
  const descriptors = runtime.runDescriptors;
  const ai = createScriptedInferenceHarness(turns);
  const toolHarness = createToolRuntimeHarness(tools);
  const checkpointer = new SqliteCheckpointer(db);
  const engine = new graph.GraphExecutor(checkpointer, {
    executionCheckpointPort: runtime.executionCheckpoints,
  });
  engine.registerNode(new graph.UserNode());
  engine.registerNode(
    createDefaultLlmNode({ llmCaller: ai.getLlmCaller(), toolRuntime: toolHarness.toolRuntime })
  );
  engine.registerNode(
    new graph.ToolNode({
      toolRuntime: toolHarness.toolRuntime,
      observationPreview: defaultObservationPreviewPort,
    })
  );
  engine.registerNode(new graph.WaitUserNode());
  const history = new HistoryRepository(eventStore);
  const persistence = new EventPersistenceCoordinator({
    persistencePort: createConversationPersistencePort(history),
    conversationAdmission: createDirectFlowConversationAdmissionPort(history),
  });
  const runner = new AgentRunnerService(engine, knowledge, database, {
    ...createAgentRunnerRuntimeHarness({
      costCollector: runtime.costCollector,
      registeredChildRunInvoker: createRegisteredChildRunInvoker({
        runtime,
        telemetryPort: telemetry.noopTelemetry,
        commandRuntime: { kind: 'disabled' },
        childRunInvoker: createLinnyaChildRunInvoker({
          telemetryPort: telemetry.noopTelemetry,
          auditPort: runtime.auditPort,
          llmCaller: ai.getLlmCaller(),
          toolRuntime: toolHarness.toolRuntime,
        }),
      }),
    }),
    recovery: {
      bindings: runtime.executionCheckpoints,
      checkpointer,
      descriptors,
      releaseTerminalRun: runId =>
        releaseTerminalRunRecovery({
          runId,
          supervisor: runtime.supervisor,
          checkpointer,
          descriptors,
        }),
    },
  });
  const flow = new FlowOrchestrator(
    new HistoryHandlerService(createFlowHistoryAccessPort(history)),
    runner,
    persistence,
    new FlowIncomingEventPreparer({ kind: 'disabled' }),
    runtime
  );
  return {
    flow,
    runner,
    runtime,
    checkpointer,
    ai,
    db,
    database,
    eventStore,
    history,
    getToolExecutions: toolHarness.getExecutions,
    close: () => {
      toolHarness.restore();
      database.close();
    },
  };
}
