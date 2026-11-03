// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { expect, it, vi } from 'vitest';
import { useLocalizationStore } from '@/app/localization';
import DocumentBacklinksPanel from '../ui/DocumentBacklinksPanel.vue';
const port = vi.hoisted(() => ({ list: vi.fn(), open: vi.fn(), subscribe: vi.fn(() => () => {}) }));
vi.mock('../adapters/createBacklinksPanelPort', () => ({ createBacklinksPanelPort: () => port }));
it('shows grouped sources with type icons, opens a source and supports the shared language setting', async () => {
  port.list.mockResolvedValue({
    referenceCount: 2,
    documentCount: 1,
    documents: [
      { sourceDocumentId: 'source', title: 'Source', nodeType: 'slides', referenceCount: 2 },
    ],
    nextOffset: null,
  });
  const host = document.createElement('div');
  document.body.append(host);
  const pinia = createPinia();
  const icon = () => h('svg', { 'data-type-icon': 'slides' });
  const app = createApp({
    render: () =>
      h(DocumentBacklinksPanel, {
        projectId: 'project',
        documentId: 'target',
        readIcon: () => icon,
      }),
  }).use(pinia);
  try {
    app.mount(host);
    await vi.waitFor(() =>
      expect(document.querySelector('.document-backlinks-list button')?.textContent).toContain(
        'Source'
      )
    );
    expect(document.querySelector('[data-type-icon=slides]')).not.toBeNull();
    expect(document.body.textContent).toContain('1 个文档中的 2 处引用');
    document.querySelector<HTMLButtonElement>('.document-backlinks-list button')?.click();
    expect(port.open).toHaveBeenCalledWith(expect.objectContaining({ sourceDocumentId: 'source' }));
    useLocalizationStore(pinia).setCurrentLocale('en-US');
    await nextTick();
    expect(document.body.textContent).toContain('Referenced by');
    expect(document.body.textContent).toContain('2 references');
  } finally {
    app.unmount();
    host.remove();
  }
});
