import { expect, it, vi } from 'vitest';
import { decodeCanvasHistorySession } from '@plugin/canvas/shared';
import { createCanvasDocumentSession, readCanvasHistorySession, type CanvasDocumentPort } from '../../features/canvasDocument';
import { installCanvasHistoryRestore } from '../installCanvasHistoryRestore';
import type { CanvasRestoredMessage } from '../../definitions/canvasHistoryRestoration';

async function fixture() {
  const port: CanvasDocumentPort = { read: async () => ({ schemaVersion: 1, documentId: 'doc', sequence: 0, elements: [] }), commit: vi.fn(), changes: vi.fn(), editing: async () => {}, undo: vi.fn(), close: async () => {}, subscribe: () => () => {} };
  const session = createCanvasDocumentSession(port); await session.open('doc');
  let generation: string | null = 'draft:1', listener: ((event: CanvasRestoredMessage) => void) | null = null;
  const discard = vi.fn(() => { generation = null; }), changed = vi.fn(), report = vi.fn();
  const dispose = installCanvasHistoryRestore({ documentId: 'doc', session, participants: [{ readGeneration: () => generation, discard }], subscribe: value => { listener = value; return () => { listener = null; }; }, changed, report });
  return { session, discard, changed, report, dispose, edit(value: string) { generation = value; }, restore(clientSessionId: string) { listener?.({ documentId: 'doc', clientSessionId, sequence: 0 }); } };
}
it('恢复只清该次Header打开时冻结的失败草稿，后续输入与其他窗口不受影响', async () => {
  const f = await fixture(), token = readCanvasHistorySession('doc'); if (!token) throw new Error('missing history token');
  expect(decodeCanvasHistorySession(token)?.viewId).toBe(f.session.viewId);
  f.restore(token); await vi.waitFor(() => expect(f.discard).toHaveBeenCalledOnce());
  f.edit('draft:2'); const next = readCanvasHistorySession('doc'); if (!next) throw new Error('missing next token');
  f.edit('draft:3'); f.restore(next); await Promise.resolve(); expect(f.discard).toHaveBeenCalledOnce();
  f.dispose(); expect(readCanvasHistorySession('doc')).toBeNull(); await f.session.close();
});
it('两次面板的迟到恢复不能拿新capture清旧请求之后的输入，同代多次查看复用token', async () => {
  const f = await fixture(), first = readCanvasHistorySession('doc'); if (!first) throw new Error('missing first token');
  expect(readCanvasHistorySession('doc')).toBe(first);
  f.edit('draft:2'); const second = readCanvasHistorySession('doc'); if (!second) throw new Error('missing second token');
  expect(second).not.toBe(first); f.restore(first); await Promise.resolve(); expect(f.discard).not.toHaveBeenCalled();
  f.restore(second); await vi.waitFor(() => expect(f.discard).toHaveBeenCalledOnce()); expect(f.report).not.toHaveBeenCalled();
  f.dispose(); await f.session.close();
});

it('同文档多个表面保留独立注册，关闭最近表面后恢复前一个', async () => {
  const first = await fixture(), second = await fixture();
  try {
    const latest = readCanvasHistorySession('doc');
    expect(latest && decodeCanvasHistorySession(latest)?.viewId).toBe(second.session.viewId);
    second.dispose();
    const remaining = readCanvasHistorySession('doc');
    expect(remaining && decodeCanvasHistorySession(remaining)?.viewId).toBe(first.session.viewId);
    if (!remaining) throw new Error('missing remaining view');
    first.restore(remaining);
    await vi.waitFor(() => expect(first.discard).toHaveBeenCalledOnce());
    expect(second.discard).not.toHaveBeenCalled();
  } finally { first.dispose(); second.dispose(); await first.session.close(); await second.session.close(); }
});
