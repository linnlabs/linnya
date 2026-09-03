// @vitest-environment jsdom

import { defineComponent } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConversationFileLinkResolutionSchema,
  ConversationFileLinkResolveRequestSchema,
} from '@app/schemas';

const { openDocument, resolveDocumentTypeByNodeType } = vi.hoisted(() => ({
  openDocument: vi.fn(),
  resolveDocumentTypeByNodeType: vi.fn(),
}));

vi.mock('@/shared/ports/workspaceNavigationPort', () => ({
  getWorkspaceNavigationPort: () => ({ openDocument }),
}));

vi.mock('@/app/plugins/enabledPluginsStore', () => ({
  useEnabledPluginsStore: () => ({ enabledPluginIds: new Set(['slides']), states: [] }),
}));

vi.mock('@/app/plugins/registry', () => ({
  resolveDocumentTypeByNodeType,
}));

import { createConversationResourceLinkPort } from './createConversationResourceLinkPort';

const SlidesIcon = defineComponent({ template: '<svg />' });

describe('createConversationResourceLinkPort', () => {
  const resolveConversationFileLink = vi.fn();
  const revealConversationFileLink = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { resolveConversationFileLink, revealConversationFileLink },
    });
    resolveDocumentTypeByNodeType.mockReturnValue({
      state: 'enabled',
      documentType: {
        activeDocumentType: 'slides',
        iconComponent: SlidesIcon,
        iconClass: 'slides-icon',
      },
    });
  });

  it('Workspace metadata 经 registry 投影后使用显式 project/document identity 导航', async () => {
    const resolution = ConversationFileLinkResolutionSchema.parse({
      state: 'ready',
      kind: 'workspace',
      locator: 'workspace:/试稿.slides',
      project_id: 'project-a',
      document_id: 'slides-a',
      node_type: 'presentation',
      title: '真实标题',
      parent_id: null,
    });
    resolveConversationFileLink.mockResolvedValue({ success: true, data: resolution });
    const port = createConversationResourceLinkPort();
    const request = ConversationFileLinkResolveRequestSchema.parse({
      conversation_id: 'conversation-a',
      locator: 'workspace:/试稿.slides',
    });

    const target = await port.resolve(request);
    expect(target).toMatchObject({
      state: 'ready',
      kind: 'workspace',
      title: '真实标题',
      activeDocumentType: 'slides',
    });
    if (target.state !== 'ready') throw new Error('测试目标未 ready');
    await port.open({ conversationId: 'conversation-a', target });

    expect(openDocument).toHaveBeenCalledWith({
      documentId: 'slides-a',
      type: 'slides',
      projectId: 'project-a',
      displayName: '真实标题',
      parentId: null,
    });
  });

  it('物理文件打开只把 locator 与 owner conversation 交给 reveal IPC', async () => {
    revealConversationFileLink.mockResolvedValue({ success: true, data: undefined });
    const port = createConversationResourceLinkPort();
    const target = ConversationFileLinkResolutionSchema.parse({
      state: 'ready',
      kind: 'conversation',
      locator: 'conversation:/renders/preview.png',
      file_name: 'preview.png',
    });
    if (target.state !== 'ready' || target.kind !== 'conversation') {
      throw new Error('测试目标不是 Conversation 文件');
    }

    await port.open({ conversationId: 'conversation-a', target });

    expect(revealConversationFileLink).toHaveBeenCalledWith({
      conversation_id: 'conversation-a',
      locator: 'conversation:/renders/preview.png',
    });
  });
});
