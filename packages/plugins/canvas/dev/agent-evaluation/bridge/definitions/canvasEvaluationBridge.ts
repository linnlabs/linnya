import { z } from 'zod';
import { JsonValueSchema } from '@app/schemas';
import { CanvasCardIdSchema, CanvasCommandSchema, CanvasElementIdSchema } from '@plugin/canvas/shared';

const empty = z.object({}).strict();
export const CanvasEvaluationCommandSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string().uuid(), kind: z.literal('mount'), payload: z.object({ projectId: z.string().min(1), documentId: z.string().min(1) }).strict() }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('seed'), payload: z.object({ operations: z.array(CanvasCommandSchema).min(1).max(500) }).strict() }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('read'), payload: empty }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('edit'), payload: z.object({ elementId: CanvasCardIdSchema }).strict() }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('save'), payload: empty }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('fit'), payload: z.object({ elementIds: z.array(CanvasElementIdSchema).optional() }).strict() }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('stats'), payload: z.object({ reset: z.boolean().optional() }).strict() }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('frame-window'), payload: z.object({ since: z.number().nonnegative().finite(), until: z.number().nonnegative().finite() }).strict().refine(value => value.until >= value.since, '帧窗口终点不能早于起点') }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('readiness'), payload: z.object({ elementIds: z.array(CanvasCardIdSchema) }).strict() }).strict(),
  z.object({ id: z.string().uuid(), kind: z.literal('unmount'), payload: empty }).strict(),
]);
export type CanvasEvaluationCommand = z.infer<typeof CanvasEvaluationCommandSchema>;
export const CanvasEvaluationResultSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.string().uuid(), ok: z.literal(true), value: JsonValueSchema }).strict(),
  z.object({ id: z.string().uuid(), ok: z.literal(false), error: z.string() }).strict(),
]);
export type CanvasEvaluationResult = z.infer<typeof CanvasEvaluationResultSchema>;
export const CanvasEvaluationBridgeConnectionSchema = z.object({ protocol: z.literal(1), host: z.literal('127.0.0.1'), port: z.number().int().min(1).max(65535), nonce: z.string().min(32), projectId: z.string().min(1) }).strict();
export type CanvasEvaluationBridgeConnection = z.infer<typeof CanvasEvaluationBridgeConnectionSchema>;
