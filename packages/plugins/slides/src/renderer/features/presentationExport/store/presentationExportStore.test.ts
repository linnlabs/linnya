import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { usePresentationExportStore } from './presentationExportStore';

describe('presentationExportStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('每次打开弹窗都恢复产品默认值：原生图表、1920 图片宽度', () => {
    const store = usePresentationExportStore();
    store.open('pptx');
    store.setChartMode('image');
    store.setImageWidth(3840);
    store.updateImageProgress(3, 8);

    store.open('images');

    expect(store.activeDialog).toBe('images');
    expect(store.chartMode).toBe('native');
    expect(store.imageWidthPx).toBe(1920);
    expect(store.completedImagePages).toBe(0);
    expect(store.totalImagePages).toBe(0);
  });
});
