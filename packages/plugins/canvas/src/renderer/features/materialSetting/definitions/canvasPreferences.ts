import { z } from 'zod';
export const CanvasPreferencesSchema = z.object({
  material: z.enum(['paper', 'card']), overview: z.enum(['titles', 'thumbnails']), wheelZoom: z.boolean(), snapping: z.boolean(), wheelSuggestionSeen: z.boolean().default(false),
}).strict();
export type CanvasPreferences = z.infer<typeof CanvasPreferencesSchema>;
export const DEFAULT_CANVAS_PREFERENCES: CanvasPreferences = { material: 'paper', overview: 'titles', wheelZoom: false, snapping: true, wheelSuggestionSeen: false };
