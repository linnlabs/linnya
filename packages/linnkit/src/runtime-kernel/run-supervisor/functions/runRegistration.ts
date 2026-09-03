import type { RunRequestSnapshot } from '../runHandle';
import type { RunRecord } from '../runRegistryStorePort';
import type { RunRegistrationSpec } from '../definitions/runSupervisorContracts';
import { cloneRunMetadata } from './runRecordProjection';
import type { RunId } from '../../../contracts';

export interface CreateRunRecordOptions<TRequest extends RunRequestSnapshot> {
  runId: RunId;
  startedAt: number;
  spec: RunRegistrationSpec<TRequest>;
}

export function forwardParentAbortSignal(
  controller: AbortController,
  parentSignal: AbortSignal | undefined
): void {
  if (!parentSignal) {
    return;
  }
  if (parentSignal.aborted) {
    controller.abort(parentSignal.reason);
    return;
  }
  parentSignal.addEventListener(
    'abort',
    () => {
      controller.abort(parentSignal.reason);
    },
    { once: true }
  );
}

export function createInitialRunRecord<TRequest extends RunRequestSnapshot>(
  options: CreateRunRecordOptions<TRequest>
): RunRecord {
  const { runId, spec, startedAt } = options;
  return {
    runId,
    conversationId: spec.conversationId,
    parentRunId: spec.parentRunId,
    agentSpecId: spec.agentSpec.id,
    status: 'pending',
    startedAt,
    updatedAt: startedAt,
    iterationBudget: spec.iterationBudget ? { ...spec.iterationBudget } : undefined,
    metadata: cloneRunMetadata(spec.metadata),
  };
}
