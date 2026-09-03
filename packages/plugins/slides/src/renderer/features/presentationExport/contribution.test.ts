import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { slidesDocumentActionMenu } from './contribution';
import { usePresentationExportStore } from './store/presentationExportStore';
import { useSlidesStore } from '../../store/slidesStore';

describe('slidesDocumentActionMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useSlidesStore().currentDeckId = 'deck-1';
  });

  it('只开放 PPTX 与图片导出，PDF 在语义导出方案验收前保持关闭', () => {
    expect(slidesDocumentActionMenu.getOptions()).toEqual([
      { value: 'export-pptx', text: '导出为 PPTX' },
      { value: 'export-images', text: '导出为图片' },
    ]);

    const exportStore = usePresentationExportStore();
    slidesDocumentActionMenu.select('export-pptx');
    expect(exportStore.activeDialog).toBe('pptx');
    slidesDocumentActionMenu.select('export-images');
    expect(exportStore.activeDialog).toBe('images');
    exportStore.close();
    slidesDocumentActionMenu.select('export-pdf');
    expect(exportStore.activeDialog).toBeNull();
  });
});
