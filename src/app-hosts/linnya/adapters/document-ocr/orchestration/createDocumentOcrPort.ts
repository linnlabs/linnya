import { randomUUID } from 'node:crypto';
import { Logger } from '@shared/logger';
import { DOCUMENT_OCR_CAPABILITY_IDS } from '@app/schemas/document-ocr';
import type { ModelConfig } from 'src/domains/model-catalog';
import { modelCatalog as defaultCatalog } from 'src/domains/model-catalog';
import {
  OcrProviderError,
  type DocumentOcrModelProfile,
  type DocumentOcrPort,
  type OcrDocumentInput,
  type OcrDocumentOptions,
  type OcrDocumentResult,
} from 'src/domains/document-ocr';
import { PaddleOcrJobCapability } from '../capabilities/paddle/orchestration/paddleOcrJobCapability';
import { PaddleOcrLayoutParsingCapability } from '../capabilities/paddle/orchestration/paddleOcrLayoutParsingCapability';
import type { DocumentOcrCapabilityConfig } from '../definitions/documentOcrCapabilityConfig';
import {
  beginProviderOutboundAttempt,
  defaultProviderOutboundDiagnostics,
  type ProviderOutboundDiagnosticsPort,
  type ProviderOutboundFailureSummary,
} from 'src/domains/provider-diagnostics/features/provider-outbound';

const logger = new Logger('DocumentOcrPort');

interface DocumentOcrCapability {
  recognizeDocument(
    input: OcrDocumentInput,
    options?: OcrDocumentOptions
  ): Promise<OcrDocumentResult>;
}

function createCapability(config: ModelConfig, credential: string): DocumentOcrCapability {
  const capabilityConfig = resolveCapabilityConfig(config, credential);
  if (capabilityConfig.route.capability_id === DOCUMENT_OCR_CAPABILITY_IDS.PADDLE_LAYOUT_PARSING) {
    return new PaddleOcrLayoutParsingCapability(capabilityConfig);
  }
  if (capabilityConfig.route.capability_id === DOCUMENT_OCR_CAPABILITY_IDS.PADDLE_OCR_JOBS) {
    return new PaddleOcrJobCapability(capabilityConfig);
  }
  throw new Error(`模型 '${config.id}' 声明了未注册的 OCR capability`);
}

function resolveCapabilityConfig(config: ModelConfig, credential: string): DocumentOcrCapabilityConfig {
  if (!config.document_ocr_route) {
    throw new Error(`模型 '${config.id}' 未声明 document_ocr_route`);
  }
  if (!credential) {
    throw new Error(`OCR 模型 '${config.id}' 缺少 API 密钥`);
  }
  return {
    route: config.document_ocr_route,
    apiKey: credential,
  };
}

function projectModelProfile(config: ModelConfig): DocumentOcrModelProfile {
  const route = config.document_ocr_route;
  if (!route) throw new Error(`OCR 模型 '${config.id}' 缺少 document_ocr_route`);

  return {
    modelId: config.id,
    displayName: config.display_name || config.model_name,
    mode: route.mode,
    supportsAbortSignal: route.supports_abort_signal,
    attemptTimeoutMs: route.attempt_timeout_ms,
    ...(route.max_input_pages === undefined ? {} : { maxInputPages: route.max_input_pages }),
  };
}

export interface DocumentOcrModelCatalog {
  initialize(): Promise<void>;
  getModel(id: string): ModelConfig | undefined;
  resolveCredential(modelId: string): string | undefined;
}

export interface CreateDocumentOcrPortDependencies {
  readonly catalog?: DocumentOcrModelCatalog;
  readonly outbound_diagnostics?: ProviderOutboundDiagnosticsPort;
}

function classifyOcrFailure(
  error: unknown,
  signal: AbortSignal | undefined
): ProviderOutboundFailureSummary {
  if (signal?.aborted) {
    return { kind: 'aborted', code: 'request_aborted', retryable: false };
  }
  if (error instanceof OcrProviderError) {
    return {
      kind: error.statusCode === undefined ? 'transport' : 'provider',
      code:
        error.statusCode === undefined
          ? 'ocr_transport_error'
          : `provider_http_${error.statusCode}`,
      retryable: error.retryable ?? false,
    };
  }
  return { kind: 'protocol', code: 'ocr_protocol_error', retryable: false };
}

export function createDocumentOcrPort(
  dependencies: CreateDocumentOcrPortDependencies = {}
): DocumentOcrPort {
  const catalog = dependencies.catalog ?? defaultCatalog;
  const outboundDiagnostics = dependencies.outbound_diagnostics ?? defaultProviderOutboundDiagnostics;
  return {
    async resolveModelProfile(modelId) {
      await catalog.initialize();
      const config = catalog.getModel(modelId);
      if (!config?.document_ocr_route) return undefined;
      return projectModelProfile(config);
    },
    async recognizeDocument(request) {
      await catalog.initialize();
      const config = catalog.getModel(request.modelId);
      if (!config) throw new Error(`OCR 模型 '${request.modelId}' 未在注册表中找到`);
      if (!config.document_ocr_route) {
        throw new Error(`模型 '${config.id}' 未声明 document_ocr_route`);
      }
      logger.info(`使用模型声明的 OCR capability: ${config.document_ocr_route.capability_id}`);
      const route = config.document_ocr_route;
      const credential = catalog.resolveCredential(request.modelId);
      if (!credential) throw new Error(`OCR 模型 '${config.id}' 缺少 API 密钥`);
      const capability = createCapability(config, credential);
      const attempt = beginProviderOutboundAttempt(outboundDiagnostics, {
        attempt_id: randomUUID(),
        operation: 'document_ocr',
        route: {
          model_id: request.modelId,
          endpoint_id: route.endpoint_id,
          endpoint_model_id: route.endpoint_model_id,
          api_surface: route.api_surface,
          capability_id: route.capability_id,
        },
        input: {
          kind: 'document_ocr',
          input_kind: request.input.kind === 'pdf_path' ? 'pdf' : 'image',
        },
      });
      try {
        const result = await capability.recognizeDocument(request.input, request.options);
        attempt.succeed({
          finish_reason: 'completed',
          usage: { provenance: 'not_reported' },
        });
        return result;
      } catch (error) {
        attempt.fail({
          usage: { provenance: 'not_reported' },
          failure: classifyOcrFailure(error, request.options?.signal),
        });
        throw error;
      }
    },
  };
}
