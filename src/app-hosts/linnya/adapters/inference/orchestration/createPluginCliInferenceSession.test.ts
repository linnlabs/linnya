import { describe, expect, it, vi } from 'vitest';
import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import { createPluginCliInferenceSession } from './createPluginCliInferenceSession';

function fixture(): PluginInferencePort {
  return {
    embedding: { embed: vi.fn(async () => ({ spaceId: 'fixture', vectors: [[1, 2]] })) },
    reranking: { rerank: vi.fn(async () => ({ ranking: [] })) },
    textGeneration: { generate: vi.fn<PluginInferencePort['textGeneration']['generate']>(async () => ({ text: 'output', reasoning: '', finishReason: 'stop' })) },
    documentOcr: {
      resolveModelProfile: vi.fn(async () => undefined),
      recognizeDocument: vi.fn(async () => ({ pages: [] })),
    },
  };
}

describe('CLI Host inference admission and lifetime', () => {
  it('未声明操作在供应商调用前拒绝；结束后不能借用已失效能力', async () => {
    const host = fixture();
    const session = createPluginCliInferenceSession({ inference: host, operations: ['embed'], signal: new AbortController().signal });
    await expect(session.inference.embedding.embed({ modelId: 'embedding', values: ['source'] })).resolves.toMatchObject({ spaceId: 'fixture' });
    await expect(session.inference.textGeneration.generate({ modelId: 'text', messages: [] })).rejects.toThrow('未声明');
    await expect(session.inference.documentOcr.resolveModelProfile('ocr')).rejects.toThrow('未声明');
    await expect(session.inference.reranking.rerank({ modelId: 'rerank', query: '', documents: [] })).rejects.toThrow('未声明');
    expect(host.textGeneration.generate).not.toHaveBeenCalled();
    expect(host.documentOcr.resolveModelProfile).not.toHaveBeenCalled();
    expect(host.reranking.rerank).not.toHaveBeenCalled();
    await session.close();
    await expect(session.inference.embedding.embed({ modelId: 'embedding', values: ['late'] })).rejects.toThrow();
    expect(host.embedding.embed).toHaveBeenCalledTimes(1);
  });

  it('父执行取消传入实际调用，并等待已在执行的模型清理后 close 才结束', async () => {
    const parent = new AbortController();
    let release: () => void = () => {};
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    let requestSignal: AbortSignal | undefined;
    const host = fixture();
    const session = createPluginCliInferenceSession({
      inference: { ...host, embedding: { async embed(request) {
        requestSignal = request.signal;
        await cleanup;
        request.signal?.throwIfAborted();
        return { vectors: [[1]], spaceId: 'fixture' };
      } } }, operations: ['embed'], signal: parent.signal,
    });
    const request = session.inference.embedding.embed({ modelId: 'embedding', values: ['source'] });
    const rejected = expect(request).rejects.toThrow('parent ended');
    parent.abort(new Error('parent ended'));
    expect(requestSignal?.aborted).toBe(true);
    let closed = false;
    const closing = session.close().then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await Promise.all([closing, rejected]);
    expect(closed).toBe(true);
  });
});
