import path from 'node:path';
import type { WindowsNativeRuntimeModuleLoaderOptions } from '../../../../local-process-runtime/windows/functions/loadVerifiedWindowsNativeRuntimeModule';
import { verifyWindowsRuntimeArtifact } from '../../../../local-process-runtime/windows/functions/verifyWindowsRuntimeArtifact';
import {
  WINDOWS_COMMAND_ISOLATION_ARTIFACT_FILE_NAME,
  WINDOWS_COMMAND_ISOLATION_MANIFEST_FILE_NAME,
  WindowsCommandIsolationManifestSchema,
} from '../definitions/windowsCommandIsolationManifest';

/** helper 与 native owner 同批构建，但有独立 manifest；full_access 不需要读取它。 */
export async function verifyWindowsCommandIsolationHelper(
  options: WindowsNativeRuntimeModuleLoaderOptions,
): Promise<string> {
  const result = await verifyWindowsRuntimeArtifact({
    ...options,
    manifestPath: path.join(path.dirname(options.manifestPath), WINDOWS_COMMAND_ISOLATION_MANIFEST_FILE_NAME),
  }, {
    parseManifest: value => WindowsCommandIsolationManifestSchema.parse(value),
    artifactFileName: WINDOWS_COMMAND_ISOLATION_ARTIFACT_FILE_NAME,
  });
  return result.artifactPath;
}
