import { z } from 'zod';
const tokenSchema = z.tuple([z.string().min(1), z.string().uuid()]);

/** Core只转发opaque token；Canvas把真实view与那次冻结草稿分别关联。 */
export function encodeCanvasHistorySession(viewId: string, captureId: string): string {
  return JSON.stringify(tokenSchema.parse([viewId, captureId]));
}
export function decodeCanvasHistorySession(token: string): { readonly viewId: string; readonly captureId: string } | null {
  let raw: unknown;
  try { raw = JSON.parse(token); } catch { return null; }
  const parsed = tokenSchema.safeParse(raw);
  return parsed.success ? { viewId: parsed.data[0], captureId: parsed.data[1] } : null;
}
