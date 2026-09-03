// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, type PropType } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  ConversationEmptyComposerPlacement,
  ConversationSurfaceVariant,
} from '@/domains/conversation/definitions/conversationPresentation';
import { useWorkspaceScopeStore } from '@/shared/stores/workspaceScopeStore';
import WorkspaceConversationSurface from './WorkspaceConversationSurface.vue';

const projectsStoreState = vi.hoisted(() => ({
  activeProjectId: null as string | null,
  markActiveProject: vi.fn<(projectId: string) => void>(),
  clearActiveProject: vi.fn<() => void>(),
}));

vi.mock('@/domains/workspace/store/WorkspaceProjectsStore', () => ({
  useWorkspaceProjectsStore: () => projectsStoreState,
}));

vi.mock('./ProjectConversationSurface.vue', () => ({
  default: defineComponent({
    name: 'ProjectConversationSurfaceStub',
    props: {
      variant: {
        type: String as PropType<ConversationSurfaceVariant>,
        required: true,
      },
      emptyComposerPlacement: {
        type: String as PropType<ConversationEmptyComposerPlacement>,
        required: true,
      },
      isActive: {
        type: Boolean,
        required: true,
      },
      showHomeActions: {
        type: Boolean,
        required: true,
      },
    },
    setup(props) {
      return () => h('div', {
        class: 'project-conversation-surface-stub',
        'data-variant': props.variant,
        'data-empty-composer-placement': props.emptyComposerPlacement,
        'data-active': String(props.isActive),
        'data-show-home-actions': String(props.showHomeActions),
      });
    },
  }),
}));

vi.mock('@/domains/conversation/ui/LinnyaAssistantChatSurface.vue', () => ({
  default: defineComponent({
    name: 'LinnyaAssistantChatSurfaceStub',
    props: {
      variant: {
        type: String as PropType<ConversationSurfaceVariant>,
        required: true,
      },
      emptyComposerPlacement: {
        type: String as PropType<ConversationEmptyComposerPlacement>,
        required: true,
      },
      isActive: {
        type: Boolean,
        required: true,
      },
    },
    setup(props) {
      return () => h('div', {
        class: 'linnya-conversation-surface-stub',
        'data-variant': props.variant,
        'data-empty-composer-placement': props.emptyComposerPlacement,
        'data-active': String(props.isActive),
      });
    },
  }),
}));

function mountWorkspaceSurface(props: {
  presentation: 'home' | 'side-pane';
  isActive: boolean;
}) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(WorkspaceConversationSurface, props);
  app.use(pinia);
  app.mount(container);
  return { app, container };
}

describe('WorkspaceConversationSurface assembly', () => {
  beforeEach(() => {
    localStorage.clear();
    projectsStoreState.activeProjectId = null;
    projectsStoreState.markActiveProject.mockReset();
    projectsStoreState.clearActiveProject.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('首页将 Linnya 场景装配为 regular 且保持活动', async () => {
    const { app, container } = mountWorkspaceSurface({
      presentation: 'home',
      isActive: true,
    });
    await nextTick();

    const surface = container.querySelector('.workspace-conversation-surface');
    const linnya = container.querySelector('.linnya-conversation-surface-stub');
    expect(surface?.getAttribute('data-workspace-conversation-presentation')).toBe('home');
    expect(linnya?.getAttribute('data-variant')).toBe('regular');
    expect(linnya?.getAttribute('data-empty-composer-placement')).toBe('center');
    expect(linnya?.getAttribute('data-active')).toBe('true');
    expect(projectsStoreState.clearActiveProject).toHaveBeenCalledOnce();

    app.unmount();
  });

  it('右侧项目场景只改变空态输入框位置，不改变对话密度', async () => {
    const { app, container } = mountWorkspaceSurface({
      presentation: 'side-pane',
      isActive: false,
    });
    const scopeStore = useWorkspaceScopeStore();
    scopeStore.enterProject('project-1');
    await nextTick();

    const project = container.querySelector('.project-conversation-surface-stub');
    expect(project?.getAttribute('data-variant')).toBe('regular');
    expect(project?.getAttribute('data-empty-composer-placement')).toBe('footer');
    expect(project?.getAttribute('data-active')).toBe('false');
    expect(project?.getAttribute('data-show-home-actions')).toBe('false');
    expect(projectsStoreState.markActiveProject).toHaveBeenCalledWith('project-1');

    app.unmount();
  });
});
