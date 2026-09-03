import type { TypecheckResult } from '../../../sandbox/codegenTypecheck';
import type { SandboxJsonObject } from '@plugin/backend/sandboxRuntime';
import { isMathFormulaErrorCode } from '@plugin/slides/shared';
import { isSandboxJsonObject, measureJsonBytes } from '../../../sandbox/sandboxJson';
import {
  PRESENTATION_BUILD_COMPOSE_PAYLOAD_MAX_BYTES,
  PRESENTATION_BUILD_DIAGNOSTIC_MAX_COUNT,
  PRESENTATION_BUILD_DIAGNOSTIC_MESSAGE_MAX_CHARS,
  PRESENTATION_BUILD_DIAGNOSTIC_SNIPPET_MAX_CHARS,
  PRESENTATION_BUILD_RESULT_MESSAGE_MAX_CHARS,
  PRESENTATION_BUILD_MATERIALIZATION_RESULT_MAX_BYTES,
  PRESENTATION_BUILD_SOURCE_MAX_BYTES,
  PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
  type PresentationBuildWorkerRequest,
  type PresentationBuildWorkerResponse,
  type PresentationBuildWorkerCompileComposeRequest,
  type PresentationBuildWorkerCompileComposeResultMessage,
  type PresentationBuildWorkerFailureMessage,
  type PresentationBuildWorkerMaterializeRequest,
  type PresentationBuildWorkerMaterializeResultMessage,
  type PresentationBuildWorkerTypecheckRequest,
  type PresentationBuildWorkerTypecheckResultMessage,
} from '../definitions/presentationBuildWorkerProtocol';
import type {
  PresentationComposeCompilationResult,
  PresentationMaterializationInput,
} from '../definitions/presentationBuildExecution';
import {
  encodePresentationMaterializationInput,
  readPresentationMaterializationInput,
} from './presentationMaterializationCodec';

const TYPECHECK_DIAGNOSTIC_CATEGORIES = new Set([
  'error',
  'warning',
  'message',
  'suggestion',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireProtocolVersion(value: Record<string, unknown>): void {
  if (value.protocolVersion !== PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION) {
    throw new Error('Slides build worker protocol version mismatch.');
  }
}

function requireRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new Error('Slides build worker request id is invalid.');
  }
  return value;
}

function readTypecheckResult(value: unknown): TypecheckResult {
  if (!isRecord(value)) {
    throw new Error('Slides build worker typecheck result must be an object.');
  }
  if (
    typeof value.ok !== 'boolean'
    || typeof value.elapsedMs !== 'number'
    || !Number.isFinite(value.elapsedMs)
    || value.elapsedMs < 0
    || typeof value.message !== 'string'
    || value.message.length > PRESENTATION_BUILD_RESULT_MESSAGE_MAX_CHARS
    || !Array.isArray(value.records)
    || value.records.length > PRESENTATION_BUILD_DIAGNOSTIC_MAX_COUNT
  ) {
    throw new Error('Slides build worker typecheck result fields are invalid.');
  }

  const records = value.records.map((record) => {
    if (!isRecord(record)) {
      throw new Error('Slides build worker diagnostic must be an object.');
    }
    if (
      typeof record.line !== 'number'
      || !Number.isInteger(record.line)
      || record.line < 1
      || typeof record.column !== 'number'
      || !Number.isInteger(record.column)
      || record.column < 1
      || typeof record.code !== 'number'
      || !Number.isInteger(record.code)
      || typeof record.category !== 'string'
      || !TYPECHECK_DIAGNOSTIC_CATEGORIES.has(record.category)
      || typeof record.message !== 'string'
      || record.message.length > PRESENTATION_BUILD_DIAGNOSTIC_MESSAGE_MAX_CHARS
      || (record.snippet !== undefined && typeof record.snippet !== 'string')
      || (typeof record.snippet === 'string'
        && record.snippet.length > PRESENTATION_BUILD_DIAGNOSTIC_SNIPPET_MAX_CHARS)
    ) {
      throw new Error('Slides build worker diagnostic fields are invalid.');
    }
    return {
      line: record.line,
      column: record.column,
      code: record.code,
      category: readDiagnosticCategory(record.category),
      message: record.message,
      ...(typeof record.snippet === 'string' ? { snippet: record.snippet } : {}),
    };
  });

  return {
    ok: value.ok,
    elapsedMs: value.elapsedMs,
    message: value.message,
    records,
  };
}

function readComposeCompilationResult(value: unknown): PresentationComposeCompilationResult {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new Error('Slides build worker compose result is invalid.');
  }
  if (value.ok) {
    if (
      !isSandboxJsonObject(value.input)
      || measureJsonBytes(value.input) > PRESENTATION_BUILD_COMPOSE_PAYLOAD_MAX_BYTES
    ) {
      throw new Error('Slides build worker compose result payload is invalid.');
    }
    return { ok: true, input: value.input };
  }
  if (
    (value.kind !== 'compose_contract' && value.kind !== 'layout_unavailable')
    || typeof value.message !== 'string'
    || value.message.length > PRESENTATION_BUILD_RESULT_MESSAGE_MAX_CHARS
  ) {
    throw new Error('Slides build worker compose failure is invalid.');
  }
  return { ok: false, kind: value.kind, message: value.message };
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function readDiagnosticCategory(
  value: string,
): TypecheckResult['records'][number]['category'] {
  switch (value) {
    case 'error':
    case 'warning':
    case 'message':
    case 'suggestion':
      return value;
  }
  throw new Error('Slides build worker diagnostic category is invalid.');
}

export function createPresentationBuildWorkerTypecheckRequest(input: {
  readonly requestId: string;
  readonly source: string;
}): PresentationBuildWorkerTypecheckRequest {
  if (Buffer.byteLength(input.source, 'utf8') > PRESENTATION_BUILD_SOURCE_MAX_BYTES) {
    throw new Error('Slides deck.js source exceeds the build worker byte limit.');
  }
  return {
    protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
    type: 'typecheck',
    requestId: requireRequestId(input.requestId),
    source: input.source,
  };
}

export function createPresentationBuildWorkerCompileComposeRequest(input: {
  readonly requestId: string;
  readonly payload: SandboxJsonObject;
}): PresentationBuildWorkerCompileComposeRequest {
  if (!isSandboxJsonObject(input.payload)) {
    throw new Error('Slides compose payload must be a finite JSON object.');
  }
  if (measureJsonBytes(input.payload) > PRESENTATION_BUILD_COMPOSE_PAYLOAD_MAX_BYTES) {
    throw new Error('Slides compose payload exceeds the build worker byte limit.');
  }
  return {
    protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
    type: 'compile_compose',
    requestId: requireRequestId(input.requestId),
    payload: input.payload,
  };
}

export function createPresentationBuildWorkerMaterializeRequest(input: {
  readonly requestId: string;
  readonly materialization: PresentationMaterializationInput;
}): PresentationBuildWorkerMaterializeRequest {
  const encoded = encodePresentationMaterializationInput(input.materialization);
  return {
    protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
    type: 'materialize',
    requestId: requireRequestId(input.requestId),
    deckSpec: encoded.deckSpec,
    svgAssets: encoded.svgAssets,
    svgFallbacks: encoded.svgFallbacks,
  };
}

export function createPresentationBuildWorkerTypecheckResultMessage(input: {
  readonly requestId: string;
  readonly result: TypecheckResult;
}): PresentationBuildWorkerTypecheckResultMessage {
  return {
    protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
    type: 'typecheck_result',
    requestId: requireRequestId(input.requestId),
    result: {
      ok: input.result.ok,
      elapsedMs: input.result.elapsedMs,
      message: truncateText(
        input.result.message,
        PRESENTATION_BUILD_RESULT_MESSAGE_MAX_CHARS,
      ),
      records: input.result.records
        .slice(0, PRESENTATION_BUILD_DIAGNOSTIC_MAX_COUNT)
        .map(record => ({
          line: record.line,
          column: record.column,
          code: record.code,
          category: record.category,
          message: truncateText(
            record.message,
            PRESENTATION_BUILD_DIAGNOSTIC_MESSAGE_MAX_CHARS,
          ),
          ...(record.snippet === undefined
            ? {}
            : {
              snippet: truncateText(
                record.snippet,
                PRESENTATION_BUILD_DIAGNOSTIC_SNIPPET_MAX_CHARS,
              ),
            }),
        })),
    },
  };
}

export function createPresentationBuildWorkerCompileComposeResultMessage(input: {
  readonly requestId: string;
  readonly result: PresentationComposeCompilationResult;
}): PresentationBuildWorkerCompileComposeResultMessage {
  const result = input.result.ok
    ? readComposeCompilationResult(input.result)
    : {
      ok: false as const,
      kind: input.result.kind,
      message: truncateText(
        input.result.message,
        PRESENTATION_BUILD_RESULT_MESSAGE_MAX_CHARS,
      ),
    };
  return {
    protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
    type: 'compile_compose_result',
    requestId: requireRequestId(input.requestId),
    result,
  };
}

export function createPresentationBuildWorkerMaterializeResultMessage(input: {
  readonly requestId: string;
  readonly buffer: ArrayBuffer;
}): PresentationBuildWorkerMaterializeResultMessage {
  requirePptxBuffer(input.buffer);
  return {
    protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
    type: 'materialize_result',
    requestId: requireRequestId(input.requestId),
    buffer: input.buffer,
  };
}

export function createPresentationBuildWorkerFailureMessage(input: {
  readonly requestId: string;
  readonly message: string;
  readonly failure: PresentationBuildWorkerFailureMessage['failure'];
}): PresentationBuildWorkerFailureMessage {
  const requestId = requireRequestId(input.requestId);
  const message = truncateText(input.message, PRESENTATION_BUILD_RESULT_MESSAGE_MAX_CHARS);
  if (input.failure.kind === 'execution') {
    return {
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'failure',
      requestId,
      message,
      failure: { kind: 'execution' },
    };
  }
  return {
    protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
    type: 'failure',
    requestId,
    message,
    failure: { kind: 'formula', code: input.failure.code },
  };
}

export function parsePresentationBuildWorkerRequest(
  value: unknown,
): PresentationBuildWorkerRequest {
  if (!isRecord(value)) {
    throw new Error('Slides build worker request must be an object.');
  }
  requireProtocolVersion(value);
  if (value.type === 'typecheck' && typeof value.source === 'string') {
    return createPresentationBuildWorkerTypecheckRequest({
      requestId: requireRequestId(value.requestId),
      source: value.source,
    });
  }
  if (value.type === 'compile_compose' && isSandboxJsonObject(value.payload)) {
    return createPresentationBuildWorkerCompileComposeRequest({
      requestId: requireRequestId(value.requestId),
      payload: value.payload,
    });
  }
  if (
    value.type === 'materialize'
    && isSandboxJsonObject(value.deckSpec)
    && Array.isArray(value.svgAssets)
    && value.svgAssets.every(isSandboxJsonObject)
    && Array.isArray(value.svgFallbacks)
  ) {
    readPresentationMaterializationInput({
      deckSpec: value.deckSpec,
      svgAssets: value.svgAssets,
      svgFallbacks: value.svgFallbacks,
    });
    return {
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'materialize',
      requestId: requireRequestId(value.requestId),
      deckSpec: value.deckSpec,
      svgAssets: value.svgAssets,
      svgFallbacks: value.svgFallbacks,
    };
  }
  throw new Error('Slides build worker request type is invalid.');
}

export function parsePresentationBuildWorkerResponse(
  value: unknown,
): PresentationBuildWorkerResponse {
  if (!isRecord(value)) {
    throw new Error('Slides build worker response must be an object.');
  }
  requireProtocolVersion(value);
  if (value.type === 'ready') {
    return {
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'ready',
    };
  }
  const requestId = requireRequestId(value.requestId);
  if (value.type === 'typecheck_result') {
    return {
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'typecheck_result',
      requestId,
      result: readTypecheckResult(value.result),
    };
  }
  if (value.type === 'compile_compose_result') {
    return {
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'compile_compose_result',
      requestId,
      result: readComposeCompilationResult(value.result),
    };
  }
  if (value.type === 'materialize_result' && value.buffer instanceof ArrayBuffer) {
    requirePptxBuffer(value.buffer);
    return {
      protocolVersion: PRESENTATION_BUILD_WORKER_PROTOCOL_VERSION,
      type: 'materialize_result',
      requestId,
      buffer: value.buffer,
    };
  }
  if (
    value.type === 'failure'
    && typeof value.message === 'string'
    && value.message.length <= PRESENTATION_BUILD_RESULT_MESSAGE_MAX_CHARS
    && isRecord(value.failure)
  ) {
    if (value.failure.kind === 'execution') {
      return createPresentationBuildWorkerFailureMessage({
        requestId,
        message: value.message,
        failure: { kind: 'execution' },
      });
    }
    if (
      value.failure.kind === 'formula'
      && isMathFormulaErrorCode(value.failure.code)
    ) {
      return createPresentationBuildWorkerFailureMessage({
        requestId,
        message: value.message,
        failure: { kind: 'formula', code: value.failure.code },
      });
    }
  }
  throw new Error('Slides build worker response type is invalid.');
}

function requirePptxBuffer(buffer: ArrayBuffer): void {
  if (
    buffer.byteLength < 4
    || buffer.byteLength > PRESENTATION_BUILD_MATERIALIZATION_RESULT_MAX_BYTES
  ) {
    throw new Error('Slides build worker PPTX result size is invalid.');
  }
  const signature = new Uint8Array(buffer, 0, 4);
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new Error('Slides build worker PPTX result is not a ZIP package.');
  }
}
