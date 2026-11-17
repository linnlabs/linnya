import path from 'node:path';
import type { PluginInferencePort } from '@linnya/plugin-host-contract/backend/inferenceRuntime';
import type { QueueManagerInitializeOptions } from 'src/infra/task-queue/queues';
import { getDefaultModelIdByCapability } from 'src/domains/model-catalog';
import {
  PDF_OCR_DEFAULT_CAPABILITY,
  PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
} from '../../../agent-registry/internals/ingestion/pdf_ocr';
import { createInferenceWorkerRequestHandler } from './createInferenceWorkerRequestHandler';

/** Host 在入队前冻结模型和素材归属；Worker 不再自行读取配置或凭据。 */
export function createKnowledgeWorkerInference(
  inference: PluginInferencePort,
  temporaryRoot: string
): Required<Pick<QueueManagerInitializeOptions, 'prepareIngestionJob' | 'workerInference'>> {
  return {
    prepareIngestionJob(payload) {
      return {
        ...payload,
        ...(path.extname(payload.filename).toLowerCase() === '.pdf'
          ? {
              pdfOcrModelId:
                payload.pdfOcrModelId?.trim() ||
                getDefaultModelIdByCapability(PDF_OCR_DEFAULT_CAPABILITY) ||
                PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
              ocrTemporaryDirectory: path.join(temporaryRoot, payload.taskId),
            }
          : {}),
      };
    },
    workerInference: {
      ingestion(payload) {
        return createInferenceWorkerRequestHandler(inference, {
          allowedOperations: new Set(['embed', 'text', 'ocr-profile', 'ocr']),
          modelIds: new Set(
            [
              payload.embeddingModelId,
              payload.pdfOcrModelId,
              payload.imageVisionModelId ?? payload.visionModelId,
            ].filter((value): value is string => typeof value === 'string' && value.length > 0)
          ),
          inputFiles: [payload.filePath],
          temporaryDirectory: payload.ocrTemporaryDirectory,
        });
      },
      graphExtraction(payload) {
        return createInferenceWorkerRequestHandler(inference, {
          allowedOperations: new Set(['text']),
          modelIds: new Set([payload.llmModelId]),
          inputFiles: [],
        });
      },
      graphIndexing(payload) {
        return createInferenceWorkerRequestHandler(inference, {
          allowedOperations: new Set(['embed']),
          modelIds: new Set([payload.embeddingModelId]),
          inputFiles: [],
        });
      },
    },
  };
}
