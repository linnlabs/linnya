// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue';
import { AlertDialog, ImagePreviewModal, Modal, useModalFocus } from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLElement }> = [];

function mount(render: () => ReturnType<typeof h>): void {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render });
  app.mount(host);
  mountedApps.push({ app, host });
}

function element(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

function press(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

async function settle(): Promise<void> {
  await nextTick();
  await nextTick();
}

/** 页面上有一个打开弹窗的按钮；弹窗里两个按钮，外加标题栏的关闭。 */
function mountPage(visible: Ref<boolean>, props: Record<string, unknown> = {}): void {
  mount(() => h('div', [
    h('button', { id: 'trigger', onClick: () => { visible.value = true; } }, '打开'),
    h('button', { id: 'other' }, '页面上的其他按钮'),
    h(Modal, { isVisible: visible.value, title: '标题', onClose: () => { visible.value = false; }, ...props }, {
      default: () => h('button', { id: 'inside' }, '里面'),
      footer: () => h('button', { id: 'save' }, '保存'),
    }),
  ]));
}

beforeEach(() => document.body.replaceChildren());

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('弹窗的键盘焦点', () => {
  it('对读屏写明是弹窗，名称取标题；确认框是 alertdialog', async () => {
    mount(() => h('div', [
      h(Modal, { isVisible: true, title: '模型详情' }),
      h(AlertDialog, { visible: true, title: '确认删除', message: '确定吗？', isConfirmation: true }),
    ]));
    await settle();
    const dialog = element('[role="dialog"]');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('模型详情');
    const alert = element('[role="alertdialog"]');
    expect(document.getElementById(alert.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('确认删除');
  });

  it('打开时焦点进入弹窗，关闭后回到触发处', async () => {
    const visible = ref(false);
    mountPage(visible);
    element('#trigger').focus();
    element('#trigger').click();
    await settle();
    expect(document.activeElement).toBe(element('.modal-container'));

    element('#save').focus();
    visible.value = false;
    await settle();
    expect(document.activeElement).toBe(element('#trigger'));
  });

  it('挂载时就是打开的弹窗，焦点同样进入并归还', async () => {
    const shown = ref(false);
    mount(() => h('div', [
      h('button', { id: 'trigger' }, '打开'),
      shown.value ? h(Modal, { isVisible: true, title: '标题' }) : null,
    ]));
    element('#trigger').focus();
    shown.value = true;
    await settle();
    expect(document.activeElement).toBe(element('[role="dialog"]'));

    shown.value = false;
    await settle();
    expect(document.activeElement).toBe(element('#trigger'));
  });

  it('调用方已经把焦点放到输入框时不再移动', async () => {
    const visible = ref(true);
    mount(() => h(Modal, { isVisible: visible.value }, {
      default: () => h('input', { id: 'name', onVnodeMounted: () => element('#name').focus() }),
    }));
    await settle();
    expect(document.activeElement).toBe(element('#name'));
  });

  it('Tab 在弹窗里循环，首尾相接', async () => {
    const visible = ref(true);
    mountPage(visible);
    await settle();
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element('#save'));
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element('.modal-close'));
    expect(press('Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element('#save'));
    element('#inside').focus();
    expect(press('Tab').defaultPrevented).toBe(false);
  });

  it('禁用和移出 Tab 顺序的控件不参与循环；没有控件时停在弹窗上', async () => {
    mount(() => h(Modal, { isVisible: true }, {
      footer: () => [h('button', { id: 'a' }, '可用'), h('button', { disabled: true }, '禁用'), h('button', { tabindex: -1 }, '跳过')],
    }));
    await settle();
    element('#a').focus();
    expect(press('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element('.modal-close'));
  });

  it('点遮罩丢了焦点，再按 Tab 回到弹窗里', async () => {
    const visible = ref(true);
    mountPage(visible);
    await settle();
    element('.modal-container').blur();
    expect(document.activeElement).toBe(document.body);
    press('Tab');
    expect(document.activeElement).toBe(element('.modal-close'));
    element('.modal-close').blur();
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(element('#save'));
  });

  it('别处把焦点带到被盖住的页面时拉回来，关闭后还给它', async () => {
    const visible = ref(true);
    mountPage(visible);
    await settle();
    element('#other').focus();
    expect(document.activeElement).toBe(element('.modal-container'));
    visible.value = false;
    await settle();
    expect(document.activeElement).toBe(element('#other'));
  });

  it('弹窗里打开的面板挂在 body 上，焦点留在面板里', async () => {
    const visible = ref(true);
    mountPage(visible);
    await settle();
    const panel = document.createElement('div');
    panel.innerHTML = '<button id="option">选项</button>';
    document.body.append(panel);
    element('#option').focus();
    expect(document.activeElement).toBe(element('#option'));
    expect(press('Tab').defaultPrevented).toBe(false);
    panel.remove();
  });

  it('两层弹窗逐层归还；下层不和上层抢焦点', async () => {
    const lower = ref(true);
    const upper = ref(false);
    mount(() => h('div', [
      h(Modal, { isVisible: lower.value, title: '下层' }, { default: () => h('button', { id: 'lower' }, '删除') }),
      h(AlertDialog, { visible: upper.value, isConfirmation: true, onCancel: () => { upper.value = false; } }),
    ]));
    await settle();
    element('#lower').focus();
    upper.value = true;
    await settle();
    const alert = element('[role="alertdialog"]');
    expect(document.activeElement).toBe(alert);
    element('#lower').focus();
    expect(document.activeElement).toBe(alert);
    upper.value = false;
    await settle();
    expect(document.activeElement).toBe(element('#lower'));
  });

  it('关闭时业务已经移动了焦点，就不再抢回触发处', async () => {
    const visible = ref(false);
    mountPage(visible);
    element('#trigger').focus();
    visible.value = true;
    await settle();
    element('.modal-container').blur();
    mount(() => h('input', { id: 'later' }));
    visible.value = false;
    element('#later').focus();
    await settle();
    expect(document.activeElement).toBe(element('#later'));
  });

  it('确认框里焦点在“取消”上时按 Enter 是取消；焦点在框上时仍是确认', async () => {
    const calls: string[] = [];
    const visible = ref(false);
    mount(() => h(AlertDialog, {
      visible: visible.value,
      isConfirmation: true,
      onConfirm: () => calls.push('confirm'),
      onCancel: () => calls.push('cancel'),
    }));
    visible.value = true;
    await settle();
    const cancel = element('.modal-footer button');
    cancel.focus();
    expect(press('Enter').defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
    element('[role="alertdialog"]').focus();
    press('Enter');
    expect(calls).toEqual(['confirm']);
  });

  it('图片预览与自有浮层用同一套归还', async () => {
    const preview = ref(false);
    const own = ref(false);
    const OwnLayer = defineComponent(() => {
      const containerRef = ref<HTMLElement | null>(null);
      useModalFocus({ active: own, containerRef });
      return () => (own.value ? h('div', { ref: containerRef, id: 'own', tabindex: -1 }) : null);
    });
    mount(() => h('div', [
      h('button', { id: 'thumb' }, '缩略图'),
      h(ImagePreviewModal, { isVisible: preview.value, src: 'a.png', alt: '图' }),
      h(OwnLayer),
    ]));
    element('#thumb').focus();
    preview.value = true;
    await settle();
    expect(document.activeElement).toBe(element('.image-preview-modal'));
    preview.value = false;
    await settle();
    expect(document.activeElement).toBe(element('#thumb'));
    own.value = true;
    await settle();
    expect(document.activeElement).toBe(element('#own'));
    own.value = false;
    await settle();
    expect(document.activeElement).toBe(element('#thumb'));
  });
});
