// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectConversationSurface from './ProjectConversationSurface.vue';

const dependencies = vi.hoisted(() => ({
  ensureDataLoaded: vi.fn<() => Promise<void>>(async () => undefined),
  ensureProjectTreeLoaded: vi.fn<(projectId: string) => Promise<void>>(async () => undefined),
  setInputText: vi.fn<(text: string) => void>(),
  openProjectOverview: vi.fn(),
}));

vi.mock('@/shared/stores/workspaceScopeStore', () => ({
  useWorkspaceScopeStore: () => ({
    currentProjectId: 'project-1',
  }),
}));

vi.mock('@/domains/workspace/store', () => ({
  useWorkspaceProjectsStore: () => ({
    projects: [{ id: 'project-1', name: '测试项目' }],
  }),
  useWorkspaceTreeStore: () => ({
    ensureProjectTreeLoaded: dependencies.ensureProjectTreeLoaded,
  }),
}));

vi.mock('@/domains/knowledgebase/stores/knowledgeBase/index.js', () => ({
  useKnowledgeBaseStore: () => ({
    ensureDataLoaded: dependencies.ensureDataLoaded,
  }),
}));

vi.mock('@/domains/conversation/store/assistantStore', () => ({
  useAssistantStore: () => ({
    setInputText: dependencies.setInputText,
  }),
}));

vi.mock('@/domains/workspace/features/project-overview/store/projectOverviewModalStore', () => ({
  useProjectOverviewModalStore: () => ({
    open: dependencies.openProjectOverview,
  }),
}));

vi.mock('@/domains/conversation/ui/composables/useStartupEmptySubtitle', () => ({
  useStartupEmptySubtitle: () => ref('启动说明'),
}));

vi.mock('@/domains/conversation/ui/useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    conversationMessage: (key: string) => key,
  }),
}));

vi.mock('@linnya/renderer-ui/icons', () => ({
  LinnyaIcon: defineComponent({
    name: 'LinnyaIconStub',
    setup() {
      return () => h('span', { class: 'linnya-icon-stub' });
    },
  }),
}));

vi.mock('@/domains/conversation/ui/ConversationChatSurface.vue', () => ({
  default: defineComponent({
    name: 'ConversationChatSurfaceStub',
    inheritAttrs: false,
    props: {
      variant: String,
      emptyComposerPlacement: String,
      isActive: Boolean,
      emptyHeading: String,
      emptyDescription: String,
      inputPlaceholder: String,
    },
    setup(props, { slots }) {
      return () => h('div', {
        class: 'conversation-chat-surface-stub',
        'data-variant': props.variant,
        'data-empty-composer-placement': props.emptyComposerPlacement,
        'data-active': String(props.isActive),
      }, [
        slots['empty-mark']?.(),
        slots.emptyActions?.(),
      ]);
    },
  }),
}));

function mountProjectSurface(showHomeActions: boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(ProjectConversationSurface, {
    variant: 'regular',
    emptyComposerPlacement: showHomeActions ? 'center' : 'footer',
    isActive: true,
    showHomeActions,
  });
  app.mount(container);
  return { app, container };
}

describe('ProjectConversationSurface app-level boundaries', () => {
  beforeEach(() => {
    dependencies.ensureDataLoaded.mockClear();
    dependencies.ensureProjectTreeLoaded.mockClear();
    dependencies.setInputText.mockClear();
    dependencies.openProjectOverview.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('右侧展示不挂载首页操作，也不预加载首页知识库数据', async () => {
    const { app, container } = mountProjectSurface(false);
    await nextTick();

    const surface = container.querySelector('.conversation-chat-surface-stub');
    expect(surface?.getAttribute('data-variant')).toBe('regular');
    expect(surface?.getAttribute('data-empty-composer-placement')).toBe('footer');
    expect(container.querySelector('.project-chat-suggestion-chip')).toBeNull();
    expect(dependencies.ensureDataLoaded).not.toHaveBeenCalled();
    expect(dependencies.ensureProjectTreeLoaded).toHaveBeenCalledWith('project-1');

    app.unmount();
  });

  it('首页展示挂载建议操作，并通过幂等入口准备知识库数据', async () => {
    const { app, container } = mountProjectSurface(true);
    await nextTick();

    const surface = container.querySelector('.conversation-chat-surface-stub');
    expect(surface?.getAttribute('data-variant')).toBe('regular');
    expect(surface?.getAttribute('data-empty-composer-placement')).toBe('center');
    expect(container.querySelectorAll('.project-chat-suggestion-chip')).toHaveLength(4);
    expect(dependencies.ensureDataLoaded).toHaveBeenCalledOnce();
    expect(dependencies.ensureProjectTreeLoaded).toHaveBeenCalledWith('project-1');

    app.unmount();
  });
});
