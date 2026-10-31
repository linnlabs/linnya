import { z } from 'zod';
import { WindowsRuntimeArtifactManifestSchema } from '../../../../local-process-runtime/windows/definitions/windowsRuntimeArtifactManifest';

export const WINDOWS_COMMAND_ISOLATION_ARTIFACT_FILE_NAME = 'linnyaCommandIsolation.exe';
export const WINDOWS_COMMAND_ISOLATION_MANIFEST_FILE_NAME = 'linnyaCommandIsolation.manifest.json';

export const WindowsCommandIsolationManifestSchema = WindowsRuntimeArtifactManifestSchema.extend({
  runtime_id: z.literal('linnya_windows_command_isolation'),
  protocol_version: z.literal(1),
  artifact: WindowsRuntimeArtifactManifestSchema.shape.artifact.extend({
    file_name: z.literal(WINDOWS_COMMAND_ISOLATION_ARTIFACT_FILE_NAME),
  }),
});
