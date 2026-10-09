// @vitest-environment jsdom

import { createPinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { ConversationFileLinkResolutionSchema, WorkspaceFileLocatorSchema } from '@app/schemas';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import { registerConversationResourceLinkPort, type ConversationResourceLinkPort } from '../../resource-link';
import ResearchCompletionCard from './ResearchCompletionCard.vue';
import { createConversationToolLocalizedTextDescriptor } from '../../../ui/tools/functions/createConversationToolTitleDescriptor';

let app: App | undefined;
async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe('ResearchCompletionCard', () => {
  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
  });

  it('opens the delivered article and both original reviews through the existing document navigation', async () => {
    const locators = ['revision', 'argument-review', 'source-review'].map(name =>
      WorkspaceFileLocatorSchema.parse(`workspace:/research/${name}.md`));
    const open = vi.fn<ConversationResourceLinkPort['open']>();
    registerConversationResourceLinkPort({
      resolve: async ({ locator }) => ({
        ...ConversationFileLinkResolutionSchema.parse({
          state: 'ready', kind: 'workspace', locator,
          project_id: 'project-a', document_id: locator, node_type: 'document',
          title: 'Saved document', parent_id: null,
        }),
        activeDocumentType: 'markdown', iconComponent: DocumentIcon, iconClass: '',
      }),
      open,
    });
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(defineComponent({
      setup() {
        return () => h(ResearchCompletionCard, {
          presentation: {
            uiKey: 'complete_research', status: 'success', phase: 'complete',
            data: {
              kind: 'delivered', articlePath: locators[0],
              reviewLinks: [
                { path: locators[1], label: createConversationToolLocalizedTextDescriptor('conversation.tool.researchComplete.argumentReview') },
                { path: locators[2], label: createConversationToolLocalizedTextDescriptor('conversation.tool.researchComplete.sourceReview') },
              ],
            },
          },
        });
      },
    }));
    app.use(createPinia());
    app.provide(CONVERSATION_RENDER_SCOPE_KEY, { conversationId: 'research-main' });
    app.mount(host);
    await settle();

    const links = host.querySelectorAll('a');
    expect(links).toHaveLength(3);
    // Workspace ready 后会使用 owner 的真实标题；角色说明仍须保留，不依赖文件命名。
    expect(links[1].textContent).toBe('Saved document');
    expect(links[2].textContent).toBe('Saved document');
    expect(links[1].parentElement?.textContent).toContain('论证复核');
    expect(links[2].parentElement?.textContent).toContain('来源与数字复核');
    for (const [index, link] of links.entries()) {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await settle();
      expect(open).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        conversationId: 'research-main', target: expect.objectContaining({ document_id: locators[index] }),
      }));
    }
    expect(host.querySelectorAll('.subrun-trace-panel')).toHaveLength(0);
  });
});
