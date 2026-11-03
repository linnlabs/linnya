import { z } from 'zod';
import { CanvasCardIdSchema, type CanvasSnapshot } from '../../model/definitions/canvasElement';
import { CanvasCommandSchema, type CanvasCommand } from '../../changeset/definitions/canvasCommands';

export const CanvasLayoutOptionsSchema = z.object({
  algorithm: z.enum(['tree', 'grid', 'layered']), direction: z.enum(['right', 'down']).default('right'),
  elementIds: z.array(CanvasCardIdSchema).optional(), columns: z.number().int().min(1).max(100).optional(),
  groups: z.array(z.array(CanvasCardIdSchema).min(1)).optional(),
}).strict();
export type CanvasLayoutOptions = z.infer<typeof CanvasLayoutOptionsSchema>;
export interface CanvasLayoutRequest extends CanvasLayoutOptions {
  readonly snapshot: CanvasSnapshot;
  /** 只排除实际占用位置/尺寸字段的卡；最终提交仍须重验租约和baseRevision。 */
  readonly protectedElementIds?: readonly string[];
}
export const CanvasLayoutDiagnosticSchema = z.object({
  code: z.enum(['locked', 'editing', 'not_found', 'cycle_or_multiple_parents', 'disconnected', 'unchanged']),
  elementIds: z.array(z.string()), message: z.string(),
}).strict();
export type CanvasLayoutDiagnostic = z.infer<typeof CanvasLayoutDiagnosticSchema>;
export interface CanvasLayoutResult {
  readonly sequence: number;
  readonly operations: readonly CanvasCommand[];
  readonly diagnostics: readonly CanvasLayoutDiagnostic[];
}
export const CanvasLayoutResultSchema: z.ZodType<CanvasLayoutResult> = z.object({
  sequence: z.number().int().nonnegative(), operations: z.array(CanvasCommandSchema), diagnostics: z.array(CanvasLayoutDiagnosticSchema),
}).strict();
