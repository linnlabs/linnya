// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { registerDocumentType } from '@/app/plugins/documentTypeRegistry';
import {
  clearPluginDocumentCreationHandlersForTest,
  registerPluginDocumentCreationHandler,
} from '@plugin/renderer/pluginDocumentCreationPort';
import { useWorkspaceProjectsStore } from './store/WorkspaceProjectsStore';

function createDeferred<T>() {
  let resolvePromise: (value: T) => void = () => {
    throw new Error('Deferred promise 尚未初始化');
  };
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      resolvePromise(value);
    },
  };
}

const mocks = vi.hoisted(() => ({
  listNodesMock: vi.fn(),
  createDocumentMock: vi.fn(),
  pluginCreateDocumentMock: vi.fn(),
  getActiveFileSessionMock: vi.fn(),
  deactivateIfActiveDocumentMock: vi.fn(),
}));

vi.mock('@/shared/ipc/workspaceGateway', () => ({
  workspaceGateway: {
    'list-nodes': mocks.listNodesMock,
    'list-vfs-nodes': mocks.listNodesMock,
    'create-document': mocks.createDocumentMock,
  },
}));

vi.mock('@/domains/workspace/services/file-manager/index', () => ({
  getActiveFileSession: mocks.getActiveFileSessionMock,
  deactivateIfActiveDocument: mocks.deactivateIfActiveDocumentMock,
}));

import { useWorkspaceTree } from './tree';

describe('WorkspaceTree.loadProjectTree', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    clearPluginDocumentCreationHandlersForTest();
    mocks.listNodesMock.mockReset();
    mocks.createDocumentMock.mockReset();
    mocks.pluginCreateDocumentMock.mockReset();
    mocks.getActiveFileSessionMock.mockReset();
    mocks.deactivateIfActiveDocumentMock.mockReset();
  });

  it('已加载同一项目时，ensureProjectTreeLoaded 不重复拉取', async () => {
    mocks.listNodesMock.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'doc-1',
          name: '文档',
          type: 'document',
          projectId: 'project-1',
          parentId: null,
          children: null,
        },
      ],
    });

    const store = useWorkspaceTree();

    await store.ensureProjectTreeLoaded('project-1');
    await store.ensureProjectTreeLoaded('project-1');

    expect(mocks.listNodesMock).toHaveBeenCalledTimes(1);
    expect(store.loadedProjectId).toBe('project-1');
    expect(store.projectTree).toHaveLength(1);
  });

  it('同一项目并发 ensure 时复用进行中的加载', async () => {
    const listRequest = createDeferred<{ success: true; data: [] }>();
    mocks.listNodesMock.mockReturnValue(listRequest.promise);

    const store = useWorkspaceTree();
    const firstLoad = store.ensureProjectTreeLoaded('project-1');
    const secondLoad = store.ensureProjectTreeLoaded('project-1');

    listRequest.resolve({ success: true, data: [] });
    await Promise.all([firstLoad, secondLoad]);

    expect(mocks.listNodesMock).toHaveBeenCalledTimes(1);
    expect(store.loadedProjectId).toBe('project-1');
  });

  it('刷新事实时保留节点身份、展开状态和已加载子树', async () => {
    const folder = {
      id: 'folder-1', name: '原目录', type: 'folder', project_id: 'project-1',
      parent_id: null, created_at: 1, updated_at: 1, deleted_at: null, icon: null,
    };
    const child = { ...folder, id: 'doc-1', name: '原文档', type: 'document', parent_id: folder.id };
    mocks.listNodesMock
      .mockResolvedValueOnce({ success: true, data: [folder] })
      .mockResolvedValueOnce({ success: true, data: [child] })
      .mockResolvedValueOnce({ success: true, data: [{ ...folder, name: '新目录', updated_at: 2 }] })
      .mockResolvedValueOnce({ success: true, data: [{ ...child, name: '新文档', updated_at: 3 }] });
    useWorkspaceProjectsStore().markActiveProject('project-1');
    const tree = useWorkspaceTree();
    await tree.loadProjectTree('project-1');
    await tree.toggleExpand(folder.id);
    const existingFolder = tree.findNodeById(folder.id)!;
    const existingChild = tree.findNodeById(child.id)!;
    const existingChildren = existingFolder.children;

    await tree.reloadActiveProjectTree();

    expect(tree.findNodeById(folder.id)).toBe(existingFolder);
    expect(existingFolder).toMatchObject({ name: '新目录', updatedAt: '2', isExpanded: true });
    expect(existingFolder.children).toBe(existingChildren);
    expect(tree.findNodeById(child.id)).toBe(existingChild);
    await tree.loadNodeChildren(existingFolder);
    expect(tree.findNodeById(child.id)).toBe(existingChild);
    expect(existingChild).toMatchObject({ name: '新文档', updatedAt: '3' });
    expect(existingFolder.isExpanded).toBe(true);
  });

  it('清空树后忽略仍在途的旧项目响应', async () => {
    const listRequest = createDeferred<{
      success: true;
      data: Array<Record<string, unknown>>;
    }>();
    mocks.listNodesMock.mockReturnValue(listRequest.promise);

    const store = useWorkspaceTree();
    const loading = store.loadProjectTree('project-1');
    store.clearTree();
    listRequest.resolve({
      success: true,
      data: [{
        id: 'stale-doc',
        name: '旧项目文档',
        type: 'document',
        project_id: 'project-1',
        parent_id: null,
        icon: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      }],
    });
    await loading;

    expect(store.projectTree).toEqual([]);
    expect(store.loadedProjectId).toBeNull();
    expect(store.isLoading).toBe(false);
  });

  it('清空树后也忽略仍在途的主动刷新响应', async () => {
    const listRequest = createDeferred<{
      success: true;
      data: Array<Record<string, unknown>>;
    }>();
    mocks.listNodesMock.mockReturnValue(listRequest.promise);
    useWorkspaceProjectsStore().markActiveProject('project-1');

    const store = useWorkspaceTree();
    const reloading = store.reloadActiveProjectTree();
    store.clearTree();
    listRequest.resolve({
      success: true,
      data: [{
        id: 'stale-reload-doc',
        name: '刷新中的旧文档',
        type: 'document',
        project_id: 'project-1',
        parent_id: null,
        icon: null,
        created_at: 1,
        updated_at: 1,
        deleted_at: null,
      }],
    });
    await reloading;

    expect(store.projectTree).toEqual([]);
    expect(store.loadedProjectId).toBeNull();
    expect(store.isLoading).toBe(false);
  });

  it('插件文档创建走 pluginDocumentCreationPort，不静态依赖具体插件 gateway', async () => {
    const TestSurface = { name: 'WorkspaceTreeStorePluginDocumentTestSurface', template: '<span />' };
    registerDocumentType({
      pluginId: 'workspace-tree-store-test-plugin',
      nodeType: 'workspace-tree-store-test-plugin-doc',
      activeDocumentType: 'workspace-tree-store-test-plugin-doc',
      fileSessionType: 'workspace-tree-store-test-plugin-doc',
      createRequestType: 'workspace-tree-store-test-plugin-doc',
      createBackend: 'plugin-document',
      createHandlerId: 'workspace-tree-store-test-plugin.create',
      surfaceComponent: TestSurface,
      iconComponent: TestSurface,
      label: '测试插件文档',
      createLabel: '新建测试插件文档',
      defaultName: '未命名测试插件文档',
      iconClass: 'test-plugin-doc-icon',
      createPriority: 990,
      entityReferences: [{
        kind: 'document',
        uriPattern: 'linnya://workspace-tree-store-test-plugin/{documentId}',
        description: '测试插件文档根实体。',
      }],
    });
    registerPluginDocumentCreationHandler({
      id: 'workspace-tree-store-test-plugin.create',
      createDocument: mocks.pluginCreateDocumentMock,
    });
    mocks.pluginCreateDocumentMock.mockResolvedValue({
      success: true,
      data: { documentId: 'plugin-doc-1' },
    });
    mocks.listNodesMock.mockResolvedValue({ success: true, data: [] });

    const projectsStore = useWorkspaceProjectsStore();
    projectsStore.markActiveProject('project-1');
    const store = useWorkspaceTree();

    const documentId = await store.createDocument({
      name: '插件文档',
      parentId: 'folder-1',
      type: 'workspace-tree-store-test-plugin-doc',
      requestRename: false,
    });

    expect(documentId).toBe('plugin-doc-1');
    expect(mocks.pluginCreateDocumentMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      parentId: 'folder-1',
      name: '插件文档',
      createRequestType: 'workspace-tree-store-test-plugin-doc',
    });
    expect(mocks.createDocumentMock).not.toHaveBeenCalled();
  });
});
