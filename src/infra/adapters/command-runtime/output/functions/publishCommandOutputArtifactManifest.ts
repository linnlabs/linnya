import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { CommandOutputArtifactManifest } from '../../../../../domains/commands/definitions/commandOutputArtifact';
import type {
  CommandOutputArtifactFileOperations,
  CommandOutputArtifactWritableFile,
} from '../definitions/commandOutputArtifactFileOperations';
import { writeCommandOutputArtifactFileFully } from './writeCommandOutputArtifactFileFully';

export async function publishCommandOutputArtifactManifest(input: {
  readonly manifest: CommandOutputArtifactManifest;
  readonly executionDirectory: string;
  readonly manifestFileName: string;
  readonly operations: CommandOutputArtifactFileOperations;
}): Promise<void> {
  const manifestPath = path.join(input.executionDirectory, input.manifestFileName);
  const temporaryPath = path.join(
    input.executionDirectory,
    `.${input.manifestFileName}.${randomUUID()}.tmp`,
  );
  const bytes = new TextEncoder().encode(`${JSON.stringify(input.manifest, null, 2)}\n`);
  let temporaryFile: CommandOutputArtifactWritableFile | undefined;
  try {
    temporaryFile = await input.operations.openExclusive(temporaryPath);
    await writeCommandOutputArtifactFileFully(temporaryFile, bytes, 0, () => undefined);
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = undefined;
    await input.operations.rename(temporaryPath, manifestPath);
  } catch (error) {
    await temporaryFile?.close().catch(() => undefined);
    await input.operations.removeFile(temporaryPath).catch(() => undefined);
    throw error;
  }
}
