import { z } from 'zod';
import { WindowsRuntimeArtifactManifestSchema } from './windowsRuntimeArtifactManifest';

export const WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME =
  'linnyaCommandProcessOwner.node';
export const WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME =
  'linnyaCommandProcessOwner.manifest.json';

export const WindowsNativeRuntimeManifestSchema = WindowsRuntimeArtifactManifestSchema.extend({
  runtime_id: z.literal('linnya_command_process_owner'),
  minimum_node_api_version: z.literal(8),
  binding_contract_version: z.literal(1),
  artifact: WindowsRuntimeArtifactManifestSchema.shape.artifact.extend({
    file_name: z.literal(WINDOWS_OWNED_PIPE_NATIVE_ARTIFACT_FILE_NAME),
  }),
});

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
