import { z } from 'zod';
import { CanvasCardIdSchema, CanvasSelectionContextSchema } from '@plugin/canvas/shared';
import type { ConversationReferenceInput } from '@plugin/renderer/conversationInputContribution';
export const CANVAS_SELECTION_REFERENCE_KIND = 'canvas-selection';
export const CanvasSelectionReferenceMetadataSchema = z
  .object({
    documentId: z.string().min(1),
    projectId: z.string().min(1),
    elementIds: z.array(CanvasCardIdSchema).min(1),
    originalCount: z.number().int().positive(),
    sequence: z.number().int().nonnegative().optional(),
  })
  .strict();
export type CanvasSelectionReferenceMetadata = z.infer<
  typeof CanvasSelectionReferenceMetadataSchema
>;
export interface CanvasSelectionReferencePort {
  save(documentId: string): Promise<boolean>;
  read(input: {
    documentId: string;
    elementIds: readonly string[];
    conversationId?: string;
    projectId?: string | null;
  }): Promise<z.infer<typeof CanvasSelectionContextSchema>>;
  add(input: ConversationReferenceInput & { pluginId: string; kind: string }): string;
  focusComposer(): Promise<boolean>;
  activate(metadata: CanvasSelectionReferenceMetadata): Promise<void>;
}
export type CanvasReferenceFocus = (
  ids: readonly z.infer<typeof CanvasCardIdSchema>[]
) => Promise<void>;
