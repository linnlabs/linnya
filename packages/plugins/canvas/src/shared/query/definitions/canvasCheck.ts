import { z } from 'zod';
import { CanvasCardIdSchema, CanvasEdgeIdSchema } from '../../model/definitions/canvasElement';
export const CanvasCheckReportSchema = z.object({
  sequence: z.number().int().nonnegative(), cardCount: z.number().int().nonnegative(), edgeCount: z.number().int().nonnegative(),
  overlapCount: z.number().int().nonnegative(), crossingCount: z.number().int().nonnegative(),
  overlaps: z.array(z.tuple([CanvasCardIdSchema, CanvasCardIdSchema])).max(100),
  crossings: z.array(z.tuple([CanvasEdgeIdSchema, CanvasEdgeIdSchema])).max(100),
  longEdges: z.array(CanvasEdgeIdSchema), outliers: z.array(CanvasCardIdSchema), note: z.string(),
}).strict();
export type CanvasCheckReport = z.infer<typeof CanvasCheckReportSchema>;
