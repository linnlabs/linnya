import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectOverview, WorkspaceMutationEvent } from '@app/schemas';
import { refreshPlanFor } from '../functions/projectOverviewRefreshPlan';

const gateway = vi.hoisted(() => ({ read: vi.fn(), stats: vi.fn(), search: vi.fn(), subscribe: vi.fn() }));
vi.mock('../infrastructure/projectOverviewGateway', () => ({ readProjectOverview: gateway.read }));
vi.mock('@/shared/ipc/workspaceGateway', () => ({ workspaceGateway: {
  'get-project-char-stats': gateway.stats, 'search-vfs-nodes': gateway.search,
} }));
vi.mock('@/shared/ipc/workspaceMutationSubscription', () => ({ subscribeToWorkspaceMutation: gateway.subscribe }));
import { useProjectOverviewData } from './useProjectOverviewData';
import { useProjectOverviewContentSearch } from './useProjectOverviewContentSearch';

let scope: EffectScope;
let publish: (event: WorkspaceMutationEvent) => void;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function overview(project = 'p', title = 'old'): ProjectOverview {
  return { project_id: project, folder_count: 0, documents: [{
    document_id: 'doc', node_type: 'document', title, parent_id: null, location: [],
    created_at: 1, creator: null, last_modified_at: 2, last_modified_by: null, pending_revision_count: 0, tags: [],
    properties: { revision: 0, field_ids: [], values: {} },
  }], fields: [] };
}
const updated = (projectId: string): WorkspaceMutationEvent => ({
  type: 'workspace.document.updated', projectId, documentId: 'doc', nodeType: 'document',
  mutationId: 'm', mutationKind: 'version',
});
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); await nextTick(); };
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); scope = effectScope();
  gateway.stats.mockResolvedValue({ success: true, data: { charCount: 10 } });
  gateway.subscribe.mockImplementation((callback: typeof publish) => { publish = callback; return vi.fn(); });
});
afterEach(() => { scope.stop(); vi.useRealTimers(); });

describe('概览刷新', () => {
  it('只刷新同项目正文，跨项目转移两端都重新读结构', () => {
    expect(refreshPlanFor(updated('p'), 'p')).toEqual({ kind: 'documents', id: 'doc' });
    expect(refreshPlanFor(updated('q'), 'p')).toEqual({ kind: 'none' });
    const transfer: WorkspaceMutationEvent = { type: 'workspace.node.transferred', mutationId: 'm', nodeId: 'doc',
      nodeType: 'document', name: 'test', sourceProjectId: 'p', targetProjectId: 'q', sourceParentId: null,
      targetParentId: null, movedNodeIds: ['doc'] };
    expect(refreshPlanFor(transfer, 'p')).toEqual({ kind: 'all' });
    expect(refreshPlanFor(transfer, 'q')).toEqual({ kind: 'all' });
    expect(refreshPlanFor(transfer, 'other')).toEqual({ kind: 'none' });
  });
  it('初次读取期间的保存排在快照后补读，不丢掉保存后的结果', async () => {
    const first = deferred<ProjectOverview>();
    gateway.read.mockReturnValueOnce(first.promise).mockResolvedValueOnce(overview('p', 'new'));
    const data = scope.run(() => useProjectOverviewData(ref('p')))!;
    publish(updated('p'));
    await vi.advanceTimersByTimeAsync(600);
    expect(gateway.read).toHaveBeenCalledTimes(1);
    first.resolve(overview()); await settle();
    expect(gateway.read).toHaveBeenLastCalledWith({ project_id: 'p', document_ids: ['doc'] });
    expect(data.rows.value.get('doc')?.title).toBe('new');
    expect(data.status.value).toBe('ready');
  });
  it('切项目后旧请求不能覆盖新项目，后续事件仍能刷新', async () => {
    const old = deferred<ProjectOverview>();
    gateway.read.mockReturnValueOnce(old.promise).mockResolvedValue(overview('q', 'new project'));
    const id = ref('p'); const data = scope.run(() => useProjectOverviewData(id))!;
    id.value = 'q'; await settle(); old.resolve(overview()); await settle();
    expect(data.rows.value.get('doc')?.title).toBe('new project');
    publish(updated('q')); await vi.advanceTimersByTimeAsync(600);
    expect(gateway.read).toHaveBeenLastCalledWith({ project_id: 'q', document_ids: ['doc'] });
  });
  it('新搜索清除旧命中，数据更新重搜，搜索失败明确区分于无结果', async () => {
    gateway.search.mockResolvedValue({ success: true, data: { ok: true, matches: [{ node: { id: 'doc' } }], truncated: false } });
    const query = ref('first'); const revision = ref(0);
    const data = scope.run(() => useProjectOverviewContentSearch(ref('p'), query, revision))!;
    await vi.advanceTimersByTimeAsync(250); expect(data.matches.value?.has('doc')).toBe(true);
    query.value = 'second'; await nextTick(); expect(data.matches.value).toBeNull();
    await vi.advanceTimersByTimeAsync(250);
    revision.value += 1; await nextTick(); await vi.advanceTimersByTimeAsync(250);
    expect(gateway.search).toHaveBeenCalledTimes(3);
    gateway.search.mockResolvedValue({ success: false }); query.value = 'third';
    await nextTick(); await vi.advanceTimersByTimeAsync(250); expect(data.failed.value).toBe(true);
  });
  it('只有文档快照变化时保留旧命中直到新结果到达，正文命中的行不闪退', async () => {
    const hit = (id: string) => ({ success: true, data: { ok: true, matches: [{ node: { id } }], truncated: false } });
    const next = deferred<ReturnType<typeof hit>>();
    gateway.search.mockResolvedValueOnce(hit('doc')).mockReturnValueOnce(next.promise);
    const query = ref('word'); const revision = ref(0);
    const data = scope.run(() => useProjectOverviewContentSearch(ref('p'), query, revision))!;
    await vi.advanceTimersByTimeAsync(250);
    expect(data.matches.value?.has('doc')).toBe(true);
    revision.value += 1; await nextTick();
    expect(data.matches.value?.has('doc')).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(gateway.search).toHaveBeenCalledTimes(2);
    expect(data.matches.value?.has('doc')).toBe(true);
    next.resolve(hit('other')); await settle();
    expect([...data.matches.value ?? []]).toEqual(['other']);
  });
  it('查询词清空时丢掉旧命中；换项目也不沿用上个项目的命中', async () => {
    gateway.search.mockResolvedValue({ success: true, data: { ok: true, matches: [{ node: { id: 'doc' } }], truncated: false } });
    const query = ref('word'); const id = ref('p');
    const data = scope.run(() => useProjectOverviewContentSearch(id, query, ref(0)))!;
    await vi.advanceTimersByTimeAsync(250);
    expect(data.matches.value?.has('doc')).toBe(true);
    id.value = 'q'; await nextTick();
    expect(data.matches.value).toBeNull();
    await vi.advanceTimersByTimeAsync(250);
    expect(data.matches.value?.has('doc')).toBe(true);
    query.value = ' '; await nextTick();
    expect(data.matches.value).toBeNull();
  });
});

describe('概览补读', () => {
  async function loaded(read: () => void): Promise<ReturnType<typeof useProjectOverviewData>> {
    read();
    const data = scope.run(() => useProjectOverviewData(ref('p')))!;
    await settle();
    expect(data.status.value).toBe('ready');
    return data;
  }
  it('补读失败后点名的文档放回队列，稍后自动重试并在读到后通知发起方', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = await loaded(() => {
      gateway.read.mockResolvedValueOnce(overview())
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(overview('p', 'new'));
    });
    let done = false;
    void data.refreshDocuments(['doc']).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0); await settle();
    expect(gateway.read).toHaveBeenCalledTimes(2);
    expect(data.rows.value.get('doc')?.title).toBe('old');
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000); await settle();
    expect(gateway.read).toHaveBeenLastCalledWith({ project_id: 'p', document_ids: ['doc'] });
    expect(data.rows.value.get('doc')?.title).toBe('new');
    expect(done).toBe(true);
  });
  it('自动重试有上限，用尽后点名的文档留给下一次工作区事件一并补读', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const data = await loaded(() => {
      gateway.read.mockResolvedValueOnce(overview()).mockRejectedValue(new Error('offline'));
    });
    void data.refreshDocuments(['other']);
    await vi.advanceTimersByTimeAsync(0); await settle();
    await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(gateway.read).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(600_000); await settle();
    expect(gateway.read).toHaveBeenCalledTimes(5);
    gateway.read.mockResolvedValueOnce(overview('p', 'new'));
    publish(updated('p')); await vi.advanceTimersByTimeAsync(600); await settle();
    expect(gateway.read).toHaveBeenCalledTimes(6);
    expect(gateway.read).toHaveBeenLastCalledWith({ project_id: 'p', document_ids: ['other', 'doc'] });
  });
  it('发起补读时正在进行的读取不算数：通知发起方要等晚于调用才开始的那次读取', async () => {
    const data = await loaded(() => {
      gateway.read.mockResolvedValueOnce(overview());
    });
    const inFlight = deferred<ProjectOverview>();
    gateway.read.mockReturnValueOnce(inFlight.promise).mockResolvedValueOnce(overview('p', 'after write'));
    publish(updated('p')); await vi.advanceTimersByTimeAsync(600);
    expect(gateway.read).toHaveBeenCalledTimes(2);
    let done = false;
    void data.refreshDocuments(['doc']).then(() => { done = true; });
    inFlight.resolve(overview('p', 'before write')); await settle();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(0); await settle();
    expect(gateway.read).toHaveBeenCalledTimes(3);
    expect(data.rows.value.get('doc')?.title).toBe('after write');
    expect(done).toBe(true);
  });
  it('补读未完成时换项目，发起方的等待随之结束', async () => {
    const data = await (async () => {
      gateway.read.mockResolvedValue(overview());
      const id = ref('p');
      const result = scope.run(() => ({ data: useProjectOverviewData(id), id }))!;
      await settle();
      return result;
    })();
    gateway.read.mockReturnValue(new Promise(() => undefined));
    let done = false;
    void data.data.refreshDocuments(['doc']).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    data.id.value = 'q'; await settle();
    expect(done).toBe(true);
  });
});
