import { effectScope, ref, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSavedFilter, ProjectSavedFiltersRequest } from '@app/schemas';

const gateway = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../infrastructure/projectOverviewGateway', () => ({ requestProjectSavedFilters: gateway.request }));
import { useProjectSavedFilters } from './useProjectSavedFilters';

type Reply = { filters: readonly ProjectSavedFilter[]; saved_id: string | null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const filter = (id: string) => ({ id, name: id, pinned: true }) as unknown as ProjectSavedFilter;
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
let scope: EffectScope;
beforeEach(() => { vi.resetAllMocks(); scope = effectScope(); });
afterEach(() => { scope.stop(); });

describe('保存的筛选', () => {
  it('同项目的请求乱序返回时，较早发出的旧结果不能覆盖较新的列表', async () => {
    const initial = deferred<Reply>();
    const create = deferred<Reply>();
    const list = deferred<Reply>();
    gateway.request.mockImplementation((request: ProjectSavedFiltersRequest) => {
      if (request.action === 'create') return create.promise;
      return gateway.request.mock.calls.length === 1 ? initial.promise : list.promise;
    });
    const filters = scope.run(() => useProjectSavedFilters(ref('p')))!;
    initial.resolve({ filters: [], saved_id: null }); await settle();
    const created = filters.create('new', {} as never);
    const reloaded = filters.reload();
    list.resolve({ filters: [filter('a'), filter('b')], saved_id: null }); await settle();
    expect(filters.filters.value.map(item => item.id)).toEqual(['a', 'b']);
    create.resolve({ filters: [filter('a')], saved_id: 'a' }); await settle();
    expect(filters.filters.value.map(item => item.id)).toEqual(['a', 'b']);
    await expect(created).resolves.toBe('a');
    await reloaded;
  });
  it('切换项目后旧项目的迟到结果仍被丢弃', async () => {
    const old = deferred<Reply>();
    gateway.request.mockReturnValueOnce(old.promise).mockResolvedValue({ filters: [filter('q1')], saved_id: null });
    const id = ref('p');
    const filters = scope.run(() => useProjectSavedFilters(id))!;
    id.value = 'q'; await settle();
    old.resolve({ filters: [filter('p1')], saved_id: null }); await settle();
    expect(filters.filters.value.map(item => item.id)).toEqual(['q1']);
  });
});
