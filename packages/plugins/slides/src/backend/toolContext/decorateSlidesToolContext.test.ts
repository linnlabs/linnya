import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SLIDES_PLUGIN_META } from '@plugin/slides/shared';
import {
  requirePresentationCoordinator,
  requirePresentationInspectTargetResolver,
} from '../tools';
import { decorateSlidesToolContext } from './decorateSlidesToolContext';

const pluginRuntimeMock = vi.hoisted(() => ({
  assertPluginRuntimeEnabled: vi.fn(),
}));

vi.mock('@plugin/backend/pluginRuntime', () => ({
  assertPluginRuntimeEnabled: pluginRuntimeMock.assertPluginRuntimeEnabled,
  isPluginRuntimeEnabled: vi.fn(() => true),
}));

const workspaceRuntimeMock = vi.hoisted(() => ({
  resolveWorkspaceVfsNodeForPluginTool: vi.fn(),
  createConversationFilePathResolver: vi.fn(() => undefined),
}));

vi.mock('@plugin/backend/workspaceRuntime', () => ({
  resolveWorkspaceVfsNodeForPluginTool: workspaceRuntimeMock.resolveWorkspaceVfsNodeForPluginTool,
  createConversationFilePathResolver: workspaceRuntimeMock.createConversationFilePathResolver,
}));

const coordinatorFactoryMock = vi.hoisted(() => ({
  getSharedPptCoordinator: vi.fn(),
}));

vi.mock('../coordinator', () => ({
  getSharedPptCoordinator: coordinatorFactoryMock.getSharedPptCoordinator,
}));

function createContext() {
  const db = { prepare: vi.fn() };
  return {
    db,
    context: {
      databaseService: { getDb: () => db },
    },
  };
}

describe('decorateSlidesToolContext', () => {
  beforeEach(() => {
    // resetAllMocks 同时清除 mockImplementation，避免「门禁抛错」实现泄漏到后续用例。
    vi.resetAllMocks();
  });

  it('coordinator provider 先过插件门禁，再通过包内共享 factory 读取 runtime', () => {
    const { context } = createContext();
    const coordinator = { generate: vi.fn() };
    coordinatorFactoryMock.getSharedPptCoordinator.mockReturnValue(coordinator);

    decorateSlidesToolContext(context);

    expect(requirePresentationCoordinator(context)).toBe(coordinator);
    expect(pluginRuntimeMock.assertPluginRuntimeEnabled).toHaveBeenCalledWith({
      pluginId: SLIDES_PLUGIN_META.id,
      pluginName: SLIDES_PLUGIN_META.name,
      action: '使用 Slides 工具',
    });
  });

  it('coordinator provider 每次都委托共享 factory，缓存责任不在 decorator 内部', () => {
    const { context } = createContext();
    const coordinator = { generate: vi.fn() };
    coordinatorFactoryMock.getSharedPptCoordinator.mockReturnValue(coordinator);

    decorateSlidesToolContext(context);
    const first = requirePresentationCoordinator(context);
    const second = requirePresentationCoordinator(context);

    expect(first).toBe(second);
    expect(coordinatorFactoryMock.getSharedPptCoordinator).toHaveBeenCalledTimes(2);
  });

  it('插件被禁用时 provider 直接抛出门禁错误，不装配 coordinator', () => {
    const { context } = createContext();
    pluginRuntimeMock.assertPluginRuntimeEnabled.mockImplementation(() => {
      throw new Error('Slides 插件未启用');
    });

    decorateSlidesToolContext(context);

    expect(() => requirePresentationCoordinator(context)).toThrow('Slides 插件未启用');
    expect(coordinatorFactoryMock.getSharedPptCoordinator).not.toHaveBeenCalled();
  });

  it('databaseService 缺失时 provider 抛错', () => {
    const context = {};

    decorateSlidesToolContext(context);

    expect(() => requirePresentationCoordinator(context)).toThrow(
      'Workspace database not available in tool context.',
    );
  });

  it('inspect resolver 把 presentation 节点解析为目标', async () => {
    const { context } = createContext();
    workspaceRuntimeMock.resolveWorkspaceVfsNodeForPluginTool.mockResolvedValue({
      ok: true,
      node: {
        id: 'pres-1',
        inode: 'inode-1',
        path: '/deck.slides',
        type: 'presentation',
        name: 'deck.slides',
      },
    });

    decorateSlidesToolContext(context);
    const resolver = requirePresentationInspectTargetResolver(context);
    const target = await resolver({ path: '/deck.slides' });

    expect(target).toEqual({
      presentationId: 'pres-1',
      path: '/deck.slides',
      inode: 'inode-1',
    });
    expect(workspaceRuntimeMock.resolveWorkspaceVfsNodeForPluginTool).toHaveBeenCalledWith(
      context,
      { path: '/deck.slides', inode: undefined },
    );
  });

  it('派生复制后的 binding 会重新绑定到派生 context', async () => {
    const sourceDb = { id: 'source-db' };
    const targetDb = { id: 'target-db' };
    const sourceContext = {
      databaseService: { getDb: () => sourceDb },
    };
    const targetContext = {
      databaseService: { getDb: () => targetDb },
    };
    const sourceCoordinator = { id: 'source-coordinator' };
    const targetCoordinator = { id: 'target-coordinator' };
    coordinatorFactoryMock.getSharedPptCoordinator.mockImplementation((db) => {
      if (db === sourceDb) return sourceCoordinator;
      if (db === targetDb) return targetCoordinator;
      throw new Error('unexpected db');
    });
    workspaceRuntimeMock.resolveWorkspaceVfsNodeForPluginTool.mockResolvedValue({
      ok: true,
      node: {
        id: 'pres-1',
        inode: 'inode-1',
        path: '/deck.slides',
        type: 'presentation',
        name: 'deck.slides',
      },
    });

    decorateSlidesToolContext(sourceContext);
    const {
      copyPresentationCoordinatorBindingToToolContext,
    } = await import('../tools/toolContextBinding');
    copyPresentationCoordinatorBindingToToolContext(sourceContext, targetContext);

    expect(requirePresentationCoordinator(targetContext)).toBe(targetCoordinator);
    const resolver = requirePresentationInspectTargetResolver(targetContext);
    await resolver({ path: '/deck.slides' });
    expect(workspaceRuntimeMock.resolveWorkspaceVfsNodeForPluginTool).toHaveBeenLastCalledWith(
      targetContext,
      { path: '/deck.slides', inode: undefined },
    );
  });

  it('inspect resolver 对非 presentation 节点抛错', async () => {
    const { context } = createContext();
    workspaceRuntimeMock.resolveWorkspaceVfsNodeForPluginTool.mockResolvedValue({
      ok: true,
      node: {
        id: 'doc-1',
        inode: 'inode-2',
        path: '/note.md',
        type: 'markdown',
        name: 'note.md',
      },
    });

    decorateSlidesToolContext(context);
    const resolver = requirePresentationInspectTargetResolver(context);

    await expect(resolver({ path: '/note.md' })).rejects.toThrow(
      'ppt_inspect 只能检查 Slides 文件，当前路径类型: markdown',
    );
  });

  it('inspect resolver 透传解析失败的 message 和 hint', async () => {
    const { context } = createContext();
    workspaceRuntimeMock.resolveWorkspaceVfsNodeForPluginTool.mockResolvedValue({
      ok: false,
      message: 'Path not found: /missing.slides',
      hint: 'Missing root item: missing.slides',
    });

    decorateSlidesToolContext(context);
    const resolver = requirePresentationInspectTargetResolver(context);

    await expect(resolver({ path: '/missing.slides' })).rejects.toThrow(
      'Path not found: /missing.slides Missing root item: missing.slides',
    );
  });

  it('非对象上下文直接抛错', () => {
    expect(() => decorateSlidesToolContext(null)).toThrow(
      'Slides tool context decorator requires ToolContext-like host object.',
    );
  });
});
