import type {
  RenderSlideSize,
} from '../../renderModel';
import { isSlideRenderModel } from '../../renderModel';
import {
  SLIDE_RASTER_FORMAT,
  type SlideRasterErrorCode,
  type SlideRasterFailure,
  type SlideRasterRequest,
  type SlideRasterResult,
  type SlideRasterSuccess,
} from '../definitions/slideRasterization';
import {
  SLIDES_RASTER_WORKER_ID,
  SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
  type SlideRasterWorkerReadyPayload,
  type SlideRasterWorkerCancelPayload,
  type SlideRasterWorkerRequestPayload,
  type SlideRasterWorkerResponsePayload,
} from '../definitions/slideRasterWorkerProtocol';

export function createSlideRasterWorkerCancelPayload(
  requestId: string,
): SlideRasterWorkerCancelPayload {
  return {
    requestId: readNonEmptyString(requestId, 'requestId'),
    protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
  };
}

export function parseSlideRasterWorkerCancelPayload(
  payload: unknown,
): SlideRasterWorkerCancelPayload {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['requestId', 'protocolVersion'])) {
    throw new Error('Invalid slides raster worker cancel envelope');
  }
  assertProtocolVersion(payload.protocolVersion);
  return createSlideRasterWorkerCancelPayload(
    readNonEmptyString(payload.requestId, 'requestId'),
  );
}

export function createSlideRasterWorkerRequestPayload(
  request: SlideRasterRequest,
): SlideRasterWorkerRequestPayload {
  return {
    requestId: request.requestId,
    protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
    request,
  };
}

export function parseSlideRasterWorkerRequestPayload(
  payload: unknown,
): SlideRasterWorkerRequestPayload {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['requestId', 'protocolVersion', 'request'])) {
    throw new Error('Invalid slides raster worker request envelope');
  }
  const requestId = readNonEmptyString(payload.requestId, 'requestId');
  assertProtocolVersion(payload.protocolVersion);
  const request = parseSlideRasterRequest(payload.request);
  if (request.requestId !== requestId) {
    throw new Error('Slides raster worker request id mismatch');
  }
  return {
    requestId,
    protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
    request,
  };
}

export function createSlideRasterWorkerResponsePayload(
  result: SlideRasterResult,
): SlideRasterWorkerResponsePayload {
  return {
    requestId: result.requestId,
    protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
    result,
  };
}

export function parseSlideRasterWorkerResponsePayload(
  payload: unknown,
): SlideRasterWorkerResponsePayload {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['requestId', 'protocolVersion', 'result'])) {
    throw new Error('Invalid slides raster worker response envelope');
  }
  const requestId = readNonEmptyString(payload.requestId, 'requestId');
  assertProtocolVersion(payload.protocolVersion);
  const result = parseSlideRasterResult(payload.result);
  if (result.requestId !== requestId) {
    throw new Error('Slides raster worker response id mismatch');
  }
  return {
    requestId,
    protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
    result,
  };
}

export function createSlideRasterWorkerReadyPayload(): SlideRasterWorkerReadyPayload {
  return {
    workerId: SLIDES_RASTER_WORKER_ID,
    protocolVersion: SLIDES_RASTER_WORKER_PROTOCOL_VERSION,
  };
}

export function parseSlideRasterWorkerReadyPayload(
  payload: unknown,
): SlideRasterWorkerReadyPayload {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['workerId', 'protocolVersion'])) {
    throw new Error('Invalid slides raster worker ready payload');
  }
  if (payload.workerId !== SLIDES_RASTER_WORKER_ID) {
    throw new Error('Slides raster worker id mismatch');
  }
  assertProtocolVersion(payload.protocolVersion);
  return createSlideRasterWorkerReadyPayload();
}

export function parseSlideRasterRequest(payload: unknown): SlideRasterRequest {
  if (!isRecord(payload) || !hasOnlyKeys(payload, ['requestId', 'slide', 'slideSize', 'profile'])) {
    throw new Error('Invalid slide raster request');
  }
  const requestId = readNonEmptyString(payload.requestId, 'request.requestId');
  if (!isSlideRenderModel(payload.slide)) {
    throw new Error('Invalid slide raster request slide');
  }
  if (!isRenderSlideSize(payload.slideSize)) {
    throw new Error('Invalid slide raster request slideSize');
  }
  if (!isRecord(payload.profile)
    || !hasOnlyKeys(payload.profile, [
      'id',
      'viewportWidthPx',
      'viewportHeightPx',
      'pixelRatio',
      'format',
      'transparentBackground',
    ])) {
    throw new Error('Invalid slide raster request profile');
  }
  const profile = payload.profile;
  return {
    requestId,
    slide: payload.slide,
    slideSize: payload.slideSize,
    profile: {
      id: readNonEmptyString(profile.id, 'request.profile.id'),
      viewportWidthPx: readPositiveFinite(profile.viewportWidthPx, 'request.profile.viewportWidthPx'),
      viewportHeightPx: readPositiveFinite(profile.viewportHeightPx, 'request.profile.viewportHeightPx'),
      pixelRatio: readPositiveFinite(profile.pixelRatio, 'request.profile.pixelRatio'),
      format: readRasterFormat(profile.format),
      ...(profile.transparentBackground == null
        ? {}
        : {
            transparentBackground: readBoolean(
              profile.transparentBackground,
              'request.profile.transparentBackground',
            ),
          }),
    },
  };
}

export function parseSlideRasterResult(payload: unknown): SlideRasterResult {
  if (!isRecord(payload)) {
    throw new Error('Invalid slide raster result');
  }
  if (payload.status === 'success') {
    return parseSuccess(payload);
  }
  if (payload.status === 'failure') {
    return parseFailure(payload);
  }
  throw new Error('Invalid slide raster result status');
}

export function extractSlideRasterRequestId(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  const requestId = payload.requestId;
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : null;
}

function parseSuccess(payload: Record<string, unknown>): SlideRasterSuccess {
  if (!hasOnlyKeys(payload, [
    'status',
    'requestId',
    'format',
    'widthPx',
    'heightPx',
    'bytes',
  ])) {
    throw new Error('Invalid successful slide raster result');
  }
  if (!(payload.bytes instanceof Uint8Array)) {
    throw new Error('Invalid slide raster result bytes');
  }
  return {
    status: 'success',
    requestId: readNonEmptyString(payload.requestId, 'result.requestId'),
    format: readRasterFormat(payload.format),
    widthPx: readPositiveFinite(payload.widthPx, 'result.widthPx'),
    heightPx: readPositiveFinite(payload.heightPx, 'result.heightPx'),
    bytes: payload.bytes,
  };
}

function parseFailure(payload: Record<string, unknown>): SlideRasterFailure {
  if (!hasOnlyKeys(payload, ['status', 'requestId', 'error']) || !isRecord(payload.error)) {
    throw new Error('Invalid failed slide raster result');
  }
  if (!hasOnlyKeys(payload.error, ['code', 'message']) || !isRasterErrorCode(payload.error.code)) {
    throw new Error('Invalid slide raster failure error');
  }
  return {
    status: 'failure',
    requestId: readNonEmptyString(payload.requestId, 'result.requestId'),
    error: {
      code: payload.error.code,
      message: readNonEmptyString(payload.error.message, 'result.error.message'),
    },
  };
}

function isRenderSlideSize(value: unknown): value is RenderSlideSize {
  return isRecord(value)
    && isPositiveFinite(value.width)
    && isPositiveFinite(value.height)
    && value.unit === 'in';
}

function readRasterFormat(value: unknown): typeof SLIDE_RASTER_FORMAT {
  if (value !== SLIDE_RASTER_FORMAT) {
    throw new Error('Unsupported slide raster format');
  }
  return value;
}

function isRasterErrorCode(value: unknown): value is SlideRasterErrorCode {
  if (typeof value !== 'string') {
    return false;
  }
  switch (value) {
    case 'slides.raster.invalid_request':
    case 'slides.raster.resource_load_failed':
    case 'slides.raster.render_failed':
    case 'slides.raster.encode_failed':
      return true;
    default:
      return false;
  }
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  if (!isNonEmptyString(value)) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function readPositiveFinite(value: unknown, fieldName: string): number {
  if (!isPositiveFinite(value)) {
    throw new Error(`${fieldName} must be a positive finite number`);
  }
  return value;
}

function readBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
}

function assertProtocolVersion(value: unknown): void {
  if (value !== SLIDES_RASTER_WORKER_PROTOCOL_VERSION) {
    throw new Error('Unsupported slides raster worker protocol version');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}
