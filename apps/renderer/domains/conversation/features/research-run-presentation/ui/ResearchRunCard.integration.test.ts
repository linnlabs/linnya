// @vitest-environment jsdom

import { createPinia } from 'pinia';
import { computed, createApp, defineComponent, h, nextTick, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { ConversationFileLinkResolutionSchema } from '@app/schemas';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import { executionActivity, provideToolExecutionActivity } from '../../../shared/execution-presentation';
import { registerConversationResourceLinkPort, type ConversationResourceLinkPort } from '../../resource-link';
import { SUBRUN_TRACE_STEP_KINDS } from '../../subrun-trace';
import { loadCompleteSubrunTrace } from '../../subrun-trace/orchestration/loadSubrunTrace';
import { projectResearchRunPresentation } from '../functions/projectResearchRunPresentation';
import ResearchRunCard from './ResearchRunCard.vue';

vi.mock('../../subrun-trace/orchestration/loadSubrunTrace', async loadOriginal => ({
  ...await loadOriginal<typeof import('../../subrun-trace/orchestration/loadSubrunTrace')>(),
  loadCompleteSubrunTrace: vi.fn(async () => ({
    status: 'ready' as const, buckets: {}, eventCount: 0, nextCursor: null, revision: 1,
  })),
}));

let app: App | undefined;
async function settle(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe('ResearchRunCard', () => {
  afterEach(() => {
    app?.unmount();
    app = undefined;
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('opens the saved Workspace document and lazily loads only the selected child process', async () => {
    const open = vi.fn<ConversationResourceLinkPort['open']>();
    registerConversationResourceLinkPort({
      resolve: async () => ({
        ...ConversationFileLinkResolutionSchema.parse({
          state: 'ready', kind: 'workspace', locator: 'workspace:/research/investigation.md',
          project_id: 'project-a', document_id: 'saved-document', node_type: 'document',
          title: '已保存研究记录', parent_id: null,
        }),
        activeDocumentType: 'markdown', iconComponent: DocumentIcon, iconClass: '',
      }),
      open,
    });
    const projection = projectResearchRunPresentation({
      sourceToolName: 'research_run', uiKey: 'research_run', status: 'success', phase: 'complete',
      args: { question: 'Question', reader: 'Reader', task_type: 'fixed', materials: ['workspace:/source.md'] },
      result: {
        data: {
          status: 'inputs_changed', model_id: 'model-a', subrun_ids: ['saved-child'], changed_paths: ['workspace:/source.md'],
          artifacts: [{ stage: 'investigation', subrun_id: 'saved-child', path: 'workspace:/research/investigation.md',
            inode: 'saved-document', sha256: 'a'.repeat(64), citation_sha256: 'b'.repeat(64) }],
        },
        observation: 'Source changed.',
      },
      subrunSummary: { subrun_ids: ['saved-child', 'unfinished-child'], event_counts: { 'saved-child': 1, 'unfinished-child': 0 } },
    });
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(defineComponent({
      setup() {
        provideToolExecutionActivity(() => 'success', computed(() => executionActivity('completed')), () => false);
        return () => h(ResearchRunCard, {
          presentation: { ...projection, uiKey: 'research_run', status: 'success', phase: 'complete' },
          lazySubrunTraceSource: { conversationId: 'conversation-a', parentToolCallId: 'research-parent', kinds: SUBRUN_TRACE_STEP_KINDS },
        });
      },
    }));
    app.use(createPinia());
    app.provide(CONVERSATION_RENDER_SCOPE_KEY, { conversationId: 'conversation-a' });
    app.mount(host);
    await settle();

    expect(host.querySelectorAll('.subrun-trace-panel')).toHaveLength(2);
    expect(host.querySelectorAll('a')).toHaveLength(1);
    expect(host.textContent).toContain('已保存研究记录');
    expect(host.textContent).toContain('workspace:/source.md');
    expect(host.textContent).not.toContain('查看详情');
    expect(loadCompleteSubrunTrace).not.toHaveBeenCalled();
    host.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-a', target: expect.objectContaining({ document_id: 'saved-document' }),
    }));
    host.querySelectorAll('.deep-trace__header')[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(loadCompleteSubrunTrace).toHaveBeenCalledOnce();
    expect(loadCompleteSubrunTrace).toHaveBeenCalledWith('conversation-a', 'research-parent', expect.objectContaining({
      subrunId: 'unfinished-child', kinds: SUBRUN_TRACE_STEP_KINDS,
    }));
  });
});
