import { z } from 'zod';
import { JsonValueSchema, type JsonValue } from '@app/schemas';
import { isCanvasContentWithinDepth } from '../functions/isCanvasContentWithinDepth';
import { CANVAS_CONTENT_MAX_DEPTH } from './canvasContentLimits';

export const CanvasCardIdSchema = z.string().regex(/^c[1-9]\d*$/).brand<'CanvasCardId'>();
export const CanvasEdgeIdSchema = z.string().regex(/^e[1-9]\d*$/).brand<'CanvasEdgeId'>();
export const CanvasElementIdSchema = z.union([CanvasCardIdSchema, CanvasEdgeIdSchema]);
export const CanvasColorSchema = z.enum(['white', 'red', 'orange', 'yellow', 'green', 'cyan', 'purple']);
export const CanvasSourceSchema = z.object({
  kind: z.enum(['user', 'agent']),
  conversationId: z.string().min(1).nullable(),
  runId: z.string().min(1).nullable(),
}).strict();

export type CanvasCardId = z.infer<typeof CanvasCardIdSchema>;
export type CanvasEdgeId = z.infer<typeof CanvasEdgeIdSchema>;
export type CanvasElementId = z.infer<typeof CanvasElementIdSchema>;
export type CanvasSource = z.infer<typeof CanvasSourceSchema>;

export interface CanvasContentNode {
  type: string;
  text?: string;
  attrs?: Record<string, JsonValue>;
  content?: CanvasContentNode[];
  marks?: { type: string; attrs?: Record<string, JsonValue> }[];
}

const markSchema = z.object({
  type: z.enum(['bold', 'italic', 'strike', 'underline', 'code', 'link', 'textStyle', 'highlight', 'subscript', 'superscript']),
  attrs: z.record(z.string(), JsonValueSchema).optional(),
}).strict();

// 文档 JSON 是正文真源；这里只接纳产品支持的节点，不把未知 shape 静默降成正文。
export const CanvasContentNodeSchema: z.ZodType<CanvasContentNode> = z.lazy(() => contentNodeSchema);
const contentNodeSchema = z.object({
  type: z.enum([
    'doc', 'text', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
    'taskList', 'taskItem', 'blockquote', 'horizontalRule', 'hardBreak', 'documentReference',
    'codeBlock', 'table', 'tableRow', 'tableHeader', 'tableCell', 'image', 'inlineMath', 'blockMath',
  ]),
  text: z.string().optional(),
  attrs: z.record(z.string(), JsonValueSchema).optional(),
  content: z.array(CanvasContentNodeSchema).optional(),
  marks: z.array(markSchema).optional(),
}).strict();
export const CanvasTextDocumentSchema = z.preprocess((value, context) => {
  if (!isCanvasContentWithinDepth(value)) {
    context.addIssue({ code: 'custom', message: `画布正文JSON超过${CANVAS_CONTENT_MAX_DEPTH}层，请简化嵌套结构。` });
    return z.NEVER;
  }
  return value;
}, z.object({
  type: z.literal('doc'), content: z.array(CanvasContentNodeSchema),
}).strict());

const finite = z.number().finite();
const identity = {
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  order: z.string().min(1),
  locked: z.boolean(),
  color: CanvasColorSchema,
  createdBy: CanvasSourceSchema,
  updatedBy: CanvasSourceSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
};
const card = {
  ...identity, id: CanvasCardIdSchema,
  x: finite, y: finite, width: finite.positive(), height: finite.positive(),
  parentId: CanvasCardIdSchema.nullable(),
};

export const CanvasTextCardSchema = z.object({
  ...card, type: z.literal('text'),
  data: z.object({ contentVersion: z.literal(1), content: CanvasTextDocumentSchema,
    // 自动正文高度与用户固定高度必须能在关闭重开后区分。
    heightMode: z.enum(['auto', 'fixed']).default('auto'),
  }).strict(),
}).strict();
export const CanvasImageCropSchema = z.object({ x: finite.min(0).max(1), y: finite.min(0).max(1), width: finite.positive().max(1), height: finite.positive().max(1) }).strict()
  .refine(crop => crop.x + crop.width <= 1 && crop.y + crop.height <= 1, '裁剪范围不能超出原图');
export const CanvasImageCardSchema = z.object({
  ...card, type: z.literal('image'),
  data: z.object({
    assetId: z.string().min(1), caption: z.string(), alt: z.string(),
    crop: CanvasImageCropSchema.nullable(),
  }).strict(),
}).strict();
export const CanvasDocumentCardSchema = z.object({
  ...card, type: z.literal('document'),
  data: z.object({ documentId: z.string().min(1) }).strict(),
}).strict();
export const CanvasEndpointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('card'), cardId: CanvasCardIdSchema, side: z.enum(['auto', 'top', 'right', 'bottom', 'left']) }).strict(),
  z.object({ kind: z.literal('point'), x: finite, y: finite }).strict(),
]);
export const CanvasEdgeSchema = z.object({
  ...identity, id: CanvasEdgeIdSchema, type: z.literal('edge'),
  from: CanvasEndpointSchema, to: CanvasEndpointSchema,
  direction: z.enum(['none', 'forward', 'both']),
  lineStyle: z.enum(['curve', 'straight']), linePattern: z.enum(['solid', 'dashed']).default('solid'), label: z.string(),
}).strict();

export const CanvasCardSchema = z.discriminatedUnion('type', [CanvasTextCardSchema, CanvasImageCardSchema, CanvasDocumentCardSchema]);
export const CanvasElementSchema = z.discriminatedUnion('type', [CanvasTextCardSchema, CanvasImageCardSchema, CanvasDocumentCardSchema, CanvasEdgeSchema]);
export type CanvasTextDocument = z.infer<typeof CanvasTextDocumentSchema>;
export type CanvasColor = z.infer<typeof CanvasColorSchema>;
export type CanvasCard = z.infer<typeof CanvasCardSchema>;
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;
export type CanvasElement = z.infer<typeof CanvasElementSchema>;
export type CanvasEndpoint = z.infer<typeof CanvasEndpointSchema>;

export const CanvasIntegrityIssueSchema = z.object({ elementId: z.string().nullable(),
  code: z.enum(['future_format', 'unknown_element', 'invalid_element', 'dangling_edge']), message: z.string(),
}).strict();
export const CanvasIntegritySchema = z.object({ readOnly: z.literal(true), formatVersion: z.number().int(), issues: z.array(CanvasIntegrityIssueSchema) }).strict();
export type CanvasIntegrityIssue = z.infer<typeof CanvasIntegrityIssueSchema>;

export const CanvasSnapshotSchema = z.object({
  schemaVersion: z.literal(1), documentId: z.string().min(1),
  sequence: z.number().int().nonnegative(), elements: z.array(CanvasElementSchema), integrity: CanvasIntegritySchema.optional(),
}).strict();
export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;
