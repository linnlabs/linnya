// @vitest-environment jsdom

import { createPinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationFileLinkResolutionSchema } from '@app/schemas';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import {
  registerConversationResourceLinkPort,
  type ConversationResourceLinkPort,
} from '../index';
import ConversationResourceLinkNode from './ConversationResourceLinkNode.vue';

const TestSlidesIcon = defineComponent({ template: '<svg data-test="slides-icon" />' });

const mountedApps: App[] = [];

function mountNode(props: { href: string; authoredTitle: string }): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(defineComponent({
    render: () => h(ConversationResourceLinkNode, props),
  }));
  app.use(createPinia());
  app.provide(CONVERSATION_RENDER_SCOPE_KEY, Object.freeze({
    conversationId: 'conversation-a',
  }));
  app.mount(host);
  mountedApps.push(app);
  return host;
}

async function settleResolution(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
}

describe('ConversationResourceLinkNode', () => {
  afterEach(() => {
    mountedApps.splice(0).forEach(app => app.unmount());
    document.body.innerHTML = '';
  });

  it('Workspace 链接以 owner metadata 的真实标题和 registry 图标打开', async () => {
    const open = vi.fn<ConversationResourceLinkPort['open']>();
    const resolve = vi.fn<ConversationResourceLinkPort['resolve']>(async () => ({
      ...ConversationFileLinkResolutionSchema.parse({
        state: 'ready',
        kind: 'workspace',
        locator: 'workspace:/试稿.slides',
        project_id: 'project-a',
        document_id: 'slides-a',
        node_type: 'presentation',
        title: '数据库真实标题',
        parent_id: null,
      }),
      activeDocumentType: 'slides',
      iconComponent: TestSlidesIcon,
      iconClass: 'slides-icon',
    }));
    registerConversationResourceLinkPort({ resolve, open });

    const host = mountNode({
      href: 'workspace:/%E8%AF%95%E7%A8%BF.slides',
      authoredTitle: '模型写错的标题',
    });
    await settleResolution();

    expect(host.textContent).toContain('数据库真实标题');
    expect(host.textContent).not.toContain('模型写错的标题');
    expect(host.querySelector('[data-test="slides-icon"]')).not.toBeNull();
    host.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-a',
      target: expect.objectContaining({ document_id: 'slides-a', project_id: 'project-a' }),
    }));
  });

  it('Conversation 文件显示 authored title 与不重复的 locator 后缀', async () => {
    const target = ConversationFileLinkResolutionSchema.parse({
      state: 'ready',
      kind: 'conversation',
      locator: 'conversation:/renders/第 1 页.png',
      file_name: '第 1 页.png',
    });
    if (target.state !== 'ready' || target.kind !== 'conversation') {
      throw new Error('测试目标不是 Conversation 文件');
    }
    const open = vi.fn<ConversationResourceLinkPort['open']>();
    registerConversationResourceLinkPort({
      resolve: async () => target,
      open,
    });

    const host = mountNode({
      href: 'conversation:/renders/%E7%AC%AC%201%20%E9%A1%B5.png',
      authoredTitle: '渲染预览',
    });
    await settleResolution();

    expect(host.textContent).toContain('渲染预览');
    expect(host.textContent).toContain('.png');
    host.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await nextTick();
    expect(open).toHaveBeenCalledOnce();
  });

  it('非法 file locator 显示明确不可用状态且不请求 owner', async () => {
    const resolve = vi.fn<ConversationResourceLinkPort['resolve']>();
    registerConversationResourceLinkPort({ resolve, open: vi.fn() });

    const host = mountNode({
      href: 'file://localhost/tmp/file.txt',
      authoredTitle: '文件',
    });
    await settleResolution();

    expect(host.textContent).toContain('格式无效');
    expect(host.querySelector('a')?.getAttribute('aria-disabled')).toBe('true');
    expect(resolve).not.toHaveBeenCalled();
  });

});
