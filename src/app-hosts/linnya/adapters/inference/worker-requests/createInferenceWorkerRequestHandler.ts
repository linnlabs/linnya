import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import type { WorkerHostRequestHandler, WorkerHostFailure } from '@linnya/plugin-host-contract/backend/workerRequests';
import {
  PluginWorkerEmbeddingInputSchema, PluginWorkerTextInputSchema,
  PluginWorkerOcrProfileInputSchema, PluginWorkerOcrInputSchema,
} from '@app/schemas/plugins/inference-worker';
import { EmbeddingFailure, TextGenerationFailure } from 'src/domains/model-inference';
import { OcrProviderError } from 'src/domains/document-ocr';

export type InferenceWorkerOperation = 'embed' | 'text' | 'ocr-profile' | 'ocr';
export interface InferenceWorkerRequestOwner {
  readonly allowedOperations: ReadonlySet<InferenceWorkerOperation>;
  readonly modelIds: ReadonlySet<string>;
  readonly inputFiles: readonly string[];
  readonly temporaryDirectory?: string;
}

function projectFailure(error: unknown): WorkerHostFailure {
  if (error instanceof EmbeddingFailure || error instanceof TextGenerationFailure) return {
    name: error.name, kind: error.kind, code: error.code, retryable: error.retryable, message: error.message,
  };
  if (error instanceof OcrProviderError) return {
    name: error.name, statusCode: error.statusCode, retryable: error.retryable, message: error.message,
  };
  return { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) };
}

/** 任务 owner 冻结允许操作、模型和文件；只在 Host 调用正式推理端口。 */
export function createInferenceWorkerRequestHandler(
  inference: PluginInferencePort,
  owner: InferenceWorkerRequestOwner,
): WorkerHostRequestHandler {
  function admit(operation: InferenceWorkerOperation, modelId: string): void {
    if (!owner.allowedOperations.has(operation)) throw new Error(`此任务未授权 Host 推理操作: ${operation}`);
    if (!owner.modelIds.has(modelId)) throw new Error('请求模型不属于当前任务的模型快照');
  }
  async function admitFile(filename: string): Promise<string> {
    const actual = await realpath(filename);
    for (const input of owner.inputFiles) if (actual === await realpath(input)) return actual;
    if (owner.temporaryDirectory) {
      const root = await realpath(owner.temporaryDirectory);
      const relative = path.relative(root, actual);
      if (relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) return actual;
    }
    throw new Error('OCR 文件不属于当前任务');
  }
  return {
    projectFailure,
    async execute(operation, payload, context) {
      context.signal.throwIfAborted();
      if (operation === 'embed') {
        const request = PluginWorkerEmbeddingInputSchema.parse(payload);
        admit(operation, request.modelId);
        return inference.embedding.embed({ ...request, signal: context.signal });
      }
      if (operation === 'text') {
        const request = PluginWorkerTextInputSchema.parse(payload);
        admit(operation, request.modelId);
        return inference.textGeneration.generate({ ...request, signal: context.signal });
      }
      if (operation === 'ocr-profile') {
        const request = PluginWorkerOcrProfileInputSchema.parse(payload);
        admit(operation, request.modelId);
        return inference.documentOcr.resolveModelProfile(request.modelId);
      }
      if (operation === 'ocr') {
        const request = PluginWorkerOcrInputSchema.parse(payload);
        admit(operation, request.modelId);
        const input = request.input.kind === 'pdf_path'
          ? { kind: 'pdf_path' as const, path: await admitFile(request.input.path) }
          : request.input;
        return inference.documentOcr.recognizeDocument({ ...request, input, options: {
          ...request.options, signal: context.signal, onProgress: context.progress,
        } });
      }
      throw new Error(`不支持的 Worker Host 操作: ${operation}`);
    },
  };
}
