import { beforeAll, describe, expect, it } from 'vitest';
import { registerDocumentType } from '@/app/plugins/documentTypeRegistry';
import {
  buildNodeContextMenuOptions,
  filterBatchUnsupportedNodeContextMenuActions,
  flattenNodeContextMenuActions,
  type BuildNodeContextMenuOptionsOptions,
  type WorkspaceSidebarNodeLike,
} from './nodeContextMenuModel';
import { WORKSPACE_MESSAGE_FALLBACKS } from '@/domains/workspace/definitions/workspaceMessageCatalog';

const TestIcon = { name: 'TestIcon', template: '<span />' };
const message = (key: keyof typeof WORKSPACE_MESSAGE_FALLBACKS): string => WORKSPACE_MESSAGE_FALLBACKS[key];

function actionsFor(
  node: WorkspaceSidebarNodeLike,
  options: Partial<BuildNodeContextMenuOptionsOptions> = {},
): readonly string[] {
  return flattenNodeContextMenuActions(buildNodeContextMenuOptions(node, {
    message,
    ...options,
  }));
}

describe('nodeContextMenuModel', () => {
  beforeAll(() => {
    for (const contribution of [
      { nodeType: 'document', activeDocumentType: 'editor', createRequestType: 'document', label: '文档', createLabel: '新建文档', defaultName: '未命名文档', canAddToKnowledgeBase: true },
      { nodeType: 'mindmap', activeDocumentType: 'mindmap', createRequestType: 'mindmap', label: '思维导图', createLabel: '新建思维导图', defaultName: '未命名思维导图', canAddToKnowledgeBase: true },
      { nodeType: 'sheet', activeDocumentType: 'sheet', createRequestType: 'sheet', label: '表格', createLabel: '新建表格', defaultName: '未命名表格', canAddToKnowledgeBase: true },
      { nodeType: 'presentation', activeDocumentType: 'slides', createRequestType: 'presentation', label: '演示文稿', createLabel: '新建演示文稿', defaultName: '未命名演示文稿', canAddToKnowledgeBase: false },
    ]) {
      registerDocumentType({
        pluginId: 'test-platform',
        fileSessionType: contribution.nodeType === 'document' ? 'markdown' : contribution.nodeType,
        createBackend: contribution.nodeType === 'mindmap' ? 'plugin-document' : 'workspace-document',
        createHandlerId: contribution.nodeType === 'mindmap' ? 'test-mindmap.create' : undefined,
        surfaceComponent: TestIcon,
        iconComponent: TestIcon,
        iconClass: 'file-icon',
        createPriority: contribution.createRequestType === 'document'
          ? 10
          : contribution.createRequestType === 'mindmap'
            ? 20
            : contribution.createRequestType === 'sheet'
              ? 30
              : 40,
        entityReferences: [{
          kind: 'root',
          uriPattern: `linnya://test/${contribution.createRequestType}/{documentId}`,
          description: `${contribution.label} 测试根实体`,
        }],
        ...contribution,
      });
    }
  });

  it('批量选择右键菜单移除无法批量执行的重命名和复制路径', () => {
    const options = buildNodeContextMenuOptions({
      id: 'doc-1',
      path: '/报告.md',
      name: '报告.md',
      type: 'document',
      isVirtual: false,
    }, { message });
    expect(flattenNodeContextMenuActions(filterBatchUnsupportedNodeContextMenuActions(options))).toEqual([
      'duplicate',
      'delete',
    ]);
  });

  it('右键菜单不提供添加到知识库，More 菜单对不支持的文档显示禁用项', () => {
    const node = {
      id: 'slides-1',
      path: '/演示文稿.slides',
      name: '演示文稿.slides',
      type: 'presentation',
      isVirtual: false,
    } as const;
    const contextOptions = buildNodeContextMenuOptions(node, {
      message,
      hideKnowledgeBaseAction: true,
    });
    expect(flattenNodeContextMenuActions(contextOptions)).not.toContain('add-to-kb');

    const moreOptions = buildNodeContextMenuOptions(node, {
      message,
      disableUnsupportedKnowledgeBaseAction: true,
    });
    const addToKnowledgeBase = moreOptions.find(option => option.value === 'add-to-kb');
    expect(addToKnowledgeBase?.disabled).toBe(true);
    expect(addToKnowledgeBase?.disabledReason).toBeUndefined();
  });

  it('为普通文档返回真实节点动作和 VFS 引用动作', () => {
    expect(actionsFor({
      id: 'doc-1',
      inode: 'workspace:doc-1',
      path: '/报告.md',
      name: '报告.md',
      type: 'document',
      isVirtual: false,
    })).toEqual([
      'add-to-kb',
      'duplicate',
      'rename',
      'copy-relative-path',
      'delete',
    ]);
  });

  it('为真实节点投影“移动到项目”子菜单，并在没有其他项目时禁用', () => {
    const node = {
      id: 'doc-1',
      projectId: 'project-1',
      path: '/报告.md',
      name: '报告.md',
      type: 'document',
      isVirtual: false,
    } as const;
    const options = buildNodeContextMenuOptions(node, {
      message,
      moveTargetProjects: [{ id: 'project-2', name: '客户项目' }],
    });
    expect(flattenNodeContextMenuActions(options)).toContain('move-to-project:project-2');

    const unavailable = buildNodeContextMenuOptions(node, {
      message,
      moveTargetProjects: [],
    }).find(option => option.text === message('workspace.sidebar.node.context.moveToProject'));
    expect(unavailable).toMatchObject({
      disabled: true,
      disabledReason: message('workspace.sidebar.node.context.noOtherProjects'),
    });
  });

  it('为普通文件夹返回新建、重命名、删除和 VFS 引用动作', () => {
    expect(actionsFor({
      id: 'folder-1',
      inode: 'workspace:folder-1',
      path: '/资料',
      name: '资料',
      type: 'folder',
      isVirtual: false,
    })).toEqual([
      'new-document:document',
      'new-document:mindmap',
      'new-document:sheet',
      'new-document:presentation',
      'new-folder',
      'rename',
      'copy-relative-path',
      'delete',
    ]);
  });

  it('文件夹新建菜单只暴露已启用插件贡献的文档类型', () => {
    expect(actionsFor({
      id: 'folder-1',
      inode: 'workspace:folder-1',
      path: '/资料',
      name: '资料',
      type: 'folder',
      isVirtual: false,
    }, { enabledPluginIds: new Set() })).toEqual([
      'new-folder',
      'rename',
      'copy-relative-path',
      'delete',
    ]);

    expect(actionsFor({
      id: 'folder-1',
      inode: 'workspace:folder-1',
      path: '/资料',
      name: '资料',
      type: 'folder',
      isVirtual: false,
    }, { enabledPluginIds: new Set(['test-platform']) })).toContain('new-document:sheet');

    expect(actionsFor({
      id: 'folder-1',
      inode: 'workspace:folder-1',
      path: '/资料',
      name: '资料',
      type: 'folder',
      isVirtual: false,
    }, { enabledPluginIds: new Set(['other-plugin']) })).toEqual([
      'new-folder',
      'rename',
      'copy-relative-path',
      'delete',
    ]);
  });

  it('历史资源库和虚拟分组不再提供专属刷新动作', () => {
    expect(actionsFor({
      id: 'resource-library',
      inode: 'resource-library',
      path: '/Resources',
      name: 'Resources',
      displayName: '资源库',
      type: 'folder',
      isVirtual: true,
      source: 'resource_library',
    })).toEqual(['copy-relative-path']);

    expect(actionsFor({
      id: 'generated-images',
      inode: 'generated-images',
      path: '/Resources/Generated Images',
      name: 'Generated Images',
      displayName: 'AI 生成图片',
      type: 'folder',
      isVirtual: true,
      source: 'generated_image',
    })).toEqual(['copy-relative-path']);
  });

  it('插件 surface 暂不可用的真实文件仍可保持身份移动，虚拟节点不可移动', () => {
    expect(actionsFor({
      id: 'unknown-doc',
      projectId: 'project-1',
      path: '/archive.custom',
      name: 'archive.custom',
      type: 'missing-plugin-type',
      isVirtual: false,
    }, {
      moveTargetProjects: [{ id: 'project-2', name: '归档项目' }],
    })).toEqual([
      'move-to-project:project-2',
      'copy-relative-path',
    ]);

    expect(actionsFor({
      id: 'virtual-node',
      path: '/System',
      name: 'System',
      type: 'missing-plugin-type',
      isVirtual: true,
    }, {
      moveTargetProjects: [{ id: 'project-2', name: '归档项目' }],
    })).toEqual(['copy-relative-path']);
  });

  it('历史虚拟图片不再提供专属预览或 Finder 动作', () => {
    expect(actionsFor({
      id: 'image-1',
      inode: 'asset:image-1',
      path: '/Resources/Generated Images/a.png',
      name: 'a.png',
      type: 'asset_image',
      isVirtual: true,
      payload: { filePath: '/tmp/a.png' },
    })).toEqual(['copy-relative-path']);

    expect(actionsFor({
      id: 'image-2',
      inode: 'asset:image-2',
      path: '/Resources/Generated Images/b.png',
      name: 'b.png',
      type: 'asset_image',
      isVirtual: true,
      payload: {},
    })).toEqual(['copy-relative-path']);
  });

  it('历史虚拟附件不再提供专属预览或 Finder 动作', () => {
    expect(actionsFor({
      id: 'asset-1',
      inode: 'asset:asset-1',
      path: '/Resources/Attachments/brief.pdf',
      name: 'brief.pdf',
      type: 'asset_file',
      isVirtual: true,
      payload: { filePath: '/tmp/brief.pdf' },
    })).toEqual(['copy-relative-path']);
  });
});
