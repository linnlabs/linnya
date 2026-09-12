import type { ConversationRunContinueRequest } from '@app/schemas';
import { ExecutionIdSchema, RunIdSchema } from '@linnlabs/linnkit/contracts';
import { CommittedResumeInputsSchema } from '../../application/run-resumption';
import type { FlowRuntimePort } from './flow.runtime';
import type { FlowAgentRunnerPort } from './flow.runner-handoff';
import type { EventPersistenceCoordinator } from './flow.persistence';
import type { SSESink, FlowExecutionResult, FlowRunAcceptance } from './flow.schemas';
import { FlowHostSessionService } from './flow.host-session.service';
import type { FlowExecutionCompletionRegistry } from './interactive-run/orchestration/flowExecutionCompletionRegistry';
import { requireRuntimeCompatibility } from '../../application/run-resumption/functions/runtimeCompatibility';
import type { runSupervisor } from '@linnlabs/linnkit/runtime-kernel';
import type { AgentInvokeRequest } from '../../context/agent/contracts';

class RunContinuationSettlementError extends Error {
  constructor(
    readonly executionError: unknown,
    readonly settlementError: unknown
  ) {
    super('Run continuation and Host finalization failed');
    this.name = 'RunContinuationSettlementError';
  }
}

/** 独立控制操作：不调用 /next，不执行 incoming admission，不创建用户消息。 */
interface ContinueFlowRunInput {
  runId: string;
  command: ConversationRunContinueRequest;
  sink: SSESink;
  runtime: FlowRuntimePort;
  runner: FlowAgentRunnerPort;
  persistenceCoordinator: EventPersistenceCoordinator;
  completions: FlowExecutionCompletionRegistry;
  lifecycleObserver?: { readonly onAccepted: (acceptance: FlowRunAcceptance) => void };
}

export async function continueFlowRun(input: ContinueFlowRunInput): Promise<FlowExecutionResult> {
  const runId = RunIdSchema.parse(input.runId);
  const descriptors = input.runtime.runDescriptors;
  if (
    !descriptors ||
    !input.runtime.createCheckpointWriter ||
    !input.runner.readCheckpointRevision
  ) {
    throw new Error('Run continuation is unavailable in this Host');
  }
  const target = (
    await input.runtime.supervisor.findByConversation(input.command.conversation_id)
  ).find(run => run.runId === runId);
  if (!target || target.parentRunId || target.metadata?.lane !== 'foreground') {
    throw new Error('Continuation target is not a foreground root run of this conversation');
  }
  const descriptor = await descriptors.load(runId);
  if (!descriptor || descriptor.conversationId !== input.command.conversation_id) {
    throw new Error('Original run inputs are unavailable for this conversation');
  }
  requireRuntimeCompatibility(descriptor);
  const originalInputs = await descriptors.loadInputs(descriptor);
  const host = new FlowHostSessionService({
    conversationId: descriptor.conversationId,
    sseSink: input.sink,
    shouldPersist: true,
    persistenceCoordinator: input.persistenceCoordinator,
    eventStore: input.runtime.eventStore,
    nextEventStoreId: input.runtime.nextEventStoreId,
    createCheckpointWriter: input.runtime.createCheckpointWriter,
  });
  const completion = input.completions.register(runId, descriptor.conversationId);
  let result: FlowExecutionResult | undefined;
  let failure: unknown;
  let didThrow = false;
  let activated = false;
  let handle: runSupervisor.RunHandle<AgentInvokeRequest> | undefined;
  let dispatched = false;
  try {
    const revision = await input.runner.readCheckpointRevision(runId);
    const resumeInputs =
      target.metadata?.resumeInputs === undefined
        ? undefined
        : CommittedResumeInputsSchema.parse(target.metadata.resumeInputs);
    const pendingResponse =
      resumeInputs && resumeInputs.checkpointRevision === revision
        ? await descriptors.loadEvents(descriptor.conversationId, resumeInputs.eventIds)
        : undefined;
    handle = await host.withConversationAdmissionForIncoming(
      { conversation_id: descriptor.conversationId },
      [],
      async () => {
        const owner = await input.runtime.supervisor.resumePausedRun({
          runId,
          expectedUpdatedAt: input.command.expected_updated_at,
          expectedExecutionId: ExecutionIdSchema.parse(input.command.expected_execution_id),
          eventBus: host.eventBus,
          executionId: host.sequencer.getExecutionId(),
        });
        activated = true;
        return owner;
      }
    );
    host.bindRunIdentity({ runId, lane: 'foreground', visibility: 'conversation' });
    await host.openRootRunSession(runId);
    input.lifecycleObserver?.onAccepted({
      conversationId: descriptor.conversationId,
      incomingEventIds: [],
      turnId: descriptor.turnId,
      runId,
      executionId: host.sequencer.getExecutionId(),
      agentId: descriptor.agentSpec.id,
      acceptedAt: Date.now(),
    });
    const execution = input.runner.run({
      conversationId: descriptor.conversationId,
      turnId: descriptor.turnId,
      request: descriptor.request,
      ...originalInputs,
      options: descriptor.options,
      ...(pendingResponse ? { newEvents: pendingResponse } : {}),
      runHandle: handle,
      recoveryInputs: descriptor,
      hostPorts: host.createRunnerHostPorts(),
      execution:
        revision === null
          ? { kind: 'start' }
          : { kind: pendingResponse ? 'resume' : 'continue', expectedCheckpointRevision: revision },
    });
    dispatched = true;
    result = await execution.result;
  } catch (error) {
    didThrow = true;
    failure = error;
    if (handle && !dispatched) {
      try {
        // 激活后的装配失败仍保留原断点；不能遗留一个没有执行者的 running。
        await handle.markPaused({ reason: 'continuation_setup_failed' });
      } catch (settlementError) {
        failure = new RunContinuationSettlementError(error, settlementError);
      }
    }
    if (!activated)
      host.emitPreAdmissionTransportError(error, { conversation_id: descriptor.conversationId });
  }
  try {
    const run = activated ? await input.runtime.supervisor.peek(runId) : null;
    await host.finalize({
      request: { conversation_id: descriptor.conversationId },
      result,
      didThrow,
      transportEndReason: didThrow ? 'error' : 'complete',
      runStatus: run?.status,
      turnIdHint: descriptor.turnId,
    });
    completion.complete();
  } catch (error) {
    completion.fail(error);
    if (didThrow) throw new RunContinuationSettlementError(failure, error);
    throw error;
  }
  if (didThrow) throw failure;
  if (!result) throw new Error('Run continuation produced no execution result');
  return result;
}

/**
 * CLI 等短连接只等待 Host 取得原 run 的新 execution ownership；后续执行继续由 App 持有。
 * 恢复规则仍全部落在 continueFlowRun，不能另建简化恢复路径。
 */
export function continueFlowRunDetached(
  input: Omit<ContinueFlowRunInput, 'sink' | 'lifecycleObserver'> & {
    readonly onExecutionFailure: (error: unknown) => void;
  }
): Promise<FlowRunAcceptance> {
  return new Promise<FlowRunAcceptance>((resolve, reject) => {
    let accepted = false;
    const execution = continueFlowRun({
      ...input,
      sink: () => undefined,
      lifecycleObserver: {
        onAccepted: acceptance => {
          accepted = true;
          resolve(acceptance);
        },
      },
    });
    void execution
      .then(() => {
        if (!accepted) reject(new Error('Run continuation completed without Host acceptance'));
      })
      .catch((error: unknown) => {
        if (!accepted) {
          reject(error);
          return;
        }
        input.onExecutionFailure(error);
      });
  });
}
