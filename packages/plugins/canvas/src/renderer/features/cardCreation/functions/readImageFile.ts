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
        reject(new Error('图片字节读取失败'));
        return;
      }
      resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error ?? new Error('图片字节读取失败'));
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException('图片读取已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    reader.readAsDataURL(file);
  });
}
