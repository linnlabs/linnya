import { describe, expect, it } from 'vitest';
import { TextGenerationFailure } from 'src/domains/model-inference';
import { OcrProviderError } from 'src/domains/document-ocr';
import {
  EmptyOcrContentError,
  OcrTimeoutError,
  PdfLocalConversionError,
} from '../definitions/ocrErrors';
import { classifyOcrError } from './errorClassification';

describe('classifyOcrError', () => {
  it('classifies auth failures as non-retryable', () => {
    const result = classifyOcrError(
      new TextGenerationFailure('provider', 'provider_http_401', false, 'unauthorized')
    );

    expect(result).toEqual({
      kind: 'auth',
      retryable: false,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: false,
    });
  });

  it('classifies rate limits as retryable with concurrency reduction', () => {
    const result = classifyOcrError(
      new TextGenerationFailure('provider', 'provider_http_429', true, 'too many requests')
    );

    expect(result).toMatchObject({
      kind: 'rate_limited',
      retryable: true,
      shouldReduceConcurrency: true,
      shouldSplitSmaller: false,
    });
  });

  it('classifies OCR adapter provider errors by status code', () => {
    const result = classifyOcrError(
      new OcrProviderError('too many requests', {
        provider: 'paddleocr-layout-parsing',
        statusCode: 429,
      })
    );

    expect(result).toMatchObject({
      kind: 'rate_limited',
      retryable: true,
      shouldReduceConcurrency: true,
      shouldSplitSmaller: false,
    });
  });

  it('respects non-retryable OCR provider errors without status code', () => {
    const result = classifyOcrError(
      new OcrProviderError('job failed: unsupported file', {
        provider: 'paddleocr-job',
        retryable: false,
      })
    );

    expect(result).toEqual({
      kind: 'bad_request',
      retryable: false,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: false,
    });
  });

  it('lets provider explicit retryable flag override default status-code retry policy', () => {
    const result = classifyOcrError(
      new OcrProviderError('server rejected a permanent job state', {
        provider: 'paddleocr-job',
        statusCode: 500,
        retryable: false,
      })
    );

    expect(result).toMatchObject({
      kind: 'server',
      retryable: false,
    });
  });

  it('classifies payload-too-large as a split-smaller signal', () => {
    const result = classifyOcrError(
      new TextGenerationFailure('provider', 'provider_http_413', true, 'payload too large')
    );

    expect(result).toMatchObject({
      kind: 'payload_too_large',
      retryable: true,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: true,
    });
  });

  it('classifies server errors as retryable without forcing a smaller segment', () => {
    const result = classifyOcrError(
      new TextGenerationFailure('provider', 'provider_http_502', true, 'bad gateway')
    );

    expect(result).toMatchObject({
      kind: 'server',
      retryable: true,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: false,
    });
  });

  it('classifies timeouts as retryable with safer execution signals', () => {
    const result = classifyOcrError(new OcrTimeoutError('timed out', { timeoutMs: 120_000 }));

    expect(result).toMatchObject({
      kind: 'timeout',
      retryable: true,
      shouldReduceConcurrency: true,
      shouldSplitSmaller: true,
    });
  });

  it('classifies local conversion failures as non-retryable OCR errors', () => {
    const result = classifyOcrError(
      new PdfLocalConversionError('pdftocairo failed', {
        pageNum: 7,
        tool: 'pdftocairo',
      })
    );

    expect(result).toMatchObject({
      kind: 'local_conversion',
      retryable: false,
      shouldReduceConcurrency: false,
      shouldSplitSmaller: false,
    });
  });

  it('classifies wrapped retry-exhausted errors by their original cause', () => {
    const wrapped = new Error('retry exhausted') as Error & { cause: unknown };
    wrapped.cause = new OcrProviderError('too many requests', {
      provider: 'paddleocr-job',
      statusCode: 429,
    });

    expect(classifyOcrError(wrapped)).toMatchObject({
      kind: 'rate_limited',
      retryable: true,
      shouldReduceConcurrency: true,
    });
  });

  it('classifies empty OCR content explicitly', () => {
    expect(classifyOcrError(new EmptyOcrContentError('empty'))).toMatchObject({
      kind: 'empty_content',
      retryable: true,
      shouldReduceConcurrency: false,
    });
  });
});
