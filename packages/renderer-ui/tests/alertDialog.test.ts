// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import {
  AlertDialog,
  Modal,
  resolveAlertDialogDangerousAction,
} from '@linnya/renderer-ui';

const mountedApps: Array<{ readonly app: App; readonly host: HTMLDivElement }> = [];

function mount(render: () => ReturnType<typeof h>): void {
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp({ render });
  app.mount(host);
  mountedApps.push({ app, host });
}

afterEach(() => {
  while (mountedApps.length > 0) {
    const mounted = mountedApps.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('AlertDialog', () => {
  it('业务 Modal 触发确认框时使用既有 alert 上层语义', async () => {
    mount(() => h('div', [
      h(Modal, { isVisible: true, title: '模型详情' }),
      h(AlertDialog, {
        visible: true,
        title: '确认删除',
        message: '确定删除模型吗？',
        isConfirmation: true,
      }),
    ]));
    await nextTick();

    const overlays = Array.from(document.body.querySelectorAll<HTMLElement>('.modal-overlay'));
    const modelOverlay = overlays.find(overlay => overlay.textContent?.includes('模型详情'));
    const alertOverlay = overlays.find(overlay => overlay.textContent?.includes('确认删除'));
    expect(modelOverlay?.classList.contains('modal-overlay--alert')).toBe(false);
    expect(alertOverlay?.classList.contains('modal-overlay--alert')).toBe(true);
  });

  it('长确认内容由文案区滚动，确认操作位于固定 footer', async () => {
    let confirmCount = 0;
    mount(() => h(AlertDialog, {
      visible: true,
      title: '批量删除',
      message: '请检查以下内容',
      sections: [{
        title: '将被删除的项目',
        items: Array.from({ length: 40 }, (_, index) => `项目 ${index + 1}`),
      }],
      isConfirmation: true,
      onConfirm: () => { confirmCount += 1; },
    }));
    await nextTick();

    const content = document.body.querySelector<HTMLElement>('.modal-content');
    const copy = document.body.querySelector<HTMLElement>('.alert-dialog-copy');
    const footerButtons = Array.from(document.body.querySelectorAll<HTMLButtonElement>(
      '.modal-footer button'
    ));
    const confirmButton = footerButtons[footerButtons.length - 1];
    expect(content?.classList.contains('modal-content--internal')).toBe(true);
    expect(copy?.querySelectorAll('li')).toHaveLength(40);
    expect(content?.contains(confirmButton ?? null)).toBe(false);

    confirmButton?.click();
    expect(confirmCount).toBe(1);
  });

  it('确认框关闭按 closeIsCancel 投影为 cancel，普通提醒确认投影为 close', async () => {
    let cancelCount = 0;
    let closeCount = 0;
    mount(() => h('div', [
      h(AlertDialog, {
        visible: true,
        title: '确认操作',
        isConfirmation: true,
        onCancel: () => { cancelCount += 1; },
      }),
      h(AlertDialog, {
        visible: true,
        title: '提示',
        onClose: () => { closeCount += 1; },
      }),
    ]));
    await nextTick();

    const overlays = Array.from(document.body.querySelectorAll<HTMLElement>('.modal-overlay'));
    overlays.find(overlay => overlay.textContent?.includes('确认操作'))
      ?.querySelector<HTMLButtonElement>('.modal-close')
      ?.click();
    overlays.find(overlay => overlay.textContent?.includes('提示'))
      ?.querySelector<HTMLButtonElement>('.action-btn.primary')
      ?.click();
    expect(cancelCount).toBe(1);
    expect(closeCount).toBe(1);
  });
});

describe('resolveAlertDialogDangerousAction', () => {
  it('保持显式声明与既有中英文危险文案推断', () => {
    expect(resolveAlertDialogDangerousAction({
      confirmText: '继续',
      title: '普通操作',
      isDangerousAction: true,
    })).toBe(true);
    expect(resolveAlertDialogDangerousAction({
      confirmText: 'Remove',
      title: 'Project',
      isDangerousAction: false,
    })).toBe(true);
    expect(resolveAlertDialogDangerousAction({
      confirmText: '继续',
      title: '普通操作',
      isDangerousAction: false,
    })).toBe(false);
  });
});
