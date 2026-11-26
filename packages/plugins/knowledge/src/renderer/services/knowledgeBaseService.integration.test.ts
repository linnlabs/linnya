// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { changeLocale } from '@app/localization';
import { ensureKnowledgeBaseLocalizationRegistered } from '../orchestration/ensureKnowledgeBaseLocalizationRegistered';
import { knowledgeBaseService } from './knowledgeBaseService';
import { startKnowledgeRequestSession, stopKnowledgeRequestSession } from './knowledgeRequestSession';

const invoke = vi.fn<(id: string, channel: string, payload: unknown) => Promise<unknown>>();
beforeEach(() => {
  setActivePinia(createPinia());
  ensureKnowledgeBaseLocalizationRegistered();
  invoke.mockReset();
  vi.stubGlobal('window', { electronAPI: { 'plugin:invoke': invoke } });
  startKnowledgeRequestSession();
});
afterEach(() => { stopKnowledgeRequestSession(); vi.unstubAllGlobals(); });

it('按正式插件IPC读取失败文档与可读原文，拒绝结构错误且保留后端业务错误', async () => {
  invoke.mockResolvedValueOnce({ success: true, data: [{
    id: 'doc', kbId: 'kb', filename: 'source.md', status: 'failed', createdAt: 10,
    fileSize: 9, errorMessage: 'index failed', hasSource: true,
  }] });
  const docs = await knowledgeBaseService.getDocuments('kb');
  expect(invoke).toHaveBeenLastCalledWith('knowledge', 'list-documents', { kbId: 'kb' });
  expect(docs.documents[0]).toMatchObject({ status: 'failed', hasSource: true, errorMessage: 'index failed' });
  invoke.mockResolvedValueOnce({ success: true, data: { documentId: 'doc', fileName: 'source.md', markdown: '# Preserved' } });
  await expect(knowledgeBaseService.readSavedContent('kb', 'doc', new AbortController().signal)).resolves.toMatchObject({ markdown: '# Preserved' });
  invoke.mockResolvedValueOnce({ success: true, data: 'invalid' });
  await expect(knowledgeBaseService.getDocuments('kb')).rejects.toThrow();
  invoke.mockResolvedValueOnce({ success: false, error: '请检查模型密钥' });
  await expect(knowledgeBaseService.rebuildIndex('kb', 'm')).rejects.toThrow('请检查模型密钥');
});

it('页面关闭和插件停用都结束等待；旧响应不能跨越重新启用', async () => {
  let resolve: (value: unknown) => void = () => {};
  invoke.mockImplementation(() => new Promise(accept => { resolve = accept; }));
  const controller = new AbortController();
  const reading = knowledgeBaseService.readSavedContent('kb', 'doc', controller.signal);
  controller.abort();
  await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  const old = knowledgeBaseService.getAllKnowledgeBases();
  stopKnowledgeRequestSession();
  await expect(old).rejects.toMatchObject({ name: 'AbortError' });
  startKnowledgeRequestSession();
  resolve({ success: true, data: [] });
  invoke.mockResolvedValue({ success: true, data: [] });
  await expect(knowledgeBaseService.getAllKnowledgeBases()).resolves.toMatchObject({ knowledge_bases: [] });
});

it('新索引 job 状态解码后仍通过既有取消 wire 提交同一身份', async () => {
  const job = { jobId: 'rebuild-1', kbId: 'kb', modelId: 'model', status: 'running', progress: 20, message: 'building', updatedAt: 1 };
  invoke.mockResolvedValueOnce({ success: true, data: job });
  const started = await knowledgeBaseService.rebuildIndex('kb', 'model');
  invoke.mockResolvedValueOnce({ success: true, data: job });
  const current = await knowledgeBaseService.getIndexRebuildStatus('kb');
  expect(current?.jobId).toBe(started.jobId);
  invoke.mockResolvedValueOnce({ success: true, data: { cancelled: true } });
  await knowledgeBaseService.cancelTask(started.jobId);
  expect(invoke).toHaveBeenLastCalledWith('knowledge', 'cancel-task', { taskId: 'rebuild-1' });
});

it('检索遇到向量服务启动失败：按当前语言显示原因，不显示后端中文原文', async () => {
  const failure = {
    success: false, error: '知识库数据目录的路径太长，后端诊断原文',
    userMessage: { key: 'knowledgeBase.runtime.error.vectorDataDirectoryTooLong' },
  };
  invoke.mockResolvedValue(failure);

  changeLocale('en-US');
  const english = await knowledgeBaseService.searchInKnowledgeBase('kb', { query: 'q', embeddingModelId: 'e', rerankModelId: 'r' })
    .catch((error: unknown) => error);
  expect(english).toBeInstanceOf(Error);
  expect(english).toHaveProperty('message', expect.stringMatching(/^The Knowledge Base data folder path is too long .*LINNYA_WORKSPACE_DIR.*restart Linnya\.$/u));
  expect(english).not.toHaveProperty('message', expect.stringMatching(/后端诊断原文/u));

  changeLocale('zh-CN');
  const chinese = await knowledgeBaseService.searchInKnowledgeBase('kb', { query: 'q', embeddingModelId: 'e', rerankModelId: 'r' })
    .catch((error: unknown) => error);
  expect(chinese).toHaveProperty('message', expect.stringMatching(/^知识库数据目录的路径太长.*LINNYA_WORKSPACE_DIR.*重启 Linnya。$/u));
  expect(chinese).not.toHaveProperty('message', expect.stringMatching(/后端诊断原文/u));
});

it('检索遇到嵌入模型失败：按原因和当前语言显示该怎么修，不显示后端原文，也不当成没有结果', async () => {
  const cases = [
    { key: 'knowledgeBase.search.error.embeddingModelUnavailable', en: /^Search failed: the embedding model .* is unavailable .*Settings › Models/u, zh: /^检索失败：知识库使用的嵌入模型不可用.*设置 › 模型/u },
    { key: 'knowledgeBase.search.error.embeddingCredential', en: /^Search failed: the embedding model has no API key.*Settings › Models\.$/u, zh: /^检索失败：嵌入模型缺少 API Key.*设置 › 模型/u },
    { key: 'knowledgeBase.search.error.embeddingRequestFailed', en: /^Search failed: the request to the embedding model did not succeed.*Try again later/u, zh: /^检索失败：调用嵌入模型没有成功.*请稍后重试/u },
  ] as const;
  for (const { key, en, zh } of cases) {
    invoke.mockResolvedValue({ success: false, error: '检索时嵌入模型调用失败：后端诊断原文', userMessage: { key } });
    changeLocale('en-US');
    const english = await knowledgeBaseService.searchInKnowledgeBase('kb', { query: 'q', embeddingModelId: 'e', rerankModelId: 'r' })
      .catch((error: unknown) => error);
    expect(english).toBeInstanceOf(Error);
    expect(english).toHaveProperty('message', expect.stringMatching(en));
    expect(english).not.toHaveProperty('message', expect.stringMatching(/后端诊断原文/u));

    changeLocale('zh-CN');
    const chinese = await knowledgeBaseService.searchInKnowledgeBase('kb', { query: 'q', embeddingModelId: 'e', rerankModelId: 'r' })
      .catch((error: unknown) => error);
    expect(chinese).toHaveProperty('message', expect.stringMatching(zh));
    expect(chinese).not.toHaveProperty('message', expect.stringMatching(/后端诊断原文/u));
  }
});
