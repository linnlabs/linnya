// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, type PropType } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationContentPhase } from '../functions/conversationContentPhase';
import type {
  ConversationEmptyComposerPlacement,
  ConversationSurfaceVariant,
} from '../definitions/conversationPresentation';
import ConversationChatSurface from './ConversationChatSurface.vue';

const surfaceState = vi.hoisted(() => ({
  phase: 'draft' as ConversationContentPhase,
}));

vi.mock('../store/conversationContentPhaseSelector', () => ({
  useConversationContentPhaseSelector: () => ({
    get value(): ConversationContentPhase {
      return surfaceState.phase;
    },
  }),
}));

vi.mock('../store/assistantStore', () => ({
  useAssistantStore: () => ({
    isTimelineCollapsed: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

vi.mock('./AiAssistantInput.vue', () => ({
  default: defineComponent({
    name: 'AiAssistantInputStub',
    props: {
      variant: {
        type: String as PropType<ConversationSurfaceVariant>,
        default: 'regular',
      },
      disabled: {
        type: Boolean,
        default: false,
      },
    },
    setup(props) {
      return () => h('div', {
        class: 'ai-assistant-input-stub',
        'data-variant': props.variant,
        'data-disabled': String(props.disabled),
      });
    },
  }),
}));

vi.mock('./ConversationHost.vue', () => ({
  default: defineComponent({
    name: 'ConversationHostStub',
    props: {
      isActive: {
        type: Boolean,
        default: true,
      },
      inputVariant: {
        type: String as PropType<ConversationSurfaceVariant>,
        default: 'regular',
      },
    },
    setup(props) {
      return () => h('div', {
        class: 'conversation-host-stub',
        'data-active': String(props.isActive),
        'data-input-variant': props.inputVariant,
      });
    },
  }),
}));

vi.mock('./components/ConversationEmptyState.vue', () => ({
  default: defineComponent({
    name: 'ConversationEmptyStateStub',
    setup() {
      return () => h('div', { class: 'conversation-empty-state-stub' });
    },
  }),
}));

vi.mock('./components/ErrorBanner.vue', () => ({
  default: defineComponent({
    name: 'ErrorBannerStub',
    setup() {
      return () => h('div', { class: 'error-banner-stub' });
    },
  }),
}));

function mountSurface(props: {
  variant?: ConversationSurfaceVariant;
  emptyComposerPlacement?: ConversationEmptyComposerPlacement;
  isActive?: boolean;
} = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app = createApp(ConversationChatSurface, {
    emptyHeading: 'Linnya',
    ...props,
  });
  app.mount(container);
  return { app, container };
}

describe('ConversationChatSurface content assembly', () => {
  beforeEach(() => {
    surfaceState.phase = 'draft';
    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it.each<ConversationContentPhase>(['draft', 'ready-empty'])(
    '%s 的 regular 首页使用居中输入框且不挂载 Host',
    async (phase) => {
      surfaceState.phase = phase;
      const { app, container } = mountSurface({ variant: 'regular' });
      await nextTick();

      expect(container.querySelector('.empty-state-layout')).not.toBeNull();
      expect(container.querySelector('.centered-input-box .ai-assistant-input-stub')
        ?.getAttribute('data-variant')).toBe('regular');
      expect(container.querySelector('.conversation-host-stub')).toBeNull();
      expect(container.querySelectorAll('.ai-assistant-input-stub')).toHaveLength(1);

      app.unmount();
    },
  );

  it.each<ConversationContentPhase>(['draft', 'ready-empty'])(
    '%s 的 footer 空态复用历史视觉，但保持 regular 输入框规格',
    async (phase) => {
      surfaceState.phase = phase;
      const { app, container } = mountSurface({
        variant: 'regular',
        emptyComposerPlacement: 'footer',
      });
      await nextTick();

      const footerLayout = container.querySelector('.conversation-chat-footer-empty-layout');
      expect(footerLayout?.querySelector('.conversation-empty-state-stub')).not.toBeNull();
      expect(footerLayout?.querySelector('.centered-input-box')).toBeNull();
      expect(footerLayout?.querySelector('.conversation-chat-footer-empty-footer .ai-assistant-input-stub')
        ?.getAttribute('data-variant')).toBe('regular');
      expect(container.querySelector('.conversation-chat-surface--compact')).toBeNull();
      expect(container.querySelector('.conversation-host-stub')).toBeNull();
      expect(container.querySelectorAll('.ai-assistant-input-stub')).toHaveLength(1);

      app.unmount();
    },
  );

  it.each<ConversationContentPhase>(['history-loading', 'ready'])(
    '%s 挂载 Host 并透传展示与活动态',
    async (phase) => {
      surfaceState.phase = phase;
      const { app, container } = mountSurface({
        variant: 'regular',
        emptyComposerPlacement: 'footer',
        isActive: false,
      });
      await nextTick();

      const host = container.querySelector('.conversation-host-stub');
      expect(container.querySelector('.empty-state-layout')).toBeNull();
      expect(host?.getAttribute('data-active')).toBe('false');
      expect(host?.getAttribute('data-input-variant')).toBe('regular');
      expect(container.querySelector('.conversation-chat-surface--compact')).toBeNull();
      expect(container.querySelector('.ai-assistant-input-stub')).toBeNull();

      app.unmount();
    },
  );
});
