// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { AlertDialog, ImagePreviewModal, Modal, useEscapeLayer } from '@linnya/renderer-ui';
import { getEscapeLayerRegistry } from '../src/features/overlays/registry/escapeLayerRegistry';

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

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
  vi.restoreAllMocks();
});

describe('Escape 注册表', () => {
  it('只把 Escape 交给最后登记的层，退出后再交给上一层', () => {
    const registry = getEscapeLayerRegistry(document);
    const calls: string[] = [];
    const unregisterLower = registry.register({ onEscape: () => calls.push('lower') });
    const unregisterUpper = registry.register({ onEscape: () => calls.push('upper') });

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
    const registry = getEscapeLayerRegistry(document);
    const onEscape = vi.fn();
    const unregister = registry.register({ onEscape });

    pressKey('Enter');
    pressKey('a');
    expect(onEscape).not.toHaveBeenCalled();

    unregister();
  });

  it('整个 document 只装一个监听，最后一层退出后移除，重复退出无副作用', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const registry = getEscapeLayerRegistry(document);

    const unregisterFirst = registry.register({ onEscape: () => undefined });
    const unregisterSecond = registry.register({ onEscape: () => undefined });
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);

    unregisterFirst();
    unregisterFirst();
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);

    unregisterSecond();
    expect(remove.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
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
