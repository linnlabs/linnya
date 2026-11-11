import { FileSessionOpenCancelledError, type FileSessionDescriptor } from '../definitions/fileSession';

export function isFileSessionOpenCancelledError(error: unknown): error is FileSessionOpenCancelledError {
  return error instanceof FileSessionOpenCancelledError;
}

export function throwIfFileSessionOpenCancelled(session: FileSessionDescriptor): void {
  if (session.openSignal?.aborted) {
    throw new FileSessionOpenCancelledError(session);
  }
}

