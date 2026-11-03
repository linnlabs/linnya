import type { CanvasCommand, CanvasElementId, CanvasEditingRequestSchema } from '@plugin/canvas/shared';
import type { z } from 'zod';
import type { CanvasDocumentPort, CanvasDocumentSession } from '../definitions/canvasDocumentSession';
import { createCanvasDocumentState } from '../store/createCanvasDocumentState';
import { applyCanvasSynchronization } from '../functions/applyCanvasSynchronization';

/** 一个表面拥有一个会话；Host file handler 在关闭前先等待该表面的保存屏障。 */
export function createCanvasDocumentSession(port: CanvasDocumentPort): CanvasDocumentSession {
  const state = createCanvasDocumentState();
  const viewId = crypto.randomUUID();
  let sessionId = 0;
  let targetSequence = 0;
  let synchronization: Promise<void> | null = null;
  let unsubscribe: (() => void) | null = null;
  const protections = new Map<CanvasElementId, Map<string, z.infer<typeof CanvasEditingRequestSchema>['fields']>>();
  let writes: Promise<unknown> = Promise.resolve();
  const requireDocument = () => {
    const current = state.snapshot.value;
    if (!current) throw new Error('Canvas document is not open');
    return current;
  };
  const synchronize = (sequence: number): Promise<void> => {
    targetSequence = Math.max(targetSequence, sequence);
    if (synchronization) return synchronization;
    const token = sessionId;
    synchronization = (async () => {
      while (token === sessionId) {
        const current = requireDocument();
        if (current.sequence >= targetSequence) return;
        const update = await port.changes(current.documentId, current.sequence);
        if (token !== sessionId) return;
        const installed = requireDocument();
        const next = applyCanvasSynchronization(installed, update);
        if (next.sequence <= installed.sequence) throw new Error('Canvas synchronization made no progress');
        state.install(next);
      }
    })().catch(error => {
      if (token === sessionId) state.fail(error instanceof Error ? error.message : String(error));
      throw error;
    }).finally(() => { if (token === sessionId) synchronization = null; });
    return synchronization;
  };
  return {
    state, viewId, synchronize,
    async open(documentId) {
      const previousDocumentId = state.snapshot.value?.documentId;
      const token = ++sessionId;
      unsubscribe?.(); unsubscribe = null;
      synchronization = null; targetSequence = 0;
      protections.clear(); state.begin();
      try {
        if (previousDocumentId) await port.close(previousDocumentId, viewId);
        if (token !== sessionId) return;
        // 先订阅再读快照，接住读取期间其他来源的提交；loading阶段只累计目标版本。
        unsubscribe = port.subscribe(event => {
          if (token !== sessionId || event.documentId !== documentId) return;
          targetSequence = Math.max(targetSequence, event.sequence);
          const current = state.snapshot.value;
          if (!current || event.sequence <= current.sequence) return;
          void synchronize(event.sequence).catch(() => { /* 状态已记录失败，界面提供明确重开入口。 */ });
        });
        const snapshot = await port.read(documentId, viewId);
        if (token !== sessionId) return;
        if (snapshot.documentId !== documentId) throw new Error('Canvas open response belongs to another document');
        state.install(snapshot);
        await synchronize(targetSequence);
      } catch (error) {
        if (token === sessionId) state.fail(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    commit(operations: readonly CanvasCommand[], historyGroupId?: string) {
      const token = sessionId;
      const document = requireDocument();
      const requestId = crypto.randomUUID();
      const run = writes.then(async () => {
        if (token !== sessionId) throw new DOMException('Canvas session closed', 'AbortError');
        const result = await port.commit({ documentId: document.documentId, requestId, viewId, operations, ...(historyGroupId ? { historyGroupId } : {}) });
        if (token !== sessionId) throw new DOMException('Canvas committed after its surface closed', 'AbortError');
        await synchronize(result.sequence);
        return result;
      });
      // 一个动作失败不能把后续用户动作永远卡在 rejected promise 上。
      writes = run.catch(() => undefined);
      return run;
    },
    async protect(elementId: CanvasElementId, fields, owner) {
      const document = requireDocument();
      const owners = protections.get(elementId) ?? new Map<string, z.infer<typeof CanvasEditingRequestSchema>['fields']>();
      if (fields.length) owners.set(owner, fields); else owners.delete(owner);
      if (owners.size) protections.set(elementId, owners); else protections.delete(elementId);
      await port.editing({ documentId: document.documentId, viewId, elementId, fields: [...new Set([...owners.values()].flat())] });
    },
    undo(direction) {
      const token = sessionId;
      const document = requireDocument();
      const requestId = crypto.randomUUID();
      const run = writes.then(async () => {
        if (token !== sessionId) throw new DOMException('Canvas session closed', 'AbortError');
        const result = await port.undo({ documentId: document.documentId, viewId, requestId, direction });
        if (token !== sessionId) throw new DOMException('Canvas session closed', 'AbortError');
        await synchronize(result.commit.sequence);
        return result;
      });
      writes = run.catch(() => undefined);
      return run;
    },
    async close() {
      const documentId = state.snapshot.value?.documentId;
      sessionId += 1; unsubscribe?.(); unsubscribe = null;
      synchronization = null; targetSequence = 0; protections.clear(); state.clear();
      if (documentId) await port.close(documentId, viewId);
    },
  };
}
