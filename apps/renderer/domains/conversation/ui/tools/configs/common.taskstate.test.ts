import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRendererPluginRegistryForTest,
  registerRendererPlugin,
} from '@/app/plugins/registry';
import { commonToolConfigs } from './common';
import { workspaceReadToolConfigs } from './workspace';

const TestSurface = { name: 'ConversationCommonToolConfigTestSurface', template: '<div />' };

function registerTestDocumentTypes(): void {
  registerRendererPlugin({
    meta: {
      id: 'conversation-common-tool-test-platform',
      name: 'Conversation Common Tool Test Platform',
      version: '1.0.0',
      description: 'Conversation common tool test document types',
      developer: 'Linnya',
      builtin: true,
      required: true,
    },
    documentTypes: [
      {
        pluginId: 'conversation-common-tool-test-platform',
        nodeType: 'document',
        activeDocumentType: 'editor',
        fileSessionType: 'markdown',
        createRequestType: 'document',
        createBackend: 'workspace-document',
        surfaceComponent: TestSurface,
        label: '文档',
        createLabel: '新建文档',
        defaultName: '未命名文档',
        iconComponent: TestSurface,
        iconClass: 'file-icon',
        createPriority: 10,
        entityReferences: [{
          kind: 'document',
          uriPattern: 'linnya://document/{documentId}',
          description: '测试文档根实体。',
        }],
      },
      {
        pluginId: 'conversation-common-tool-test-platform',
        nodeType: 'presentation',
        activeDocumentType: 'slides',
        createRequestType: 'presentation',
        createBackend: 'plugin-document',
        createHandlerId: 'conversation-common-tool-test-platform.presentation.create',
        surfaceComponent: TestSurface,
        label: '演示文稿',
        createLabel: '新建演示文稿',
        defaultName: '未命名演示文稿',
        iconComponent: TestSurface,
        iconClass: 'slides-icon',
        createPriority: 20,
        entityReferences: [{
          kind: 'slide',
          uriPattern: 'linnya://slides/{documentId}#slide/{slideId}',
          description: '测试 Slides 页面实体。',
        }],
      },
    ],
  });
}

describe('commonToolConfigs - taskstate / sharedmemory copy', () => {
  beforeEach(() => {
    clearRendererPluginRegistryForTest();
    registerTestDocumentTypes();
  });

  it('应注册 live task_write/read 与历史 TaskState 回放', () => {
    expect(commonToolConfigs['task_write']).toBeDefined();
    expect(commonToolConfigs['task_read']).toBeDefined();
    expect(commonToolConfigs['taskstate_write']).toBeDefined();
    expect(commonToolConfigs['taskstate_read']).toBeDefined();
  });

  it('TaskState 与 Todo 应由 presentation projector 同时拥有 payload 与标题', () => {
    for (const toolName of [
      'task_write',
      'task_read',
      'todo_write',
      'todo_read',
    ]) {
      expect(commonToolConfigs[toolName]?.presentation).toBeTypeOf('function');
    }
  });

  it('canonical subagent 与 batch 声明 presentation；退役 delegate 不保留 UI 兼容入口', () => {
    for (const toolName of ['subagent', 'subrun_batch']) {
      expect(commonToolConfigs[toolName]?.presentation).toBeTypeOf('function');
      expect(commonToolConfigs[toolName]?.runtime).toEqual({ subrunTrace: true });
    }
    expect(commonToolConfigs['delegate']).toBeUndefined();
  });

  it('ask 使用 live 问卷卡片，ask_questions 只复用同一历史回放配置', () => {
    expect(commonToolConfigs['ask']).toBeDefined();
    expect(commonToolConfigs['ask_questions']).toBe(commonToolConfigs['ask']);
  });

  it('sharedmemory 文案应标记为内部产物，避免被产品化成用户文档', () => {
    for (const toolName of ['sharedmemory_list', 'sharedmemory_write']) {
      expect(commonToolConfigs[toolName]?.presentation).toBeTypeOf('function');
    }
  });

  it('Workspace Path 工具应渲染为不可展开的单卡片标题', () => {
    expect(commonToolConfigs['list_files'].layout).toEqual({ fullWidth: true, hideContent: true });
    expect(workspaceReadToolConfigs['workspace_read_file']).toMatchObject({
      layout: { fullWidth: true, hideContent: true, disableHeaderHover: true },
    });
    expect(workspaceReadToolConfigs['read_file']).toMatchObject({
      resolveUiKey: expect.any(Function),
    });
    expect(commonToolConfigs['write_file'].layout).toEqual({ fullWidth: true, hideContent: true, disableHeaderHover: true });
    expect(commonToolConfigs['edit_file'].layout).toEqual({ fullWidth: true, hideContent: true, disableHeaderHover: true });
    expect(commonToolConfigs['grep'].layout).toEqual({ fullWidth: true, hideContent: true, disableHeaderHover: true });
  });

  it('read_file 应由 projector 生成可延迟本地化的文档链接标题', () => {
    const workspaceReadConfig = workspaceReadToolConfigs['workspace_read_file'];
    if (!workspaceReadConfig || !('presentation' in workspaceReadConfig)) {
      throw new Error('workspace_read_file final config is missing');
    }
    expect(workspaceReadConfig.presentation?.({
      sourceToolName: 'read_file',
      uiKey: 'workspace_read_file',
      args: { path: '/draft.md' },
      status: 'success',
      phase: 'complete',
      result: {
        data: {
          path: '/docs/final.md',
          inode: 'workspace:doc-1',
          content_type: 'text/markdown',
          node: {
            name: 'final.md',
            path: '/docs/final.md',
            inode: 'workspace:doc-1',
            type: 'document',
            source: 'workspace_node',
            is_virtual: false,
            parent_id: 'folder-1',
            updated_at: 1,
          },
          offset: 0,
          limit: 20_000,
          truncated: false,
          has_more: false,
        },
        observation: 'content',
      },
    })).toMatchObject({
      title: {
        text: {
          key: 'conversation.tool.workspace.file.readTarget',
          params: { target: 'final' },
        },
        documentLink: {
          prefixText: { key: 'conversation.tool.workspace.file.read' },
          text: {
            key: 'conversation.tool.workspace.file.target',
            params: { target: 'final' },
          },
          documentId: 'doc-1',
          documentType: 'editor',
          displayName: 'final.md',
          parentId: 'folder-1',
        },
      },
    });
  });

  it('已迁移的 Workspace header-only 注册项应只使用 admission projector', () => {
    for (const toolName of ['list_files', 'write_file', 'edit_file', 'grep']) {
      expect(commonToolConfigs[toolName].presentation).toBeTypeOf('function');
    }
    const workspaceReadConfig = workspaceReadToolConfigs['workspace_read_file'];
    expect(workspaceReadConfig && 'presentation' in workspaceReadConfig
      ? workspaceReadConfig.presentation
      : undefined).toBeTypeOf('function');
  });

  it('Evidence header-only 注册项应只使用各工具合同的 admission projector', () => {
    for (const toolName of ['assemble_documents', 'evidence_resolve']) {
      expect(commonToolConfigs[toolName].presentation).toBeTypeOf('function');
    }
  });

  it('退役的 assemble_evidence 只保留 strict historical projector', () => {
    expect(commonToolConfigs['assemble_evidence'].presentation).toBeTypeOf('function');
  });
});
