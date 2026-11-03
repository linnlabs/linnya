import { describe, expect, it, vi } from 'vitest';
import { CanvasCardIdSchema } from '@plugin/canvas/shared';
import { createCanvasSelectionReferenceKind, addCanvasSelectionReference } from '..';
import type { CanvasSelectionReferencePort } from '..';
const id = CanvasCardIdSchema.parse('c1');
const metadata = { documentId: 'doc', projectId: 'project', elementIds: [id], originalCount: 1 };
const reference = { id: 'quote', pluginId: 'canvas', kind: 'canvas-selection', label: '画布 · 1 张卡', previewText: '旧', text: '旧', metadata };
function fixture() {
  const save = vi.fn(async () => true), read = vi.fn(async () => ({ documentId: 'doc', sequence: 7, elementIds: [id], path: 'workspace:/画布.canvas', text: '发送瞬间的最新正文' }));
  const add = vi.fn(() => 'ref'), focusComposer = vi.fn(async () => true), activate = vi.fn(async () => {});
  const port: CanvasSelectionReferencePort = { save, read, add, focusComposer, activate };
  return { save, read, add, focusComposer, port, kind: createCanvasSelectionReferenceKind(port) };
}
describe('画布选区引用', () => {
  it('先保存调用方草稿，发送时后台读一次冻结版本，保留原引用快照', async () => {
    const f = fixture();
    const prepared = await f.kind.prepareForSend?.(reference, { conversationId: 'conversation', projectId: 'project', signal: new AbortController().signal });
    expect(f.save).toHaveBeenCalledWith('doc');
    expect(f.read).toHaveBeenCalledWith({ documentId: 'doc', elementIds: ['c1'], conversationId: 'conversation', projectId: 'project' });
    expect(prepared).toMatchObject({ text: '发送瞬间的最新正文', metadata: { sequence: 7 } });
    expect(reference.text).toBe('旧');
  });
  it('失败或无项目的新对话拒绝发送，不使用引用metadata里的旧项目补齐', async () => {
    const f = fixture();
    await expect(f.kind.prepareForSend?.(reference, { conversationId: null, projectId: null, signal: new AbortController().signal })).rejects.toThrow('没有项目');
    expect(f.read).not.toHaveBeenCalled();
    f.save.mockResolvedValueOnce(false);
    await expect(f.kind.prepareForSend?.(reference, { conversationId: 'conversation', projectId: 'project', signal: new AbortController().signal })).rejects.toThrow('尚未保存');
  });
  it('加入选区携带通用去重身份并聚焦composer', async () => {
    const f = fixture(); await addCanvasSelectionReference(metadata, f.port);
    expect(f.add).toHaveBeenCalledWith(expect.objectContaining({ pluginId: 'canvas', kind: 'canvas-selection', deduplicationKey: 'doc:c1' }));
    expect(f.focusComposer).toHaveBeenCalledTimes(1);
  });
});
