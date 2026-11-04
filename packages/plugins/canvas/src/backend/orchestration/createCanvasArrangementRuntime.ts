import { JsonValueSchema } from '@app/schemas';
import { CanvasArrangeRequestSchema, CanvasCancelArrangementRequestSchema, CanvasCommitRequestSchema, type CanvasSnapshot, type CanvasLayoutComputation } from '../../shared';
import type { CanvasDatabase } from '../definitions/canvasDatabase';
import type { CanvasBackendCapabilities } from '../definitions/canvasBackendCapabilities';
import { canvasPayloadHash, canvasSourceKey, readCanvasEditingClaims, readCanvasReceipt, type CanvasCommitActor } from '../features/canvasCommit';
import { bindCanvasLayout, resolveCanvasLayoutOptions } from '../features/canvasWrite';
import type { CanvasDocumentRuntime } from './createCanvasDocumentRuntime';

interface ArrangementJob { readonly identity: string; readonly controller: AbortController; readonly result: Promise<ArrangementResult> }
interface ArrangementResult { readonly commit: ReturnType<CanvasDocumentRuntime['commitUser']>; readonly diagnostics: import('../../shared').CanvasLayoutDiagnostic[]; readonly computation: CanvasLayoutComputation | null; readonly replayed: boolean }

/** 计算离开事务，最终提交重验字段、编辑声明和最新障碍；取消只终止尚未提交的工作。 */
export function createCanvasArrangementRuntime(database: CanvasDatabase, document: CanvasDocumentRuntime, capabilities: CanvasBackendCapabilities) {
  const pending = new Map<string, ArrangementJob>();
  function arrange(value: unknown): Promise<ArrangementResult> {
    const input = CanvasArrangeRequestSchema.parse(value);
    document.read(input.documentId);
    const key = JSON.stringify([input.documentId, input.viewId, input.requestId]);
    const payloadIdentity = JsonValueSchema.parse({ kind: 'canvas-arrange', options: input.options, operations: input.operations });
    const identity = canvasPayloadHash(payloadIdentity);
    const previous = pending.get(key);
    if (previous) {
      if (previous.identity !== identity) throw new Error('request_id_payload_mismatch');
      return previous.result;
    }
    const actor: CanvasCommitActor = { viewId: input.viewId, source: { kind: 'user', conversationId: null, runId: null } };
    const receipt = readCanvasReceipt(database, { documentId: input.documentId, requestId: input.requestId, sourceKey: canvasSourceKey(actor) });
    if (receipt) {
      if (receipt.payloadHash !== identity) throw new Error('request_id_payload_mismatch');
      return Promise.resolve({ commit: receipt.result, diagnostics: [], computation: null, replayed: true });
    }
    const controller = new AbortController();
    const result = (async () => {
      const request = CanvasCommitRequestSchema.parse({ documentId: input.documentId, requestId: input.requestId, operations: input.operations, payloadIdentity });
      const preview = document.editing.preview({ request, actor, now: Date.now() });
      const snapshot: CanvasSnapshot = { schemaVersion: 1, documentId: input.documentId, sequence: preview.state.sequence, elements: preview.state.elements.map(row => row.element) };
      const options = resolveCanvasLayoutOptions(input.options, preview.refs);
      const protectedElementIds = readCanvasEditingClaims(database, { documentId: input.documentId, viewId: input.viewId, now: Date.now() })
        .filter(claim => claim.fields.some(field => ['x', 'y', 'width', 'height'].includes(field))).map(claim => claim.elementId);
      const layout = await capabilities.computation.layout({ ...options, requestId: input.requestId, snapshot, protectedElementIds }, controller.signal);
      controller.signal.throwIfAborted();
      const bound = bindCanvasLayout(layout, preview.refs, options.groups);
      const commit = document.commitUser({ ...request, operations: [...request.operations, ...bound.operations], layoutGroups: bound.layoutGroups }, input.viewId, input.historyGroupId);
      return { commit, diagnostics: layout.diagnostics, computation: layout.computation, replayed: false };
    })().finally(() => pending.delete(key));
    pending.set(key, { identity, controller, result });
    return result;
  }
  function cancel(value: unknown) {
    const input = CanvasCancelArrangementRequestSchema.parse(value);
    pending.get(JSON.stringify([input.documentId, input.viewId, input.requestId]))?.controller.abort(new Error('canvas_layout_cancelled'));
  }
  function close(documentId: string, viewId: string) {
    for (const [key, job] of pending) {
      const [jobDocument, jobView]: unknown[] = JSON.parse(key);
      if (jobDocument === documentId && jobView === viewId) job.controller.abort(new Error('canvas_view_closed'));
    }
  }
  function dispose() { for (const job of pending.values()) job.controller.abort(new Error('canvas_plugin_disabled')); }
  return { arrange, cancel, close, dispose };
}
