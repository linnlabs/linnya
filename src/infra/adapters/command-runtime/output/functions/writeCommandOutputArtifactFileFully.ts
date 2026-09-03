import type { CommandOutputArtifactWritableFile } from '../definitions/commandOutputArtifactFileOperations';

export async function writeCommandOutputArtifactFileFully(
  file: CommandOutputArtifactWritableFile,
  bytes: Uint8Array,
  startPosition: number,
  onProgress: (persisted: Uint8Array) => void,
): Promise<number> {
  let written = 0;
  while (written < bytes.byteLength) {
    const result = await file.write(
      bytes,
      written,
      bytes.byteLength - written,
      startPosition + written,
    );
    if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten <= 0) {
      throw Object.assign(new Error('command output write made no progress'), { code: 'EIO' });
    }
    const persisted = bytes.subarray(written, written + result.bytesWritten);
    onProgress(persisted);
    written += result.bytesWritten;
  }
  return written;
}
