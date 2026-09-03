import { z } from 'zod';

export const WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME =
  'linnyaCommandProcessOwner.node';
export const WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME =
  'linnyaCommandProcessOwner.manifest.json';

const WindowsNativeSignatureEvidenceSchema = z.discriminatedUnion(
  'kind',
  [
    z.object({
      kind: z.literal('development_unsigned'),
    }).strict(),
    z.object({
      kind: z.literal('authenticode_build_verified'),
      publisher_identity: z.string().min(1),
    }).strict(),
  ],
);

export const WindowsNativeRuntimeManifestSchema = z.object({
  schema_version: z.literal(1),
  runtime_id: z.literal('linnya_command_process_owner'),
  runtime_version: z.string().min(1),
  application_version: z.string().min(1),
  platform: z.literal('win32'),
  architecture: z.enum(['x64', 'arm64']),
  minimum_node_api_version: z.literal(8),
  binding_contract_version: z.literal(1),
  signature_evidence: WindowsNativeSignatureEvidenceSchema,
  artifact: z.object({
    file_name: z.literal(WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME),
    size_bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict(),
}).strict();

export type WindowsNativeRuntimeManifest = z.infer<
  typeof WindowsNativeRuntimeManifestSchema
>;

export type WindowsNativeRuntimeLoadErrorCode =
  | 'manifest_unavailable'
  | 'manifest_invalid'
  | 'runtime_mismatch'
  | 'runtime_signature_unverified'
  | 'artifact_unavailable'
  | 'artifact_not_unpacked'
  | 'artifact_size_mismatch'
  | 'artifact_hash_mismatch'
  | 'binding_load_failed'
  | 'binding_contract_invalid';

export class WindowsNativeRuntimeLoadError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: WindowsNativeRuntimeLoadErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message);
    this.name = 'WindowsNativeRuntimeLoadError';
    this.cause = options?.cause;
  }
}

export function parseWindowsNativeRuntimeManifest(
  input: unknown,
): WindowsNativeRuntimeManifest {
  return WindowsNativeRuntimeManifestSchema.parse(input);
}
