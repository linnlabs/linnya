import { z } from 'zod';
import { CanvasCommitResultSchema } from '../../changeset/definitions/canvasCommands';
export const CanvasUndoRequestSchema = z.object({ documentId: z.string().min(1), viewId: z.string().min(1), requestId: z.string().min(1).max(160), direction: z.enum(['undo', 'redo']) }).strict();
export const CanvasUndoResultSchema = z.object({ commit: CanvasCommitResultSchema, canUndo: z.boolean(), canRedo: z.boolean() }).strict();
export type CanvasUndoRequest = z.infer<typeof CanvasUndoRequestSchema>;
export type CanvasUndoResult = z.infer<typeof CanvasUndoResultSchema>;
