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
  }] };
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
});
