import * as z from 'zod';
import { SLIDES_TEMPLATE_IMPORT_MAX_BYTES } from '../../ipc';
import {
  SLIDES_AUTHORING_KEY_PATTERN,
  isEditableTextContent,
  readInsertedObjects,
  readSlidesTextStylePatch,
  SLIDES_TEXT_STYLE_FIELDS,
} from '../../authoringEditing';
import type { SlidesManualEditCommand, SlidesManualEditOperation } from '../../authoringEditing';

const identity = z.string().refine(value => value.trim().length > 0, '不能为空');
const authorKey = z.string().regex(SLIDES_AUTHORING_KEY_PATTERN, '作者标识无效');
const target = z.object({ slideKey: authorKey, editKey: authorKey }).strict();
const targetKind = z.enum([
  'text',
  'shape',
  'image',
  'frame',
  'table',
  'chart',
  'svgGraphic',
  'formula',
]);
const finite = z.number().finite();
const index = finite.int().safe().nonnegative();
const translation = z.object({ dx: finite, dy: finite }).strict();
const color = z.string().regex(/^#[0-9a-f]{6}$/iu, '颜色必须是 #RRGGBB');
const editableText = z.custom<import('../../authoringEditing').SlidesEditableTextContent>(
  isEditableTextContent,
  '正文必须是文字或文字 run 数组'
);
const objects = z
  .unknown()
  .transform((value, context) => {
    const result = readInsertedObjects(value);
    if ('error' in result) {
      context.addIssue({ code: 'custom', message: result.error });
      return z.NEVER;
    }
    return result.value;
  })
  .refine(value => value.length > 0, '至少需要一个新增对象');
const style = z
  .object({
    op: z.literal('set_text_style'),
    target,
    fontSizePt: z.unknown().optional(),
    color: z.unknown().optional(),
    bold: z.unknown().optional(),
    italic: z.unknown().optional(),
    underline: z.unknown().optional(),
    align: z.unknown().optional(),
  })
  .strict()
  .transform((value, context) => {
    const result = readSlidesTextStylePatch(value);
    if ('error' in result) {
      context.addIssue({ code: 'custom', message: result.error });
      return z.NEVER;
    }
    if (!SLIDES_TEXT_STYLE_FIELDS.some(field => value[field] !== undefined)) {
      context.addIssue({ code: 'custom', message: '文本样式至少需要一个值' });
      return z.NEVER;
    }
    return { op: value.op, target: value.target, ...result.value };
  });

export const SlidesManualObjectOperationSchema: z.ZodType<
  SlidesManualEditOperation,
  unknown
> = z.union([
  z
    .object({
      op: z.literal('set_text_width'),
      target,
      targetKind: z.literal('text'),
      width: finite.positive(),
    })
    .strict(),
  z
    .object({
      op: z.literal('set_image'),
      target,
      targetKind: z.literal('image'),
      assetId: identity.optional(),
      fit: z.enum(['contain', 'cover']).optional(),
    })
    .strict()
    .refine(
      value => value.assetId !== undefined || value.fit !== undefined,
      '图片修改至少需要一个值'
    ),
  z
    .object({
      op: z.literal('set_text_content'),
      target,
      targetKind: z.literal('text'),
      content: editableText,
    })
    .strict(),
  z
    .object({
      op: z.literal('set_text_content'),
      target,
      targetKind: z.literal('shape'),
      content: z.string(),
    })
    .strict(),
  z.object({ op: z.literal('set_translation'), target, targetKind, translation }).strict(),
  z.object({ op: z.literal('translate_by'), target, targetKind, delta: translation }).strict(),
  style,
  z
    .object({
      op: z.literal('set_fill_color'),
      target,
      targetKind: z.enum(['frame', 'shape']),
      color,
    })
    .strict(),
  z
    .object({
      op: z.literal('set_visual_size'),
      target,
      targetKind: z.enum(['shape', 'image']),
      visualSize: z.object({ width: finite.positive(), height: finite.positive() }).strict(),
      translationDelta: translation.optional(),
    })
    .strict(),
  z.object({ op: z.literal('delete_target'), target, targetKind }).strict(),
]);

export const SlidesManualEditCommandSchema: z.ZodType<
  SlidesManualEditCommand,
  unknown
> = z
  .object({
    commandId: z.string().uuid(),
    documentId: identity,
    expectedBase: z
      .object({
        revisionId: identity,
        revision: finite.int().safe().positive(),
        sourceHash: z.string().regex(/^[0-9a-f]{64}$/u, '必须是小写 SHA-256'),
      })
      .strict(),
    operation: z.union([
      SlidesManualObjectOperationSchema,
      z
        .object({
          op: z.literal('batch'),
          operations: z.array(SlidesManualObjectOperationSchema).min(1).max(1000),
        })
        .strict(),
      z
        .object({
          op: z.literal('set_layer'),
          target,
          direction: z.enum(['front', 'back', 'forward', 'backward']),
        })
        .strict(),
      z.object({ op: z.literal('insert_objects'), index, objects }).strict(),
      z
        .object({ op: z.enum(['insert_blank_slide', 'duplicate_slide', 'delete_slide']), index })
        .strict(),
      z.object({ op: z.literal('move_slide'), index, toIndex: index }).strict(),
      z.object({ op: z.enum(['undo', 'redo']) }).strict(),
    ]),
  })
  .strict();

export const SlidesNodePayloadSchema = z.object({ nodeId: identity }).strict();
export const SlidesHistoryPreviewSchema = z
  .object({ documentId: identity, versionId: identity })
  .strict();
export const SlidesCopyObjectsSchema = z
  .object({ documentId: identity, revisionId: identity, targets: z.array(target).min(1).max(1000) })
  .strict();
export const SlidesSourceSlicesSchema = z
  .object({
    nodeId: identity,
    conversationId: identity,
    targets: z
      .array(
        z
          .object({
            elementId: identity,
            slideNumber: finite,
            kind: identity,
            sourceSpan: z.object({ startLine: finite, endLine: finite }).strict(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

/** 与模板导入共用结构化克隆的二进制，不在插件里扩大为 base64 字符串。 */
const binary = z
  .custom<
    ArrayBuffer | ArrayBufferView
  >(value => value instanceof ArrayBuffer || ArrayBuffer.isView(value), '必须是二进制缓冲区')
  .transform(value =>
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  );
export const SLIDES_IMAGE_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const SlidesImportImageSchema = z
  .object({
    documentId: identity,
    bytes: binary.refine(
      value => value.byteLength > 0 && value.byteLength <= SLIDES_IMAGE_IMPORT_MAX_BYTES,
      '图片大小必须在 20 MB 内'
    ),
  })
  .strict();
export const SlidesTemplateImportSchema = z
  .object({
    fileName: identity,
    name: identity,
    description: identity.nullish().transform(value => value ?? undefined),
    buffer: binary.refine(
      value => value.byteLength > 0 && value.byteLength <= SLIDES_TEMPLATE_IMPORT_MAX_BYTES,
      '模板大小必须在 50 MB 内'
    ),
  })
  .strict();
