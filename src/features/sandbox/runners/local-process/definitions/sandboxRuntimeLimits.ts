import { z } from 'zod';

export const SANDBOX_MINIMUM_HEAP_MB = 16;
export const SANDBOX_MAXIMUM_HEAP_MB = 4_096;

export const SandboxHeapLimitMbSchema = z.number()
  .int()
  .safe()
  .min(SANDBOX_MINIMUM_HEAP_MB)
  .max(SANDBOX_MAXIMUM_HEAP_MB);

export function parseSandboxHeapLimitMb(value: unknown): number {
  const parsed = SandboxHeapLimitMbSchema.safeParse(value);
  if (!parsed.success) throw new Error('sandbox heap limit is outside the supported range');
  return parsed.data;
}
