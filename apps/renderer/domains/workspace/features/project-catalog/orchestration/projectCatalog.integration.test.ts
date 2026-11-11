import { beforeEach, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { projectGateway } from '@/shared/ipc/projectGateway';
import { useWorkspaceProjectsStore } from '../../../store/WorkspaceProjectsStore';
import { loadProjectCatalog } from './loadProjectCatalog';
import { updateProjectCatalog } from './updateProjectCatalog';

vi.mock('@/shared/ipc/projectGateway', () => ({
  projectGateway: { list: vi.fn(), ensureDefault: vi.fn(), update: vi.fn() },
}));
const record = {
  id: 'project-1',
  name: 'Original',
  description: 'Description',
  icon: null,
  system_role: null,
  can_delete: true,
  created_at: 1,
  updated_at: 2,
  deleted_at: null,
};
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});

test('启动空目录确保默认项目并重读，加载状态结束，保留活动项目投影', async () => {
  const store = useWorkspaceProjectsStore();
  store.markActiveProject('selected');
  vi.mocked(projectGateway.list)
    .mockResolvedValueOnce({ success: true, data: { projects: [] } })
    .mockResolvedValueOnce({ success: true, data: { projects: [record] } });
  vi.mocked(projectGateway.ensureDefault).mockResolvedValue({
    success: true,
    data: { projectId: record.id },
  });
  const loading = loadProjectCatalog();
  expect(store.isLoading).toBe(true);
  await loading;
  expect(store.projects.map(project => project.id)).toEqual([record.id]);
  expect(store.activeProjectId).toBe('selected');
  expect(store.isLoading).toBe(false);
  expect(store.error).toBeNull();
  expect(projectGateway.ensureDefault).toHaveBeenCalledOnce();
  expect(projectGateway.list).toHaveBeenCalledTimes(2);
});

test('已存在目录不初始化默认项目；更新只接纳成功结果，失败不覆盖项目', async () => {
  vi.mocked(projectGateway.list).mockResolvedValue({ success: true, data: { projects: [record] } });
  await loadProjectCatalog();
  const store = useWorkspaceProjectsStore();
  const project = store.projects[0];
  expect(projectGateway.ensureDefault).not.toHaveBeenCalled();
  vi.mocked(projectGateway.update).mockResolvedValue({ success: true });
  await updateProjectCatalog(record.id, { name: 'Changed' });
  expect(store.projects[0]).toBe(project);
  expect(project?.name).toBe('Changed');
  expect(project?.description).toBe('Description');
  vi.mocked(projectGateway.update).mockRejectedValue(new Error('offline'));
  await expect(updateProjectCatalog(record.id, { name: 'Rejected' })).rejects.toThrow('offline');
  expect(project?.name).toBe('Changed');
});

test('加载失败保留既有错误展示语义并退出 loading', async () => {
  vi.mocked(projectGateway.list).mockRejectedValue(new Error('offline'));
  await loadProjectCatalog();
  const store = useWorkspaceProjectsStore();
  expect(store.projects).toEqual([]);
  expect(store.error).toBeTruthy();
  expect(store.isLoading).toBe(false);
});
