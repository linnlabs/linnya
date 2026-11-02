import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectGateway } from '@/shared/ipc/projectGateway';
import { useNavigationScope } from '@/app/navigation';
import { useWorkspaceProjectsStore } from '../../../store/WorkspaceProjectsStore';
import { refreshProjectCatalog } from './refreshProjectCatalog';

vi.mock('@/shared/ipc/projectGateway', () => ({
  projectGateway: { list: vi.fn(), ensureDefault: vi.fn() },
}));

describe('Project catalog refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('接纳其他项目及当前项目改名，保留当前导航和草稿；空列表刷新不创建默认项目', async () => {
    const navigation = useNavigationScope();
    navigation.startDraft({ kind: 'project', projectId: 'selected' });
    const draft = navigation.currentDraft;
    const store = useWorkspaceProjectsStore();
    store.markActiveProject('selected');
    const record = {
      id: 'selected',
      name: 'Renamed',
      description: 'From CLI',
      icon: null,
      system_role: null,
      can_delete: true,
      created_at: 1,
      updated_at: 2,
      deleted_at: null,
    };
    vi.mocked(projectGateway.list).mockResolvedValue({
      success: true,
      data: { projects: [record, { ...record, id: 'other', name: 'New project' }] },
    });
    await refreshProjectCatalog();
    expect(store.activeProject?.name).toBe('Renamed');
    expect(store.projects.map(project => project.id)).toEqual(['selected', 'other']);
    expect(navigation.currentProjectId).toBe('selected');
    expect(navigation.currentDraft).toEqual(draft);
    // 创建回执和 mutation 通知都可能刷新目录；相同事实不能打断正在播放的插入动画。
    const acceptedCatalog = store.projects;
    await refreshProjectCatalog();
    expect(store.projects).toBe(acceptedCatalog);
    vi.mocked(projectGateway.list).mockResolvedValue({
      success: true,
      data: { projects: [{ ...record, name: 'Changed again' }] },
    });
    await refreshProjectCatalog();
    expect(store.activeProject?.name).toBe('Changed again');
    expect(store.projects.map(project => project.id)).toEqual(['selected']);
    vi.mocked(projectGateway.list).mockResolvedValue({ success: true, data: { projects: [] } });
    await refreshProjectCatalog();
    expect(store.projects).toEqual([]);
    expect(projectGateway.ensureDefault).not.toHaveBeenCalled();
    expect(navigation.currentProjectId).toBe('selected');
  });
});
