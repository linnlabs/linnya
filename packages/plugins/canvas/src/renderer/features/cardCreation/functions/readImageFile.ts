import { canvasText } from '../../localization';
export function readImageFile(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const reader = new FileReader();
    const abort = () => reader.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    reader.onload = () => {
      cleanup();
      const value = reader.result;
      if (typeof value !== 'string') {
        reject(new Error(canvasText('canvas.input.image.unreadable')));
        return;
      }
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error ?? new Error(canvasText('canvas.input.image.unreadable')));
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException(canvasText('canvas.input.image.readCancelled'), 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(file);
  });
}
