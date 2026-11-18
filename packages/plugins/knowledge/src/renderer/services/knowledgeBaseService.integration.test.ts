// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { knowledgeBaseService } from './knowledgeBaseService';
import { startKnowledgeRequestSession, stopKnowledgeRequestSession } from './knowledgeRequestSession';

const invoke = vi.fn<(id: string, channel: string, payload: unknown) => Promise<unknown>>();
beforeEach(() => {
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
