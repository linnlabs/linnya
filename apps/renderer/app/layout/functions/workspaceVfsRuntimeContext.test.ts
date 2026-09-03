import { describe, expect, it } from 'vitest';
import { shouldReloadProjectTreeForVfsRuntimeContextChange } from './workspaceVfsRuntimeContext';

describe('shouldReloadProjectTreeForVfsRuntimeContextChange', () => {
  it('conversationId 未变化时不刷新项目树', () => {
    expect(shouldReloadProjectTreeForVfsRuntimeContextChange({
      previousConversationId: 'conversation-1',
      nextConversationId: 'conversation-1',
      sidebarNav: 'project',
      sidebarMode: 'files',
      activeProjectId: 'project-1',
    })).toBe(false);
  });

  it('对话模式下只更新上下文，不立即刷新文件树', () => {
    expect(shouldReloadProjectTreeForVfsRuntimeContextChange({
      previousConversationId: 'conversation-1',
      nextConversationId: 'conversation-2',
      sidebarNav: 'project',
      sidebarMode: 'chat',
      activeProjectId: 'project-1',
    })).toBe(false);
  });

  it('没有活动项目时不刷新文件树', () => {
    expect(shouldReloadProjectTreeForVfsRuntimeContextChange({
      previousConversationId: 'conversation-1',
      nextConversationId: 'conversation-2',
      sidebarNav: 'project',
      sidebarMode: 'files',
      activeProjectId: null,
    })).toBe(false);
  });

  it('列表态文件子标签无效，不立即刷新文件树', () => {
    expect(shouldReloadProjectTreeForVfsRuntimeContextChange({
      previousConversationId: 'conversation-1',
      nextConversationId: 'conversation-2',
      sidebarNav: 'list',
      sidebarMode: 'files',
      activeProjectId: 'project-1',
    })).toBe(false);
  });

  it('项目态文件子标签下 conversationId 变化且有活动项目时刷新项目树', () => {
    expect(shouldReloadProjectTreeForVfsRuntimeContextChange({
      previousConversationId: 'conversation-1',
      nextConversationId: 'conversation-2',
      sidebarNav: 'project',
      sidebarMode: 'files',
      activeProjectId: 'project-1',
    })).toBe(true);
  });
});
