// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  OverlayScrollViewportController,
  UseOverlayScrollViewportParams,
} from '@linnya/renderer-ui/scroll';
import ConversationChatSurface from '@/domains/conversation/ui/ConversationChatSurface.vue';
import ConversationSidePane from '@/app/layout/chat/ConversationSidePane.vue';

interface MockOverlayController extends OverlayScrollViewportController {
  init: Mock<OverlayScrollViewportController['init']>;
  update: Mock<OverlayScrollViewportController['update']>;
  scheduleUpdate: Mock<OverlayScrollViewportController['scheduleUpdate']>;
  destroy: Mock<OverlayScrollViewportController['destroy']>;
  getViewport: Mock<OverlayScrollViewportController['getViewport']>;
  getInstance: Mock<OverlayScrollViewportController['getInstance']>;
}

interface OverlayCall {
  params: UseOverlayScrollViewportParams;
  controller: MockOverlayController;
}

const overlayMockState = vi.hoisted(() => {
  return {
    calls: [] as OverlayCall[],
  };
});

const conversationSurfaceMockState = vi.hoisted(() => {
  return {
    activeMessages: [
      {
        id: 'message-1',
        type: 'assistant',
        status: 'complete',
        content: 'hello',
      },
    ],
  };
});

vi.mock('@linnya/renderer-ui/scroll', () => {
  return {
    useOverlayScrollViewport: (params: UseOverlayScrollViewportParams): OverlayScrollViewportController => {
      const controller: MockOverlayController = {
        init: vi.fn(() => {
          params.bindings.viewportRef.value = params.bindings.viewportMountRef.value;
          return params.bindings.viewportMountRef.value;
        }),
        update: vi.fn(() => {
          params.bindings.viewportRef.value = params.bindings.viewportMountRef.value;
          return params.bindings.viewportMountRef.value;
        }),
        scheduleUpdate: vi.fn(),
        beginStructureTransition: vi.fn(),
        finishStructureTransition: vi.fn(),
        destroy: vi.fn(),
        getViewport: vi.fn(() => params.bindings.viewportRef.value),
        getInstance: vi.fn(() => null),
      };

      overlayMockState.calls.push({
        params,
        controller,
      });

      return controller;
    },
  };
});

vi.mock('@/shared/ipc/workspaceGateway', () => {
  return {
    workspaceGateway: {
      'notify-document-opened': vi.fn(async () => ({ success: true })),
    },
  };
});

vi.mock('@/domains/conversation/store/assistantStore', () => {
  return {
    useAssistantStore: () => ({
      activeMessages: conversationSurfaceMockState.activeMessages,
      activeRenderableMessages: conversationSurfaceMockState.activeMessages,
      activeConversationId: 'conversation-1',
      activeConversation: null,
      hasRenderableMessages: conversationSurfaceMockState.activeMessages.length > 0,
      isTimelineCollapsed: true,
      isLoading: false,
      isStreaming: false,
      error: null,
      initialize: vi.fn(async () => undefined),
      clearError: vi.fn(),
    }),
  };
});

vi.mock('@/domains/conversation/ui/ConversationView.vue', () => {
  return {
    default: defineComponent({
      name: 'ConversationViewStub',
      setup() {
        return () => h('div', { class: 'conversation-view-stub' });
      },
    }),
  };
});

vi.mock('@/domains/conversation/ui/AiAssistantInput.vue', () => {
  return {
    default: defineComponent({
      name: 'AiAssistantInputStub',
      setup() {
        return () => h('div', { class: 'ai-assistant-input-stub' });
      },
    }),
  };
});

vi.mock('@/domains/conversation/ui/components/ErrorBanner.vue', () => {
  return {
    default: defineComponent({
      name: 'ErrorBannerStub',
      setup() {
        return () => h('div', { class: 'error-banner-stub' });
      },
    }),
  };
});

vi.mock('@/domains/conversation/features/command-execution-presentation/orchestration/useCommandCardControl', () => ({
  createCommandCardControlPageOwner: () => ({
    ensure: vi.fn(async () => undefined),
    release: vi.fn(),
  }),
}));

// 本测试只验证 Linnya 对话分支的滚动生命周期，项目首页的跨领域装配不在此测试范围内。
vi.mock('@/app/pages/WorkspaceConversationSurface/ProjectConversationSurface.vue', () => {
  return {
    default: defineComponent({
      name: 'ProjectConversationSurfaceStub',
      setup() {
        return () => h('div', { class: 'project-conversation-surface-stub' });
      },
    }),
  };
});

async function flushDomUpdates(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function mountComponent(component: object, pinia = createPinia()) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(component);
  setActivePinia(pinia);
  app.use(pinia);
  app.mount(container);

  return {
    app,
    container,
  };
}

describe('overlay scroll adoption', () => {
  beforeEach(() => {
    overlayMockState.calls.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    });
    conversationSurfaceMockState.activeMessages = [
      {
        id: 'message-1',
        type: 'assistant',
        status: 'complete',
        content: 'hello',
      },
    ];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('ConversationChatSurface mounts shared overlay scroll host and viewport for non-empty conversation content', async () => {
    const ChatSurfaceHost = defineComponent({
      setup() {
        return () => h(ConversationChatSurface, {
          emptyHeading: 'Linnya',
          inputPlaceholder: '说点什么',
        });
      },
    });

    const { app, container } = mountComponent(ChatSurfaceHost);
    await flushDomUpdates();

    const host = container.querySelector('.conversation-chat-host');
    const viewport = container.querySelector('.conversation-host-viewport');
    const overlayCall = overlayMockState.calls[0];

    expect(host).not.toBeNull();
    expect(host?.getAttribute('data-conversation-content-state')).toBe('filled');
    expect(host?.getAttribute('data-overlay-scroll-theme')).toBe('linnya');
    expect(host?.getAttribute('data-overlay-scroll-visibility')).toBe('strict-hover');
    expect(viewport).not.toBeNull();
    expect(viewport?.getAttribute('data-conversation-scroll-viewport')).toBe('true');
    expect(container.querySelector('.messages-scroll-host')).toBeNull();
    expect(container.querySelector('.messages-viewport')).toBeNull();
    expect(container.querySelector('.conversation-view-stub')).not.toBeNull();
    expect(overlayCall).toBeDefined();
    expect(overlayCall.controller.init).toHaveBeenCalled();
    expect(overlayCall.params.bindings.hostRef.value).toBe(host);
    expect(overlayCall.params.bindings.viewportMountRef.value).toBe(viewport);
    expect(overlayCall.params.bindings.viewportRef.value).toBe(viewport);

    app.unmount();
  });

  it('ConversationSidePane uses the Host viewport while visible and destroys it while hidden', async () => {
    const isActive = ref(true);
    const SidePaneHost = defineComponent({
      setup() {
        return () => h(ConversationSidePane, { isActive: isActive.value });
      },
    });

    const { app, container } = mountComponent(SidePaneHost);
    await flushDomUpdates();

    const surface = container.querySelector('.conversation-side-pane__surface');
    const host = surface?.querySelector('.conversation-chat-host') ?? null;
    const viewport = container.querySelector('.conversation-host-viewport');
    const overlayCall = overlayMockState.calls[0];

    expect(surface?.getAttribute('data-workspace-conversation-presentation')).toBe('side-pane');
    expect(host).not.toBeNull();
    expect(host?.getAttribute('data-conversation-content-state')).toBe('filled');
    expect(host?.getAttribute('data-overlay-scroll-theme')).toBe('linnya');
    expect(host?.getAttribute('data-overlay-scroll-visibility')).toBe('strict-hover');
    expect(viewport).not.toBeNull();
    expect(viewport?.getAttribute('data-conversation-scroll-viewport')).toBe('true');
    expect(overlayCall).toBeDefined();
    expect(overlayCall.controller.init).toHaveBeenCalled();
    expect(overlayCall.params.bindings.hostRef.value).toBe(host);
    expect(overlayCall.params.bindings.viewportMountRef.value).toBe(viewport);
    expect(overlayCall.params.bindings.viewportRef.value).toBe(viewport);

    isActive.value = false;
    await flushDomUpdates();
    expect(container.querySelector('.conversation-view-stub')).toBeNull();
    expect(overlayCall.controller.destroy).toHaveBeenCalled();

    app.unmount();
  });
});
