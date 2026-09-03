import { describe, expect, it } from 'vitest';
import {
  isAssistantEntrySelected,
  isPluginStoreEntrySelected,
  isProjectChatEntrySelected,
} from './sidebarEntrySelection';

describe('sidebarEntrySelection', () => {
  it('知识库 scene 下不高亮项目入口', () => {
    expect(isProjectChatEntrySelected({
      activeScene: 'knowledge-base',
      currentScope: { kind: 'project', projectId: 'project-1' },
      projectId: 'project-1',
    })).toBe(false);
  });

  it('知识库 scene 下不高亮 Linnya 助手入口', () => {
    expect(isAssistantEntrySelected({
      activeScene: 'knowledge-base',
      currentScope: { kind: 'linnya-assistant' },
    })).toBe(false);
  });

  it('插件 scene 只高亮插件入口', () => {
    expect(isPluginStoreEntrySelected('plugin-store')).toBe(true);
    expect(isPluginStoreEntrySelected('workspace')).toBe(false);
    expect(isAssistantEntrySelected({
      activeScene: 'plugin-store',
      currentScope: { kind: 'linnya-assistant' },
    })).toBe(false);
  });

  it('workspace scene 下按当前 scope 高亮项目或 Linnya 助手', () => {
    expect(isProjectChatEntrySelected({
      activeScene: 'workspace',
      currentScope: { kind: 'project', projectId: 'project-1' },
      projectId: 'project-1',
    })).toBe(true);

    expect(isAssistantEntrySelected({
      activeScene: 'workspace',
      currentScope: { kind: 'linnya-assistant' },
    })).toBe(true);
  });
});
