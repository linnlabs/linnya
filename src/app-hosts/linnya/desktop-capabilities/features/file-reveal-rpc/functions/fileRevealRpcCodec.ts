import { z } from 'zod';

import type { DesktopFileRevealRpcRequest } from '../definitions/fileRevealRpc';

const DesktopFileRevealRpcRequestSchema = z.object({
  absolutePath: z.string().min(1),
}).strict();

export function parseDesktopFileRevealRpcRequest(
  value: unknown,
): DesktopFileRevealRpcRequest {
  return DesktopFileRevealRpcRequestSchema.parse(value);
}

export function parseDesktopFileRevealRpcResponse(value: unknown): null {
  return z.null().parse(value);
}
