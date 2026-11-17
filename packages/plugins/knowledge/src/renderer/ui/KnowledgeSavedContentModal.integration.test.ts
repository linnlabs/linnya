// @vitest-environment jsdom
import { createApp, h, nextTick, shallowRef, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, expect, it, vi } from 'vitest';
import KnowledgeSavedContentModal from './KnowledgeSavedContentModal.vue';
const reader = vi.hoisted(() => ({ read: vi.fn(), create: vi.fn(), destroy: vi.fn() }));
vi.mock('../services/knowledgeBaseService', () => ({ knowledgeBaseService: { readSavedContent: reader.read } }));
vi.mock('@plugin/renderer/embeddedMarkdownEditor', () => ({
  parseEmbeddedMarkdown: (markdown: string) => ({ text: markdown }),
  createEmbeddedMarkdownEditor: reader.create,
}));
let app: App | undefined;
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; vi.clearAllMocks(); });

it('关闭/换目标会中止读取与销毁只读表面，读取失败明确呈现', async () => {
  const target = shallowRef<{ kbId: string; documentId: string; fileName: string } | null>({ kbId: 'kb', documentId: 'first', fileName: 'first.md' });
  let resolve: (value: unknown) => void = () => {};
  let signal: AbortSignal | undefined;
  reader.read.mockImplementation((_kb: string, _doc: string, requestSignal: AbortSignal) => {
    signal = requestSignal;
    return new Promise(accept => { resolve = accept; });
  });
  reader.create.mockReturnValue({ destroy: reader.destroy });
  const container = document.createElement('div'); document.body.append(container);
  app = createApp({ render: () => h(KnowledgeSavedContentModal, { target: target.value, onClose: () => { target.value = null; } }) });
  app.use(createPinia());
  app.mount(container); await nextTick();
  expect(document.querySelector('.modal-container')).not.toBeNull();
  target.value = null; await nextTick();
  expect(signal?.aborted).toBe(true);
  resolve({ documentId: 'first', fileName: 'first.md', markdown: '# Late' });
  await nextTick(); await nextTick();
  expect(reader.create).not.toHaveBeenCalled();
  reader.read.mockResolvedValueOnce({ documentId: 'second', fileName: 'second.md', markdown: '# Saved' });
  target.value = { kbId: 'kb', documentId: 'second', fileName: 'second.md' };
  for (let count = 0; count < 5; count++) await nextTick();
  expect(reader.create).toHaveBeenCalledWith(expect.objectContaining({ readonly: true, label: 'second.md', content: { text: '# Saved' } }));
  target.value = null; await nextTick();
  expect(reader.destroy).toHaveBeenCalledOnce();
  reader.read.mockRejectedValueOnce(new Error('file unreadable'));
  target.value = { kbId: 'kb', documentId: 'third', fileName: 'third.md' };
  for (let count = 0; count < 5; count++) await nextTick();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('无法读取');
});
