import { createHash } from 'node:crypto';
import type { CanvasCommitActor } from '../definitions/canvasCommit';

/** run 与工具视图不是 Agent 请求身份；同一对话重试必须命中同一回执。 */
export function canvasSourceKey(actor: CanvasCommitActor): string {
  return JSON.stringify(actor.source.kind === 'agent' ? ['agent', actor.source.conversationId] : ['user', actor.viewId]);
}
export function canvasPayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error('canvas_payload_missing');
  return createHash('sha256').update(serialized).digest('hex');
}
