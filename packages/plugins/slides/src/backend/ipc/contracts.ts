import {
  SLIDES_TEMPLATE_IMPORT_MAX_BYTES,
  type SlideSourceSpan,
  SLIDES_AUTHORING_KEY_PATTERN,
  type SlidesManualEditCommand,
  type SlidesManualTargetKind,
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

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  fieldName: string,
): void {
  const unknownKey = Object.keys(value).find(key => !allowed.includes(key));
  if (unknownKey) throw new Error(`${fieldName} contains unknown field ${unknownKey}.`);
}

function readAuthoringKey(value: unknown, fieldName: string): string {
  const key = readNonEmptyString(value, fieldName);
  if (!SLIDES_AUTHORING_KEY_PATTERN.test(key)) {
    throw new Error(`${fieldName} must be a valid Slides authoring key.`);
  }
  return key;
}

function readManualTargetKind(value: unknown): SlidesManualTargetKind {
  switch (value) {
    case 'text':
    case 'frame':
    case 'shape':
    case 'image':
    case 'table':
    case 'chart':
    case 'svgGraphic':
    case 'formula':
      return value;
    default:
      throw new Error('operation.targetKind is invalid.');
  }
}

function readFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
  return value;
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

export function parseSlidesManualEditPayload(payload: unknown): SlidesManualEditCommand {
  if (!isRecord(payload)) throw new Error('slides:manual-edit payload must be an object.');
  assertOnlyKeys(payload, ['commandId', 'documentId', 'expectedBase', 'operation'], 'payload');
  const commandId = readNonEmptyString(payload.commandId, 'commandId');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(commandId)) {
    throw new Error('commandId must be a UUID.');
  }
  if (!isRecord(payload.expectedBase)) throw new Error('expectedBase must be an object.');
  assertOnlyKeys(payload.expectedBase, ['revisionId', 'revision', 'sourceHash'], 'expectedBase');
  const revision = payload.expectedBase.revision;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('expectedBase.revision must be a positive safe integer.');
  }
  const sourceHash = readNonEmptyString(payload.expectedBase.sourceHash, 'expectedBase.sourceHash');
  if (!/^[0-9a-f]{64}$/u.test(sourceHash)) {
    throw new Error('expectedBase.sourceHash must be a lowercase SHA-256 digest.');
  }
  if (!isRecord(payload.operation)) throw new Error('operation must be an object.');
  if (!isRecord(payload.operation.target)) throw new Error('operation.target must be an object.');
  assertOnlyKeys(payload.operation.target, ['slideKey', 'editKey'], 'operation.target');
  const target = {
    slideKey: readAuthoringKey(payload.operation.target.slideKey, 'operation.target.slideKey'),
    editKey: readAuthoringKey(payload.operation.target.editKey, 'operation.target.editKey'),
  };
  const base = {
    commandId,
    documentId: readNonEmptyString(payload.documentId, 'documentId'),
    expectedBase: {
      revisionId: readNonEmptyString(payload.expectedBase.revisionId, 'expectedBase.revisionId'),
      revision,
      sourceHash,
    },
  };

  if (payload.operation.op === 'set_text_content') {
    assertOnlyKeys(payload.operation, ['op', 'target', 'content'], 'operation');
    if (typeof payload.operation.content !== 'string') {
      throw new Error('operation.content must be a string.');
    }
    return {
      ...base,
      operation: { op: 'set_text_content', target, content: payload.operation.content },
    };
  }
  if (payload.operation.op === 'set_translation') {
    assertOnlyKeys(payload.operation, ['op', 'target', 'targetKind', 'translation'], 'operation');
    if (!isRecord(payload.operation.translation)) {
      throw new Error('operation.translation must be an object.');
    }
    assertOnlyKeys(payload.operation.translation, ['dx', 'dy'], 'operation.translation');
    return {
      ...base,
      operation: {
        op: 'set_translation',
        target,
        targetKind: readManualTargetKind(payload.operation.targetKind),
        translation: {
          dx: readFiniteNumber(payload.operation.translation.dx, 'operation.translation.dx'),
          dy: readFiniteNumber(payload.operation.translation.dy, 'operation.translation.dy'),
        },
      },
    };
  }
  throw new Error('operation.op is invalid.');
}

export function readSlidesIpcErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
