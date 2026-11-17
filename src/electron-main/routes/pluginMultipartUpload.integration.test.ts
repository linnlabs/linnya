import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, request } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPluginMultipartUploadRouter } from './pluginMultipartUpload';
import { readBackendPluginUploadContext, registerBackendPluginIpcHandler, invokeBackendPluginIpcHandler,
  clearBackendPluginIpcHandlersForTest } from '../../plugin-sdk/backend/pluginIpcRuntime';

const state = vi.hoisted(() => ({ directory: '', enabled: true }));
vi.mock('../../shared/utils/pathManager', () => ({ pathManager: { getUploadsPath: () => state.directory } }));
vi.mock('../../app-hosts/linnya/plugin-registry/builtin', () => ({
  getRegisteredBackendPluginUploadChannel: (id: string) => state.enabled && id === 'fixture' ? 'upload' : undefined,
}));
vi.mock('../../shared/logger', () => ({ Logger: class { warn() {} error() {} } }));

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  clearBackendPluginIpcHandlersForTest();
  state.enabled = true;
});
async function server() {
  state.directory = await mkdtemp(path.join(os.tmpdir(), 'plugin-upload-'));
  cleanups.push(() => rm(state.directory, { recursive: true, force: true }));
  const app = express();
  app.use('/api/v1/plugins', createPluginMultipartUploadRouter());
  const listener = createServer(app);
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve())));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('missing test listener');
  return `http://127.0.0.1:${address.port}/api/v1/plugins/fixture/documents/upload`;
}

describe('plugin multipart upload ownership', () => {
  it('真实上传在文件之后收齐字段，交接给任务后保留文件；普通IPC不能伪造路径', async () => {
    const url = await server();
    let acceptedPath = '';
    registerBackendPluginIpcHandler('fixture', 'upload', async (event, payload) => {
      const upload = readBackendPluginUploadContext(event);
      if (!upload) throw new Error('No upload admission');
      expect(payload).toEqual({ kbId: 'kb', embedding_model_id: 'model-after-file' });
      expect(upload.file.name).toBe('原文.md');
      expect(await readFile(upload.file.path, 'utf8')).toBe('retained source');
      acceptedPath = upload.file.path;
      upload.acceptFile();
      return { success: true, data: { queued: true } };
    });
    await expect(invokeBackendPluginIpcHandler('fixture', 'upload', { file: { path: '/unrelated' }, signal: new AbortController().signal }, {})).rejects.toThrow('No upload admission');
    const form = new FormData();
    form.append('kbId', 'kb');
    form.append('file', new Blob(['retained source']), '原文.md');
    form.append('embedding_model_id', 'model-after-file');
    const response = await fetch(url, { method: 'POST', body: form });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ queued: true });
    expect(await readFile(acceptedPath, 'utf8')).toBe('retained source');
  });

  it('业务拒绝删除未接纳文件，无文件表单结束时明确返回错误，不悬挂', async () => {
    const url = await server();
    registerBackendPluginIpcHandler('fixture', 'upload', () => { throw new Error('model is not configured'); });
    const form = new FormData();
    form.append('file', new Blob(['source']), 'source.md');
    const rejected = await fetch(url, { method: 'POST', body: form });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'model is not configured' });
    // 响应先发送、finally 紧随其后；等待一次事件循环让清理 Promise 结算。
    await vi.waitFor(async () => expect(await readdir(path.join(state.directory, 'temp'))).toEqual([]));
    const noFile = new FormData();
    noFile.append('kbId', 'kb');
    const missing = await fetch(url, { method: 'POST', body: noFile });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: '未找到上传的文件' });
  });

  it('超限和多文件都拒绝且清理未接纳文件，不执行插件处理', async () => {
    const url = await server();
    const handler = vi.fn();
    registerBackendPluginIpcHandler('fixture', 'upload', handler);
    for (const files of [[new Blob([new Uint8Array(50 * 1024 * 1024 + 1)])], [new Blob(['one']), new Blob(['two'])]]) {
      const form = new FormData();
      for (const file of files) form.append('file', file, 'source.md');
      const result = await fetch(url, { method: 'POST', body: form });
      expect(result.status).toBe(400);
      expect((await result.json()).error).toMatch(/50 MiB|一个文件/);
      await vi.waitFor(async () => expect(await readdir(path.join(state.directory, 'temp'))).toEqual([]));
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(['disconnect', 'disable'] as const)('上传中途 %s 时不接纳文件并删除暂存', async mode => {
    const url = await server();
    const handler = vi.fn();
    registerBackendPluginIpcHandler('fixture', 'upload', handler);
    const boundary = 'fixture-boundary';
    const body = request(url, { method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    const response = new Promise<number | undefined>((resolve, reject) => {
      body.on('response', result => { result.resume(); result.on('end', () => resolve(result.statusCode)); });
      body.on('error', error => mode === 'disconnect' ? resolve(undefined) : reject(error));
    });
    body.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.md"\r\nContent-Type: text/plain\r\n\r\n`);
    body.write('partial bytes');
    await vi.waitFor(async () => expect(await readdir(path.join(state.directory, 'temp'))).toHaveLength(1));
    if (mode === 'disconnect') body.destroy();
    else { state.enabled = false; body.end(`\r\n--${boundary}--\r\n`); }
    expect(await response).toBe(mode === 'disconnect' ? undefined : 400);
    await vi.waitFor(async () => expect(await readdir(path.join(state.directory, 'temp'))).toEqual([]));
    expect(handler).not.toHaveBeenCalled();
  });

  it('停用的插件在读文件前拒绝上传', async () => {
    const url = await server();
    state.enabled = false;
    const handler = vi.fn();
    registerBackendPluginIpcHandler('fixture', 'upload', handler);
    const form = new FormData();
    form.append('file', new Blob(['source']), 'source.md');
    expect((await fetch(url, { method: 'POST', body: form })).status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
    expect(await readdir(state.directory)).toEqual([]);
  });
});
