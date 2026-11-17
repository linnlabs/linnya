import { installTestPresentation } from '../documentRuntime/testing/installTestPresentation';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { slidesDocumentActionMenu } from './contribution';
import { usePresentationExportStore } from './store/presentationExportStore';

const context = { projectId: 'project-1', documentId: 'deck-1', activeDocumentType: 'slides', displayName: 'Deck' };

describe('slidesDocumentActionMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    installTestPresentation({ documentId: 'deck-1' });
  });

  it('只开放 PPTX 与图片导出，PDF 在语义导出方案验收前保持关闭', () => {
    expect(slidesDocumentActionMenu.getOptions(context)).toEqual([
      { value: 'export-pptx', text: '导出为 PPTX' },
      { value: 'export-images', text: '导出为图片' },
    ]);

    const exportStore = usePresentationExportStore();
    slidesDocumentActionMenu.select('export-pptx', context);
    expect(exportStore.activeDialog).toBe('pptx');
    slidesDocumentActionMenu.select('export-images', context);
    expect(exportStore.activeDialog).toBe('images');
    exportStore.close();
    slidesDocumentActionMenu.select('export-pdf', context);
    expect(exportStore.activeDialog).toBeNull();
  });
});
