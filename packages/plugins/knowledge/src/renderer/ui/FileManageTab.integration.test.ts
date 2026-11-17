// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, ref, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentStatus, type KnowledgeDocumentSummary } from '../../shared';
import FileManageTab from './FileManageTab.vue';

const fixture = reactive({ documents: [] as KnowledgeDocumentSummary[] });
vi.mock('../runtime.js', () => ({ useKnowledgeBase: () => ({
  get documents() { return fixture.documents; },
  getKnowledgeBaseById: (id: string) => ({ id, name: 'Recovery' }),
  fetchDocuments: vi.fn(),
}) }));
vi.mock('../orchestration/useKnowledgeIndexRebuild', () => ({ useKnowledgeIndexRebuild: () => ({
  modelId: ref('model'), modelName: ref('Embedding'), status: ref(null), error: ref(''), busy: ref(false),
  start: vi.fn(), cancel: vi.fn(),
}) }));
let app: App | undefined;
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; fixture.documents = []; });

it('失败资料按可读正文事实显示恢复方向；无正文整库不能发起重建', async () => {
  fixture.documents = [
    { id: 'saved', kbId: 'kb', filename: 'saved.md', fileSize: 42, createdAt: 1, status: DocumentStatus.FAILED, errorMessage: 'Embedding denied', hasSource: true },
    { id: 'pdf', kbId: 'kb', filename: 'source.pdf', fileSize: 42, createdAt: 1, status: DocumentStatus.FAILED, errorMessage: 'OCR failed', hasSource: false },
  ];
  const container = document.createElement('div'); document.body.append(container);
  app = createApp({ render: () => h(FileManageTab, { selectedKbId: 'kb' }) });
  app.use(createPinia()); app.mount(container); await nextTick();
  const rows = container.querySelectorAll('.file-item');
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toContain('Embedding denied');
  expect(rows[0]?.textContent).toContain('正文已保存');
  expect(rows[0]?.textContent).toContain('查看已保存内容');
  expect(rows[1]?.textContent).toContain('尚无可读正文');
  expect(rows[1]?.textContent).not.toContain('查看已保存内容');
  const rebuild = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('重建检索索引'));
  if (!rebuild) throw new Error('Rebuild action missing');
  expect(rebuild.disabled).toBe(false);
  fixture.documents = fixture.documents.filter(document => !document.hasSource); await nextTick();
  expect(rebuild.disabled).toBe(true);
  expect(rebuild.dataset.linnyaTooltip).toContain('暂无可用于重建的已保存正文');
});
