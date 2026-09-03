import path from 'node:path';

import { z } from 'zod';

const LocalProcessWindowsRuntimeTrustSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('development') }).strict(),
  z.object({
    kind: z.literal('release'),
    expected_publisher_identity: z.string().min(1),
  }).strict(),
]);

export const LocalProcessPlatformRuntimeSchema = z.discriminatedUnion('platform', [
  z.object({
    schema_version: z.literal(1),
    platform: z.literal('darwin'),
  }).strict(),
  z.object({
    schema_version: z.literal(1),
    platform: z.literal('win32'),
    manifest_path: z.string().min(1),
    expected_runtime_version: z.string().min(1),
    expected_application_version: z.string().min(1),
    trust: LocalProcessWindowsRuntimeTrustSchema,
  }).strict(),
]).superRefine((runtime, context) => {
  if (runtime.platform === 'win32' && !path.win32.isAbsolute(runtime.manifest_path)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['manifest_path'],
      message: 'Windows local process runtime manifest path must be absolute',
    });
  }
});

export type LocalProcessPlatformRuntime = z.infer<
  typeof LocalProcessPlatformRuntimeSchema
>;

export function parseLocalProcessPlatformRuntime(
  input: unknown,
): LocalProcessPlatformRuntime {
  return LocalProcessPlatformRuntimeSchema.parse(input);
}
