import * as fs from 'fs/promises';
import { Logger } from '@shared/logger';
import { OcrProviderError } from 'src/domains/document-ocr';
import type { DocumentOcrCapabilityConfig } from '../../../definitions/documentOcrCapabilityConfig';
import { parsePaddleLayoutPages } from '../functions/parsePaddleOcrResponse';
import type {
  OcrDocumentInput,
  OcrDocumentOptions,
  OcrDocumentResult,
} from 'src/domains/document-ocr';

const logger = new Logger('PaddleOcrLayoutParsingCapability');

type PaddleOcrLayoutFileType = 0 | 1;

type PaddleOcrLayoutPayload = {
  file: string;
  fileType: PaddleOcrLayoutFileType;
  useDocOrientationClassify?: boolean;
  useDocUnwarping?: boolean;
  useChartRecognition?: boolean;
};

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readOptionalPayloadBoolean(
  payload: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  if (!payload) return undefined;
  return readBoolean(payload[key]);
}

async function readPdfAsBase64(pdfPath: string): Promise<string> {
  const bytes = await fs.readFile(pdfPath);
  return Buffer.from(bytes).toString('base64');
}

function buildInputFile(
  input: OcrDocumentInput
): Promise<{ base64: string; fileType: PaddleOcrLayoutFileType }> {
  if (input.kind === 'image_base64') {
    return Promise.resolve({
      base64: input.base64,
      fileType: 1,
    });
  }

  return readPdfAsBase64(input.path).then(base64 => ({
    base64,
    fileType: 0,
  }));
}

function compactPayload(payload: PaddleOcrLayoutPayload): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export class PaddleOcrLayoutParsingCapability {
  readonly provider = 'paddleocr-layout-parsing';
  private readonly config: DocumentOcrCapabilityConfig;

  constructor(config: DocumentOcrCapabilityConfig) {
    this.config = config;
    logger.info(`初始化: ${config.route.endpoint_model_id}`);
  }

  async recognizeDocument(
    input: OcrDocumentInput,
    options: OcrDocumentOptions = {}
  ): Promise<OcrDocumentResult> {
    const apiBase = this.config.route.base_url;
    const apiKey = this.config.apiKey;

    const { base64, fileType } = await buildInputFile(input);
    const payload = compactPayload({
      file: base64,
      fileType,
      useDocOrientationClassify: readOptionalPayloadBoolean(
        options.optionalPayload,
        'useDocOrientationClassify'
      ),
      useDocUnwarping: readOptionalPayloadBoolean(options.optionalPayload, 'useDocUnwarping'),
      useChartRecognition: readOptionalPayloadBoolean(
        options.optionalPayload,
        'useChartRecognition'
      ),
    });

    const resp = await fetch(apiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `token ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });

    if (!resp.ok) {
      throw new OcrProviderError(
        `[PaddleOcrLayoutParsingCapability] 请求失败: ${resp.status} ${resp.statusText}`,
        {
          provider: this.provider,
          endpoint: 'paddleocr/layout-parsing',
          statusCode: resp.status,
          statusText: resp.statusText,
          retryable: resp.status === 429 || resp.status >= 500,
        }
      );
    }

    const jsonUnknown: unknown = await resp.json();
    const firstPageNumber = input.kind === 'image_base64' ? input.pageNumber : 1;
    const pages = parsePaddleLayoutPages(jsonUnknown, firstPageNumber);
    return {
      pages,
      totalPages: input.kind === 'pdf_path' ? pages.length : undefined,
    };
  }
}
