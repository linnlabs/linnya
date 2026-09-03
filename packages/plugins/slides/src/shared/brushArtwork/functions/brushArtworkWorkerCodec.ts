import {
  SLIDES_BRUSH_WORKER_ID,
  SLIDES_BRUSH_WORKER_PROTOCOL_VERSION,
  type BrushArtworkWorkerCancelPayload,
  type BrushArtworkWorkerReadyPayload,
  type BrushArtworkWorkerRequestPayload,
  type BrushArtworkWorkerResponsePayload,
} from '../definitions/brushArtworkWorkerProtocol';
import type {
  BrushArtworkRenderRequest,
  BrushArtworkRenderResult,
} from '../definitions/brushArtwork';
import {
  parseBrushArtworkRenderRequest,
  parseBrushArtworkRenderResult,
} from './brushArtworkContract';

export function createBrushArtworkWorkerRequestPayload(
  request: BrushArtworkRenderRequest,
): BrushArtworkWorkerRequestPayload {
  return {
    requestId: request.requestId,
    protocolVersion: SLIDES_BRUSH_WORKER_PROTOCOL_VERSION,
    request,
  };
}

export function parseBrushArtworkWorkerRequestPayload(
  value: unknown,
): BrushArtworkWorkerRequestPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['requestId', 'protocolVersion', 'request'])) {
    throw new Error('Invalid Brush worker request envelope.');
  }
  assertProtocol(value.protocolVersion);
  const request = parseBrushArtworkRenderRequest(value.request);
  if (request.requestId !== value.requestId) throw new Error('Brush worker request id mismatch.');
  return createBrushArtworkWorkerRequestPayload(request);
}

export function createBrushArtworkWorkerResponsePayload(
  result: BrushArtworkRenderResult,
): BrushArtworkWorkerResponsePayload {
  return {
    requestId: result.requestId,
    protocolVersion: SLIDES_BRUSH_WORKER_PROTOCOL_VERSION,
    result,
  };
}

export function parseBrushArtworkWorkerResponsePayload(
  value: unknown,
): BrushArtworkWorkerResponsePayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['requestId', 'protocolVersion', 'result'])) {
    throw new Error('Invalid Brush worker response envelope.');
  }
  assertProtocol(value.protocolVersion);
  const result = parseBrushArtworkRenderResult(value.result);
  if (result.requestId !== value.requestId) throw new Error('Brush worker response id mismatch.');
  return createBrushArtworkWorkerResponsePayload(result);
}

export function createBrushArtworkWorkerReadyPayload(): BrushArtworkWorkerReadyPayload {
  return {
    workerId: SLIDES_BRUSH_WORKER_ID,
    protocolVersion: SLIDES_BRUSH_WORKER_PROTOCOL_VERSION,
  };
}

export function parseBrushArtworkWorkerReadyPayload(
  value: unknown,
): BrushArtworkWorkerReadyPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['workerId', 'protocolVersion'])
    || value.workerId !== SLIDES_BRUSH_WORKER_ID) {
    throw new Error('Invalid Brush worker ready payload.');
  }
  assertProtocol(value.protocolVersion);
  return createBrushArtworkWorkerReadyPayload();
}

export function createBrushArtworkWorkerCancelPayload(
  requestId: string,
): BrushArtworkWorkerCancelPayload {
  return {
    requestId: readRequestId(requestId),
    protocolVersion: SLIDES_BRUSH_WORKER_PROTOCOL_VERSION,
  };
}

export function parseBrushArtworkWorkerCancelPayload(
  value: unknown,
): BrushArtworkWorkerCancelPayload {
  if (!isRecord(value) || !hasOnlyKeys(value, ['requestId', 'protocolVersion'])) {
    throw new Error('Invalid Brush worker cancel payload.');
  }
  assertProtocol(value.protocolVersion);
  return createBrushArtworkWorkerCancelPayload(readRequestId(value.requestId));
}

export function extractBrushArtworkRequestId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.requestId === 'string' && value.requestId.length > 0
    ? value.requestId
    : null;
}

function assertProtocol(value: unknown): void {
  if (value !== SLIDES_BRUSH_WORKER_PROTOCOL_VERSION) {
    throw new Error('Unsupported Brush worker protocol version.');
  }
}

function readRequestId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('requestId must be non-empty.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}
