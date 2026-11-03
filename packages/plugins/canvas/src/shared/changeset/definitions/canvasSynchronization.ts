import { z } from 'zod';
import { CanvasElementIdSchema, CanvasElementSchema, CanvasSnapshotSchema, CanvasSourceSchema } from '../../model/definitions/canvasElement';

export const CanvasElementChangeSchema = z.object({
  id: CanvasElementIdSchema, before: CanvasElementSchema.nullable(), after: CanvasElementSchema.nullable(),
  fields: z.array(z.string()),
}).strict();
export type CanvasElementChange = z.infer<typeof CanvasElementChangeSchema>;
export const CanvasCommitDeltaSchema = z.object({
  sequence: z.number().int().positive(), source: CanvasSourceSchema, changes: z.array(CanvasElementChangeSchema),
}).strict();
export const CanvasSynchronizationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot'), snapshot: CanvasSnapshotSchema }).strict(),
  z.object({ kind: z.literal('delta'), documentId: z.string(), fromSequence: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative(), commits: z.array(CanvasCommitDeltaSchema) }).strict(),
]);
export type CanvasSynchronization = z.infer<typeof CanvasSynchronizationSchema>;
export const CanvasChangedEventSchema = z.object({
  documentId: z.string(), sequence: z.number().int().nonnegative(),
  /** UTC毫秒，在SQLite事务完成后采样；不使用请求开始时间冒充提交到帧延迟。 */
  committedAt: z.number().finite().nonnegative().optional(),
  sourceKind: z.enum(['user', 'agent']).optional(), changedElementCount: z.number().int().nonnegative().optional(),
}).strict();
export type CanvasChangedEvent = z.infer<typeof CanvasChangedEventSchema>;
export const CanvasEditingRequestSchema = z.object({
  documentId: z.string().min(1), viewId: z.string().min(1), elementId: CanvasElementIdSchema,
  fields: z.array(z.enum(['data', 'x', 'y', 'width', 'height', 'from', 'to', 'label'])),
}).strict();
export const CanvasReadRequestSchema = z.object({ documentId: z.string().min(1), viewId: z.string().min(1).optional() }).strict();
export const CanvasCloseRequestSchema = z.object({ documentId: z.string().min(1), viewId: z.string().min(1) }).strict();
export const CanvasChangesRequestSchema = CanvasReadRequestSchema.extend({ afterSequence: z.number().int().nonnegative() });
export const CANVAS_CHANGED_CHANNEL = 'canvas:changed';
export const CANVAS_GROUPS_CHANGED_CHANNEL = 'canvas:groups-changed';
