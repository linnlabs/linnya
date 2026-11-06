import { describe, expect, it, vi } from 'vitest';
import { CanvasCardIdSchema } from '@plugin/canvas/shared';
import { createCanvasSelectionReferenceKind, addCanvasSelectionReference } from '..';
import type { CanvasSelectionReferencePort } from '..';
import { createCanvasSelectionPreview } from '../orchestration/createCanvasSelectionPreview';
import { registerCanvasReferenceFocus, focusCanvasReference } from '..';
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
  it('同文档多表面关闭最近注册后仍可定位剩余表面', async () => {
    const first = vi.fn(async () => {}), second = vi.fn(async () => {});
    const closeFirst = registerCanvasReferenceFocus('multiple', first), closeSecond = registerCanvasReferenceFocus('multiple', second);
    try {
      await focusCanvasReference('multiple', [id]); expect(second).toHaveBeenCalledOnce();
      closeSecond(); await focusCanvasReference('multiple', [id]); expect(first).toHaveBeenCalledOnce();
    } finally { closeFirst(); closeSecond(); }
  });
  it('预览预算不会截断组合emoji，完整正文仍随发送前刷新保留', async () => {
    const f = fixture(), text = '中'.repeat(499) + '👨‍👩‍👧‍👦e\u0301🇨🇳';
    f.read.mockResolvedValueOnce({ documentId: 'doc', sequence: 9, elementIds: [id], path: 'workspace:/画布.canvas', text });
    const result = await f.kind.prepareForSend?.(reference, { conversationId: 'chat', projectId: 'project', signal: new AbortController().signal });
    expect(result?.previewText).toBe('中'.repeat(499)); expect(result?.text).toBe(text);
  });
  it('hover读取当前正文且不保存，关闭和切项目后不接纳迟到正文', async () => {
    const f = fixture(); let project: string | null = 'project';
    const preview = createCanvasSelectionPreview(f.read, () => project);
    await preview.refresh(reference);
    expect(preview.content.value).toBe('发送瞬间的最新正文'); expect(f.save).not.toHaveBeenCalled();
    let finish: (() => void) | undefined;
    f.read.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ documentId: 'doc', sequence: 8, elementIds: [id], path: 'workspace:/画布.canvas', text: '迟到内容' }); }));
    const pending = preview.refresh(reference); preview.dispose(); finish?.(); await pending;
    expect(preview.content.value).toBe('');
    project = null; await preview.refresh(reference);
    expect(preview.error.value).toContain('不在当前项目'); expect(f.read).toHaveBeenCalledTimes(2);
  });
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
  it('全部删除发送最新说明并标记已删除，保留原选区身份供撤销恢复后再次刷新', async () => {
    const f = fixture(); f.read.mockResolvedValueOnce({ documentId: 'doc', sequence: 8, elementIds: [], path: 'workspace:/画布.canvas', text: '所选卡片已全部删除，没有可发送的正文。' });
    const deleted = await f.kind.prepareForSend?.(reference, { conversationId: 'conversation', projectId: 'project', signal: new AbortController().signal });
    expect(deleted).toMatchObject({ label: '画布 · 已删除', text: '所选卡片已全部删除，没有可发送的正文。', metadata: { elementIds: ['c1'], sequence: 8 } });
    expect(reference.text).toBe('旧');
  });
});
