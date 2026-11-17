import { randomUUID } from 'node:crypto';
import { parentPort } from 'node:worker_threads';
import type { z } from 'zod';
import type { PluginWorkerInferencePort } from '@linnya/plugin-host-contract/backend/inferenceWorkerRuntime';
import {
  PluginWorkerEmbeddingResultSchema, PluginWorkerTextResultSchema, PluginWorkerOcrProfileSchema,
  PluginWorkerOcrResultSchema, PluginWorkerOcrProgressSchema, PluginWorkerInferenceFailureSchema,
} from '@app/schemas/plugins/inference-worker';
import { EmbeddingFailure } from 'src/domains/model-inference/features/embedding/definitions/embedding';
import { TextGenerationFailure } from 'src/domains/model-inference/features/text-generation/definitions/textGeneration';
import { OcrProviderError } from 'src/domains/document-ocr/features/recognition/definitions/ocrProviderError';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  progress?(value: unknown): void;
}

function readFailure(value: unknown): Error {
  const failure = PluginWorkerInferenceFailureSchema.parse(value);
  if (failure.name === 'EmbeddingFailure' && failure.kind && failure.code) {
    return new EmbeddingFailure(failure.kind, failure.code, failure.retryable === true, failure.message);
  }
  if (failure.name === 'TextGenerationFailure' && failure.kind && failure.code) {
    return new TextGenerationFailure(failure.kind, failure.code, failure.retryable === true, failure.message);
  }
  if (failure.name === 'OcrProviderError') return new OcrProviderError(failure.message, {
    provider: 'host', statusCode: failure.statusCode, retryable: failure.retryable,
  });
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
}

/** 该 SDK 子入口可内联进插件 Worker；只包含消息客户端和错误类型，不加载模型目录或凭据。 */
export function createPluginWorkerInferencePort(): PluginWorkerInferencePort {
  if (!parentPort) throw new Error('推理 Worker 端口只能在受管 Worker 中创建');
  const channel = parentPort;
  const pending = new Map<string, PendingRequest>();
  const lifetime = new AbortController();
  function cancelAll(): void {
    lifetime.abort();
  }
  function onMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return;
    if ('cmd' in message && message.cmd === 'cancel') { cancelAll(); return; }
    if (!('requestId' in message) || typeof message.requestId !== 'string' || !('type' in message)) return;
    const request = pending.get(message.requestId);
    if (!request) return;
    try {
      if (message.type === 'host-result' && 'result' in message) request.resolve(message.result);
      else if (message.type === 'host-failure' && 'error' in message) request.reject(readFailure(message.error));
      else if (message.type === 'host-progress' && 'value' in message) request.progress?.(message.value);
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
  channel.on('message', onMessage);
  channel.on('close', cancelAll);

  function call<T>(operation: string, payload: unknown, schema: z.ZodType<T>, options: {
    signal?: AbortSignal; progress?: (value: unknown) => void;
  } = {}): Promise<T> {
    const signal = options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal;
    if (signal.aborted) return Promise.reject(new DOMException('推理任务已取消', 'AbortError'));
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const cleanup = () => { pending.delete(requestId); signal.removeEventListener('abort', onAbort); };
      const onAbort = () => {
        cleanup();
        channel.postMessage({ type: 'host-cancel', requestId });
        reject(new DOMException('推理任务已取消', 'AbortError'));
      };
      pending.set(requestId, {
        resolve(value) { cleanup(); try { resolve(schema.parse(value)); } catch (error) { reject(error); } },
        reject(error) { cleanup(); reject(error); },
        progress: options.progress,
      });
      signal.addEventListener('abort', onAbort, { once: true });
      channel.postMessage({ type: 'host-request', requestId, operation, payload });
    });
  }

  return {
    embedding: { embed({ signal, ...payload }) { return call('embed', payload, PluginWorkerEmbeddingResultSchema, { signal }); } },
    textGeneration: { generate({ signal, ...payload }) { return call('text', payload, PluginWorkerTextResultSchema, { signal }); } },
    documentOcr: {
      resolveModelProfile(modelId) { return call('ocr-profile', { modelId }, PluginWorkerOcrProfileSchema); },
      recognizeDocument({ options, ...input }) {
        return call('ocr', { ...input, options: { optionalPayload: options?.optionalPayload } }, PluginWorkerOcrResultSchema, {
          signal: options?.signal,
          progress: options?.onProgress ? value => options.onProgress?.(PluginWorkerOcrProgressSchema.parse(value)) : undefined,
        });
      },
    },
    dispose() { cancelAll(); channel.off('message', onMessage); channel.off('close', cancelAll); },
  };
}
