import { readInsertedObjects } from '@plugin/slides/shared/authoringEditing';
import { readSlidesTextStylePatch, SLIDES_TEXT_STYLE_FIELDS, isEditableTextContent } from '@plugin/slides/shared/authoringEditing';
import {
  SLIDES_TEMPLATE_IMPORT_MAX_BYTES,
  type SlideSourceSpan,
  SLIDES_AUTHORING_KEY_PATTERN,
  type SlidesManualEditCommand,
  type SlidesManualEditCommandOperation,
  type SlidesManualEditOperation,
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
  const base = {
    commandId,
    documentId: readNonEmptyString(payload.documentId, 'documentId'),
    expectedBase: {
      revisionId: readNonEmptyString(payload.expectedBase.revisionId, 'expectedBase.revisionId'),
      revision,
      sourceHash,
    },
  };
  return { ...base, operation: readManualEditOperation(payload.operation) };
}

function readManualEditOperation(operation: Record<string, unknown>): SlidesManualEditCommandOperation {
  if (operation.op === 'set_layer') {
    assertOnlyKeys(operation, ['op', 'target', 'direction'], 'operation');
    if (!isRecord(operation.target)) throw new Error('图层目标无效。');
    assertOnlyKeys(operation.target, ['slideKey', 'editKey'], 'operation.target');
    const direction = operation.direction;
    if (direction !== 'front' && direction !== 'back' && direction !== 'forward' && direction !== 'backward') throw new Error('图层顺序无效。');
    return { op: 'set_layer', target: { slideKey: readAuthoringKey(operation.target.slideKey, 'slideKey'), editKey: readAuthoringKey(operation.target.editKey, 'editKey') }, direction };
  }
  if (operation.op === 'move_slide') {
    assertOnlyKeys(operation, ['op', 'index', 'toIndex'], 'operation');
    const index = operation.index;
    const toIndex = operation.toIndex;
    if (typeof index !== 'number' || typeof toIndex !== 'number' || !Number.isSafeInteger(index) || !Number.isSafeInteger(toIndex) || index < 0 || toIndex < 0) throw new Error('页面顺序无效。');
    return { op: 'move_slide', index, toIndex };
  }
  if (operation.op === 'insert_objects') {
    assertOnlyKeys(operation, ['op', 'index', 'objects'], 'operation');
    const parsed = readInsertedObjects(operation.objects);
    if ('error' in parsed) throw new Error(parsed.error);
    if (parsed.value.length === 0) throw new Error('至少需要一个新增对象。');
    const index = operation.index;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) throw new Error('新增对象的页面位置无效。');
    return { op: 'insert_objects', index, objects: parsed.value };
  }
  if (operation.op === 'insert_blank_slide' || operation.op === 'duplicate_slide' || operation.op === 'delete_slide') {
    assertOnlyKeys(operation, ['op', 'index'], 'operation');
    const index = operation.index;
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) throw new Error('operation.index must be a non-negative safe integer.');
    return { op: operation.op, index };
  }
  if (operation.op === 'undo' || operation.op === 'redo') {
    assertOnlyKeys(operation, ['op'], 'operation');
    return { op: operation.op };
  }
  if (operation.op === 'batch') {
    assertOnlyKeys(operation, ['op', 'operations'], 'operation');
    if (!Array.isArray(operation.operations) || operation.operations.length === 0 || operation.operations.length > 1000) {
      throw new Error('A batch must contain 1..1000 object operations.');
    }
    return { op: 'batch', operations: operation.operations.map(item => {
      if (!isRecord(item)) throw new Error('A batch entry must be an object operation.');
      return readManualObjectOperation(item);
    }) };
  }
  return readManualObjectOperation(operation);
}

function readManualObjectOperation(operation: Record<string, unknown>): SlidesManualEditOperation {
  if (!isRecord(operation.target)) throw new Error('operation.target must be an object.');
  assertOnlyKeys(operation.target, ['slideKey', 'editKey'], 'operation.target');
  const target = {
    slideKey: readAuthoringKey(operation.target.slideKey, 'operation.target.slideKey'),
    editKey: readAuthoringKey(operation.target.editKey, 'operation.target.editKey'),
  };

  if (operation.op === 'set_text_width') {
    assertOnlyKeys(operation, ['op', 'target', 'targetKind', 'width'], 'operation');
    const width = readFiniteNumber(operation.width, 'operation.width');
    if (operation.targetKind !== 'text' || width <= 0) throw new Error('文字宽度无效。');
    return { op: 'set_text_width', target, targetKind: 'text', width };
  }
  if (operation.op === 'set_image') {
    assertOnlyKeys(operation, ['op', 'target', 'targetKind', 'assetId', 'fit'], 'operation');
    const assetId = operation.assetId === undefined ? undefined : readNonEmptyString(operation.assetId, 'operation.assetId');
    const fit = operation.fit;
    if (operation.targetKind !== 'image' || (fit !== undefined && fit !== 'contain' && fit !== 'cover') || (!assetId && !fit)) throw new Error('图片修改无效。');
    return { op: 'set_image', target, targetKind: 'image', ...(assetId ? { assetId } : {}), ...(fit ? { fit } : {}) };
  }
  if (operation.op === 'set_text_content') {
    assertOnlyKeys(operation, ['op', 'target', 'targetKind', 'content'], 'operation');
    if (operation.targetKind !== 'text' && operation.targetKind !== 'shape') {
      throw new Error('operation.targetKind must be text or shape.');
    }
    if (!isEditableTextContent(operation.content)) throw new Error('operation.content must be text or text runs.');
    if (operation.targetKind === 'shape') {
      if (typeof operation.content !== 'string') throw new Error('Shape content must be a string.');
      return { op: 'set_text_content', target, targetKind: 'shape', content: operation.content };
    }
    return { op: 'set_text_content', target, targetKind: operation.targetKind, content: operation.content };
  }
  if (operation.op === 'set_translation') {
    assertOnlyKeys(operation, ['op', 'target', 'targetKind', 'translation'], 'operation');
    if (!isRecord(operation.translation)) {
      throw new Error('operation.translation must be an object.');
    }
    assertOnlyKeys(operation.translation, ['dx', 'dy'], 'operation.translation');
    return {
        op: 'set_translation',
        target,
        targetKind: readManualTargetKind(operation.targetKind),
        translation: {
          dx: readFiniteNumber(operation.translation.dx, 'operation.translation.dx'),
          dy: readFiniteNumber(operation.translation.dy, 'operation.translation.dy'),
        },
    };
  }
  if (operation.op === 'translate_by') {
    assertOnlyKeys(operation, ['op', 'target', 'targetKind', 'delta'], 'operation');
    if (!isRecord(operation.delta)) {
      throw new Error('operation.delta must be an object.');
    }
    assertOnlyKeys(operation.delta, ['dx', 'dy'], 'operation.delta');
    return {
        op: 'translate_by',
        target,
        targetKind: readManualTargetKind(operation.targetKind),
        delta: {
          dx: readFiniteNumber(operation.delta.dx, 'operation.delta.dx'),
          dy: readFiniteNumber(operation.delta.dy, 'operation.delta.dy'),
        },
    };
  }
  if (operation.op === 'set_text_style') {
    assertOnlyKeys(operation, ['op', 'target', ...SLIDES_TEXT_STYLE_FIELDS], 'operation');
    const patch = readSlidesTextStylePatch(operation);
    if ('error' in patch) throw new Error(patch.error);
    if (Object.keys(patch.value).length === 0) throw new Error('文本样式操作至少需要一个值。');
    return { op: 'set_text_style', target, ...patch.value };
  }
  if (operation.op === 'set_fill_color') {
    assertOnlyKeys(operation, ['op', 'target', 'targetKind', 'color'], 'operation');
    const targetKind = readManualTargetKind(operation.targetKind);
    if (targetKind !== 'frame' && targetKind !== 'shape') {
      throw new Error('operation.targetKind must be frame or shape.');
    }
    return {
        op: 'set_fill_color',
        target,
        targetKind,
        color: readHexColor(operation.color, 'operation.color'),
    };
  }
  if (operation.op === 'set_visual_size') {
    assertOnlyKeys(operation, ['op', 'target', 'targetKind', 'visualSize', 'translationDelta'], 'operation');
    const targetKind = readManualTargetKind(operation.targetKind);
    if (targetKind !== 'shape' && targetKind !== 'image') {
      throw new Error('operation.targetKind must be shape or image.');
    }
    if (!isRecord(operation.visualSize)) {
      throw new Error('operation.visualSize must be an object.');
    }
    assertOnlyKeys(operation.visualSize, ['width', 'height'], 'operation.visualSize');
    const width = readFiniteNumber(operation.visualSize.width, 'operation.visualSize.width');
    const height = readFiniteNumber(operation.visualSize.height, 'operation.visualSize.height');
    let translationDelta: { dx: number; dy: number } | undefined;
    if (operation.translationDelta !== undefined) {
      const delta = operation.translationDelta;
      if (!isRecord(delta)) throw new Error('operation.translationDelta must be an object.');
      assertOnlyKeys(delta, ['dx', 'dy'], 'operation.translationDelta');
      translationDelta = {
        dx: readFiniteNumber(delta.dx, 'operation.translationDelta.dx'),
        dy: readFiniteNumber(delta.dy, 'operation.translationDelta.dy'),
      };
    }
    if (width <= 0 || height <= 0) {
      throw new Error('operation.visualSize width and height must be positive.');
    }
    return { op: 'set_visual_size', target, targetKind, visualSize: { width, height }, ...(translationDelta ? { translationDelta } : {}) };
  }
  if (operation.op === 'delete_target') {
    assertOnlyKeys(operation, ['op', 'target', 'targetKind'], 'operation');
    const targetKind = readManualTargetKind(operation.targetKind);
    return { op: 'delete_target', target, targetKind };
  }
  throw new Error('operation.op is invalid.');
}

function readHexColor(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^#[0-9A-Fa-f]{6}$/u.test(value)) {
    throw new Error(`${path} must be #RRGGBB.`);
  }
  return value;
}

export function readSlidesIpcErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
