import { createAudioBlockMessage } from './audioBlockPresentation';
export function buildMicrophonePermissionError(errorName) {
  if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
    return createAudioBlockMessage('editor.audioBlock.status.microphonePermissionDenied');
  }
  if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
    return createAudioBlockMessage('editor.audioBlock.status.microphoneNotFound');
  }
  return createAudioBlockMessage('editor.audioBlock.status.microphoneAccessFailed');
}
