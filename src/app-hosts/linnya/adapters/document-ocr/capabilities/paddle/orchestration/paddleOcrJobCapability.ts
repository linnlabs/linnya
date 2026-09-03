import * as fs from 'fs/promises';
import { basename } from 'path';
import { Logger } from '@shared/logger';
import { OcrProviderError } from 'src/domains/document-ocr';
import type { DocumentOcrCapabilityConfig } from '../../../definitions/documentOcrCapabilityConfig';
import { isRecord, parsePaddleLayoutPages } from '../functions/parsePaddleOcrResponse';
import type {
  OcrDocumentInput,
  OcrDocumentOptions,
  OcrDocumentResult,
  OcrDocumentPage,
} from 'src/domains/document-ocr';

const logger = new Logger('PaddleOcrJobCapability');
const JOBS_PATH = '/api/v2/ocr/jobs';

type PaddleOcrJobState = 'pending' | 'running' | 'done' | 'failed';

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readOptionalPayload(options: OcrDocumentOptions): Record<string, unknown> {
  const source = options.optionalPayload ?? {};
  return {
    useDocOrientationClassify: readBoolean(source.useDocOrientationClassify) ?? false,
    useDocUnwarping: readBoolean(source.useDocUnwarping) ?? false,
    useChartRecognition: readBoolean(source.useChartRecognition) ?? false,
  };
}

function buildJobsUrl(apiBase: string): string {
  const trimmed = apiBase.trim();
  if (trimmed.endsWith('/ocr/jobs')) return trimmed;
  return `${trimmed.replace(/\/+$/u, '')}${JOBS_PATH}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readJobId(response: unknown): string {
  if (!isRecord(response) || !isRecord(response.data)) {
    throw new Error('PaddleOCR job 提交响应缺少 data');
  }
  const jobId = readString(response.data.jobId);
  if (!jobId) {
    throw new Error('PaddleOCR job 提交响应缺少 jobId');
  }
  return jobId;
}

function readJobState(response: unknown): {
  state: PaddleOcrJobState;
  totalPages?: number;
  extractedPages?: number;
  jsonUrl?: string;
  errorMsg?: string;
} {
  if (!isRecord(response) || !isRecord(response.data)) {
    throw new Error('PaddleOCR job 状态响应缺少 data');
  }

  const state = response.data.state;
  if (state !== 'pending' && state !== 'running' && state !== 'done' && state !== 'failed') {
    throw new Error(`PaddleOCR job 返回未知状态: ${String(state)}`);
  }

  const progress = isRecord(response.data.extractProgress)
    ? response.data.extractProgress
    : undefined;
  const resultUrl = isRecord(response.data.resultUrl) ? response.data.resultUrl : undefined;

  return {
    state,
    totalPages: readPositiveNumber(progress?.totalPages),
    extractedPages: readPositiveNumber(progress?.extractedPages),
    jsonUrl: readString(resultUrl?.jsonUrl),
    errorMsg: readString(response.data.errorMsg),
  };
}

function parseJsonlPages(jsonl: string, firstPageNumber: number): OcrDocumentPage[] {
  const pages: OcrDocumentPage[] = [];
  let pageCursor = firstPageNumber;

  for (const rawLine of jsonl.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsed: unknown = JSON.parse(line);
    const linePages = parsePaddleLayoutPages(parsed, pageCursor);
    pages.push(...linePages);
    pageCursor += linePages.length;
  }

  return pages;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(signal.reason);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function buildFilePart(input: OcrDocumentInput): Promise<{ file: Blob; filename: string }> {
  if (input.kind === 'pdf_path') {
    const bytes = await fs.readFile(input.path);
    return {
      file: new Blob([bytes], { type: 'application/pdf' }),
      filename: basename(input.path) || 'document.pdf',
    };
  }

  const bytes = Buffer.from(input.base64, 'base64');
  return {
    file: new Blob([bytes], { type: input.mimeType }),
    filename: `page-${input.pageNumber}.${input.mimeType === 'image/png' ? 'png' : 'jpg'}`,
  };
}

export class PaddleOcrJobCapability {
  readonly provider = 'paddleocr-job';
  private readonly config: DocumentOcrCapabilityConfig;
  private readonly pollIntervalMs: number;

  constructor(config: DocumentOcrCapabilityConfig) {
    this.config = config;
    if (config.route.api_surface !== 'paddle_ocr_jobs') {
      throw new Error(`OCR capability 配置错误: ${config.route.api_surface}`);
    }
    this.pollIntervalMs = config.route.poll_interval_ms;
    logger.info(`初始化: ${config.route.endpoint_model_id}`);
  }

  async recognizeDocument(
    input: OcrDocumentInput,
    options: OcrDocumentOptions = {}
  ): Promise<OcrDocumentResult> {
    const apiBase = this.config.route.base_url;
    const apiKey = this.config.apiKey;

    const jobsUrl = buildJobsUrl(apiBase);
    const jobId = await this.submitJob({
      input,
      jobsUrl,
      apiKey,
      options,
    });

    const jsonUrl = await this.pollJob({
      jobsUrl,
      jobId,
      apiKey,
      options,
    });

    const jsonl = await this.downloadJsonl(jsonUrl, options.signal);
    const firstPageNumber = input.kind === 'image_base64' ? input.pageNumber : 1;
    const pages = parseJsonlPages(jsonl, firstPageNumber);
    return {
      pages,
      totalPages: input.kind === 'pdf_path' ? pages.length : undefined,
    };
  }

  private async submitJob(args: {
    input: OcrDocumentInput;
    jobsUrl: string;
    apiKey: string;
    options: OcrDocumentOptions;
  }): Promise<string> {
    const { file, filename } = await buildFilePart(args.input);
    const formData = new FormData();
    formData.append('model', this.config.route.endpoint_model_id);
    formData.append('optionalPayload', JSON.stringify(readOptionalPayload(args.options)));
    formData.append('file', file, filename);

    const resp = await fetch(args.jobsUrl, {
      method: 'POST',
      headers: {
        Authorization: `bearer ${args.apiKey}`,
      },
      body: formData,
      signal: args.options.signal,
    });

    if (!resp.ok) {
      await this.throwProviderError(resp, 'submit');
    }

    const jsonUnknown: unknown = await resp.json();
    const jobId = readJobId(jsonUnknown);
    args.options.onProgress?.({ state: 'submitted', message: `PaddleOCR job 已提交: ${jobId}` });
    return jobId;
  }

  private async pollJob(args: {
    jobsUrl: string;
    jobId: string;
    apiKey: string;
    options: OcrDocumentOptions;
  }): Promise<string> {
    while (true) {
      const resp = await fetch(`${args.jobsUrl}/${args.jobId}`, {
        method: 'GET',
        headers: {
          Authorization: `bearer ${args.apiKey}`,
        },
        signal: args.options.signal,
      });

      if (!resp.ok) {
        await this.throwProviderError(resp, 'poll');
      }

      const state = readJobState(await resp.json());
      if (state.state === 'failed') {
        throw new OcrProviderError('[PaddleOcrJobCapability] job 失败', {
          provider: this.provider,
          endpoint: 'paddleocr/ocr-jobs',
          retryable: false,
        });
      }

      args.options.onProgress?.({
        state: state.state,
        totalPages: state.totalPages,
        processedPages: state.extractedPages,
      });

      if (state.state === 'done') {
        if (!state.jsonUrl) {
          throw new Error(`PaddleOCR job ${args.jobId} 完成但缺少 resultUrl.jsonUrl`);
        }
        return state.jsonUrl;
      }

      await wait(this.pollIntervalMs, args.options.signal);
    }
  }

  private async downloadJsonl(jsonUrl: string, signal?: AbortSignal): Promise<string> {
    const resp = await fetch(jsonUrl, {
      method: 'GET',
      signal,
    });

    if (!resp.ok) {
      await this.throwProviderError(resp, 'download');
    }

    return resp.text();
  }

  private async throwProviderError(
    resp: Response,
    phase: 'submit' | 'poll' | 'download'
  ): Promise<never> {
    throw new OcrProviderError(
      `[PaddleOcrJobCapability] ${phase} 请求失败: ${resp.status} ${resp.statusText}`,
      {
        provider: this.provider,
        endpoint: 'paddleocr/ocr-jobs',
        statusCode: resp.status,
        statusText: resp.statusText,
        retryable: resp.status === 429 || resp.status >= 500,
      }
    );
  }
}
