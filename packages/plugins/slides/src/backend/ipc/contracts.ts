import {
  SLIDES_TEMPLATE_IMPORT_MAX_BYTES,
  type SlideSourceSpan,
  type SlidesIpcChannel,
  type SlidesSourceSliceTargetInput,
  parsePresentationExportRequest,
} from '@plugin/slides/shared';

export {
  SLIDES_IPC,
  SLIDES_IPC_CHANNELS,
  SLIDES_PLUGIN_ID,
  SLIDES_TEMPLATE_IMPORT_MAX_BYTES,
} from '@plugin/slides/shared';
export type {
  OperationResult,
  SlidesIpcChannel,
} from '@plugin/slides/shared';

export interface SlidesNodePayload {
  nodeId: string;
}

export interface SlidesSourceSlicesPayload extends SlidesNodePayload {
  conversationId: string;
  targets: SlidesSourceSliceTargetInput[];
}

export interface SlidesTemplateImportPayload {
  fileName: string;
  name: string;
  description?: string;
  buffer: Buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

function readOptionalNonEmptyString(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return readNonEmptyString(value, fieldName);
}

function isSourceSpan(value: unknown): value is SlideSourceSpan {
  return isRecord(value)
    && typeof value.startLine === 'number'
    && Number.isFinite(value.startLine)
    && typeof value.endLine === 'number'
    && Number.isFinite(value.endLine);
}

function isSourceSliceTarget(value: unknown): value is SlidesSourceSliceTargetInput {
  return isRecord(value)
    && typeof value.elementId === 'string'
    && value.elementId.trim().length > 0
    && typeof value.slideNumber === 'number'
    && Number.isFinite(value.slideNumber)
    && typeof value.kind === 'string'
    && value.kind.trim().length > 0
    && isSourceSpan(value.sourceSpan);
}

function isSourceSliceTargetArray(value: unknown): value is SlidesSourceSliceTargetInput[] {
  return Array.isArray(value) && value.length > 0 && value.every(isSourceSliceTarget);
}

function readBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('buffer must be an ArrayBuffer, typed array, or Buffer.');
}

export function parseSlidesNodePayload(payload: unknown, channel: SlidesIpcChannel): SlidesNodePayload {
  if (!isRecord(payload)) {
    throw new Error(`${channel} payload must be an object.`);
  }
  return {
    nodeId: readNonEmptyString(payload.nodeId, 'nodeId'),
  };
}

export { parsePresentationExportRequest };

export function parseSlidesSourceSlicesPayload(payload: unknown): SlidesSourceSlicesPayload {
  const base = parseSlidesNodePayload(payload, 'slides:source-slices');
  if (!isRecord(payload)) {
    throw new Error('slides:source-slices payload must be an object.');
  }
  if (!isSourceSliceTargetArray(payload.targets)) {
    throw new Error('targets must contain valid source slice targets.');
  }

  return {
    ...base,
    conversationId: readNonEmptyString(payload.conversationId, 'conversationId'),
    targets: payload.targets,
  };
}

export function parseSlidesTemplateImportPayload(payload: unknown): SlidesTemplateImportPayload {
  if (!isRecord(payload)) {
    throw new Error('slides:template-import payload must be an object.');
  }
  const buffer = readBuffer(payload.buffer);
  if (buffer.length === 0) {
    throw new Error('PPTX file is required.');
  }
  if (buffer.length > SLIDES_TEMPLATE_IMPORT_MAX_BYTES) {
    throw new Error(`PPTX file is too large. Maximum size is ${SLIDES_TEMPLATE_IMPORT_MAX_BYTES} bytes.`);
  }

  return {
    buffer,
    fileName: readNonEmptyString(payload.fileName, 'fileName'),
    name: readNonEmptyString(payload.name, 'name'),
    description: readOptionalNonEmptyString(payload.description, 'description'),
  };
}

export function readSlidesIpcErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
