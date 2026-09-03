// @vitest-environment jsdom

import {
  createApp,
  defineComponent,
  h,
  nextTick,
  type App,
} from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { useLayoutStore } from '@/app/layout/store/layoutStore';
import WorkspaceStage from './WorkspaceStage.vue';

vi.mock('@/app/pages/ChatCentricPage/ChatCentricPage.vue', () => ({
  default: defineComponent({
    name: 'ChatCentricPageStub',
    setup: () => () => h('main', { class: 'chat-centric-page-stub' }),
  }),
}));

vi.mock('@/app/layout/components/PaneDivider.vue', () => ({
  default: defineComponent({
    name: 'PaneDividerStub',
    setup: () => () => h('div', { class: 'pane-divider-stub' }),
  }),
}));

vi.mock('@/app/layout/document/DocumentPane.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'DocumentPaneStub',
    setup: () => () => h('main', { class: 'document-pane-stub' }),
  }),
}));

vi.mock('@/app/layout/chat/ConversationSidePane.vue', () => ({
  __esModule: true,
  default: defineComponent({
    name: 'ConversationSidePaneStub',
    inheritAttrs: false,
    props: {
      isActive: { type: Boolean, required: true },
    },
    setup(props, { attrs }) {
      return () => h('aside', {
        ...attrs,
        class: ['conversation-side-pane-stub', attrs.class],
        'data-active': String(props.isActive),
      });
    },
  }),
}));

vi.mock('@/app/layout/composables/useLayoutLocalization', () => ({
  useLayoutLocalization: () => ({ layoutMessage: (key: string) => key }),
}));

vi.mock('@/app/layout/composables/useRightPaneResize', () => ({
  useRightPaneResize: () => ({ startResize: vi.fn() }),
}));

vi.mock('@/app/layout/composables/useWorkspaceStageMeasurement', () => ({
  useWorkspaceStageMeasurement: vi.fn(),
}));

async function flushAsyncComponents(): Promise<void> {
  await Promise.resolve();
  await nextTick();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await nextTick();
}

function dispatchWidthTransitionEnd(element: HTMLElement): void {
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: 'width' });
  element.dispatchEvent(event);
}

describe('WorkspaceStage conversation drawer geometry', () => {
  let app: App<Element> | null;
  let container: HTMLElement;
  let pinia: Pinia;

  beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
    container = document.createElement('div');
    document.body.appendChild(container);
    app = null;
  });

  afterEach(() => {
    app?.unmount();
    container.remove();
  });

  it('外框开合时保持大宽度对话正文不变，并在收起动画结束后才停用内容', async () => {
    const layoutStore = useLayoutStore();
    layoutStore.setWorkspaceStageWidth(1_600);
    layoutStore.openDocument({
      type: 'editor',
      id: 'document-1',
      projectId: 'project-1',
    });
    layoutStore.setPreferredRightPaneWidth(900);

    app = createApp(WorkspaceStage);
    app.use(pinia);
    app.mount(container);
    await flushAsyncComponents();

    const frame = container.querySelector<HTMLElement>('.workspace-stage__right-pane-frame');
    const content = container.querySelector<HTMLElement>('.conversation-side-pane-stub');
    expect(frame?.style.width).toBe('900px');
    expect(content?.style.width).toBe('900px');
    expect(content?.dataset.active).toBe('true');

    layoutStore.toggleWorkspaceRightPaneVisibility();
    await nextTick();

    expect(frame?.style.width).toBe('0px');
    expect(content?.style.width).toBe('900px');
    expect(content?.dataset.active).toBe('true');

    dispatchWidthTransitionEnd(frame as HTMLElement);
    await nextTick();
    expect(content?.dataset.active).toBe('false');

    layoutStore.toggleWorkspaceRightPaneVisibility();
    await nextTick();

    expect(frame?.style.width).toBe('900px');
    expect(content?.style.width).toBe('900px');
    expect(content?.dataset.active).toBe('true');
  });
});
