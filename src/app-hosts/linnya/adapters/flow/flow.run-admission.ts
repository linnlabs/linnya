import { ExecutionIdSchema, generateRunId, type AgentSpec } from '@linnlabs/linnkit/contracts';
import type { ConversationNextRequest } from '@app/schemas';
import type { FlowRuntimePort } from './flow.runtime';
import type { FlowAgentRunnerPort } from './flow.runner-handoff';
import type { PreparedFlowRunInput } from './flow.run-preparation.service';
import type { FlowHostSessionService } from './flow.host-session.service';

/** 原输入先物化，run / descriptor / incoming 在同一个 admission 事务进入事实库。 */
export async function admitDurableFlowStart(input: {
  runtime: FlowRuntimePort;
  runner: FlowAgentRunnerPort;
  host: FlowHostSessionService;
  prepared: PreparedFlowRunInput;
  request: ConversationNextRequest;
  conversationId: string;
  turnId: string;
  agentSpec: AgentSpec;
  lane: 'foreground' | 'auxiliary';
  visibility: 'conversation' | 'none';
  signal?: AbortSignal;
}) {
  const admission = input.runtime.runAdmissionCommit;
  const prepare = input.runner.prepareRecoveryInputs?.bind(input.runner);
  if (!admission || !prepare) throw new Error('Durable Flow admission is not assembled');
  const runId = generateRunId();
  input.host.bindRunIdentity({ runId, lane: input.lane, visibility: input.visibility });
  const incoming = input.host.routeIncomingEventBatch(input.prepared.incomingBatch);
  const descriptor = await prepare({
    conversationId: input.conversationId,
    turnId: input.turnId,
    runId,
    agentSpec: input.agentSpec,
    request: input.prepared.agentInvokeReq,
    history: input.prepared.contextHistoryEvents,
    newEvents: [...incoming.events],
    options: input.prepared.effectiveOptions,
  });
  const active =
    input.lane === 'foreground'
      ? (await input.runtime.supervisor.findActiveByConversation(input.conversationId)).find(
          run => run.metadata?.lane === 'foreground'
        )
      : undefined;
  const replacesPausedRun =
    active?.status === 'paused' && active.pausedAt !== undefined
      ? {
          runId: active.runId,
          expectedUpdatedAt: active.updatedAt,
          expectedExecutionId: ExecutionIdSchema.parse(active.metadata?.executionId),
        }
      : undefined;
  const handle = await input.runtime.supervisor.registerRun({
    runId,
    parentSignal: input.signal,
    concurrencyKey:
      input.lane === 'foreground' ? `conversation:${input.conversationId}:foreground` : undefined,
    conversationId: input.conversationId,
    agentSpec: descriptor.agentSpec,
    request: descriptor.request,
    eventBus: input.host.eventBus,
    eventStore: input.runtime.eventStore,
    costCollector: input.runtime.costCollector,
    replacesPausedRun,
    metadata: {
      executionId: input.host.sequencer.getExecutionId(),
      turnId: input.turnId,
      traceId: descriptor.runContext.traceId,
      originalSource: 'flow',
      lane: input.lane,
      visibility: input.visibility,
    },
    admissionCommit: (record, replacement) =>
      admission.start({
        record,
        replacement,
        descriptor,
        incoming: { ...incoming, replaceTargetId: input.request.options?.truncateFromMessageId },
      }),
  });
  return { handle, descriptor, replacedRunId: replacesPausedRun?.runId };
}
