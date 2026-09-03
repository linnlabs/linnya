import { nextTick, ref, watch } from 'vue';
import type {
  DocumentSurfaceRuntimePort,
  DocumentSurfaceReadyRef,
  WaitForDocumentSurfaceReadyOptions,
} from '@/shared/ports/documentSurfaceRuntimePort';

const DEFAULT_SURFACE_READY_TIMEOUT = 8000;
const readySurface = ref<DocumentSurfaceReadyRef | null>(null);

function createAbortError(): Error {
  return new Error('[documentRuntime] 等待 document surface ready 已取消');
}

function isSameSurface(a: DocumentSurfaceReadyRef | null, b: DocumentSurfaceReadyRef): boolean {
  return a?.type === b.type && a.id === b.id;
}

async function waitForSurfaceReadyOnly(
  surface: DocumentSurfaceReadyRef,
  options: WaitForDocumentSurfaceReadyOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SURFACE_READY_TIMEOUT;

  await nextTick();
  if (isSameSurface(readySurface.value, surface)) return;

  if (options.signal?.aborted) {
    throw createAbortError();
  }

  return new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      stopWatch();
      window.clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', handleAbort);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const inspect = () => {
      if (isSameSurface(readySurface.value, surface)) {
        finish();
      }
    };

    const handleAbort = () => {
      fail(createAbortError());
    };

    const timeoutId = window.setTimeout(() => {
      fail(new Error(`[documentRuntime] ${surface.type} surface is not ready within timeout`));
    }, timeoutMs);

    const stopWatch = watch(
      () => readySurface.value ? `${readySurface.value.type}:${readySurface.value.id}` : '',
      () => inspect(),
      { flush: 'post' },
    );

    options.signal?.addEventListener('abort', handleAbort, { once: true });
    inspect();
  });
}

export function createDocumentSurfaceRuntime(): DocumentSurfaceRuntimePort {
  return {
    markSurfaceReady(surface) {
      readySurface.value = { ...surface };
    },

    clearSurfaceReady(surface) {
      if (!surface || isSameSurface(readySurface.value, surface)) {
        readySurface.value = null;
      }
    },

    waitForSurfaceReady(surface, options = {}) {
      return waitForSurfaceReadyOnly(surface, options);
    },
  };
}
