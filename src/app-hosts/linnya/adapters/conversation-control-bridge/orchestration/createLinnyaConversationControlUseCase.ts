import { generateConversationId } from '@linnlabs/linnkit/contracts';
import type { FlowOrchestrator } from 'src/app-hosts/linnya/adapters/flow/flow.orchestrator';
import type { HistoryService } from 'src/features/conversation/history/history.service';
import type { ModelCatalog } from 'src/domains/model-catalog';
import type { ProviderAccountRegistry } from 'src/domains/provider-account';
import {
  createConversationControlUseCase,
  projectConversationControlModels,
  type ConversationControlRunRecord,
  type ConversationControlUseCase,
} from 'src/app-hosts/linnya/application/conversation-control';
import {
  createExecutionAuditExportUseCase,
  type ExecutionAuditEventPort,
  type ExecutionAuditTelemetryPort,
} from 'src/app-hosts/linnya/application/execution-audit-export';
import {
  evaluateModelRuntimeAvailability,
  type ModelRuntimeAvailabilityContext,
} from 'src/app-hosts/linnya/application/model-runtime-availability';

interface LinnyaConversationControlUseCaseOwners {
  readonly flow: Pick<
    FlowOrchestrator,
    'nextDetached' | 'respondInteractionDetached' | 'cancelRun'
  >;
  readonly runs: {
    findByConversation(
      conversationId: string,
      options?: { readonly includeChildren?: boolean },
    ): Promise<readonly ConversationControlRunRecord[]>;
  };
  readonly executionProgress: {
    peekMeta(runId: string): Promise<{
      readonly savedAt: number;
      readonly currentNode?: string;
      readonly iterations?: number;
    } | null>;
  };
  readonly modelCatalog: Pick<
    ModelCatalog,
    'getModels' | 'getModel' | 'getInferenceEndpoints' | 'hasCredential'
  >;
  readonly providerAccounts: Pick<ProviderAccountRegistry, 'hasCredential'>;
  readonly telemetry: ExecutionAuditTelemetryPort;
  readonly events: ExecutionAuditEventPort;
  readonly history: Pick<
    HistoryService,
    | 'listConversations'
    | 'readUiMessagesTail'
    | 'readUiMessagesBefore'
    | 'readUiMessagesAfter'
    | 'readRunFinalAnswer'
    | 'updateConversationSelectedAgent'
  >;
}

/** 把现有 Host owners 接成 CLI use-case ports；这里是适配，不复制任何业务规则。 */
export function createLinnyaConversationControlUseCase(
  owners: LinnyaConversationControlUseCaseOwners,
): ConversationControlUseCase {
  const modelAvailabilityContext = (): ModelRuntimeAvailabilityContext => ({
    inferenceEndpoints: owners.modelCatalog.getInferenceEndpoints(),
    hasModelCredential: modelId => owners.modelCatalog.hasCredential(modelId),
    hasProviderAccountCredential: accountId => owners.providerAccounts.hasCredential(accountId),
  });
  const audit = createExecutionAuditExportUseCase({
    runs: {
      async listByConversation(conversationId) {
        const runs = await owners.runs.findByConversation(conversationId, {
          includeChildren: true,
        });
        return runs.map(run => ({
          runId: run.runId,
          parentRunId: run.parentRunId,
          agentSpecId: run.agentSpecId,
          status: run.status,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          iterationsUsed: run.iterationsUsed,
          errorCode: run.errorIfAny?.errorCode,
        }));
      },
    },
    telemetry: owners.telemetry,
    events: owners.events,
    now: Date.now,
  });
  return createConversationControlUseCase({
    flow: {
      start: request => owners.flow.nextDetached(request),
      respond: request => owners.flow.respondInteractionDetached(request),
      stop: (runId, conversationId, reason) =>
        owners.flow.cancelRun(runId, conversationId, reason),
    },
    runs: owners.runs,
    models: {
      list() {
        const context = modelAvailabilityContext();
        return projectConversationControlModels(owners.modelCatalog.getModels(), context);
      },
      evaluate(modelId, capability) {
        const model = owners.modelCatalog.getModel(modelId);
        return model
          ? evaluateModelRuntimeAvailability({
              model,
              capability,
              context: modelAvailabilityContext(),
            })
          : undefined;
      },
    },
    executionProgress: {
      async read(runId) {
        const checkpoint = await owners.executionProgress.peekMeta(runId);
        return checkpoint
          ? {
              savedAt: checkpoint.savedAt,
              ...(checkpoint.currentNode ? { currentNode: checkpoint.currentNode } : {}),
              ...(checkpoint.iterations !== undefined
                ? { iterationsUsed: checkpoint.iterations }
                : {}),
            }
          : null;
      },
    },
    history: {
      list: query => owners.history.listConversations(query),
      readTail: (conversationId, limit) =>
        owners.history.readUiMessagesTail(conversationId, limit),
      readBefore: (conversationId, cursor, limit) =>
        owners.history.readUiMessagesBefore(conversationId, cursor, limit),
      readAfter: (conversationId, cursor, limit) =>
        owners.history.readUiMessagesAfter(conversationId, cursor, limit),
      readRunFinalAnswer: (conversationId, runId) =>
        owners.history.readRunFinalAnswer(conversationId, runId),
      updateSelectedAgent: (conversationId, selectedAgentId, projectId) =>
        owners.history.updateConversationSelectedAgent(
          conversationId,
          selectedAgentId,
          projectId ?? null,
        ),
    },
    audit,
    createConversationId: generateConversationId,
    now: Date.now,
  });
}
