import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceNodeDTO } from '@/shared/ipc/workspaceGateway';
import { loadProjectOverviewSnapshot } from '../loadProjectOverviewSnapshot';

function dto(params: {
  id: string;
  projectId?: string;
  parentId?: string | null;
  type: string;
  name?: string;
}): WorkspaceNodeDTO {
  return {
    id: params.id,
    inode: `workspace:${params.id}`,
    path: `/${params.name ?? params.id}`,
    project_id: params.projectId ?? 'project-a',
    parent_id: params.parentId ?? null,
    type: params.type,
    name: params.name ?? params.id,
    icon: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    last_opened_at: null,
    access_count: 0,
    tags: null,
  };
}

describe('loadProjectOverviewSnapshot', () => {
  it('按 projectId 递归加载项目概览快照，不依赖全局项目树', async () => {
    const listVfsNodes = vi.fn(async (args: { projectId: string; parentId?: string | null }) => {
      if (args.projectId !== 'project-a') {
        return { success: false as const, error: 'unexpected project' };
      }

      if (args.parentId === null) {
        return {
          success: true as const,
          data: [
            dto({ id: 'folder-1', type: 'folder', name: '资料' }),
            dto({ id: 'slides-1', type: 'presentation', name: '方案.slides' }),
          ],
        };
      }

      if (args.parentId === 'folder-1') {
        return {
          success: true as const,
          data: [
            dto({ id: 'doc-1', parentId: 'folder-1', type: 'document', name: '说明.md' }),
            dto({ id: 'folder-2', parentId: 'folder-1', type: 'folder', name: '归档' }),
          ],
        };
      }

      if (args.parentId === 'folder-2') {
        return {
          success: true as const,
          data: [
            dto({ id: 'sheet-1', parentId: 'folder-2', type: 'sheet', name: '预算.sheet' }),
          ],
        };
      }

      return { success: true as const, data: [] };
    });

    const snapshot = await loadProjectOverviewSnapshot({
      projectId: 'project-a',
      gateway: { 'list-vfs-nodes': listVfsNodes },
    });

    expect(listVfsNodes).toHaveBeenCalledWith({ projectId: 'project-a', parentId: null });
    expect(listVfsNodes).toHaveBeenCalledWith({ projectId: 'project-a', parentId: 'folder-1' });
    expect(listVfsNodes).toHaveBeenCalledWith({ projectId: 'project-a', parentId: 'folder-2' });
    expect(snapshot.map(node => node.id)).toEqual(['folder-1', 'slides-1']);
    expect(snapshot[0]?.children?.map(node => node.id)).toEqual(['doc-1', 'folder-2']);
    expect(snapshot[0]?.children?.[1]?.children?.map(node => node.id)).toEqual(['sheet-1']);
  });

  it('加载任一层失败时暴露后端错误', async () => {
    const listVfsNodes = vi.fn(async () => ({
      success: false as const,
      error: 'VFS unavailable',
    }));

    await expect(loadProjectOverviewSnapshot({
      projectId: 'project-a',
      gateway: { 'list-vfs-nodes': listVfsNodes },
    })).rejects.toThrow('VFS unavailable');
  });
});
