import type {
  PluginInferenceOperation,
  PluginInferencePort,
} from '@linnya/plugin-host-contract/backend/inferenceRuntime';

/** 一次已准入 CLI 的模型调用归属。声明不代替权限门；桥先校验父执行再创建本实例。 */
export function createPluginCliInferenceSession(input: {
  readonly inference: PluginInferencePort;
  readonly operations: readonly PluginInferenceOperation[];
  readonly signal: AbortSignal;
}) {
  const allowed = new Set(input.operations);
  const controller = new AbortController();
  const signal = AbortSignal.any([input.signal, controller.signal]);
  const pending = new Set<Promise<unknown>>();
  async function run<T>(operation: PluginInferenceOperation, requestSignal: AbortSignal | undefined,
    execute: (signal: AbortSignal) => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (!allowed.has(operation)) throw new Error(`当前 CLI 未声明 Host 推理操作: ${operation}`);
    const combined = requestSignal ? AbortSignal.any([signal, requestSignal]) : signal;
    combined.throwIfAborted();
    const result = execute(combined);
    pending.add(result);
    try { return await result; }
    finally { pending.delete(result); }
  }
  const inference: PluginInferencePort = {
    embedding: { embed: request => run('embed', request.signal,
      combined => input.inference.embedding.embed({ ...request, signal: combined })) },
    textGeneration: { generate: request => run('text', request.signal,
      combined => input.inference.textGeneration.generate({ ...request, signal: combined })) },
    reranking: { async rerank() { throw new Error('当前 CLI 未声明 Host 重排操作'); } },
    documentOcr: {
      resolveModelProfile: modelId => run('ocr-profile', undefined,
        () => input.inference.documentOcr.resolveModelProfile(modelId)),
      recognizeDocument: request => run('ocr', request.options?.signal,
        combined => input.inference.documentOcr.recognizeDocument({
          ...request, options: { ...request.options, signal: combined },
        })),
    },
  };
  return {
    inference,
    async close() {
      controller.abort(new Error('Plugin CLI inference scope ended.'));
      await Promise.allSettled([...pending]);
    },
  };
}
