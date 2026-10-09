// @vitest-environment jsdom

import { createPinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { ConversationFileLinkResolutionSchema, WorkspaceFileLocatorSchema } from '@app/schemas';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import { registerConversationResourceLinkPort, type ConversationResourceLinkPort } from '../../resource-link';
import ResearchDocumentSubmissionCard from './ResearchDocumentSubmissionCard.vue';

let app: App | undefined;
async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe('ResearchDocumentSubmissionCard', () => {
  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
  });

  it('opens only the saved Workspace artifact through the public resource link port', async () => {
    const open = vi.fn<ConversationResourceLinkPort['open']>();
    registerConversationResourceLinkPort({
      resolve: async () => ({
        ...ConversationFileLinkResolutionSchema.parse({
          state: 'ready', kind: 'workspace', locator: 'workspace:/research/revision.md',
          project_id: 'project-a', document_id: 'revision-document', node_type: 'document',
          title: '修订文章', parent_id: null,
        }),
        activeDocumentType: 'markdown', iconComponent: DocumentIcon, iconClass: '',
      }),
      open,
    });
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(defineComponent({
      setup() {
        return () => h(ResearchDocumentSubmissionCard, {
          presentation: {
            uiKey: 'submit_research_document', status: 'success', phase: 'complete',
            data: { kind: 'saved', artifactPath: WorkspaceFileLocatorSchema.parse('workspace:/research/revision.md') },
          },
        });
      },
    }));
    app.use(createPinia());
    app.provide(CONVERSATION_RENDER_SCOPE_KEY, { conversationId: 'conversation-a' });
    app.mount(host);
    await settle();

    expect(host.querySelectorAll('a')).toHaveLength(1);
    expect(host.textContent).toContain('修订文章');
    host.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-a', target: expect.objectContaining({ document_id: 'revision-document' }),
    }));
  });
});
