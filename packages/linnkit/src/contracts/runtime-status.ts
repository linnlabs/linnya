import { z } from 'zod';

export const ToolCallPhase = z.enum(['start', 'update', 'complete', 'error']);
export type ToolCallPhase = z.infer<typeof ToolCallPhase>;

export const Status = z.enum(['loading', 'success', 'error']);
export type Status = z.infer<typeof Status>;
