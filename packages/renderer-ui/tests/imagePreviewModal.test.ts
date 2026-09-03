// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { ImagePreviewModal } from '@linnya/renderer-ui';

interface MountedImagePreviewModal {
  readonly app: App;
  readonly host: HTMLDivElement;
  readonly closeCount: { value: number };
  readonly setVisible: (visible: boolean) => Promise<void>;
}

const mountedModals: MountedImagePreviewModal[] = [];

function mountImagePreviewModal(): MountedImagePreviewModal {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const visible = ref(true);
  const closeCount = ref(0);
  const app = createApp({
    render: () => h(ImagePreviewModal, {
      isVisible: visible.value,
      src: 'blob:test-image',
      alt: '测试图片',
      classNames: {
        overlay: 'image-preview-contract-overlay',
        image: 'image-preview-contract-image',
      },
      onClose: () => { closeCount.value += 1; },
    }),
  });
  app.mount(host);

  return {
    app,
    host,
    closeCount,
    setVisible: async (nextVisible: boolean) => {
      visible.value = nextVisible;
      await nextTick();
    },
  };
}

afterEach(() => {
  while (mountedModals.length > 0) {
    const mounted = mountedModals.pop();
    mounted?.app.unmount();
    mounted?.host.remove();
  }
});

describe('ImagePreviewModal', () => {
  it('只允许点击遮罩关闭，点击图片不关闭，并透传公开 classNames', async () => {
    const mounted = mountImagePreviewModal();
    mountedModals.push(mounted);
    await nextTick();

    const image = document.body.querySelector('.image-preview-modal img');
    const overlay = document.body.querySelector('.image-preview-modal');
    if (!(image instanceof HTMLImageElement) || !(overlay instanceof HTMLElement)) {
      throw new Error('Image preview modal not found');
    }
    expect(overlay.classList).toContain('image-preview-contract-overlay');
    expect(image.classList).toContain('image-preview-contract-image');

    image.click();
    expect(mounted.closeCount.value).toBe(0);
    overlay.click();
    expect(mounted.closeCount.value).toBe(1);
  });

  it('仅在显示时响应 Escape', async () => {
    const mounted = mountImagePreviewModal();
    mountedModals.push(mounted);
    await nextTick();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(mounted.closeCount.value).toBe(1);

    await mounted.setVisible(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(mounted.closeCount.value).toBe(1);
  });
});
