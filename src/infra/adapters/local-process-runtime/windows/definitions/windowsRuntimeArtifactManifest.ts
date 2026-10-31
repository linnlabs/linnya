import { z } from 'zod';

const WindowsNativeSignatureEvidenceSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('development_unsigned'),
    }).strict(),
    z.object({ kind: z.literal('release_unsigned') }).strict(),
    z.object({
      kind: z.literal('authenticode_build_verified'),
      publisher_identity: z.string().min(1),
    }).strict(),
  ],
);

export const WindowsRuntimeArtifactManifestSchema = z.object({
  schema_version: z.literal(1),
  runtime_version: z.string().min(1),
  application_version: z.string().min(1),
  platform: z.literal('win32'),
  architecture: z.enum(['x64', 'arm64']),
  signature_evidence: WindowsNativeSignatureEvidenceSchema,
  artifact: z.object({
    file_name: z.string().min(1),
    size_bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
}).strict();

export type WindowsRuntimeArtifactManifest = z.infer<typeof WindowsRuntimeArtifactManifestSchema>;
