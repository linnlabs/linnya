import { z } from 'zod';
import { CanvasCardIdSchema, type CanvasSnapshot } from '../../model/definitions/canvasElement';
import {
  CanvasCommandSchema,
  CanvasCommitResultSchema,
} from '../../changeset/definitions/canvasCommands';

export const CanvasLayoutTargetSchema = z
  .string()
  .regex(/^(?:c[1-9]\d*|\$[A-Za-z][A-Za-z0-9_-]*)$/);
export const CanvasArrangementOptionsSchema = z
  .object({
    algorithm: z.enum(['tree', 'grid', 'layered']).default('tree'),
    direction: z.enum(['right', 'down']).default('right'),
    elementIds: z.array(CanvasLayoutTargetSchema).min(1).optional(),
    columns: z.number().int().min(1).max(100).optional(),
    groups: z.array(z.array(CanvasLayoutTargetSchema).min(1)).optional(),
  })
  .strict();
export const CanvasLayoutOptionsSchema = CanvasArrangementOptionsSchema.extend({
  elementIds: z.array(CanvasCardIdSchema).optional(),
  groups: z.array(z.array(CanvasCardIdSchema).min(1)).optional(),
});
export type CanvasLayoutOptions = z.infer<typeof CanvasLayoutOptionsSchema>;
export interface CanvasLayoutRequest extends CanvasLayoutOptions {
  readonly requestId: string;
  readonly snapshot: CanvasSnapshot;
  /** 只排除实际占用位置/尺寸字段的卡；最终提交仍须重验租约和baseRevision。 */
  readonly protectedElementIds?: readonly string[];
}
export const CanvasLayoutDiagnosticSchema = z
  .object({
    code: z.enum([
      'locked',
      'editing',
      'not_found',
      'cycle_or_multiple_parents',
      'disconnected',
      'unchanged',
      'section_overlap',
    ]),
    elementIds: z.array(z.string()),
    message: z.string(),
  })
  .strict();
export type CanvasLayoutDiagnostic = z.infer<typeof CanvasLayoutDiagnosticSchema>;
export const CanvasLayoutMoveSchema = z
  .object({
    op: z.literal('update'),
    id: CanvasCardIdSchema,
    baseRevision: z.number().int().nonnegative(),
    // 宽高只用于分区：按分区排布后收紧到刚好包住成员。
    patch: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().positive().optional(),
        height: z.number().finite().positive().optional(),
      })
      .strict(),
  })
  .strict();
export const CanvasLayoutComputationSchema = z
  .object({
    origin: z.literal('node-worker'),
    requestId: z.string().min(1).max(160),
    sequence: z.number().int().nonnegative(),
    algorithm: CanvasArrangementOptionsSchema.shape.algorithm.unwrap(),
    executionMs: z.number().finite().nonnegative(),
  })
  .strict();
export type CanvasLayoutComputation = z.infer<typeof CanvasLayoutComputationSchema>;
export const CanvasLayoutResultSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    operations: z.array(CanvasLayoutMoveSchema),
    diagnostics: z.array(CanvasLayoutDiagnosticSchema),
    computation: CanvasLayoutComputationSchema,
  })
  .strict();
export type CanvasLayoutResult = z.infer<typeof CanvasLayoutResultSchema>;
export const CanvasArrangeRequestSchema = z
  .object({
    documentId: z.string().min(1),
    viewId: z.string().min(1),
    requestId: z.string().min(1).max(160),
    options: CanvasArrangementOptionsSchema,
    operations: z.array(CanvasCommandSchema).default([]),
    historyGroupId: z.string().min(1).optional(),
  })
  .strict();
export const CanvasArrangeResultSchema = z
  .object({
    commit: CanvasCommitResultSchema,
    diagnostics: z.array(CanvasLayoutDiagnosticSchema),
    computation: CanvasLayoutComputationSchema.nullable(),
    replayed: z.boolean(),
  })
  .strict();
export const CanvasCancelArrangementRequestSchema = z
  .object({
    documentId: z.string().min(1),
    viewId: z.string().min(1),
    requestId: z.string().min(1).max(160),
  })
  .strict();
export type CanvasArrangeRequest = z.infer<typeof CanvasArrangeRequestSchema>;
