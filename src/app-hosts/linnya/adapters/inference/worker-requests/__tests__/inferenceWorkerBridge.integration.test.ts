import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import { WorkerThreadQueue } from 'src/infra/task-queue/WorkerThreadQueue';
import { createInferenceWorkerRequestHandler } from '../createInferenceWorkerRequestHandler';

function ports(): PluginInferencePort {
  return {
    embedding: { embed: vi.fn(async request => ({ vectors: request.values.map(() => [1, 2]), spaceId: 'space-one' })) },
    textGeneration: { generate: vi.fn(async () => ({ text: 'extracted', reasoning: '', finishReason: 'stop' as const })) },
    reranking: { rerank: vi.fn(async () => ({ ranking: [] })) },
    documentOcr: {
      resolveModelProfile: vi.fn(async modelId => ({ modelId, displayName: 'OCR', mode: 'document_upload' as const,
        supportsAbortSignal: true, attemptTimeoutMs: 5000 })),
      recognizeDocument: vi.fn(async request => {
        request.options?.onProgress?.({ state: 'running', processedPages: 0 });
        return { pages: [{ pageNumber: 1, markdown: 'source' }], totalPages: 1 };
      }),
    },
  };
}

describe('worker inference Host boundary', () => {
  it('真实 Worker 仅通过受限协议执行embed/text/OCR，构建不包含模型目录或凭据实现', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-inference-worker-'));
    const inputPath = path.join(root, 'input.pdf');
    await writeFile(inputPath, 'fixture');
    const workerScript = path.join(root, 'worker.mjs');
    const bundle = await build({ entryPoints: [fileURLToPath(new URL('./fixtures/inferenceClient.worker.ts', import.meta.url))],
      outfile: workerScript, bundle: true, platform: 'node', format: 'esm', target: 'node24', metafile: true,
      logLevel: 'silent', tsconfig: path.resolve('tsconfig.json') });
    expect(Object.keys(bundle.metafile.inputs).filter(file => /model-catalog|credential-storage|provider-account/.test(file))).toEqual([]);
    const inference = ports();
    const queue = new WorkerThreadQueue<{ taskId: string; inputPath: string }>({ workerScript,
      hostRequestHandler: () => createInferenceWorkerRequestHandler(inference, {
        allowedOperations: new Set(['embed', 'text', 'ocr-profile', 'ocr']),
        modelIds: new Set(['embedding', 'language', 'ocr']), inputFiles: [inputPath],
      }) });
    try {
      const complete = new Promise<unknown>((resolve, reject) => {
        queue.once('taskCompleted', ({ result }: { result: unknown }) => resolve(result));
        queue.once('taskFailed', ({ error }: { error: string }) => reject(new Error(error)));
      });
      await queue.addTask({ taskId: 'protocol', inputPath });
      await expect(complete).resolves.toMatchObject({
        embedding: { vectors: [[1, 2], [1, 2]], spaceId: 'space-one' },
        text: { text: 'extracted' }, ocr: { pages: [{ markdown: 'source' }] }, progress: ['running'],
      });
      expect(inference.embedding.embed).toHaveBeenCalledWith(expect.objectContaining({ expectedSpaceId: 'space-one', signal: expect.any(AbortSignal) }));
      expect(inference.reranking.rerank).not.toHaveBeenCalled();
    } finally { await queue.shutdown(); await rm(root, { recursive: true, force: true }); }
  });

  it('拒绝任务外模型、未声明操作、额外凭据字段及任务外的Host文件', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'linnya-inference-admission-'));
    const unrelated = path.join(root, 'private.pdf');
    await writeFile(unrelated, 'not an input');
    const inference = ports();
    const handler = createInferenceWorkerRequestHandler(inference, {
      allowedOperations: new Set(['embed', 'ocr']), modelIds: new Set(['embedding', 'ocr']), inputFiles: [],
    });
    const context = { signal: new AbortController().signal, progress: vi.fn() };
    try {
      await expect(handler.execute('embed', { modelId: 'another', values: ['x'] }, context)).rejects.toThrow('模型');
      await expect(handler.execute('embed', { modelId: 'embedding', values: ['x'], apiKey: 'never-admitted' }, context)).rejects.toThrow();
      await expect(handler.execute('text', { modelId: 'embedding', messages: [] }, context)).rejects.toThrow('未授权');
      await expect(handler.execute('ocr', { modelId: 'ocr', input: { kind: 'pdf_path', path: unrelated } }, context)).rejects.toThrow('不属于当前任务');
      expect(inference.embedding.embed).not.toHaveBeenCalled();
      expect(inference.documentOcr.recognizeDocument).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
