import { JsonValueSchema } from '@app/schemas';
import { CanvasCommitRequestSchema, type CanvasAgentCommitResult } from '../../../shared';
import {
  canvasPayloadHash,
  canvasSourceKey,
  canvasOperationsPayload,
} from '../../features/canvasCommit';
import {
  readCanvasAgentReceipt,
  readCanvasPendingApproval,
  readCanvasAgentRequestStatuses,
} from '../../features/agentChanges';
import type {
  CanvasAgentApprovalOptions,
  CanvasAgentWriteInput,
  CanvasAgentReplayInput,
} from '../definitions/canvasAgentApprovals';
import { createCanvasAgentApprovalStaging } from './createCanvasAgentApprovalStaging';
import { createCanvasApprovalResolution } from './createCanvasApprovalResolution';
export function createCanvasAgentApprovals(options: CanvasAgentApprovalOptions) {
  function replayAgentRequest(input: CanvasAgentReplayInput): CanvasAgentCommitResult | undefined {
    if (input.actor.source.kind !== 'agent') throw new Error('canvas_agent_source_required');
    const receipt = readCanvasAgentReceipt(
      options.database,
      input.documentId,
      canvasSourceKey(input.actor),
      input.requestId
    );
    if (!receipt) return undefined;
    if (receipt.payloadHash !== canvasPayloadHash(input.payloadIdentity))
      throw new Error('request_id_payload_mismatch');
    if (receipt.status === 'committed' && receipt.commit)
      return { kind: 'committed', commit: receipt.commit };
    const batch =
      receipt.status === 'pending' && receipt.pendingId
        ? readCanvasPendingApproval(options.database, input.documentId, receipt.pendingId)
        : null;
    if (batch) return { kind: 'pending', approval: batch.approval };
    throw new Error(`canvas_approval_${receipt.status}`);
  }
  const stage = createCanvasAgentApprovalStaging(options, replayAgentRequest);
  const resolveApproval = createCanvasApprovalResolution(options);
  function commitAgent(input: CanvasAgentWriteInput): CanvasAgentCommitResult {
    if (input.actor.source.kind !== 'agent') throw new Error('canvas_agent_source_required');
    const parsed = CanvasCommitRequestSchema.parse(input.request);

    const payloadIdentity = JsonValueSchema.parse(
      input.payloadIdentity === undefined ? canvasOperationsPayload(parsed) : input.payloadIdentity
    );

    const request = { ...parsed, payloadIdentity };
    const result = stage(input, request);
    if (result.kind === 'ready')
      return { kind: 'committed', commit: options.commit({ ...input, request }) };
    options.pruneGuards(request.documentId);
    return result;
  }
  return {
    commitAgent,
    resolveApproval,
    replayAgentRequest,
    approvalResults: (documentId: string, conversationId: string | null) =>
      readCanvasAgentRequestStatuses(options.database, documentId, conversationId),
  };
}
