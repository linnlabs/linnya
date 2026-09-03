const SLIDES_DEBUG_STORAGE_KEY = 'linnya.slides.debug';

function readSlidesDebugStorageValue(): string | null {
  try {
    return globalThis.localStorage?.getItem(SLIDES_DEBUG_STORAGE_KEY) ?? null;
  } catch {
    return 'unavailable';
  }
}

export function isSlidesVerboseDiagnosticLoggingEnabled(): boolean {
  if (import.meta.env.MODE === 'test') {
    return false;
  }
  return readSlidesDebugStorageValue() === 'verbose';
}

export function logSlidesVerbose(
  scope: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (!isSlidesVerboseDiagnosticLoggingEnabled()) {
    return;
  }

  if (details) {
    console.info(`[Slides/${scope}] ${message}`, details);
    return;
  }
  console.info(`[Slides/${scope}] ${message}`);
}

export function warnSlides(
  scope: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  if (details) {
    console.warn(`[Slides/${scope}] ${message}`, details);
    return;
  }
  console.warn(`[Slides/${scope}] ${message}`);
}
