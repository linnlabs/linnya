import { z } from 'zod';
import { CanvasCheckReportSchema, CanvasLayoutResultSchema, CanvasLayoutOptionsSchema, CanvasSnapshotSchema } from '../../../shared';

const layoutRequest = CanvasLayoutOptionsSchema.extend({
  snapshot: CanvasSnapshotSchema, protectedElementIds: z.array(z.string()).readonly().optional(),
});
export const CanvasComputationWorkerRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('layout'), request: layoutRequest }).strict(),
  z.object({ kind: z.literal('check'), snapshot: CanvasSnapshotSchema }).strict(),
]);
const response = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('layout'), result: CanvasLayoutResultSchema }).strict(),
  z.object({ kind: z.literal('check'), result: CanvasCheckReportSchema }).strict(),
]);
export const CanvasComputationWorkerResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), response }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);
export type CanvasComputationRequest = z.infer<typeof CanvasComputationWorkerRequestSchema>;
export type CanvasComputationResponse = z.infer<typeof response>;
