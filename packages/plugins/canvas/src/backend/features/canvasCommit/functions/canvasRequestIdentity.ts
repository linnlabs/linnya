import { createHash } from 'node:crypto';
import type { CanvasCommitActor } from '../definitions/canvasCommit';
import type { CanvasCommitRequest } from '../../../../shared';

/** run 与工具视图不是 Agent 请求身份；同一对话重试必须命中同一回执。 */
export function canvasSourceKey(actor: CanvasCommitActor): string {
  return JSON.stringify(actor.source.kind === 'agent' ? ['agent', actor.source.conversationId] : ['user', actor.viewId]);
}
export function canvasPayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error('canvas_payload_missing');
  return createHash('sha256').update(serialized).digest('hex');
}
export function canvasOperationsPayload(request: CanvasCommitRequest) {
  return request.payloadIdentity ?? { kind: 'operations', operations: request.operations,
    ...(request.referenceBindings ? { referenceBindings: request.referenceBindings } : {}), ...(request.layoutGroups ? { layoutGroups: request.layoutGroups } : {}) };
}
