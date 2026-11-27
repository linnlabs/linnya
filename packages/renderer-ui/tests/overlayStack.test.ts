// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import {
  AlertDialog,
  BaseDropdown,
  CustomSelect,
  ImagePreviewModal,
  isModalOverlayOpen,
  Modal,
  SimpleDatePicker,
  useEscapeLayer,
  useModalFocus,
} from '@linnya/renderer-ui';
import { getOverlayStack } from '../src/features/overlays/registry/overlayStack';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mount(render: () => ReturnType<typeof h>): App {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render });
  app.mount(host);
  mountedApps.push({ app, host });
  return app;
}

function pressKey(key: string): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

/** 一次真实点击：先在 pressOn 上按下，再在 target 上收到 click（按下和松开不在同一处时 click 落在共同祖先上）。 */
function clickAt(target: Element, pressOn: Element = target): void {
  pressOn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

// 关闭动画在 jsdom 里不会结束，上一个用例关掉的遮罩会留在 body 上，每个用例从空页面开始。
beforeEach(() => document.body.replaceChildren());

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
  vi.restoreAllMocks();
});

describe('浮层栈', () => {
  it('Escape 只交给最后入栈的层，出栈后再交给上一层', () => {
    const stack = getOverlayStack(window);
    const calls: string[] = [];
    const unregisterLower = stack.register({ onEscape: () => calls.push('lower') });
    const unregisterUpper = stack.register({ onEscape: () => calls.push('upper') });

    pressKey('Escape');
    expect(calls).toEqual(['upper']);

    unregisterUpper();
    pressKey('Escape');
    expect(calls).toEqual(['upper', 'lower']);

    unregisterLower();
    pressKey('Escape');
    expect(calls).toEqual(['upper', 'lower']);
  });

  it('不是 Escape 的按键不交给任何层', () => {
    const onEscape = vi.fn();
    const unregister = getOverlayStack(window).register({ onEscape });

    pressKey('Enter');
    pressKey('a');
    expect(onEscape).not.toHaveBeenCalled();

    unregister();
  });

  it('只装一组监听：第一层入栈时安装，最后一层出栈后移除，重复出栈无副作用', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const addOnWindow = vi.spyOn(window, 'addEventListener');
    const removeOnWindow = vi.spyOn(window, 'removeEventListener');
    const stack = getOverlayStack(window);

    const unregisterFirst = stack.register({ onEscape: () => undefined });
    const unregisterSecond = stack.register({ onEscape: () => undefined });
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    expect(addOnWindow.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);

    unregisterFirst();
    unregisterFirst();
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);

    unregisterSecond();
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    expect(removeOnWindow.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
  });

  it('弃用的 useModalFocus 只管焦点，Escape 照旧交给下面处理 Escape 的层', async () => {
    const onEscape = vi.fn();
    const Own = defineComponent(() => {
      const containerRef = ref<HTMLElement | null>(null);
      useEscapeLayer({ active: true, onEscape });
      useModalFocus({ active: true, containerRef });
      return () => h('div', { ref: containerRef, tabindex: -1 });
    });
    mount(() => h(Own));
    await nextTick();

    pressKey('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

describe('有没有弹窗打开', () => {
  it('只看模态层：开着下拉时不算，弹窗打开到关闭期间算', async () => {
    const modalOpen = ref(false);
    mount(() => h('div', [
      h(CustomSelect, { modelValue: 'a', options: [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }] }),
      h(Modal, { isVisible: modalOpen.value, title: '设置', onClose: () => { modalOpen.value = false; } }),
    ]));
    await nextTick();
    element('.select-trigger').click();
    await nextTick();
    expect(isModalOverlayOpen()).toBe(false);

    modalOpen.value = true;
    await nextTick();
    expect(isModalOverlayOpen()).toBe(true);

    pressKey('Escape');
    await nextTick();
    expect(isModalOverlayOpen()).toBe(false);
  });
});

describe('useEscapeLayer', () => {
  it('按打开先后排序，而不是按挂载顺序；重新打开的层回到最上面', async () => {
    const lowerOpen = ref(false);
    const upperOpen = ref(false);
    const calls: string[] = [];
    const Layer = defineComponent({
      props: { name: { type: String, required: true }, open: { type: Boolean, required: true } },
      setup(props) {
        useEscapeLayer({ active: () => props.open, onEscape: () => calls.push(props.name) });
        return () => null;
      },
    });
    mount(() => h('div', [
      h(Layer, { name: 'lower', open: lowerOpen.value }),
      h(Layer, { name: 'upper', open: upperOpen.value }),
    ]));

    // 文档顺序里 lower 在前，但 upper 先打开，所以 lower 是最上层。
    upperOpen.value = true;
    await nextTick();
    lowerOpen.value = true;
    await nextTick();
    pressKey('Escape');
    expect(calls).toEqual(['lower']);

    lowerOpen.value = false;
    await nextTick();
    pressKey('Escape');
    expect(calls).toEqual(['lower', 'upper']);

    lowerOpen.value = true;
    await nextTick();
    pressKey('Escape');
    expect(calls).toEqual(['lower', 'upper', 'lower']);
  });

  it('组件卸载后释放登记，不再响应 Escape', async () => {
    const onEscape = vi.fn();
    const app = mount(() => h(defineComponent({
      setup() {
        useEscapeLayer({ active: true, onEscape });
        return () => null;
      },
    })));
    await nextTick();

    pressKey('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);

    app.unmount();
    pressKey('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

describe('浮层叠放时的 Escape', () => {
  it('嵌套 Modal：第一次 Escape 只关最上面一层，第二次才关下面一层', async () => {
    const outerOpen = ref(true);
    const innerOpen = ref(false);
    mount(() => h('div', [
      h(Modal, { isVisible: outerOpen.value, title: '外层', onClose: () => { outerOpen.value = false; } }),
      h(Modal, { isVisible: innerOpen.value, title: '内层', onClose: () => { innerOpen.value = false; } }),
    ]));
    await nextTick();
    innerOpen.value = true;
    await nextTick();

    pressKey('Escape');
    await nextTick();
    expect(innerOpen.value).toBe(false);
    expect(outerOpen.value).toBe(true);

    pressKey('Escape');
    await nextTick();
    expect(outerOpen.value).toBe(false);
  });

  it('最上层的 Modal 禁止 Esc 时本层不关闭，也不穿透关闭下面一层', async () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const innerOpen = ref(false);
    mount(() => h('div', [
      h(Modal, { isVisible: true, title: '外层', onClose: outerClose }),
      h(Modal, { isVisible: innerOpen.value, closeOnEsc: false, title: '处理中', onClose: innerClose }),
    ]));
    await nextTick();
    innerOpen.value = true;
    await nextTick();

    pressKey('Escape');
    expect(innerClose).not.toHaveBeenCalled();
    expect(outerClose).not.toHaveBeenCalled();
  });

  it('Modal 之上的 AlertDialog 只被关闭一次，下面的 Modal 不受影响', async () => {
    const modalClose = vi.fn();
    const alertClose = vi.fn();
    const alertCancel = vi.fn();
    const alertVisible = ref(false);
    mount(() => h('div', [
      h(Modal, { isVisible: true, title: '模型详情', onClose: modalClose }),
      h(AlertDialog, {
        visible: alertVisible.value,
        title: '确认删除',
        isConfirmation: true,
        onClose: alertClose,
        onCancel: alertCancel,
      }),
    ]));
    await nextTick();
    alertVisible.value = true;
    await nextTick();

    pressKey('Escape');
    expect(alertCancel).toHaveBeenCalledTimes(1);
    expect(alertClose).not.toHaveBeenCalled();
    expect(modalClose).not.toHaveBeenCalled();
  });

  it('提醒类 AlertDialog 初始可见时 Escape 也只关闭一次', async () => {
    const alertClose = vi.fn();
    mount(() => h(AlertDialog, { visible: true, title: '提示', onClose: alertClose }));
    await nextTick();

    pressKey('Escape');
    expect(alertClose).toHaveBeenCalledTimes(1);
  });

  it('图片预览叠在 Modal 之上时先关预览', async () => {
    const modalClose = vi.fn();
    const previewClose = vi.fn();
    const previewVisible = ref(false);
    mount(() => h('div', [
      h(Modal, { isVisible: true, title: '文档', onClose: modalClose }),
      h(ImagePreviewModal, {
        isVisible: previewVisible.value,
        src: 'blob:preview',
        alt: '预览',
        onClose: previewClose,
      }),
    ]));
    await nextTick();
    previewVisible.value = true;
    await nextTick();

    pressKey('Escape');
    expect(previewClose).toHaveBeenCalledTimes(1);
    expect(modalClose).not.toHaveBeenCalled();
  });
});

describe('BaseDropdown 在浮层栈里', () => {
  it('开在弹窗里时，第一次 Escape 只关下拉，第二次才关弹窗', async () => {
    const modalClose = vi.fn();
    mount(() => h(Modal, { isVisible: true, title: '导出', onClose: modalClose }, {
      default: () => h(BaseDropdown, null, {
        trigger: ({ toggle, isOpen }: { readonly toggle: (event?: Event) => void; readonly isOpen: boolean }) => h('button', {
          id: 'dropdown-trigger',
          'aria-expanded': String(isOpen),
          onClick: toggle,
        }, '格式'),
        content: ({ isOpen }: { readonly isOpen: boolean }) => (isOpen ? h('div', { id: 'dropdown-panel' }, '选项') : null),
      }),
    }));
    await nextTick();
    element('#dropdown-trigger').click();
    await nextTick();
    expect(document.querySelector('#dropdown-panel')).not.toBeNull();

    pressKey('Escape');
    await nextTick();
    expect(document.querySelector('#dropdown-panel')).toBeNull();
    expect(modalClose).not.toHaveBeenCalled();

    pressKey('Escape');
    expect(modalClose).toHaveBeenCalledTimes(1);
  });
});

describe('遮罩点击只给最上面一层', () => {
  it('弹窗里开着下拉时，第一次点遮罩只关下拉，第二次才关弹窗', async () => {
    const modalClose = vi.fn();
    mount(() => h(Modal, { isVisible: true, title: '设置', onClose: modalClose }, {
      default: () => h(CustomSelect, {
        modelValue: 'zh',
        options: [{ value: 'zh', text: '简体中文' }, { value: 'en', text: 'English' }],
      }),
    }));
    await nextTick();
    element('.select-trigger').click();
    await nextTick();
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    clickAt(element('.modal-overlay'));
    await nextTick();
    expect(document.querySelector('.custom-select .select-trigger')?.getAttribute('aria-expanded')).toBe('false');
    expect(modalClose).not.toHaveBeenCalled();

    clickAt(element('.modal-overlay'));
    expect(modalClose).toHaveBeenCalledTimes(1);
  });

  it('按下就关闭的日期面板同样只关面板，不连带关闭弹窗', async () => {
    const modalClose = vi.fn();
    mount(() => h(Modal, { isVisible: true, title: '筛选', onClose: modalClose }, {
      default: () => h(SimpleDatePicker, { modelValue: null }),
    }));
    await nextTick();
    element('.sdp-input').click();
    await nextTick();
    expect(document.querySelector('.sdp-panel')).not.toBeNull();

    clickAt(element('.modal-overlay'));
    await nextTick();
    expect(modalClose).not.toHaveBeenCalled();

    clickAt(element('.modal-overlay'));
    expect(modalClose).toHaveBeenCalledTimes(1);
  });

  it('在弹窗里按下、拖到遮罩上松开不算点遮罩', async () => {
    const modalClose = vi.fn();
    mount(() => h(Modal, { isVisible: true, title: '编辑', onClose: modalClose }, {
      default: () => h('textarea', { id: 'draft' }),
    }));
    await nextTick();

    clickAt(element('.modal-overlay'), element('#draft'));
    expect(modalClose).not.toHaveBeenCalled();
  });

  it('图片预览只在点到图片以外时关闭', async () => {
    const previewClose = vi.fn();
    mount(() => h(ImagePreviewModal, { isVisible: true, src: 'blob:preview', alt: '预览', onClose: previewClose }));
    await nextTick();

    clickAt(element('.image-preview-modal img'));
    expect(previewClose).not.toHaveBeenCalled();
    clickAt(element('.image-preview-modal'));
    expect(previewClose).toHaveBeenCalledTimes(1);
  });
});
