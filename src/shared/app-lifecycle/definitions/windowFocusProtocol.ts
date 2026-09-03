import { z } from 'zod';

export const WINDOW_FOCUS_STATE_CHANNEL = 'window-focus-state';

export const WindowFocusStateMessageSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal('window_focus_state'),
  focused: z.boolean(),
}).strict();

export type WindowFocusStateMessage = z.infer<typeof WindowFocusStateMessageSchema>;
