import { z } from 'zod';
import {
  CanvasCardIdSchema, CanvasColorSchema, CanvasDocumentCardSchema, CanvasElementIdSchema,
  CanvasEndpointSchema, CanvasImageCardSchema, CanvasTextCardSchema, CanvasTextDocumentSchema,
} from '../../model/definitions/canvasElement';

const finite = z.number().finite();
export const CanvasPatchSchema = z.object({
  x: finite.optional(), y: finite.optional(), width: finite.positive().optional(), height: finite.positive().optional(),
  color: CanvasColorSchema.optional(), locked: z.boolean().optional(), order: z.string().min(1).optional(),
  parentId: CanvasCardIdSchema.nullable().optional(),
  data: z.union([CanvasTextCardSchema.shape.data, CanvasImageCardSchema.shape.data, CanvasDocumentCardSchema.shape.data]).optional(),
  from: CanvasEndpointSchema.optional(), to: CanvasEndpointSchema.optional(),
  direction: z.enum(['none', 'forward', 'both']).optional(),
  lineStyle: z.enum(['curve', 'straight']).optional(), label: z.string().optional(),
}).strict().refine(patch => Object.keys(patch).length > 0, '至少修改一个字段');

const placement = {
  ref: z.string().regex(/^\$[A-Za-z][A-Za-z0-9_-]*$/).optional(),
  width: finite.positive(), height: finite.positive(),
  x: finite.optional(), y: finite.optional(), near: z.string().min(1).optional(),
  side: z.enum(['right', 'left', 'top', 'bottom']).optional(),
  color: CanvasColorSchema.optional(),
};
export const CanvasCommandSchema = z.discriminatedUnion('op', [
  z.object({ ...placement, op: z.literal('addText'), content: CanvasTextDocumentSchema }).strict(),
  z.object({ ...placement, op: z.literal('addImage'), data: CanvasImageCardSchema.shape.data }).strict(),
  z.object({ ...placement, op: z.literal('addDocument'), data: CanvasDocumentCardSchema.shape.data }).strict(),
  z.object({ op: z.literal('update'), id: z.string().min(1), baseRevision: z.number().int().nonnegative(), patch: CanvasPatchSchema }).strict(),
  z.object({ op: z.literal('delete'), id: z.string().min(1), baseRevision: z.number().int().nonnegative().optional() }).strict(),
  z.object({
    op: z.literal('connect'), ref: placement.ref,
    from: z.string().min(1), to: z.string().min(1),
    label: z.string().default(''), direction: z.enum(['none', 'forward', 'both']).default('forward'),
  }).strict(),
]);
export const CanvasCommitRequestSchema = z.object({
  documentId: z.string().min(1), requestId: z.string().min(1).max(160),
  operations: z.array(CanvasCommandSchema).min(1).max(500),
}).strict();
export const CanvasRendererCommitRequestSchema = CanvasCommitRequestSchema.extend({
  viewId: z.string().min(1), historyGroupId: z.string().min(1).optional(),
});
export const CanvasOperationResultSchema = z.object({
  index: z.number().int().nonnegative(), status: z.enum(['applied', 'skipped']),
  id: CanvasElementIdSchema.nullable(), reason: z.string().nullable(),
}).strict();
export const CanvasCommitResultSchema = z.object({
  documentId: z.string(), requestId: z.string(), sequence: z.number().int().nonnegative(),
  results: z.array(CanvasOperationResultSchema), refs: z.record(z.string(), CanvasElementIdSchema),
}).strict();
export type CanvasCommand = z.infer<typeof CanvasCommandSchema>;
export type CanvasCommitRequest = z.infer<typeof CanvasCommitRequestSchema>;
export type CanvasRendererCommitRequest = z.infer<typeof CanvasRendererCommitRequestSchema>;
export type CanvasCommitResult = z.infer<typeof CanvasCommitResultSchema>;
export type CanvasOperationResult = z.infer<typeof CanvasOperationResultSchema>;
export type CanvasPatch = z.infer<typeof CanvasPatchSchema>;
