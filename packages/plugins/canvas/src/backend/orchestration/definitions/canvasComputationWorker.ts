import { z } from 'zod';
import { CanvasLayoutResultSchema, CanvasLayoutOptionsSchema, CanvasSnapshotSchema } from '../../../shared';

export const CanvasLayoutWorkerRequestSchema = CanvasLayoutOptionsSchema.extend({
  snapshot: CanvasSnapshotSchema, protectedElementIds: z.array(z.string()).optional(),
});
export const CanvasLayoutWorkerResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), result: CanvasLayoutResultSchema }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);
